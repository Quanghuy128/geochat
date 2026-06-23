# GeoChat — Realtime Chat & Map

App **chat realtime** + **map location realtime** (MapLibre GL + OpenStreetMap). Mục tiêu cốt lõi: source code tự động hóa workflow để giảm tối đa thời gian code/maintain (Loop Engineering — xem [docs/PROJECT-CONTEXT.md](docs/PROJECT-CONTEXT.md)).

> **Pattern tham chiếu**: cỗ máy GeoChat mượn từ gstack (Garry Tan). Capture đầy đủ workflow gstack + mapping sang GeoChat tại [docs/gstack-workflow.md](docs/gstack-workflow.md).

## Stack

| Lớp | Công nghệ |
|-----|-----------|
| Framework | Next.js (App Router) + TypeScript |
| Realtime + DB + Auth | Supabase (Postgres + Realtime + Presence + Auth + PostGIS) |
| Map | MapLibre GL + OpenStreetMap (tiles demotiles MapLibre) qua `react-map-gl/maplibre` — free, KHÔNG cần API key |
| UI | Tailwind CSS + shadcn/ui |
| Test | Vitest (unit) + Playwright (e2e) |
| CI | GitHub Actions (lint + typecheck + build) — xem `.github/workflows/` |
| Deploy | Vercel (preview/PR + prod trên `master`). Migration qua Supabase CLI có duyệt tay — xem [README.md](README.md#cicd) |
| Package manager | npm (Bun là tùy chọn, khớp gstack nhưng chưa cài) |

- **Chat realtime** = Supabase Realtime (Postgres changes trên bảng messages).
- **Map location realtime** = Supabase **Presence** broadcast tọa độ → marker di chuyển live. KHÔNG tự dựng WebSocket server.

## Quy ước

- TypeScript strict. Server Components mặc định; `"use client"` chỉ khi cần.
- Supabase: client trong `lib/supabase/`. Không hardcode key — dùng `.env.local` (xem `.env.example`).
- Component UI từ shadcn để tại `components/ui/`.

## DB safety (BẮT BUỘC — bài học DB incident trước đây)

- TUYỆT ĐỐI không chạy `DROP TABLE`, `TRUNCATE`, `DELETE` không có `WHERE` trên DB thật.
- Migration phải reversible; review trước khi apply lên môi trường shared.
- Hook `careful` (`.claude/settings.json`) chặn các lệnh phá hủy ở shell.

## Loop Engineering — nguyên tắc nền

- **Maker ≠ Checker**: agent code (`feature-builder`) KHÁC agent review (`code-reviewer`). Maker không tự nghiệm thu việc mình.
- **STATE.md = trục sống**: mỗi feature có file phase tại `docs/loops/`. Đọc STATE → làm phase kế → ghi lại STATE.
- **learnings.md**: tích lũy pattern + độ tin cậy sau mỗi feature.

## Pipeline 1 feature (cỗ máy auto-workflow kiểu gstack)

```
THINK   /office-hours → làm rõ scope (6 câu hỏi)   [hoặc /autoplan: chạy + chỉ hỏi taste]
PLAN    /plan         → architecture + data flow + edge case + TEST PLAN (file riêng)
BUILD   /build        → feature-builder (maker)
REVIEW  /review       → code-reviewer (checker độc lập)
        /cso          → security-reviewer (OWASP/STRIDE) — khi đụng auth/RLS/secret
QA      /qa           → test live, tự đọc testplan
SHIP    /ship         → test + coverage + commit/PR
REFLECT /canary       → giám sát sau ship   /retro + /learn → feed learnings.md
```

**Guardrails**: `/careful` (hook chặn lệnh phá hủy) · `/freeze`+`/unfreeze`+`/guard` (giới hạn vùng sửa) · `/investigate` (debug root-cause, Iron Law: điều tra trước fix).
**Tiện ích**: `/health` (dashboard chất lượng) · `/document-release` (đồng bộ docs) · `/learn` (quarantine→promote learnings).
**Agents**: Maker = `feature-builder`; Checker (độc lập) = `code-reviewer`, `security-reviewer`.

> Full workflow gstack + mapping: [docs/gstack-workflow.md](docs/gstack-workflow.md).
> ⚠️ Skill/agent/hook mới cần restart hoặc `/hooks` để Claude Code nạp (không nạp giữa session).
