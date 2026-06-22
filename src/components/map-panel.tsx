"use client";

import { APIProvider, Map, AdvancedMarker, Pin } from "@vis.gl/react-google-maps";
import type { UserLocation } from "@/lib/types";

const HCMC_CENTER = { lat: 10.7769, lng: 106.7009 };

/**
 * Panel map. Có key Google Maps → render Map thật với marker theo vị trí.
 * Chưa có key → fallback placeholder + danh sách vị trí (mock).
 * Sau này vị trí sẽ đến từ Supabase Presence thay vì props.
 */
export function MapPanel({ locations }: { locations: UserLocation[] }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return (
      <div className="flex h-full flex-col">
        <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="font-semibold">Bản đồ</h2>
          <p className="text-xs text-zinc-500">
            Chưa có Google Maps API key — đang hiện danh sách vị trí (mock)
          </p>
        </header>
        <div className="flex flex-1 flex-col gap-2 bg-zinc-50 p-4 dark:bg-zinc-900">
          {locations.map((loc) => (
            <div
              key={loc.userId}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-800"
            >
              <span className="font-medium">📍 {loc.userName}</span>
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
        <p className="text-xs text-zinc-500">Vị trí realtime (mock — chưa nối Presence)</p>
      </header>
      <div className="flex-1">
        <APIProvider apiKey={apiKey}>
          <Map
            defaultCenter={HCMC_CENTER}
            defaultZoom={14}
            mapId="geochat-map"
            disableDefaultUI={false}
            gestureHandling="greedy"
          >
            {locations.map((loc) => (
              <AdvancedMarker
                key={loc.userId}
                position={{ lat: loc.lat, lng: loc.lng }}
                title={loc.userName}
              >
                <Pin />
              </AdvancedMarker>
            ))}
          </Map>
        </APIProvider>
      </div>
    </div>
  );
}
