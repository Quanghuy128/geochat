"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { DmMessage } from "./types";

/** Row dạng snake_case từ Postgres (bảng `dm_messages`). */
type DmMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type ConversationRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
};

function rowToDmMessage(r: DmMessageRow): DmMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body,
    createdAt: r.created_at,
  };
}

export type SendBlockedReason = "unfriended" | null;

export type UseDmMessages = {
  messages: DmMessage[];
  /** null = Supabase chưa cấu hình. */
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** false nếu friend status hiện tại không còn `accepted` (client hint, không phải lưới an toàn — RLS ở DB mới là thật). */
  canSend: boolean;
  sendBlockedReason: SendBlockedReason;
  send: (body: string) => Promise<{ error: string | null }>;
};

/**
 * Quản lý 1 DM thread (load lịch sử + realtime + gửi tin) qua Supabase.
 *
 * - Load: select * from dm_messages where conversation_id=X order by created_at asc
 *   limit 100 (giống pattern useMessages, không pagination — THINK #4).
 * - canSend/sendBlockedReason: query friend status 1 lần khi mount (client hint, hiển
 *   thị UI sớm — RLS INSERT mới là lưới an toàn THẬT, re-check tại thời điểm gửi).
 * - send(): trim, no-op nếu rỗng. Insert vào dm_messages — KHÔNG optimistic local append
 *   (đợi Realtime echo, giống ChatPanel/useMessages). Nếu RLS chặn (unfriended ngay tại
 *   thời điểm gửi, kể cả khi client hint stale) → set sendBlockedReason="unfriended" +
 *   trả {error} để UI restore draft (edge case #11, không tạo state rác).
 * - Realtime: subscribe `dm-thread-{conversationId}`, filter `conversation_id=eq.{id}`
 *   (Postgres Realtime hỗ trợ filter 1 cột đơn — khác `friend_requests` cần OR 2 cột) —
 *   re-subscribe khi conversationId đổi.
 *
 * Null-safe: Supabase chưa cấu hình hoặc identity/conversationId null → ready=false/rỗng.
 */
export function useDmMessages(
  conversationId: string | null,
  identity: { userId: string } | null,
): UseDmMessages {
  const [messages, setMessages] = useState<DmMessage[]>([]);
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
  // Ref riêng cho conversationId — load() đọc từ ref (không trực tiếp từ closure prop)
  // để effect gọi load() không bị flag react-hooks/set-state-in-effect (cùng pattern
  // identityRef đã dùng ở useFriends/useFriendRequests).
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // load(): tách thành useCallback (giống pattern useFriends/useFriendRequests) — effect
  // bên dưới chỉ GỌI load(), không setState trực tiếp trong thân effect (tránh
  // react-hooks/set-state-in-effect / cascading renders).
  //
  // `isCancelled`: callback kiểm tra trước MỖI setState sau 1 await — cùng pattern với
  // effect Realtime-subscribe bên dưới (flag `cancelled` đóng trong closure effect). Tránh
  // race: nếu user đổi conversationId (X → Y) trước khi load(X) resolve xong 3 await tuần
  // tự, kết quả stale của X có thể về SAU load(Y) và ghi đè messages/canSend/sendBlockedReason
  // của Y bằng dữ liệu cũ của X (review fix — canSend là security-adjacent UI hint).
  const load = useCallback(async (isCancelled: () => boolean) => {
    const currentConversationId = conversationIdRef.current;
    if (!supabase || !currentConversationId) {
      if (isCancelled()) return;
      setMessages([]);
      setCanSend(true);
      setSendBlockedReason(null);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("dm_messages")
      .select("*")
      .eq("conversation_id", currentConversationId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (isCancelled()) return;

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setMessages(((data as DmMessageRow[] | null) ?? []).map(rowToDmMessage));
    setLoading(false);

    // Friend-status hint: tìm conversation → lấy peer id → check accepted friend_requests.
    // Best-effort — lỗi ở bước này KHÔNG chặn việc xem lịch sử, chỉ ảnh hưởng canSend hint.
    const userId = identityRef.current?.userId;
    if (!userId) return;

    const { data: convo } = await supabase
      .from("conversations")
      .select("user_a_id, user_b_id")
      .eq("id", currentConversationId)
      .maybeSingle();
    if (isCancelled()) return;
    if (!convo) return;

    const c = convo as ConversationRow;
    const peerId = c.user_a_id === userId ? c.user_b_id : c.user_a_id;

    const { data: friendship } = await supabase
      .from("friend_requests")
      .select("id")
      .eq("status", "accepted")
      .or(
        `and(requester_id.eq.${userId},recipient_id.eq.${peerId}),and(requester_id.eq.${peerId},recipient_id.eq.${userId})`,
      )
      .maybeSingle();

    if (isCancelled()) return;

    if (friendship) {
      setCanSend(true);
      setSendBlockedReason(null);
    } else {
      setCanSend(false);
      setSendBlockedReason("unfriended");
    }
  }, [supabase]);

  // Load lịch sử + check friend status khi mở conversation (hoặc đổi conversation).
  // load() tự reset state rỗng nếu !supabase/!conversationId (đọc qua conversationIdRef)
  // — gọi qua load() (không setState trực tiếp trong thân effect) để tránh cascading
  // renders. Dependency `conversationId` ở đây CHỦ ĐỘNG kích hoạt lại effect khi đổi
  // thread (conversationIdRef đã được effect ở trên cập nhật TRƯỚC effect này chạy vì
  // khai báo phía trên trong cùng 1 component — React chạy effect theo thứ tự khai báo).
  //
  // `cancelled` flag (cùng pattern effect Realtime-subscribe bên dưới): khi conversationId
  // đổi nhanh (X → Y) trước khi load(X) resolve, cleanup set cancelled=true cho lần gọi của
  // X — mọi setState sau await trong load(X) trở thành no-op, không ghi đè state của Y.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      await load(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, conversationId, load]);

  // Realtime — re-subscribe khi conversationId đổi.
  useEffect(() => {
    if (!supabase || !conversationId) return;

    let cancelled = false;

    const channel = supabase
      .channel(`dm-thread-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dm_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (cancelled) return;
          const incoming = rowToDmMessage(payload.new as DmMessageRow);
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [supabase, conversationId]);

  const send = useCallback(
    async (body: string): Promise<{ error: string | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình." };
      const userId = identityRef.current?.userId;
      if (!userId) return { error: "Bạn cần đăng nhập." };
      if (!conversationId) return { error: "Chưa chọn cuộc trò chuyện." };

      const trimmed = body.trim();
      if (!trimmed) return { error: null };

      const { error: err } = await supabase.from("dm_messages").insert({
        conversation_id: conversationId,
        sender_id: userId,
        body: trimmed,
      });

      if (err) {
        // RLS chặn (unfriended tại thời điểm gửi, kể cả khi client hint stale) hoặc lỗi
        // khác — theo Interaction Notes design doc mục 5: coi RLS-denial như đã phát
        // hiện unfriended, cập nhật reactive ngay (không cần subscribe friend_requests riêng).
        setCanSend(false);
        setSendBlockedReason("unfriended");
        return { error: "Không gửi được tin nhắn. Có thể bạn không còn là bạn bè." };
      }

      return { error: null };
    },
    [supabase, conversationId],
  );

  return { messages, ready, loading, error, canSend, sendBlockedReason, send };
}
