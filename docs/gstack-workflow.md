# gstack — Capture toàn bộ workflow (knowledge reference)

> Nén kiến thức từ research repo **github.com/garrytan/gstack** (Garry Tan, CEO YC) — bộ Claude Code setup biến 1 dev thành "đội kỹ sư ảo". Dùng để áp pattern vào cỗ máy GeoChat.
>
> **Ngày capture**: 2026-06-22. **Nguồn chính**: README + `docs/skills.md` + repo tree (fetch trực tiếp). Phần nội dung từng file trong `agents/`, `.claude/`, `lib/` KHÔNG mở được — tên agent cụ thể + schema state chính xác chưa verify ở mức từng dòng.

---

## 1. gstack là gì

- Bộ **slash-command skills cho Claude Code** (Markdown thuần, KHÔNG phải engine code riêng). Chạy được trên Claude Code + ~7 agent khác (Codex, Cursor, OpenCode...).
- Marketing: "**23 tools** đóng vai CEO, Designer, Eng Manager, Release Manager, Doc Engineer, QA". Thực tế `docs/skills.md` liệt kê **45 skills**.
- License **MIT**, ~100k+ stars (tăng nhanh). Co-author phần lớn với Claude Opus 4.6.
- Triết lý 1 câu: **"The point isn't who typed it, it's what shipped"** (kết quả > tác giả). "That is not a copilot. That is a team."

## 2. Pipeline end-to-end

Loop: **Think → Plan → Build → Review → Test → Ship → Reflect.**
Mỗi skill consume **artifact** của skill trước (structured handoff = cơ chế cốt lõi, không phải prompt rời rạc).

| Phase | Skill chính | Maker/Checker |
|-------|-------------|---------------|
| **Think** | `/office-hours` (6 câu hỏi ép reframe → design doc), `/spec` (intent→spec 5 phase) | Maker |
| | `/plan-ceo-review` ("sản phẩm 10 sao" ẩn; scope Expand/Selective/Hold/Reduce) | Checker |
| **Plan** | `/plan-eng-review` (architecture+diagram+edge case → **viết test plan**) | Checker |
| | `/plan-design-review` (7 pass, rate 0–10, flag AI-slop), `/plan-devex-review` (TTHW, persona) | Checker |
| | `/autoplan` (chạy CEO→Design→Eng tuần tự, chỉ escalate quyết định "taste") | Auto |
| **Build** | code (Claude Code chính), `/design-html`, `/design-shotgun` | Maker |
| **Review** | `/review` (staff-eng, "bug qua CI nhưng nổ ở prod"), `/design-review` (80 mục live), `/cso` (OWASP+STRIDE), `/codex` (**cross-model OpenAI**) | Checker |
| **Test** | `/qa` (mở browser thật, diff-aware, tự fix + **tự sinh regression test**, đọc test plan từ plan-eng-review), `/qa-only` (chỉ báo, không sửa), `/investigate` (root-cause, auto `/freeze`) | Checker |
| **Ship** | `/ship` (sync main, test, coverage, push, mở PR), `/land-and-deploy` (merge+deploy+verify prod) | Maker |
| | `/canary` (giám sát sau deploy: console error, perf regression) | Checker |
| **Reflect** | `/document-release` (cập nhật docs), `/retro` (metrics/streak/hotspot), `/learn` (lưu pattern) | both |

**Chốt quan trọng**: `/office-hours` design doc → `/plan-eng-review` đọc → viết test plan → `/qa` tự nhặt. Đây là chuỗi artifact handoff.

## 3. Maker ≠ Checker (nguyên tắc nền)

- "Một người không tự duyệt PR của mình." Agent KHÔNG được tự nghiệm thu.
- **Maker**: office-hours, build, design-html, ship, land-and-deploy, document-release.
- **Checker** (audit độc lập): review, qa/qa-only, cso, design-review, plan-*-review, **codex (cross-model)**, canary, retro.
- Plan-review = checker chạy TRƯỚC khi có code (audit plan); review/qa = checker SAU build.
- **Cross-model checker** (`/codex` dùng OpenAI để review code Claude viết) = nâng cấp đáng mượn: review bằng model KHÁC model đã code.
- Skill routing tự gợi ý checker đúng theo loại thay đổi: UI→design review, API→devex, architecture→eng review.

## 4. Guardrails (an toàn)

| Skill | Chặn / làm gì |
|-------|---------------|
| `/careful` | Cảnh báo lệnh phá hủy: `rm -rf`, `DROP TABLE`, `git push --force`, `git reset --hard`, `kubectl delete`. Whitelist build cleanup thường gặp. |
| `/freeze` | Giới hạn MỌI edit trong 1 thư mục — chặn Edit/Write ngoài ranh giới. |
| `/unfreeze` | Gỡ giới hạn `/freeze`. |
| `/guard` | `/careful` + `/freeze` — an toàn tối đa cho production. |
| `/investigate` | Auto bật `/freeze` module mục tiêu; "Iron Law: không fix trước khi điều tra"; dừng sau 3 lần fix thất bại → chất vấn architecture. |

## 5. Automation / loop

- **`/autoplan`** — automation trung tâm: 1 lệnh = plan đã review đầy đủ. Chạy CEO→Design→Eng với **decision principles được mã hóa**; chỉ surface "taste decision" ở gate duyệt cuối. → Ranh giới auto-decide (cái reversible/có nguyên tắc) vs escalate (cái cần phán đoán) qua AskUserQuestion.
- **`/plan-tune`** — tự tinh chỉnh độ nhạy câu hỏi: never-ask / always-ask / chỉ-hỏi-khi-one-way-door. Ngưỡng escalate học được per-question.
- **Real-time suggestion** — phát hiện phase hiện tại → gợi skill kế.
- **Continuous checkpoint (opt-in)** — auto-commit `WIP:` + metadata; `/context-restore` recover sau crash; `/ship` squash WIP trước khi mở PR.
- **`/learn`** — institutional memory; tự áp learning đã lưu khi skill khác chạy (compound theo thời gian).

## 6. State / Memory

- **GBrain** — knowledge base bền vững: per-project learnings, cross-session, federated index có privacy tier (rw/ro/deny). Setup `/setup-gbrain`, refresh `/sync-gbrain`.
- **Project Learnings** — lưu tại `$GSTACK_STATE_ROOT/projects/$SLUG/`.
- **Domain Skills** — note per-hostname, "quarantine" đến khi đủ tin cậy mới promote global → rất giống `learnings.md` + độ tin cậy của GeoChat.
- **Design Taste Memory** — học preference qua `/design-shotgun`.
- **Analytics** — telemetry local JSONL (remote opt-in, mặc định off).

## 7. Tech stack gstack

TypeScript (~79%) + Go Templates (~11%) + Shell. Runtime **Bun** (+ `bunfig.toml`). Browser **Playwright + Chromium** (headed/stealth). **Supabase** edge functions cho telemetry.

---

## 8. Mapping gstack → GeoChat (đã có vs nên mượn)

| gstack | GeoChat hiện có | Khoảng cách |
|--------|-----------------|-------------|
| Pipeline Think→...→Reflect | `/office-hours→/plan→/build→/review→/qa→/ship` | ✅ Là core subset. Thiếu Reflect (retro/canary) |
| Maker ≠ Checker | feature-builder vs code-reviewer (subagent độc lập) | ✅ Có. Thiếu **cross-model checker** (codex) |
| `/careful` | hook careful (.claude/settings.json) | ✅ Có |
| `/freeze` `/guard` | ❌ chưa có | Nên thêm edit-boundary, nhất là khi thao tác Supabase shared |
| Artifact handoff (plan → test plan → qa) | STATE.md per-feature | ⚠️ Có STATE nhưng chưa emit **test plan file** để qa tự nhặt |
| `/autoplan` gate | ❌ chưa có | Chain plan review, chỉ escalate taste decision |
| `/learn` + GBrain | learnings.md (có confidence) + auto-memory | ✅ Tương đương cơ bản. Thiếu quarantine→promote rule |
| `/retro` `/health` `/canary` | ❌ chưa có | Đóng vòng Reflect, feed learnings.md |
| `/cso` security | security-reviewer (kế hoạch, chưa làm) | ⚠️ Có ý định, chưa có skill |

**4 nâng cấp đòn bẩy cao nhất cho GeoChat:**
1. **Artifact handoff**: `/plan` emit test-plan file → `/qa` tự đọc (như gstack plan-eng-review→qa).
2. **`/autoplan`-style gate**: chain plan review, chỉ escalate quyết định taste.
3. **`/freeze` / `/guard`**: thêm edit-boundary bổ trợ hook careful (quan trọng khi debug trên Supabase shared).
4. **Reflect loop**: `/canary` sau deploy + `/retro` → feed learnings.md (compound).

**Mượn riêng đáng giá**: cross-model checker (review bằng model khác model đã code) + quarantine→promote cho learnings.

---

## Nguồn
- https://github.com/garrytan/gstack (README)
- https://github.com/garrytan/gstack/blob/main/docs/skills.md
- https://github.com/garrytan/gstack/tree/main
- https://www.augmentcode.com/learn/garry-tan-gstack-claude-code
- https://www.buildthisnow.com/blog/guide/agents/garry-tan-gstack-claude-code
- https://techcrunch.com/2026/03/17/why-garrys-tans-claude-code-setup-has-gotten-so-much-love-and-hate/

> Độ tin cậy: README + skills.md fetch trực tiếp (cao). Nội dung file trong agents/.claude/lib KHÔNG mở được → tên agent + schema state chưa verify từng dòng. Số stars dao động theo nguồn (~100k±).
