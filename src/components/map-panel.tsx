"use client";

import { useMemo } from "react";
import { APIProvider, Map, AdvancedMarker, Pin } from "@vis.gl/react-google-maps";
import { useAuth } from "@/lib/use-auth";
import { useGeolocation } from "@/lib/use-geolocation";
import { usePresence } from "@/lib/use-presence";
import type { UserLocation } from "@/lib/types";

const HCMC_CENTER = { lat: 10.7769, lng: 106.7009 };

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
 * - Có Google Maps key → render Map thật với AdvancedMarker.
 * - Chưa có key → fallback danh sách vị trí.
 * - Supabase chưa cấu hình → dùng `fallback` (mock) truyền từ ngoài.
 * online = đậm; offline = mờ (opacity-50).
 */
export function MapPanel({ fallback = [] }: { fallback?: UserLocation[] }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
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

  if (!apiKey) {
    return (
      <div className="flex h-full flex-col">
        <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="font-semibold">Bản đồ</h2>
          <p className="text-xs text-zinc-500">
            Chưa có Google Maps API key — danh sách vị trí. {subtitle}
          </p>
        </header>
        <div className="flex flex-1 flex-col gap-2 bg-zinc-50 p-4 dark:bg-zinc-900">
          {locations.length === 0 && (
            <p className="text-sm text-zinc-500">Chưa có vị trí nào.</p>
          )}
          {locations.map((loc) => (
            <div
              key={loc.userId}
              className={`flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-800 ${
                loc.online ? "" : "opacity-50"
              }`}
            >
              <span className="font-medium">
                {loc.online ? "📍" : "📌"} {loc.userName}
                {!loc.online && (
                  <span className="ml-1 text-xs text-zinc-400">(offline)</span>
                )}
              </span>
              <span className="text-xs text-zinc-500">
                {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
              </span>
            </div>
          ))}
          <p className="mt-auto text-center text-xs text-zinc-400">
            Cắm key vào <code>.env.local</code> để xem bản đồ thật.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold">Bản đồ</h2>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </header>
      <div className="flex-1">
        <APIProvider apiKey={apiKey}>
          <Map
            defaultCenter={coords ?? HCMC_CENTER}
            defaultZoom={14}
            mapId="geochat-map"
            disableDefaultUI={false}
            gestureHandling="greedy"
          >
            {locations.map((loc) => (
              <AdvancedMarker
                key={loc.userId}
                position={{ lat: loc.lat, lng: loc.lng }}
                title={`${loc.userName}${loc.online ? "" : " (offline)"}`}
              >
                <div className={loc.online ? "" : "opacity-50"}>
                  <Pin
                    background={loc.online ? "#2563eb" : "#9ca3af"}
                    borderColor={loc.online ? "#1d4ed8" : "#6b7280"}
                    glyphColor="#ffffff"
                  />
                </div>
              </AdvancedMarker>
            ))}
          </Map>
        </APIProvider>
      </div>
    </div>
  );
}
