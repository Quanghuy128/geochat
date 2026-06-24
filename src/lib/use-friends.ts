"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { Friend, FriendRequestStatus } from "./types";

/** Row dạng snake_case từ Postgres (chưa join username). */
type FriendRequestRow = {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: FriendRequestStatus;
};

type ProfileRow = {
  id: string;
  username: string;
};

export type UseFriends = {
  friends: Friend[];
  /** null = Supabase chưa cấu hình. */
  ready: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Unfriend (chuyển status accepted → cancelled). requestId = id row friend_requests gốc. */
  unfriend: (requestId: string) => Promise<{ error: string | null }>;
};

/**
 * Quản lý friends list (status='accepted' giữa mình và đối phương) qua Supabase.
 *
 * - Load toàn bộ row liên quan tới mình với status='accepted', join username đối phương.
 * - Subscribe Realtime UPDATE trên `friend_requests` (channel RIÊNG, độc lập với
 *   useFriendRequests — theo component contract design doc, 2 hook không share channel):
 *   nhận transition pending→accepted (thêm vào friends) hoặc accepted→cancelled (xoá khỏi
 *   friends, unfriend từ phía bên kia).
 * - unfriend(): UPDATE status='cancelled' where id=requestId — chỉ match nếu đang accepted
 *   (RLS `friend_requests_update_unfriend`). data.length===0 → lỗi (đã unfriend/đổi trạng thái
 *   từ trước — race), tự refetch().
 *
 * Null-safe: Supabase chưa cấu hình hoặc identity null → ready=false/rỗng, không lỗi.
 */
export function useFriends(identity: { userId: string } | null): UseFriends {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [supabase] = useState(() => createClient());
  const ready = supabase !== null;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  const load = useCallback(async () => {
    const userId = identityRef.current?.userId;
    if (!supabase || !userId) {
      setFriends([]);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("friend_requests")
      .select("*")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const rows = (data as FriendRequestRow[] | null) ?? [];
    if (rows.length === 0) {
      setFriends([]);
      setLoading(false);
      return;
    }

    const otherIds = rows.map((r) =>
      r.requester_id === userId ? r.recipient_id : r.requester_id,
    );

    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", otherIds);

    if (profErr) {
      setError(profErr.message);
      setLoading(false);
      return;
    }

    const usernameById = new Map<string, string>(
      ((profiles as ProfileRow[] | null) ?? []).map((p) => [p.id, p.username]),
    );

    setFriends(
      rows.map((r) => {
        const otherId =
          r.requester_id === userId ? r.recipient_id : r.requester_id;
        return {
          id: otherId,
          username: usernameById.get(otherId) ?? "?",
          requestId: r.id,
        };
      }),
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    // load() tự reset friends rỗng nếu identityRef.current?.userId rỗng — gọi qua
    // load() (không setState trực tiếp trong effect) để tránh cascading renders.
    load();
    if (!identity?.userId) return;

    let cancelled = false;

    const channel = supabase
      .channel(`friends-${identity.userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "friend_requests" },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as FriendRequestRow;
          const userId = identityRef.current?.userId;
          if (!userId) return;
          if (row.requester_id !== userId && row.recipient_id !== userId) return;

          // Bất kỳ thay đổi liên quan đến trạng thái accepted → refetch đơn giản
          // (đủ rẻ vì friends list thường nhỏ; tránh logic join phức tạp trong handler).
          if (row.status === "accepted" || row.status === "cancelled") {
            load();
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    const onFocus = () => load();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      channelRef.current = null;
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, [supabase, identity?.userId, load]);

  const unfriend = useCallback(
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
        return { error: "Không tìm thấy quan hệ bạn bè này (đã thay đổi trước đó)." };
      }

      setFriends((prev) => prev.filter((f) => f.requestId !== requestId));
      return { error: null };
    },
    [supabase, load],
  );

  return { friends, ready, loading, error, refetch: load, unfriend };
}
