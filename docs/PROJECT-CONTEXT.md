# Context: Loop Engineering + Dự án "Realtime Chat & Map" tự động hóa

> **Mục đích file này**: Nén toàn bộ context cuộc trao đổi (phân tích Loop Engineering + research gstack + plan dựng "cỗ máy tự động hóa" cho dự án mới) để lần sau khởi động KHÔNG phải research lại.
>
> **Ngày**: 2026-06-22 · **Trạng thái**: Plan đã chốt hướng, CHƯA thực thi code.

---

## 1. Bối cảnh & mục tiêu của user

- User muốn **build dự án mới**: app **chat realtime** + **Google Map location realtime**.
- Cốt lõi: **một source code tự động hóa HOÀN TOÀN workflow** → giảm tối đa thời gian code/maintain.
- Yêu cầu research: repo **gstack** (https://github.com/garrytan/gstack) + engineer skills.
- Xuất phát điểm: trước đó user đưa infographic **"Kỹ thuật Vòng lặp" (Loop Engineering)**.

### Quyết định đã chốt (qua AskUserQuestion)
| Câu hỏi | Lựa chọn của user |
|---------|-------------------|
| Repo & stack | **Repo mới hoàn toàn, để Claude chọn stack** (ngoài Terra) |
| Ưu tiên #1 | **Dựng "cỗ máy" tự động hóa TRƯỚC, rồi mới build app** |
| (Loop trước đó) Mục tiêu loop | Theo tiến độ dev-lifecycle 1 feature |
| (Loop trước đó) Nhịp đập | Thủ công `/loop` khi cần (local, không cloud) |

---

## 2. Loop Engineering ("Kỹ thuật Vòng lặp") — tóm tắt

**Ý tưởng cốt lõi**: *Đừng tự thay mình làm việc của tác nhân. Hãy thiết kế HỆ THỐNG để tác nhân tự làm hộ.* → Chuyển từ "chọc tác nhân" sang "chọc hệ thống".

### 5 khối xây dựng (Claude Code đều có)
1. **Tự động hóa (Automations)** — chạy theo lịch/sự kiện → nhịp đập vòng lặp. (`/loop`, `/schedule`)
2. **Worktrees** — tách mục làm việc, chạy song song an toàn. (`EnterWorktree`)
3. **Kỹ năng (Skills)** — tách "cách làm" ra file hướng dẫn.
4. **Plugin & Kết nối (MCP)** — mở rộng tay chân: issue tracker, Slack, CI.
5. **Sub-agent** — phân chia chuyên môn, **Maker ↔ Checker**.

→ **STATE.md = "trục sống"** = trí nhớ nối các phiên/ngày lại.

### 4 lý do vòng lặp VẪN SAI (guardrail bắt buộc)
1. **Kiểm tra sai bản văn** — Checker phải kiểm đúng thứ (đừng pass lint vô nghĩa) → bám design doc làm chuẩn nghiệm thu.
2. **Lỗ hổng hiểu biết** — chạy nhanh nhưng thiếu hiểu → phải đọc knowledge/domain trước khi code.
3. **Thiên kiến tự kiểm** — Maker không được tự kiểm việc mình → **Maker ≠ Checker** (khác agent).
4. **Tự động hóa nhỏ nhất → trục sống** là nguyên tắc nền.

---

## 3. gstack là gì (kết luận research)

**gstack** (Garry Tan, CEO Y Combinator) = bộ **Claude Code setup** = "đội kỹ sư ảo" gồm 23+ skills tự động hóa toàn bộ SDLC. **KHÔNG phải** source code chat/map. ~113k★, MIT, build riêng cho Claude Code.

- Báo cáo: ship ~810× tốc độ 2013; 3 service + 40 feature/60 ngày khi vẫn làm CEO YC.
- Stack gstack: TypeScript/Bun/Playwright/Chrome DevTools/Supabase (telemetry).

### Pipeline gstack
```
idea → /office-hours → /plan-ceo-review → /plan-eng-review →
/design-html → /review → /qa → /ship → /land-and-deploy
```
- **Maker**: implementation, `/design-html`.
- **Checker** (độc lập): `/review`, `/qa`, `/design-review`.
- **State/memory**: `~/.gstack/projects/$SLUG/` (design docs, decisions) + `/learn` → `learnings.jsonl` (pattern + confidence).
- **`/autoplan`**: chạy hết review, auto-quyết cái reversible, chỉ escalate cái mơ hồ.
- **Guardrails**: `/careful` (chặn rm -rf, DROP TABLE, force-push), `/freeze`, `/guard`.

### Map gstack ↔ những gì user ĐÃ có trong Terra
| gstack | Terra đã có tương đương |
|--------|-------------------------|
| Pipeline idea→ship | ✅ 9 dev-lifecycle skills |
| Maker ≠ Checker | ✅ 13 agents + policy multi-reviewer parallel |
| State per-project + learnings | ⚠️ Có memory file, CHƯA có STATE per-project |
| `/office-hours` | ✅ new-requirement (BA) |
| `/autoplan` | ❌ Chưa có |
| `/careful`/`/freeze` | ⚠️ Có rule DB safety (CLAUDE.md), CHƯA có hook chặn thật |

> **CẢNH BÁO**: KHÔNG clone gstack vào Terra (PHP/Laravel) — xung đột với stack TS/Bun của gstack. Chỉ **mượn pattern**, áp lên hệ agents sẵn có.

---

## 4. Stack đề xuất cho dự án mới (tối ưu tự động hóa + realtime, ít maintain nhất)

| Lớp | Chọn | Lý do ít maintain |
|-----|------|-------------------|
| Framework | **Next.js (App Router) + TypeScript** | Khớp gstack, Claude generate tốt, full-stack 1 repo |
| Realtime + DB + Auth | **Supabase** (Postgres + Realtime + Auth + PostGIS) | Realtime channels + presence sẵn; PostGIS cho geo; không tự quản WS server |
| Map | **Google Maps JS API** (`@vis.gl/react-google-maps`) | Đúng yêu cầu; marker realtime drive bằng Supabase presence |
| UI | **Tailwind + shadcn/ui** | Claude generate chuẩn, zero-maintain |
| Test/CI | **Vitest + Playwright + GitHub Actions** | Khớp Checker pipeline |
| Runtime | **Bun** | Khớp gstack |

- **Chat realtime** = Supabase Realtime (Postgres changes).
- **Map location realtime** = Supabase **Presence** broadcast tọa độ → marker di chuyển live. Không cần WebSocket server riêng → ít maintain nhất.

---

## 5. PLAN step-by-step (đã chốt hướng, CHƯA thực thi)

### GIAI ĐOẠN 0 — Khởi tạo repo + "cỗ máy" (LÀM TRƯỚC)
- **Step 1 — Scaffold repo mới + nền**: tạo `realtime-chat-map/` (ngoài Terra); `bun create next-app` + Tailwind + shadcn + Supabase client + Google Maps lib; `git init` + push GitHub + Actions trống.
- **Step 2 — Bộ skills/agents kiểu gstack cho repo mới**: `CLAUDE.md` + `.claude/` riêng.
  - Maker agents: `feature-builder` (Next.js+Supabase), `realtime-specialist`, `map-specialist`.
  - Checker agents (KHÁC maker): `code-reviewer`, `qa-runner`, `security-reviewer`.
- **Step 3 — Trục sống + bộ nhớ học**: `docs/loops/<feature>-STATE.md` (phase từng feature) + `docs/learnings.md` (pattern tích lũy kiểu learnings.jsonl).
- **Step 4 — Pipeline skills (vòng lặp idea→ship)**:
  ```
  /office-hours → 6 câu hỏi ép làm rõ scope
  /plan         → architecture + data flow + edge case
  /build        → maker agent code feature
  /review       → checker: bug production-grade
  /qa           → checker: Playwright test live
  /ship         → test + coverage + PR tự động
  ```
- **Step 5 — Guardrails + nhịp đập**: hook `/careful` chặn lệnh phá hủy (DROP/rm -rf/force-push — bài học DB incident Terra); `/loop-feature` (manual `/loop`): đọc STATE → chạy phase kế → Maker→Checker → ghi STATE.

### GIAI ĐOẠN 1 — Dogfood
- **Step 6**: dùng CHÍNH pipeline vừa dựng để build feature #1 (auth + skeleton chat) → chứng minh cỗ máy chạy end-to-end.

### GIAI ĐOẠN 2+ — Build app bằng cỗ máy
- Mỗi feature (chat realtime → map presence → location sharing) đều đi qua `/office-hours → /plan → /build → /review → /qa → /ship`.

---

## 6. Điểm dừng hiện tại — câu hỏi mở chờ user trả lời

Trước khi tạo file Step 1+2, cần user chốt:
1. **Đã có Supabase project + Google Maps API key chưa?** (hoặc "tự lo key sau" → scaffold phần không cần key trước).
2. **Đường dẫn repo mới** đặt ở đâu (ngoài `/home/huynq12/vpo`)?

---

## 7. Next action khi quay lại
- Nhận đường dẫn repo + tình trạng key → bắt đầu **Step 1 (scaffold)** rồi **Step 2 (bộ skills/agents nền)**.
- Đó là phần "cỗ máy" cốt lõi; làm xong user thấy hình hài ngay.

## Sources
- https://github.com/garrytan/gstack
- https://github.com/garrytan/gstack/blob/main/docs/skills.md
- https://www.sitepoint.com/gstack-garry-tan-claude-code/
- https://www.mindstudio.ai/blog/what-is-gstack-gary-tan-claude-code-framework
