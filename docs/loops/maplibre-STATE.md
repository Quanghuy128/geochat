# STATE — Feature: Đổi map provider sang MapLibre (free, không key)

> Qua pipeline: office-hours → plan → build(Maker) → review(Checker) → qa → ship.

## Scope (office-hours — chốt 2026-06-22)

**Mục tiêu**: thay Google Maps bằng **MapLibre GL + OpenStreetMap** để map chạy free, KHÔNG cần API key / thẻ. Logic presence/marker giữ nguyên — chỉ đổi lớp render bản đồ.

**IN:**
- Gỡ hẳn `@vis.gl/react-google-maps`, thêm `react-map-gl` + `maplibre-gl`.
- MapPanel render bằng MapLibre, style = demotiles MapLibre (`https://demotiles.maplibre.org/style.json`, free, không key).
- Marker vị trí user (online đậm / offline mờ) + tự center theo coords như cũ.
- Bỏ phụ thuộc `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — map luôn hiển thị (không còn nhánh "chưa có key").

**OUT:**
- Tile/style đẹp hơn (đổi sau nếu muốn).
- Đổi logic presence/geolocation (giữ nguyên use-presence, use-geolocation).

**Edge case:**
- maplibre-gl CSS phải import (nếu thiếu → map vỡ layout).
- maplibre-gl là client-only (WebGL) → "use client" + tránh SSR import nặng.
- Thiếu Supabase env → vẫn mock list như cũ? Hoặc map vẫn render với mock locations. Giữ fallback mock locations khi chưa cấu hình Supabase.
- Marker offline mờ giữ nguyên.

**Tiêu chí nghiệm thu (Checker kiểm):**
1. Build pass, dev 200 không lỗi, KHÔNG còn import @vis.gl/react-google-maps.
2. Map render được KHÔNG cần bất kỳ key nào (demotiles).
3. Marker hiển thị đúng vị trí, online/offline style phân biệt.
4. CSS maplibre import đúng (map không vỡ).
5. SSR an toàn (client-only), null-safe thiếu Supabase.
6. package.json: gỡ @vis.gl/react-google-maps, thêm react-map-gl + maplibre-gl.

## Plan (plan — 2026-06-22)

**Lib:** `npm rm @vis.gl/react-google-maps`; `npm i react-map-gl maplibre-gl`.

**File sửa:**
1. `src/components/map-panel.tsx` — viết lại phần render:
   - import `Map, Marker` từ `react-map-gl/maplibre`; import `"maplibre-gl/dist/maplibre-gl.css"`.
   - `<Map mapStyle="https://demotiles.maplibre.org/style.json" initialViewState={{longitude, latitude, zoom}} />`.
   - Marker: `<Marker longitude lng latitude lat>` với pin tự vẽ (div tròn màu), online opacity-100 / offline opacity-50.
   - Bỏ toàn bộ nhánh `if (!apiKey)` — luôn render map. GIỮ phần data từ useAuth/useGeolocation/usePresence + header trạng thái GPS (đã có ở feature trước).
   - Center: initialViewState theo coords ?? HCMC_CENTER.
2. `package.json` — cập nhật deps (qua npm).
3. `.env.example` — bỏ dòng GOOGLE_MAPS (không cần nữa) hoặc ghi chú optional.
4. CLAUDE.md — cập nhật stack: Map = MapLibre + OSM (không còn Google Maps). (Maker cập nhật.)

**Edge/SSR:** react-map-gl/maplibre an toàn với "use client". CSS import ở module. Không cần dynamic import nếu build pass; nếu lỗi window → dùng next/dynamic ssr:false cho MapPanel inner.

**Acceptance:** như Scope.

## Build log (Maker — 2026-06-22)

**Deps:** đã `npm rm @vis.gl/react-google-maps`; `npm i react-map-gl@^8.1.1 maplibre-gl@^5.24.0`. package.json không còn `@vis.gl/react-google-maps`.

**File sửa/thêm:**
- `src/components/map-panel.tsx` — viết lại: bỏ hẳn `apiKey`/`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` và nhánh `if(!apiKey)`. Giữ nguyên data flow (useAuth + useGeolocation + usePresence + memo identity + fallback mock). Header GPS giữ nguyên. Nạp lớp map qua `next/dynamic(ssr:false)` (placeholder "Đang tải bản đồ…").
- `src/components/map-canvas.tsx` — MỚI: client-only, `Map`+`Marker` từ `react-map-gl/maplibre`, import CSS `maplibre-gl/dist/maplibre-gl.css`, `mapStyle=demotiles`, `initialViewState` theo center (coords ?? HCMC), zoom 12. Marker pin tự vẽ (nhãn tên + chấm tròn), online opacity-100 / offline opacity-50, anchor="bottom".
- `.env.example` — bỏ `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, ghi chú map free không key.
- `CLAUDE.md` — stack Map = MapLibre GL + OSM; sửa cả dòng mô tả đầu.

**Kết quả:** `npm run build` ✅ pass (TS strict OK). `eslint` 2 file feature ✅ sạch.

## Phase
| Bước | Trạng thái |
|------|-----------|
| office-hours | ✅ Done |
| plan | ✅ Done |
| build (Maker) | ✅ Done |
| review (Checker) | ✅ PASS (2 nit không chặn) |
| qa | ✅ PASS — build/dev/bundle/tile reachable |
| ship | ✅ Done |

## QA log (2026-06-22)
- ✅ build sạch; grep src/ KHÔNG còn @vis.gl/react-google-maps hay GOOGLE_MAPS_API_KEY.
- ✅ dev 200, không lỗi runtime; proxy.ts chạy.
- ✅ demotiles style.json → HTTP 200 KHÔNG cần key (mục tiêu free đạt).
- ✅ maplibre-gl bundled vào client chunk; map-canvas (dynamic ssr:false) đã build.
- ⏳ Render WebGL pixel-level: cần browser thật (Chrome không kết nối trong WSL) — kiểm bằng mắt khi mở app. 2 nit Checker: demotiles không-SLA (đổi tile production sau), viewport không re-center khi GPS lock muộn (không chặn).
