"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";

/** Payload broadcast cho mỗi event typing. */
type TypingPayload = {
  userId: string;
  userName: string;
  typing: boolean;
};

/** User đang gõ (đã lọc bỏ chính mình). */
export type TypingUser = {
  userId: string;
  userName: string;
};

export type UseTyping = {
  /** Danh sách người khác đang gõ (không gồm mình). */
  typingUsers: TypingUser[];
  /** Gọi khi mình gõ → broadcast typing:true, tự tắt sau 2s không gõ. */
  notifyTyping: () => void;
  /** Phát typing:false NGAY (vd khi gửi tin) + hủy timer dừng-gõ. */
  stopTyping: () => void;
};

/** Sau khoảng này không gõ thêm → tự phát typing:false. */
const STOP_TYPING_DELAY_MS = 2000;
/**
 * Nhịp phát lại "typing:true" KHI vẫn đang gõ liên tục (heartbeat).
 * Phía gửi KHÔNG phát mỗi keystroke (tiết kiệm quota Realtime) — chỉ phát true
 * 1 lần khi bắt đầu gõ, rồi heartbeat đều đặn để giữ cho timer phía nhận không
 * hết hạn. Phải < RECEIVER_TIMEOUT_MS để mỗi nhịp re-arm timer nhận kịp thời.
 */
const TYPING_HEARTBEAT_MS = 2000;
/**
 * Phía NHẬN: nếu không nhận thêm event của 1 user trong khoảng này → tự xóa.
 * Phòng tab đóng đột ngột (không kịp phát typing:false).
 * Phải > TYPING_HEARTBEAT_MS: người gõ liên tục phát lại true mỗi ~2s
 * (heartbeat) nên 4s là biên an toàn, không nhấp nháy.
 */
const RECEIVER_TIMEOUT_MS = 4000;

const CHANNEL_NAME = "geochat-typing";
const EVENT_NAME = "typing";

/**
 * Typing indicator realtime qua Supabase broadcast (ephemeral, không lưu DB).
 *
 * - Tạo channel "geochat-typing", lắng broadcast event "typing".
 * - notifyTyping(): chỉ broadcast {typing:true} 1 lần khi BẮT ĐẦU gõ (throttle
 *   phía gửi — không phát mỗi keystroke để tiết kiệm quota Realtime). Trong khi
 *   vẫn gõ, heartbeat re-send true mỗi ~2s giữ timer phía nhận sống. Mỗi
 *   keystroke reset stop-timer 2s; hết stop-timer → broadcast typing:false.
 * - Phía nhận: map userId→{userName,lastSeen}. Lọc bỏ chính mình. Mỗi event
 *   reset per-user timer 4s; hết hạn → xóa (phòng tab đóng đột ngột).
 *   typing:false → xóa user ngay.
 * - Cleanup: removeChannel + clear MỌI timer.
 *
 * Null-safe: Supabase chưa cấu hình → typingUsers rỗng, notifyTyping no-op.
 *
 * @param identity user đã login (null nếu chưa login / chưa cấu hình) — chỉ
 *   login mới phát; phía nhận luôn lọc bỏ userId của identity.
 */
export function useTyping(
  identity: { userId: string; userName: string } | null,
): UseTyping {
  // Lazy init client 1 lần (giống use-presence) — không tạo lại mỗi render.
  const [supabase] = useState(() => createClient());
  const supabaseRef = useRef(supabase);

  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);

  // identity mới nhất cho callback (broadcast handler + notifyTyping) — tránh
  // re-subscribe channel mỗi khi identity object đổi reference.
  // Cập nhật trong effect (không gán ref khi render).
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  // Timer phía GỬI: tự phát typing:false sau khi ngừng gõ.
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Heartbeat phía GỬI: re-send true mỗi ~2s khi đang gõ liên tục.
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cờ trạng thái đang-gõ phía GỬI: chặn phát lại true mỗi keystroke.
  const isTypingRef = useRef(false);
  // Timer phía NHẬN: per-user, tự xóa khi không nhận thêm event.
  const receiverTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Xóa 1 user khỏi danh sách + clear timer nhận tương ứng.
  const removeTypingUser = useCallback((userId: string) => {
    const timer = receiverTimersRef.current.get(userId);
    if (timer) {
      clearTimeout(timer);
      receiverTimersRef.current.delete(userId);
    }
    setTypingUsers((prev) => prev.filter((u) => u.userId !== userId));
  }, []);

  // Subscribe channel 1 lần (channel name cố định, không phụ thuộc identity).
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    let cancelled = false;
    const receiverTimers = receiverTimersRef.current;

    const channel = supabase.channel(CHANNEL_NAME);

    channel
      .on("broadcast", { event: EVENT_NAME }, (msg) => {
        if (cancelled) return;
        const payload = msg.payload as TypingPayload | undefined;
        if (!payload || !payload.userId) return;

        // Lọc bỏ chính mình.
        if (payload.userId === identityRef.current?.userId) return;

        if (!payload.typing) {
          // typing:false → xóa ngay.
          removeTypingUser(payload.userId);
          return;
        }

        // typing:true → thêm/cập nhật + reset timer nhận.
        setTypingUsers((prev) => {
          const existing = prev.find((u) => u.userId === payload.userId);
          if (existing) {
            // Cập nhật tên nếu đổi (hiếm) mà không tạo lại mảng nếu trùng.
            if (existing.userName === payload.userName) return prev;
            return prev.map((u) =>
              u.userId === payload.userId
                ? { ...u, userName: payload.userName }
                : u,
            );
          }
          return [
            ...prev,
            { userId: payload.userId, userName: payload.userName },
          ];
        });

        const prevTimer = receiverTimers.get(payload.userId);
        if (prevTimer) clearTimeout(prevTimer);
        receiverTimers.set(
          payload.userId,
          setTimeout(() => removeTypingUser(payload.userId), RECEIVER_TIMEOUT_MS),
        );
      })
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") subscribedRef.current = true;
      });

    channelRef.current = channel;

    return () => {
      cancelled = true;
      subscribedRef.current = false;
      channelRef.current = null;
      // Clear mọi timer nhận.
      for (const timer of receiverTimers.values()) clearTimeout(timer);
      receiverTimers.clear();
      supabase.removeChannel(channel);
    };
  }, [removeTypingUser]);

  // Clear timer + heartbeat gửi khi unmount (channel effect không nắm chúng).
  useEffect(() => {
    return () => {
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      isTypingRef.current = false;
    };
  }, []);

  const sendTyping = useCallback((typing: boolean) => {
    const channel = channelRef.current;
    const identity = identityRef.current;
    // Chỉ phát khi có channel đã subscribe + đã login.
    if (!channel || !subscribedRef.current || !identity?.userId) return;
    const payload: TypingPayload = {
      userId: identity.userId,
      userName: identity.userName,
      typing,
    };
    channel.send({ type: "broadcast", event: EVENT_NAME, payload });
  }, []);

  const notifyTyping = useCallback(() => {
    // No-op nếu chưa cấu hình / chưa login.
    if (!supabaseRef.current || !identityRef.current?.userId) return;

    // Throttle phía gửi: chỉ phát true 1 lần khi BẮT ĐẦU gõ + bật heartbeat.
    // Đang gõ rồi → KHÔNG phát lại mỗi keystroke (chỉ re-arm stop-timer dưới).
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      sendTyping(true);
      // Heartbeat: re-send true mỗi ~2s khi vẫn đang gõ → giữ timer phía nhận
      // sống dù user gõ liên tục >4s (không phát true mỗi keystroke nữa).
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (isTypingRef.current) sendTyping(true);
      }, TYPING_HEARTBEAT_MS);
    }

    // Mỗi keystroke reset stop-timer: phát typing:false sau 2s không gõ thêm.
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      stopTimerRef.current = null;
      // Hết stop-timer → dừng heartbeat + phát false.
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      isTypingRef.current = false;
      sendTyping(false);
    }, STOP_TYPING_DELAY_MS);
  }, [sendTyping]);

  const stopTyping = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    isTypingRef.current = false;
    // No-op nội bộ nếu chưa login / chưa subscribe (sendTyping tự guard).
    sendTyping(false);
  }, [sendTyping]);

  return { typingUsers, notifyTyping, stopTyping };
}
