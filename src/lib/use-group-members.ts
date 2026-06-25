"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { GroupMember } from "./types";

/** Row dạng snake_case từ Postgres (bảng `group_members`). */
type GroupMemberRow = {
  group_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
};

type GroupConversationRow = {
  id: string;
  creator_id: string;
};

type ProfileRow = {
  id: string;
  username: string;
};

export type UseGroupMembers = {
  members: GroupMember[];
  /** null = Supabase chưa cấu hình. */
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** true nếu viewer (mình) là creator của group này — điều khiển hiển thị nút Xóa/Thêm thành viên. */
  isCreator: boolean;
  creatorId: string | null;
  refetch: () => Promise<void>;
  /** Chỉ creator gọi được thật (RLS chặn người khác) — UI nên ẩn control nếu !isCreator. */
  addMembers: (userIds: string[]) => Promise<{ error: string | null }>;
  /** Chỉ creator gọi được thật (RLS chặn người khác xóa người khác). */
  removeMember: (userId: string) => Promise<{ error: string | null }>;
  /** Bất kỳ member nào (kể cả creator) tự rời. */
  leaveGroup: () => Promise<{ error: string | null }>;
};

/**
 * Quản lý thành viên (active, left_at is null) của 1 group — shared giữa GroupThread
 * (pill count + isCreator) và GroupMemberList (full list + mutations), theo PLAN/design
 * doc Open Question #7 default (1 hook, không tách 2).
 *
 * - Load: select group_conversations (lấy creator_id) + select group_members where
 *   left_at is null, join username.
 * - addMembers(): UPDATE left_at=null cho row đã tồn tại (re-join ex-member) HOẶC INSERT
 *   row mới (member chưa từng có row) — RLS re-check friend-gating tại thời điểm này,
 *   không cached từ lúc tạo group. Cap-50 trigger có thể reject — map sang lỗi rõ.
 * - removeMember()/leaveGroup(): UPDATE left_at = now() — soft-delete, không hard DELETE
 *   (lịch sử vẫn xem được sau khi rời, theo migration 0007).
 * - Realtime: subscribe `group-members-{groupId}` — INSERT/UPDATE trên group_members
 *   filtered group_id — member mới xuất hiện live, member rời/bị xóa biến mất live.
 *
 * Null-safe: Supabase chưa cấu hình hoặc identity/groupId null → ready=false/rỗng.
 */
export function useGroupMembers(
  groupId: string | null,
  identity: { userId: string } | null,
): UseGroupMembers {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatorId, setCreatorId] = useState<string | null>(null);

  const [supabase] = useState(() => createClient());
  const ready = supabase !== null;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);
  const groupIdRef = useRef(groupId);
  useEffect(() => {
    groupIdRef.current = groupId;
  }, [groupId]);
  const membersRef = useRef(members);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    const currentGroupId = groupIdRef.current;
    if (!supabase || !currentGroupId) {
      if (isCancelled()) return;
      setMembers([]);
      setCreatorId(null);
      return;
    }

    setLoading(true);
    setError(null);

    const { data: groupRow, error: groupErr } = await supabase
      .from("group_conversations")
      .select("id, creator_id")
      .eq("id", currentGroupId)
      .maybeSingle();

    if (isCancelled()) return;

    if (groupErr) {
      setError(groupErr.message);
      setLoading(false);
      return;
    }

    const creator = (groupRow as GroupConversationRow | null)?.creator_id ?? null;
    setCreatorId(creator);

    const { data: memberRows, error: memberErr } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", currentGroupId)
      .is("left_at", null);

    if (isCancelled()) return;

    if (memberErr) {
      setError(memberErr.message);
      setLoading(false);
      return;
    }

    const rows = (memberRows as GroupMemberRow[] | null) ?? [];
    if (rows.length === 0) {
      setMembers([]);
      setLoading(false);
      return;
    }

    const userIds = rows.map((r) => r.user_id);
    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", userIds);

    if (isCancelled()) return;

    if (profErr) {
      setError(profErr.message);
      setLoading(false);
      return;
    }

    const usernameById = new Map<string, string>(
      ((profiles as ProfileRow[] | null) ?? []).map((p) => [p.id, p.username]),
    );

    setMembers(
      rows.map((r) => ({
        id: r.user_id,
        username: usernameById.get(r.user_id) ?? "?",
        isCreator: r.user_id === creator,
        joinedAt: r.joined_at,
      })),
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      await load(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, groupId, load]);

  useEffect(() => {
    if (!supabase || !groupId) return;

    let cancelled = false;

    const channel = supabase
      .channel(`group-members-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_members",
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          if (cancelled) return;
          load();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "group_members",
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          if (cancelled) return;
          load();
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [supabase, groupId, load]);

  const addMembers = useCallback(
    async (userIds: string[]): Promise<{ error: string | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình." };
      const currentGroupId = groupIdRef.current;
      if (!currentGroupId) return { error: "Chưa chọn nhóm." };
      if (userIds.length === 0) return { error: null };

      // Chặn duplicate-add SỚM: nếu target đã là member ACTIVE (left_at is null) theo state
      // `members` đã load (đọc qua ref để tránh stale closure trong useCallback), UPDATE
      // left_at=null phía dưới sẽ "thành công" như 1 no-op (1 row matched, giá trị không
      // đổi) và trả về error:null như thể vừa add thật — silently che giấu duplicate-add
      // (edge case #4 / AC5). Trả lỗi rõ ràng ngay tại đây, không proceed.
      const activeMemberIds = new Set(membersRef.current.map((m) => m.id));
      const alreadyActive = userIds.filter((id) => activeMemberIds.has(id));
      if (alreadyActive.length > 0) {
        return { error: "đã là thành viên" };
      }

      // Mỗi userId: thử UPDATE trước (re-join ex-member, row đã tồn tại với left_at not
      // null) — nếu 0 row matched (chưa từng có row), fallback INSERT row mới.
      for (const userId of userIds) {
        const { data: updated, error: updateErr } = await supabase
          .from("group_members")
          .update({ left_at: null })
          .eq("group_id", currentGroupId)
          .eq("user_id", userId)
          .select();

        if (updateErr) {
          return {
            error:
              "Không thể thêm thành viên. Có thể chưa kết bạn, hoặc nhóm đã đạt giới hạn 50 thành viên.",
          };
        }

        if (updated && updated.length > 0) continue;

        const { error: insertErr } = await supabase.from("group_members").insert({
          group_id: currentGroupId,
          user_id: userId,
          left_at: null,
        });

        if (insertErr) {
          return {
            error:
              "Không thể thêm thành viên. Có thể chưa kết bạn, hoặc nhóm đã đạt giới hạn 50 thành viên.",
          };
        }
      }

      await load();
      return { error: null };
    },
    [supabase, load],
  );

  const removeMember = useCallback(
    async (userId: string): Promise<{ error: string | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình." };
      const currentGroupId = groupIdRef.current;
      if (!currentGroupId) return { error: "Chưa chọn nhóm." };

      const { data, error: err } = await supabase
        .from("group_members")
        .update({ left_at: new Date().toISOString() })
        .eq("group_id", currentGroupId)
        .eq("user_id", userId)
        .select();

      if (err) return { error: "Không thể xóa thành viên này." };
      if (!data || data.length === 0) {
        await load();
        return { error: "Không thể xóa thành viên này (chỉ người tạo nhóm mới có quyền)." };
      }

      setMembers((prev) => prev.filter((m) => m.id !== userId));
      return { error: null };
    },
    [supabase, load],
  );

  const leaveGroup = useCallback(async (): Promise<{ error: string | null }> => {
    if (!supabase) return { error: "Supabase chưa cấu hình." };
    const currentGroupId = groupIdRef.current;
    const userId = identityRef.current?.userId;
    if (!currentGroupId) return { error: "Chưa chọn nhóm." };
    if (!userId) return { error: "Bạn cần đăng nhập." };

    const { data, error: err } = await supabase
      .from("group_members")
      .update({ left_at: new Date().toISOString() })
      .eq("group_id", currentGroupId)
      .eq("user_id", userId)
      .select();

    if (err) return { error: "Không thể rời nhóm." };
    if (!data || data.length === 0) {
      return { error: "Bạn không còn là thành viên nhóm này." };
    }

    setMembers((prev) => prev.filter((m) => m.id !== userId));
    return { error: null };
  }, [supabase]);

  const isCreator = Boolean(creatorId && identity?.userId && creatorId === identity.userId);

  return {
    members,
    ready,
    loading,
    error,
    isCreator,
    creatorId,
    refetch: load,
    addMembers,
    removeMember,
    leaveGroup,
  };
}
