"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { FriendRequest, FriendRequestStatus } from "./types";

/** Row dạng snake_case từ Postgres (chưa join username). */
type FriendRequestRow = {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: FriendRequestStatus;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  username: string;
};

export type UseFriendRequests = {
  /** Request mà mình là recipient, status='pending'. */
  incoming: FriendRequest[];
  /** Request mà mình là requester, status='pending'. */
  outgoing: FriendRequest[];
  /** null = Supabase chưa cấu hình. */
  ready: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Accept 1 incoming request (chỉ recipient). */
  accept: (requestId: string) => Promise<{ error: string | null }>;
  /** Reject 1 incoming request (chỉ recipient). */
  reject: (requestId: string) => Promise<{ error: string | null }>;
  /** Cancel 1 outgoing request còn pending (chỉ requester). */
  cancel: (requestId: string) => Promise<{ error: string | null }>;
  /**
   * Thêm ngay 1 request mới gửi vào `outgoing` (KHÔNG chờ Realtime echo) — dùng bởi
   * `useSendFriendRequest().send()` response, theo friends-STATE.md > PLAN > mục 3
   * "Send request" bước 5: "A's UI: lấy ngay từ response insert (KHÔNG chờ Realtime)".
   * Dedup theo `id` giống pattern Realtime INSERT handler.
   */
  addOutgoing: (request: FriendRequest) => void;
};

/**
 * Quản lý incoming/outgoing pending friend requests qua Supabase.
 *
 * - Load toàn bộ row liên quan tới mình (requester hoặc recipient), status='pending'.
 * - Join username qua `profiles` (2 round-trip — bảng friend_requests chỉ lưu uuid).
 * - Subscribe Realtime INSERT/UPDATE trên `friend_requests` — KHÔNG filter ở tầng
 *   Realtime (Postgres filter string không hỗ trợ OR giữa 2 cột); dựa vào RLS
 *   `friend_requests_select_own` để Supabase chỉ phát event row của mình
 *   (xem friends-STATE.md > PLAN > mục 6.3 — assumption Checker/QA phải verify).
 * - accept/reject/cancel: UPDATE trực tiếp qua Supabase client (không Route Handler
 *   riêng, giống pattern useMessages.send()). Nếu `data.length === 0` sau update
 *   (race — request đã bị actioned trước, RLS `using` không match) → lỗi 409 +
 *   tự refetch() để đồng bộ lại UI (edge case #9).
 *
 * Null-safe: Supabase chưa cấu hình hoặc identity null → ready=false/rỗng, không lỗi.
 */
export function useFriendRequests(
  identity: { userId: string } | null,
): UseFriendRequests {
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [supabase] = useState(() => createClient());
  const ready = supabase !== null;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  /** Join username cho 1 danh sách row (1 query duy nhất tới profiles, theo unique id). */
  const joinUsernames = useCallback(
    async (rows: FriendRequestRow[]): Promise<FriendRequest[]> => {
      if (!supabase || rows.length === 0) return [];

      const ids = Array.from(
        new Set(rows.flatMap((r) => [r.requester_id, r.recipient_id])),
      );
      const { data: profiles, error: profErr } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", ids);

      if (profErr) throw new Error(profErr.message);

      const usernameById = new Map<string, string>(
        ((profiles as ProfileRow[] | null) ?? []).map((p) => [p.id, p.username]),
      );

      return rows.map((r) => ({
        id: r.id,
        requesterId: r.requester_id,
        requesterUsername: usernameById.get(r.requester_id) ?? "?",
        recipientId: r.recipient_id,
        recipientUsername: usernameById.get(r.recipient_id) ?? "?",
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
    [supabase],
  );

  const load = useCallback(async () => {
    const userId = identityRef.current?.userId;
    if (!supabase || !userId) {
      setIncoming([]);
      setOutgoing([]);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("friend_requests")
      .select("*")
      .eq("status", "pending")
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    try {
      const rows = (data as FriendRequestRow[] | null) ?? [];
      const joined = await joinUsernames(rows);
      setIncoming(joined.filter((r) => r.recipientId === userId));
      setOutgoing(joined.filter((r) => r.requesterId === userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định.");
    } finally {
      setLoading(false);
    }
  }, [supabase, joinUsernames]);

  // Mount: load + subscribe Realtime. Dep theo identity?.userId — đổi user → channel mới.
  useEffect(() => {
    if (!supabase) return;
    // load() tự reset incoming/outgoing rỗng nếu identityRef.current?.userId rỗng —
    // gọi qua load() (không setState trực tiếp trong effect) để tránh cascading renders.
    load();
    if (!identity?.userId) return;

    let cancelled = false;

    const channel = supabase
      .channel(`friend-requests-${identity.userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "friend_requests" },
        async (payload) => {
          if (cancelled) return;
          const row = payload.new as FriendRequestRow;
          const userId = identityRef.current?.userId;
          if (!userId) return;
          // Lớp lọc thừa (defense-in-depth) — RLS select_own là lớp chính.
          if (row.requester_id !== userId && row.recipient_id !== userId) return;
          if (row.status !== "pending") return;

          try {
            const [joined] = await joinUsernames([row]);
            if (cancelled || !joined) return;
            if (row.recipient_id === userId) {
              setIncoming((prev) =>
                prev.some((r) => r.id === joined.id) ? prev : [joined, ...prev],
              );
            } else {
              setOutgoing((prev) =>
                prev.some((r) => r.id === joined.id) ? prev : [joined, ...prev],
              );
            }
          } catch {
            // Lỗi join username không nên crash realtime handler — bỏ qua, refetch() sẽ sửa.
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "friend_requests" },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as FriendRequestRow;
          const userId = identityRef.current?.userId;
          if (!userId) return;
          if (row.requester_id !== userId && row.recipient_id !== userId) return;

          // Bất kỳ transition khỏi pending → xoá khỏi incoming/outgoing local state.
          if (row.status !== "pending") {
            setIncoming((prev) => prev.filter((r) => r.id !== row.id));
            setOutgoing((prev) => prev.filter((r) => r.id !== row.id));
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    // Pattern theo PLAN mục 5 (Other edge cases — stale list do bỏ lỡ Realtime event):
    // supabase-js tự reconnect channel nhưng KHÔNG tự refetch — bù bằng refetch khi tab focus lại.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      channelRef.current = null;
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, [supabase, identity?.userId, load, joinUsernames]);

  const accept = useCallback(
    async (requestId: string): Promise<{ error: string | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình." };

      const { data, error: err } = await supabase
        .from("friend_requests")
        .update({ status: "accepted" })
        .eq("id", requestId)
        .select();

      if (err) return { error: err.message };
      if (!data || data.length === 0) {
        await load();
        return { error: "Lời mời không còn hợp lệ (đã được xử lý trước đó)." };
      }

      setIncoming((prev) => prev.filter((r) => r.id !== requestId));
      return { error: null };
    },
    [supabase, load],
  );

  const reject = useCallback(
    async (requestId: string): Promise<{ error: string | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình." };

      const { data, error: err } = await supabase
        .from("friend_requests")
        .update({ status: "rejected" })
        .eq("id", requestId)
        .select();

      if (err) return { error: err.message };
      if (!data || data.length === 0) {
        await load();
        return { error: "Lời mời không còn hợp lệ (đã được xử lý trước đó)." };
      }

      setIncoming((prev) => prev.filter((r) => r.id !== requestId));
      return { error: null };
    },
    [supabase, load],
  );

  const cancel = useCallback(
    async (requestId: string): Promise<{ error: string | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình." };

      const { data, error: err } = await supabase
        .from("friend_requests")
        .update({ status: "cancelled" })
        .eq("id", requestId)
        .select();

      if (err) return { error: err.message };
      if (!data || data.length === 0) {
        await load();
        return { error: "Lời mời không còn hợp lệ (đã được xử lý trước đó)." };
      }

      setOutgoing((prev) => prev.filter((r) => r.id !== requestId));
      return { error: null };
    },
    [supabase, load],
  );

  const addOutgoing = useCallback((request: FriendRequest) => {
    setOutgoing((prev) =>
      prev.some((r) => r.id === request.id) ? prev : [request, ...prev],
    );
  }, []);

  return {
    incoming,
    outgoing,
    ready,
    loading,
    error,
    refetch: load,
    accept,
    reject,
    cancel,
    addOutgoing,
  };
}
