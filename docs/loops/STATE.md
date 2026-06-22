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
| 3. Wire Supabase Realtime (chat) | ⬜ Blocked | cần Supabase project + key. Pipeline: /office-hours→/plan→build(feature-builder)→review(code-reviewer)→qa→ship |
| 4. Map presence (location realtime) | ⬜ Blocked | cần Google Maps API key |

## Quyết định đang giữ
- Package manager: **npm** (Node 25 sẵn; Bun chưa cài, để sau).
- Chưa có Supabase/Maps key → scaffold + skeleton trước, cắm `.env.local` sau.

## Next action
Cỗ máy + skeleton xong. Chờ user cung cấp Supabase project + key (và Google Maps key) → chạy phase 3 (chat realtime) qua pipeline. Có key thì: tạo bảng `messages` + RLS, đổi ChatPanel sang Supabase Realtime subscription; MapPanel sang Presence broadcast.
