"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/lib/use-auth";
import { useGeolocation } from "@/lib/use-geolocation";
import { usePresence } from "@/lib/use-presence";
import type { UserLocation } from "@/lib/types";

const HCMC_CENTER = { lat: 10.7769, lng: 106.7009 };

// MapLibre dùng WebGL → client-only. Tải lazy không SSR để tránh lỗi `window`
// khi Next render trên server.
const MapCanvas = dynamic(() => import("./map-canvas").then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-zinc-50 text-sm text-zinc-400 dark:bg-zinc-900">
      Đang tải bản đồ…
    </div>
  ),
});

/** Câu trạng thái GPS hiển thị ở header. */
function gpsStatusText(args: {
  configured: boolean;
  loggedIn: boolean;
  permission: ReturnType<typeof useGeolocation>["permission"];
  geoError: string | null;
  hasCoords: boolean;
}): string {
  if (!args.configured) {
    return "Supabase chưa cấu hình — đang hiện dữ liệu mẫu";
  }
  if (!args.loggedIn) {
    return "Chưa đăng nhập — chỉ xem, không chia sẻ vị trí";
  }
  if (args.permission === "unsupported") {
    return "Trình duyệt không hỗ trợ định vị";
  }
  if (args.permission === "denied") {
    return "Bị từ chối quyền vị trí — bật lại trong cài đặt trình duyệt";
  }
  if (args.geoError) {
    return args.geoError;
  }
  if (args.hasCoords) {
    return "Đang theo dõi vị trí — chia sẻ realtime";
  }
  return "Đang xác định vị trí…";
}

/**
 * Panel map. Tự lấy data từ Presence (live) + bảng locations (vị trí cuối).
 * - Render bằng MapLibre GL + tiles demotiles MapLibre (free, KHÔNG cần key).
 * - Supabase chưa cấu hình → dùng `fallback` (mock) truyền từ ngoài, map vẫn render.
 * online = đậm; offline = mờ (opacity-50).
 */
export function MapPanel({ fallback = [] }: { fallback?: UserLocation[] }) {
  const { user, configured, loading } = useAuth();

  // Memo hóa identity để giữ reference ổn định giữa các render — tránh
  // effect track+upsert trong usePresence chạy lặp mỗi render.
  const identity = useMemo(
    () =>
      user
        ? {
            userId: user.id,
            userName:
              (user.user_metadata?.full_name as string | undefined) ??
              user.email ??
              "Ẩn danh",
          }
        : null,
    // Cố ý dùng primitive thay vì `user` để identity ổn định khi user object
    // có reference mới nhưng nội dung không đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, user?.email, user?.user_metadata?.full_name],
  );

  const { coords, error: geoError, permission } = useGeolocation();
  const { locations: liveLocations, ready } = usePresence(identity, coords);

  // Supabase chưa cấu hình → dùng mock fallback (đánh dấu online để hiện rõ).
  const locations: UserLocation[] = ready
    ? liveLocations
    : fallback.map((l) => ({ ...l, online: true }));

  const status = gpsStatusText({
    configured,
    loggedIn: Boolean(user),
    permission,
    geoError,
    hasCoords: coords !== null,
  });

  const subtitle = loading ? "Đang tải…" : status;
  const center = coords ?? HCMC_CENTER;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold">Bản đồ</h2>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </header>
      <div className="flex-1">
        <MapCanvas center={center} locations={locations} />
      </div>
    </div>
  );
}
