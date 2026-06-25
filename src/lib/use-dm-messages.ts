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
  reply_to_message_id: string | null;
};

type ConversationRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
};

/** Độ dài tối đa của preview trích dẫn tin gốc (ký tự) — đủ cho 1 dòng UI. */
const REPLY_PREVIEW_MAX_LEN = 80;

function truncateBody(body: string): string {
  return body.length > REPLY_PREVIEW_MAX_LEN
    ? `${body.slice(0, REPLY_PREVIEW_MAX_LEN)}…`
    : body;
}

/**
 * Map "id tin nhắn -> { senderLabel, bodyPreview }" cho TOÀN BỘ tin nhắn trong batch hiện tại
 * — dùng để denormalize `replyPreview` không cần round trip riêng (PLAN > Hooks modified).
 * `senderLabel` ở đây là "Bạn"/peerUsername — tính tại nơi gọi (load/Realtime handler) vì
 * cần biết `myUserId`/`peerUsername`, hàm build map chỉ ghép theo id.
 */
function rowToDmMessage(
  r: DmMessageRow,
  resolveSenderLabel: (senderId: string) => string,
  byId: Map<string, DmMessageRow>,
): DmMessage {
  let replyPreview: DmMessage["replyPreview"] = null;
  if (r.reply_to_message_id) {
    const target = byId.get(r.reply_to_message_id);
    if (target) {
      replyPreview = {
        messageId: target.id,
        senderLabel: resolveSenderLabel(target.sender_id),
        bodyPreview: truncateBody(target.body),
      };
    }
  }
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body,
    createdAt: r.created_at,
    replyToMessageId: r.reply_to_message_id,
    replyPreview,
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
  /**
   * `replyToMessageId` (tùy chọn) — tham chiếu tới 1 tin nhắn CÙNG conversation này; DB
   * trigger `dm_messages_check_reply_scope` raise exception nếu trỏ sai conversation (edge
   * case #6) — hook không tự validate phía client, để DB là nguồn sự thật.
   */
  send: (body: string, replyToMessageId?: string | null) => Promise<{ error: string | null }>;
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
  /**
   * Username của đối phương — dùng để denormalize `replyPreview.senderLabel` ("Bạn" vs
   * "@peerUsername") không cần query thêm. Optional/best-effort: nếu chưa có (ví dụ truyền
   * muộn), `senderLabel` rơi về "?" — không chặn render.
   */
  peerUsername?: string,
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
  const peerUsernameRef = useRef(peerUsername);
  useEffect(() => {
    peerUsernameRef.current = peerUsername;
  }, [peerUsername]);

  const resolveSenderLabel = useCallback(
    (senderId: string) => {
      const me = identityRef.current?.userId;
      if (senderId === me) return "Bạn";
      return peerUsernameRef.current ? `@${peerUsernameRef.current}` : "?";
    },
    [],
  );

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
    const rows = (data as DmMessageRow[] | null) ?? [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    setMessages(rows.map((r) => rowToDmMessage(r, resolveSenderLabel, byId)));
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
  }, [supabase, resolveSenderLabel]);

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
          const row = payload.new as DmMessageRow;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            // replyPreview denormalized từ batch ĐÃ LOADED hiện tại (prev) — không round
            // trip riêng, đúng PLAN. Nếu tin gốc không có trong prev (ngoài window 100,
            // hoặc đã bị xóa trong tương lai), replyPreview = null — UI tự xử lý.
            let replyPreview: DmMessage["replyPreview"] = null;
            if (row.reply_to_message_id) {
              const target = prev.find((m) => m.id === row.reply_to_message_id);
              if (target) {
                replyPreview = {
                  messageId: target.id,
                  senderLabel: resolveSenderLabel(target.senderId),
                  bodyPreview: truncateBody(target.body),
                };
              }
            }
            const incoming: DmMessage = {
              id: row.id,
              conversationId: row.conversation_id,
              senderId: row.sender_id,
              body: row.body,
              createdAt: row.created_at,
              replyToMessageId: row.reply_to_message_id,
              replyPreview,
            };
            return [...prev, incoming];
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
  }, [supabase, conversationId, resolveSenderLabel]);

  const send = useCallback(
    async (
      body: string,
      replyToMessageId?: string | null,
    ): Promise<{ error: string | null }> => {
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
        reply_to_message_id: replyToMessageId ?? null,
      });

      if (err) {
        // Edge case #6: trigger `dm_messages_check_reply_scope` dùng plain `raise exception`
        // (KHÔNG có `using errcode`) khi reply_to_message_id trỏ sai conversation — Postgres
        // surface plpgsql `raise exception` mặc định dưới SQLSTATE P0001, KHÁC với RLS policy
        // denial (luôn là 42501). Post-review fix (blocker #3): dùng `err.code === "P0001"`
        // thay vì substring-match trên `err.message` (brittle — text exception có thể đổi vì
        // lý do không liên quan như i18n/sửa lỗi đánh máy, lúc đó substring-match âm thầm hỏng
        // không có test nào bắt được, không phân biệt được "reply scope violation" với
        // "RLS membership denial" nữa). KHÔNG phải dấu hiệu unfriended, không nên đánh sai
        // sendBlockedReason (sẽ tự khóa luôn cả việc gửi tin thường tiếp theo, dù người dùng
        // vẫn còn là bạn bè).
        if (err.code === "P0001") {
          return { error: "Không thể trả lời tin nhắn này (không cùng cuộc trò chuyện)." };
        }
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
