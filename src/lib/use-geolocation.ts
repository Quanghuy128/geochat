"use client";

import { useEffect, useState } from "react";

export type GeolocationPermission =
  | "granted"
  | "denied"
  | "prompt"
  | "unsupported";

export type UseGeolocation = {
  /** Tọa độ hiện tại, null khi chưa có / chưa cấp quyền / không hỗ trợ. */
  coords: { lat: number; lng: number } | null;
  /** Thông báo lỗi cho UI, null khi không có lỗi. */
  error: string | null;
  /** Trạng thái quyền GPS để render header. */
  permission: GeolocationPermission;
};

/**
 * Theo dõi vị trí GPS qua navigator.geolocation.watchPosition.
 * - Cập nhật coords mỗi khi browser báo vị trí mới (user di chuyển).
 * - clearWatch khi unmount (tránh leak).
 * - Xử lý: không hỗ trợ geolocation, user từ chối quyền, lỗi GPS.
 */
export function useGeolocation(): UseGeolocation {
  // Lazy init SSR-safe: nếu môi trường không hỗ trợ geolocation → "unsupported" ngay,
  // tránh setState đồng bộ trong effect (gây cascading render).
  const supported =
    typeof navigator !== "undefined" && Boolean(navigator.geolocation);

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(
    supported ? null : "Trình duyệt không hỗ trợ định vị.",
  );
  const [permission, setPermission] = useState<GeolocationPermission>(
    supported ? "prompt" : "unsupported",
  );

  useEffect(() => {
    if (!supported) return;

    let cancelled = false;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (cancelled) return;
        setPermission("granted");
        setError(null);
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        if (cancelled) return;
        if (err.code === err.PERMISSION_DENIED) {
          setPermission("denied");
          setError("Bạn đã từ chối quyền truy cập vị trí.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError("Không lấy được vị trí (GPS không khả dụng).");
        } else if (err.code === err.TIMEOUT) {
          setError("Hết thời gian chờ lấy vị trí.");
        } else {
          setError(err.message || "Lỗi định vị.");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 20_000,
      },
    );

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [supported]);

  return { coords, error, permission };
}
