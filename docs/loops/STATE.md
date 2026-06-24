# STATE — Trục sống GeoChat

> Trí nhớ nối các phiên. Mỗi lần làm việc: **đọc file này → làm phase kế → cập nhật lại**.
> Mỗi feature lớn tạo thêm `docs/loops/<feature>-STATE.md` riêng.

## Tổng quan dự án

- **App**: chat realtime + Google Map location realtime.
- **Hướng**: dựng cỗ máy tự động hóa (Loop Engineering) song song với app.
- Stack & convention: xem [CLAUDE.md](../../CLAUDE.md). Context đầy đủ: [PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md).

## Phase hiện tại

| Phase | Trạng thái | Ghi chú |
|-------|-----------|---------|
| 0. git init | ✅ Done | branch `master`, 2026-06-22 |
| 0. Khung cỗ máy tối thiểu | ✅ Done | CLAUDE.md ✅, 2 agents ✅, hook careful ✅, STATE/learnings ✅ |
| 1. Scaffold Next.js app | ✅ Done | Next 16 TS+Tailwind+App Router+src; lib: supabase-js/ssr, @vis.gl/react-google-maps; build pass |
| 2. UI skeleton chat + map (mock) | ✅ Done | ChatPanel + MapPanel (fallback khi chưa có key), page 2-cột; build pass |
| 3. Wire Supabase Realtime (chat) | ✅ Done | migration 0001 (bảng messages+RLS+Realtime); useMessages hook (load+subscribe INSERT+send); useIdentity; ChatPanel realtime. Verify: build pass, dev 200, SELECT/INSERT/realtime OK |
| 4. Map presence (location realtime) | ⬜ Blocked | ~~cần Google Maps API key~~ → đã đổi sang OpenFreeMap (tiles.openfreemap.org/styles/bright), không cần key; chờ wire Supabase Presence |

## Quyết định đang giữ
- Package manager: **npm** (Node 25 sẵn; Bun chưa cài, để sau).
- Chưa có Supabase/Maps key → scaffold + skeleton trước, cắm `.env.local` sau.

## Next action
Chat realtime ĐÃ chạy thật trên Supabase. Tiếp theo:
- **Phase 4 (map presence)**: tile đã là OpenFreeMap (không cần API key). Còn lại: wire Supabase Presence broadcast tọa độ vào MapPanel.
- **Nợ kỹ thuật**: bảng messages còn 1 tin test "hello from curl" (xóa trong Studio nếu muốn — REST không xóa được vì chưa có DELETE policy, đúng ý đồ demo). Khi thêm auth: siết RLS (insert chỉ authenticated, user_id = auth.uid()).
- ✅ 2026-06-24: Dọn nợ — xóa dead file `src/components/auth-panel.tsx`; cài Vitest ^4.1.9 + `vitest.config.ts` (alias @/→src/) + scripts `test`/`test:watch`. 16 tests pass, build pass.
