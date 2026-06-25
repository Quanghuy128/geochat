"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { GroupConversation } from "./types";

/** Row dạng snake_case từ Postgres (bảng `group_conversations`). */
type GroupConversationRow = {
  id: string;
  name: string;
  creator_id: string;
  created_at: string;
};

type GroupMemberRow = {
  group_id: string;
  user_id: string;
  left_at: string | null;
};

type GroupMessageRow = {
  id: string;
  group_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type ProfileRow = {
  id: string;
  username: string;
};

export type UseGroupConversations = {
  groups: GroupConversation[];
  /** null = Supabase chưa cấu hình. */
  ready: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /**
   * Tạo group mới (atomic qua RPC `create_group`) — name + danh sách memberIds (KHÔNG
   * bao gồm chính mình, RPC tự thêm creator). Validate client-side trước (name non-empty
   * trimmed ≤100 ký tự, ≥1 member) — RPC vẫn là lưới an toàn thật (RLS + cap-50 trigger
   * áp dụng bên trong, security invoker).
   */
  createGroup: (
    name: string,
    memberIds: string[],
  ) => Promise<{ groupId: string | null; error: string | null }>;
};

const MAX_GROUP_NAME_LENGTH = 100;

/**
 * Quản lý inbox các group mà mình đang là thành viên (active, left_at is null) qua Supabase.
 *
 * - Load: select group_members (active, của mình) → lấy group_id list → join
 *   group_conversations (tên, creator) + đếm thành viên active + tin nhắn cuối (N+1 nhỏ,
 *   giống pattern useDmConversations/useFriends).
 * - createGroup(): gọi RPC `create_group` (migration 0008) — atomic, security invoker
 *   (RLS/cap-50 vẫn áp dụng). Validate client-side trước khi gọi (không network call nếu
 *   invalid — edge case #3/#11).
 * - Realtime: subscribe `group-conversations-{userId}` — INSERT trên group_members (own
 *   rows, group mới xuất hiện) + INSERT trên group_messages (update last-message preview
 *   tại chỗ nếu group đã có trong list, refetch nếu chưa có — giống useDmConversations).
 *
 * Null-safe: Supabase chưa cấu hình hoặc identity null → ready=false/rỗng, không lỗi.
 */
export function useGroupConversations(
  identity: { userId: string } | null,
): UseGroupConversations {
  const [groups, setGroups] = useState<GroupConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [supabase] = useState(() => createClient());
  const ready = supabase !== null;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  // Bản sao mới nhất của groups để Realtime handler đọc được mà không cần đưa `groups`
  // vào dependency array của effect subscribe (tránh resubscribe liên tục mỗi khi state đổi).
  const groupsRef = useRef<GroupConversation[]>([]);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    const userId = identityRef.current?.userId;
    if (!supabase || !userId) {
      if (isCancelled()) return;
      setGroups([]);
      return;
    }

    setLoading(true);
    setError(null);

    const { data: memberRows, error: memberErr } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
      .is("left_at", null);

    if (isCancelled()) return;

    if (memberErr) {
      setError(memberErr.message);
      setLoading(false);
      return;
    }

    const groupIds = ((memberRows as { group_id: string }[] | null) ?? []).map(
      (r) => r.group_id,
    );

    if (groupIds.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const { data: groupRows, error: groupErr } = await supabase
      .from("group_conversations")
      .select("*")
      .in("id", groupIds);

    if (isCancelled()) return;

    if (groupErr) {
      setError(groupErr.message);
      setLoading(false);
      return;
    }

    const rows = (groupRows as GroupConversationRow[] | null) ?? [];

    const withDetails = await Promise.all(
      rows.map(async (r) => {
        const { data: activeMembers } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", r.id)
          .is("left_at", null);
        const memberCount = ((activeMembers as { user_id: string }[] | null) ?? []).length;

        const { data: lastMsg } = await supabase
          .from("group_messages")
          .select("body, sender_id, created_at")
          .eq("group_id", r.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const last = lastMsg as
          | { body: string; sender_id: string; created_at: string }
          | null;

        let lastMessageSenderUsername: string | null = null;
        if (last && last.sender_id !== userId) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("username")
            .eq("id", last.sender_id)
            .maybeSingle();
          lastMessageSenderUsername = (prof as ProfileRow | null)?.username ?? null;
        }

        return {
          id: r.id,
          name: r.name,
          creatorId: r.creator_id,
          lastMessageBody: last?.body ?? null,
          lastMessageAt: last?.created_at ?? r.created_at,
          lastMessageSenderUsername,
          lastMessageMine: last ? last.sender_id === userId : false,
          memberCount,
        } satisfies GroupConversation;
      }),
    );

    if (isCancelled()) return;

    withDetails.sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );

    setGroups(withDetails);
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
  }, [supabase, identity?.userId, load]);

  useEffect(() => {
    if (!supabase || !identity?.userId) return;

    let cancelled = false;
    const userId = identity.userId;

    const channel = supabase
      .channel(`group-conversations-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_members" },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as GroupMemberRow;
          const me = identityRef.current?.userId;
          if (!me || row.user_id !== me) return;
          // Group mới mình vừa được thêm vào (creator tự thêm lúc tạo, hoặc creator
          // add sau) — đủ rẻ để refetch toàn bộ list.
          load();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages" },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as GroupMessageRow;
          const me = identityRef.current?.userId;
          if (!me) return;

          const current = groupsRef.current;
          const existing = current.find((g) => g.id === row.group_id);
          if (!existing) {
            // Group chưa có trong list local (vd vừa được tạo, chưa load lại) — refetch.
            load();
            return;
          }

          (async () => {
            let senderUsername: string | null = null;
            if (row.sender_id !== me) {
              const { data: prof } = await supabase
                .from("profiles")
                .select("username")
                .eq("id", row.sender_id)
                .maybeSingle();
              senderUsername = (prof as ProfileRow | null)?.username ?? null;
            }
            if (cancelled) return;

            setGroups((prev) => {
              const next = prev.map((g) =>
                g.id === row.group_id
                  ? {
                      ...g,
                      lastMessageBody: row.body,
                      lastMessageAt: row.created_at,
                      lastMessageSenderUsername: senderUsername,
                      lastMessageMine: row.sender_id === me,
                    }
                  : g,
              );
              next.sort(
                (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
              );
              return next;
            });
          })();
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [supabase, identity?.userId, load]);

  const createGroup = useCallback(
    async (
      name: string,
      memberIds: string[],
    ): Promise<{ groupId: string | null; error: string | null }> => {
      if (!supabase) return { groupId: null, error: "Supabase chưa cấu hình." };
      const userId = identityRef.current?.userId;
      if (!userId) return { groupId: null, error: "Bạn cần đăng nhập." };

      const trimmed = name.trim();
      if (!trimmed) return { groupId: null, error: "Vui lòng nhập tên nhóm." };
      if (trimmed.length > MAX_GROUP_NAME_LENGTH) {
        return {
          groupId: null,
          error: `Tên nhóm tối đa ${MAX_GROUP_NAME_LENGTH} ký tự.`,
        };
      }

      const uniqueMemberIds = Array.from(new Set(memberIds.filter((id) => id !== userId)));
      if (uniqueMemberIds.length === 0) {
        return { groupId: null, error: "Vui lòng chọn ít nhất 1 thành viên." };
      }

      const { data, error: err } = await supabase.rpc("create_group", {
        p_name: trimmed,
        p_member_ids: uniqueMemberIds,
      });

      if (err) {
        // RLS reject (1 member không phải bạn của creator) hoặc cap-50 trigger reject —
        // RPC rollback toàn bộ transaction (all-or-nothing, theo testplan mục 3.1/3.2).
        return {
          groupId: null,
          error:
            "Không thể tạo nhóm. Có thể một thành viên chưa kết bạn với bạn, hoặc nhóm đã đạt giới hạn.",
        };
      }

      await load();
      return { groupId: (data as string) ?? null, error: null };
    },
    [supabase, load],
  );

  return { groups, ready, loading, error, refetch: load, createGroup };
}
