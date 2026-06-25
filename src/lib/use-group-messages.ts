"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { GroupMessage } from "./types";

/** Row dạng snake_case từ Postgres (bảng `group_messages`). */
type GroupMessageRow = {
  id: string;
  group_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type GroupMemberRow = {
  group_id: string;
  user_id: string;
  left_at: string | null;
};

type ProfileRow = {
  id: string;
  username: string;
};

export type SendBlockedReason = "removed" | null;

export type UseGroupMessages = {
  messages: GroupMessage[];
  /** null = Supabase chưa cấu hình. */
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** false nếu hiện không còn là active member (left_at not null) — client hint, RLS ở DB mới là lưới an toàn thật. */
  canSend: boolean;
  sendBlockedReason: SendBlockedReason;
  send: (body: string) => Promise<{ error: string | null }>;
};

/**
 * Quản lý 1 group thread (load lịch sử + realtime + gửi tin) qua Supabase.
 *
 * Phải dùng cancelled-flag race-safety pattern TỪ ĐẦU (không phải fix sau review như
 * use-dm-messages.ts đã từng cần) — load() nhận `isCancelled: () => boolean`, effect bọc
 * bằng local `cancelled` flag, check sau MỖI await (xem PLAN > Hooks > use-group-messages.ts).
 *
 * - Load: select * from group_messages where group_id=X order by created_at asc limit 100,
 *   join sender username (group cần hiển thị tên người gửi mỗi tin — khác DM chỉ có 1 "theirs").
 * - canSend/sendBlockedReason: query group_members (group_id, user_id=me) left_at is null
 *   1 lần khi mount (client hint) — RLS INSERT mới là lưới an toàn THẬT, re-check tại thời
 *   điểm gửi.
 * - Realtime: subscribe `group-thread-{groupId}` — INSERT trên group_messages (filter
 *   group_id) + UPDATE trên group_members (filter group_id, để reactive blocked-send detection
 *   khi mình bị xóa/rời mà KHÔNG cần gửi thất bại trước — Interaction Notes mục 5).
 *
 * Null-safe: Supabase chưa cấu hình hoặc identity/groupId null → ready=false/rỗng.
 */
export function useGroupMessages(
  groupId: string | null,
  identity: { userId: string } | null,
): UseGroupMessages {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSend, setCanSend] = useState(true);
  const [sendBlockedReason, setSendBlockedReason] = useState<SendBlockedReason>(null);

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

  // load(): tách thành useCallback nhận `isCancelled` — check sau MỖI await để tránh race
  // (đổi groupId nhanh X→Y trước khi load(X) resolve hết, kết quả stale của X về SAU load(Y)
  // không được ghi đè state của Y — cùng pattern use-dm-messages.ts, áp dụng từ đầu ở đây).
  const load = useCallback(async (isCancelled: () => boolean) => {
    const currentGroupId = groupIdRef.current;
    if (!supabase || !currentGroupId) {
      if (isCancelled()) return;
      setMessages([]);
      setCanSend(true);
      setSendBlockedReason(null);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("group_messages")
      .select("*")
      .eq("group_id", currentGroupId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (isCancelled()) return;

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const rows = (data as GroupMessageRow[] | null) ?? [];
    const senderIds = Array.from(new Set(rows.map((r) => r.sender_id)));

    let usernameById = new Map<string, string>();
    if (senderIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", senderIds);
      if (isCancelled()) return;
      usernameById = new Map(
        ((profiles as ProfileRow[] | null) ?? []).map((p) => [p.id, p.username]),
      );
    }

    setMessages(
      rows.map((r) => ({
        id: r.id,
        groupId: r.group_id,
        senderId: r.sender_id,
        senderUsername: usernameById.get(r.sender_id) ?? "?",
        body: r.body,
        createdAt: r.created_at,
      })),
    );
    setLoading(false);

    // Membership hint: check left_at is null cho (group_id, user_id=me) — best-effort,
    // lỗi ở bước này KHÔNG chặn việc xem lịch sử, chỉ ảnh hưởng canSend hint.
    const userId = identityRef.current?.userId;
    if (!userId) return;

    const { data: memberRow } = await supabase
      .from("group_members")
      .select("left_at")
      .eq("group_id", currentGroupId)
      .eq("user_id", userId)
      .maybeSingle();

    if (isCancelled()) return;

    const m = memberRow as { left_at: string | null } | null;
    if (m && m.left_at === null) {
      setCanSend(true);
      setSendBlockedReason(null);
    } else {
      setCanSend(false);
      setSendBlockedReason("removed");
    }
  }, [supabase]);

  // Load lịch sử + check membership khi mở thread (hoặc đổi group). cancelled-flag: khi
  // groupId đổi nhanh (X→Y) trước khi load(X) resolve, cleanup set cancelled=true cho lần
  // gọi của X — mọi setState sau await trong load(X) trở thành no-op, không ghi đè state Y.
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

  // Realtime — re-subscribe khi groupId đổi.
  useEffect(() => {
    if (!supabase || !groupId) return;

    let cancelled = false;

    const channel = supabase
      .channel(`group-thread-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as GroupMessageRow;
          const me = identityRef.current?.userId;

          (async () => {
            let senderUsername = "?";
            if (row.sender_id === me) {
              senderUsername = "Bạn";
            } else {
              const { data: prof } = await supabase
                .from("profiles")
                .select("username")
                .eq("id", row.sender_id)
                .maybeSingle();
              if (cancelled) return;
              senderUsername = (prof as ProfileRow | null)?.username ?? "?";
            }
            if (cancelled) return;

            const incoming: GroupMessage = {
              id: row.id,
              groupId: row.group_id,
              senderId: row.sender_id,
              senderUsername,
              body: row.body,
              createdAt: row.created_at,
            };
            setMessages((prev) =>
              prev.some((msg) => msg.id === incoming.id) ? prev : [...prev, incoming],
            );
          })();
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
        (payload) => {
          if (cancelled) return;
          const row = payload.new as GroupMemberRow;
          const me = identityRef.current?.userId;
          if (!me || row.user_id !== me) return;

          // Reactive blocked-send detection — KHÔNG cần đợi 1 lần gửi thất bại trước
          // (Interaction Notes mục 5: stronger requirement than DM's fallback-only).
          if (row.left_at !== null) {
            setCanSend(false);
            setSendBlockedReason("removed");
          } else {
            setCanSend(true);
            setSendBlockedReason(null);
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [supabase, groupId]);

  const send = useCallback(
    async (body: string): Promise<{ error: string | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình." };
      const userId = identityRef.current?.userId;
      if (!userId) return { error: "Bạn cần đăng nhập." };
      if (!groupId) return { error: "Chưa chọn nhóm." };

      const trimmed = body.trim();
      if (!trimmed) return { error: null };

      const { error: err } = await supabase.from("group_messages").insert({
        group_id: groupId,
        sender_id: userId,
        body: trimmed,
      });

      if (err) {
        // RLS chặn (đã rời/bị xóa tại thời điểm gửi, kể cả khi client hint stale) —
        // coi RLS-denial như đã phát hiện "removed", cập nhật reactive ngay (giống DM).
        setCanSend(false);
        setSendBlockedReason("removed");
        return { error: "Không gửi được tin nhắn. Có thể bạn không còn là thành viên nhóm." };
      }

      return { error: null };
    },
    [supabase, groupId],
  );

  return { messages, ready, loading, error, canSend, sendBlockedReason, send };
}
