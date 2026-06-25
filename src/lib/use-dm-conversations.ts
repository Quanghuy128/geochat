"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { DmConversation } from "./types";

/** Row dạng snake_case từ Postgres (bảng `conversations`). */
type ConversationRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
};

type DmMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type ProfileRow = {
  id: string;
  username: string;
};

export type UseDmConversations = {
  conversations: DmConversation[];
  /** null = Supabase chưa cấu hình. */
  ready: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /**
   * Tìm conversation 1-1 đã có với `peerId`, hoặc tạo mới nếu chưa có (idempotent).
   * Trả lỗi rõ ràng (tiếng Việt) nếu RLS chặn (không phải bạn `accepted`).
   */
  findOrCreate: (peerId: string) => Promise<{ conversationId: string | null; error: string | null }>;
};

/**
 * Quản lý inbox các DM conversation của mình qua Supabase.
 *
 * - Load: select * from conversations where user_a_id=me or user_b_id=me, rồi join
 *   username đối phương (profiles) + tin nhắn cuối (1 query nhỏ mỗi conversation —
 *   N+1, chấp nhận được vì danh sách DM nhỏ, giống pattern useFriends/useFriendRequests).
 * - findOrCreate(peerId): SELECT existing → có thì trả về ngay; không có thì INSERT —
 *   bắt lỗi 23505 (race 2 user bấm đồng thời) → fallback SELECT lại (dm-chat-STATE.md
 *   > PLAN > mục 3, edge case #7/#8).
 * - Realtime: subscribe `dm-conversations-{userId}` trên `conversations` (INSERT) +
 *   `dm_messages` (INSERT) — không filter theo cột (Realtime không hỗ trợ OR 2 cột),
 *   lọc ở client + dựa vào RLS để không leak event của người khác (risk kế thừa từ
 *   friends feature, xem PLAN mục 5b — CHƯA verify thật, QA gate bắt buộc).
 *
 * Null-safe: Supabase chưa cấu hình hoặc identity null → ready=false/rỗng, không lỗi.
 */
export function useDmConversations(identity: { userId: string } | null): UseDmConversations {
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [supabase] = useState(() => createClient());
  const ready = supabase !== null;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  // Bản sao mới nhất của conversations để Realtime handler đọc được mà không phải
  // đưa `conversations` vào dependency array của effect subscribe (tránh resubscribe
  // liên tục mỗi khi state đổi).
  const conversationsRef = useRef<DmConversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const load = useCallback(async () => {
    const userId = identityRef.current?.userId;
    if (!supabase || !userId) {
      setConversations([]);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("conversations")
      .select("*")
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const rows = (data as ConversationRow[] | null) ?? [];
    if (rows.length === 0) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const peerIds = rows.map((r) => (r.user_a_id === userId ? r.user_b_id : r.user_a_id));

    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", peerIds);

    if (profErr) {
      setError(profErr.message);
      setLoading(false);
      return;
    }

    const usernameById = new Map<string, string>(
      ((profiles as ProfileRow[] | null) ?? []).map((p) => [p.id, p.username]),
    );

    // Tin nhắn cuối mỗi conversation — N+1 query nhỏ (chấp nhận, danh sách DM thường nhỏ,
    // giống pattern useFriends/useFriendRequests, xem PLAN mục 3 "Load").
    const withLastMessage = await Promise.all(
      rows.map(async (r) => {
        const peerId = r.user_a_id === userId ? r.user_b_id : r.user_a_id;
        const { data: lastMsg } = await supabase
          .from("dm_messages")
          .select("body, sender_id, created_at")
          .eq("conversation_id", r.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const last = lastMsg as { body: string; sender_id: string; created_at: string } | null;

        return {
          id: r.id,
          peerId,
          peerUsername: usernameById.get(peerId) ?? "?",
          lastMessageBody: last?.body ?? null,
          lastMessageAt: last?.created_at ?? r.created_at,
          lastMessageMine: last ? last.sender_id === userId : false,
        } satisfies DmConversation;
      }),
    );

    withLastMessage.sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );

    setConversations(withLastMessage);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    load();
    if (!identity?.userId) return;

    let cancelled = false;
    const userId = identity.userId;

    const channel = supabase
      .channel(`dm-conversations-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as ConversationRow;
          const me = identityRef.current?.userId;
          if (!me) return;
          if (row.user_a_id !== me && row.user_b_id !== me) return;
          // Conversation mới (do mình hoặc peer tạo) — đủ rẻ để refetch toàn bộ list.
          load();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_messages" },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as DmMessageRow;
          const me = identityRef.current?.userId;
          if (!me) return;

          const current = conversationsRef.current;
          const existing = current.find((c) => c.id === row.conversation_id);
          if (!existing) {
            // Conversation chưa có trong list local (vd vừa được tạo bởi peer, mình
            // chưa từng load) — refetch 1 lần cho chắc (đủ rẻ).
            load();
            return;
          }

          setConversations((prev) => {
            const next = prev.map((c) =>
              c.id === row.conversation_id
                ? {
                    ...c,
                    lastMessageBody: row.body,
                    lastMessageAt: row.created_at,
                    lastMessageMine: row.sender_id === me,
                  }
                : c,
            );
            next.sort(
              (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
            );
            return next;
          });
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

  const findOrCreate = useCallback(
    async (peerId: string): Promise<{ conversationId: string | null; error: string | null }> => {
      if (!supabase) return { conversationId: null, error: "Supabase chưa cấu hình." };
      const userId = identityRef.current?.userId;
      if (!userId) return { conversationId: null, error: "Bạn cần đăng nhập." };
      if (peerId === userId) {
        return { conversationId: null, error: "Không thể tự nhắn tin cho chính mình." };
      }

      const selectExisting = async (): Promise<string | null> => {
        const { data } = await supabase
          .from("conversations")
          .select("id")
          .or(
            `and(user_a_id.eq.${userId},user_b_id.eq.${peerId}),and(user_a_id.eq.${peerId},user_b_id.eq.${userId})`,
          )
          .limit(1)
          .maybeSingle();
        return (data as { id: string } | null)?.id ?? null;
      };

      const existingId = await selectExisting();
      if (existingId) return { conversationId: existingId, error: null };

      const { data: inserted, error: insertErr } = await supabase
        .from("conversations")
        .insert({ user_a_id: userId, user_b_id: peerId })
        .select("id")
        .single();

      if (!insertErr && inserted) {
        return { conversationId: (inserted as { id: string }).id, error: null };
      }

      // Race: 2 user bấm "Nhắn tin" gần như đồng thời → unique index chặn 1 trong 2
      // INSERT → 23505 → fallback SELECT lại để lấy id do request đầu tạo ra (vô hại).
      if (insertErr?.code === "23505") {
        const fallbackId = await selectExisting();
        if (fallbackId) return { conversationId: fallbackId, error: null };
      }

      // RLS chặn (không phải bạn `accepted`) hoặc lỗi khác — map sang thông báo rõ.
      return {
        conversationId: null,
        error: "Chỉ chat riêng được với bạn bè đã kết bạn.",
      };
    },
    [supabase],
  );

  return { conversations, ready, loading, error, refetch: load, findOrCreate };
}
