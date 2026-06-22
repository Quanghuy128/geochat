"use client";

import { Map, Marker } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { UserLocation } from "@/lib/types";

// Style demotiles MapLibre: tiles vector free, KHÔNG cần API key / thẻ.
const MAP_STYLE = "https://demotiles.maplibre.org/style.json";

type Props = {
  /** Tâm bản đồ ban đầu (tọa độ user hiện tại hoặc HCMC). */
  center: { lat: number; lng: number };
  /** Danh sách vị trí user để vẽ marker. */
  locations: UserLocation[];
};

/**
 * Lớp render bản đồ MapLibre GL (WebGL, client-only).
 * Tách riêng để có thể nạp qua next/dynamic ssr:false, tránh lỗi `window` khi SSR.
 * - Mỗi user 1 Marker với pin tự vẽ (div tròn + tên).
 * - online → opacity-100, offline → opacity-50.
 */
export function MapCanvas({ center, locations }: Props) {
  return (
    <Map
      mapStyle={MAP_STYLE}
      initialViewState={{
        longitude: center.lng,
        latitude: center.lat,
        zoom: 12,
      }}
      style={{ width: "100%", height: "100%" }}
    >
      {locations.map((loc) => (
        <Marker key={loc.userId} longitude={loc.lng} latitude={loc.lat} anchor="bottom">
          <div
            className={`flex flex-col items-center ${loc.online ? "opacity-100" : "opacity-50"}`}
            title={`${loc.userName}${loc.online ? "" : " (offline)"}`}
          >
            <span
              className="max-w-[8rem] truncate rounded-full px-2 py-0.5 text-xs font-medium text-white shadow"
              style={{ backgroundColor: loc.online ? "#2563eb" : "#9ca3af" }}
            >
              {loc.userName}
            </span>
            <span
              className="mt-0.5 h-4 w-4 rounded-full border-2 border-white shadow"
              style={{ backgroundColor: loc.online ? "#2563eb" : "#9ca3af" }}
            />
          </div>
        </Marker>
      ))}
    </Map>
  );
}
