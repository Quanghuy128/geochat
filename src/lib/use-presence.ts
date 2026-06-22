"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { UserLocation } from "./types";

/** Payload track lên presence cho mỗi client. */
type PresencePayload = {
  userId: string;
  userName: string;
  lat: number;
  lng: number;
  updatedAt: string;
};

/** Row snake_case từ bảng locations. */
type LocationRow = {
  user_id: string;
  user_name: string;
  lat: number;
  lng: number;
  updated_at: string;
};

export type UsePresence = {
  /** Danh sách vị trí: union(presence online ∪ bảng locations offline). */
  locations: UserLocation[];
  /** true khi Supabase đã cấu hình env. */
  ready: boolean;
  error: string | null;
};

function rowToLocation(r: LocationRow): UserLocation {
  return {
    userId: r.user_id,
    userName: r.user_name,
    lat: r.lat,
    lng: r.lng,
    updatedAt: r.updated_at,
    online: false,
  };
}

/**
 * Vị trí realtime qua Supabase Presence + bảng locations (vị trí cuối offline).
 *
 * - Mount: load bảng locations 1 lần → vị trí cuối của mọi user (offline).
 * - Tạo channel "geochat-presence" với presence key = userId.
 * - Khi có coords + đã login: presence.track({...}) + upsert bảng locations.
 * - Lắng 'sync' → dựng lại danh sách online từ presence state.
 *   online = userId có trong presence state; offline = chỉ có trong bảng.
 * - Khi user leave: row của họ vẫn còn (đã lưu từ presence/bảng) → hiện mờ.
 * - Cleanup: removeChannel khi unmount.
 *
 * Null-safe: Supabase chưa cấu hình → ready=false, locations=[].
 *
 * @param identity user đã login (null nếu chưa login / chưa cấu hình) — chỉ login mới track + lưu.
 * @param coords   vị trí GPS hiện tại (null nếu chưa có / từ chối).
 */
export function usePresence(
  identity: { userId: string; userName: string } | null,
  coords: { lat: number; lng: number } | null,
): UsePresence {
  // Khởi tạo client 1 lần; lazy init qua useState để không tạo lại mỗi render.
  const [supabase] = useState(() => createClient());
  const supabaseRef = useRef(supabase);
  const ready = supabase !== null;

  // Vị trí cuối từ bảng (offline) — load 1 lần lúc mount.
  const [dbLocations, setDbLocations] = useState<Map<string, UserLocation>>(
    new Map(),
  );
  // Vị trí live từ presence state (online).
  const [presenceLocations, setPresenceLocations] = useState<
    Map<string, UserLocation>
  >(new Map());
  // Vị trí cuối biết được TRONG PHIÊN (cập nhật mỗi lần presence sync) —
  // mới hơn dbLocations khi user di chuyển rồi rời đi trong phiên này.
  const [lastSeen, setLastSeen] = useState<Map<string, UserLocation>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  // Trạng thái subscribe của channel — track chỉ hợp lệ khi đã SUBSCRIBED.
  const subscribedRef = useRef(false);
  // Payload track mới nhất — dùng trong callback subscribe (chờ SUBSCRIBED).
  const latestPayloadRef = useRef<PresencePayload | null>(null);

  // 1. Load bảng locations 1 lần + subscribe presence.
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    let cancelled = false;

    supabase
      .from("locations")
      .select("*")
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          return;
        }
        const map = new Map<string, UserLocation>();
        for (const row of (data as LocationRow[] | null) ?? []) {
          map.set(row.user_id, rowToLocation(row));
        }
        setDbLocations(map);
      });

    const channel = supabase.channel("geochat-presence", {
      config: { presence: { key: identity?.userId ?? "anon" } },
    });

    const syncState = () => {
      if (cancelled) return;
      const state = channel.presenceState<PresencePayload>();
      const map = new Map<string, UserLocation>();
      for (const key of Object.keys(state)) {
        // Mỗi key có thể có nhiều bản ghi (multi-tab) — lấy bản mới nhất.
        const entries = state[key];
        if (!entries || entries.length === 0) continue;
        const latest = entries.reduce((acc, cur) =>
          cur.updatedAt > acc.updatedAt ? cur : acc,
        );
        map.set(latest.userId, {
          userId: latest.userId,
          userName: latest.userName,
          lat: latest.lat,
          lng: latest.lng,
          updatedAt: latest.updatedAt,
          online: true,
        });
      }
      setPresenceLocations(map);

      // Cache vị trí cuối biết được trong phiên: mỗi user đang online lưu
      // snapshot mới nhất. Khi họ rời presence sau này, marker mờ rơi về đây
      // (mới hơn dbLocations load lúc mount).
      setLastSeen((prev) => {
        const next = new Map(prev);
        for (const [userId, loc] of map) {
          const existing = next.get(userId);
          if (!existing || loc.updatedAt > existing.updatedAt) {
            next.set(userId, { ...loc, online: false });
          }
        }
        return next;
      });
    };

    channel
      .on("presence", { event: "sync" }, syncState)
      .on("presence", { event: "join" }, syncState)
      .on("presence", { event: "leave" }, syncState)
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          subscribedRef.current = true;
          // track vị trí mới nhất (nếu có) ngay khi channel sẵn sàng —
          // tránh race khi coords tới trước lúc SUBSCRIBED.
          const payload = latestPayloadRef.current;
          if (payload) channel.track(payload);
        }
      });

    channelRef.current = channel;

    return () => {
      cancelled = true;
      channelRef.current = null;
      subscribedRef.current = false;
      supabase.removeChannel(channel);
    };
    // identity?.userId là presence key — đổi user thì cần channel mới.
  }, [identity?.userId]);

  // 2. Khi có coords + đã login: track presence + upsert bảng locations.
  // Dep array dùng PRIMITIVE ổn định để effect chỉ chạy khi giá trị thực đổi
  // (không phải mỗi render do identity/coords là object reference mới).
  useEffect(() => {
    const supabase = supabaseRef.current;
    const channel = channelRef.current;
    if (!supabase || !channel || !identity || !coords) return;

    let cancelled = false;
    const updatedAt = new Date().toISOString();
    const payload: PresencePayload = {
      userId: identity.userId,
      userName: identity.userName,
      lat: coords.lat,
      lng: coords.lng,
      updatedAt,
    };

    // Giữ payload mới nhất cho callback subscribe (trường hợp coords tới
    // trước khi channel SUBSCRIBED).
    latestPayloadRef.current = payload;

    // track chỉ hợp lệ khi channel đã SUBSCRIBED; nếu chưa, subscribe callback
    // sẽ track payload mới nhất khi sẵn sàng.
    if (subscribedRef.current) {
      channel.track(payload);
    }

    supabase
      .from("locations")
      .upsert(
        {
          user_id: identity.userId,
          user_name: identity.userName,
          lat: coords.lat,
          lng: coords.lng,
          updated_at: updatedAt,
        },
        { onConflict: "user_id" },
      )
      .then(({ error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
    // Cố ý dùng primitive (B1): identity/coords là object reference mới mỗi
    // render; nếu để cả object vào dep, effect chạy lặp → spam track + upsert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.userId, identity?.userName, coords?.lat, coords?.lng, ready]);

  // 3. Merge theo thứ tự ưu tiên (sau ghi đè trước):
  //    dbLocations (vị trí cuối load lúc mount)
  //  → lastSeen (vị trí cuối biết được trong phiên, mới hơn db)
  //  → presenceLocations (đang online).
  const locations = useMemo(() => {
    const merged = new Map<string, UserLocation>(dbLocations);
    for (const [userId, loc] of lastSeen) {
      merged.set(userId, loc);
    }
    for (const [userId, loc] of presenceLocations) {
      merged.set(userId, loc);
    }
    return Array.from(merged.values());
  }, [dbLocations, lastSeen, presenceLocations]);

  return { locations, ready, error };
}
