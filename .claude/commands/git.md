---
description: Commit + push an toàn — viết commit message tiếng Anh đầy đủ (summary + body chi tiết), kiểm secret trước khi commit
---

Bạn đang chạy skill **git** của GeoChat: stage → kiểm an toàn → commit (message **tiếng Anh**, mô tả đầy đủ) → push.

Mô tả tùy chọn của user (nếu có): **$ARGUMENTS**

## Nguyên tắc

- **Commit message LUÔN bằng tiếng Anh**, kể cả khi user mô tả bằng tiếng Việt — dịch sang tiếng Anh kỹ thuật, rõ nghĩa.
- **Không bao giờ** commit `.env.local` hay secret (xem DB-safety + careful hook trong CLAUDE.md).
- **Không push thẳng lên `master`** nếu đang ở `master` — tạo nhánh trước rồi mới push.
- `git push --force` / `-f` / `reset --hard` bị hook `careful` chặn — đừng dùng; nếu cần rewrite, dùng `--force-with-lease` và giải thích lý do.

## Các bước

1. **Khảo sát**: chạy `git status`, `git diff` (và `git diff --staged` nếu đã stage) để hiểu RÕ thay đổi. Không commit mù.
2. **Kiểm an toàn**:
   - `git status` xác nhận `.env.local`, file chứa key/secret KHÔNG nằm trong danh sách stage.
   - Nếu thấy secret sắp bị track → DỪNG, báo user, không commit.
3. **Stage**: `git add` các file liên quan (ưu tiên thêm có chọn lọc; `git add -A` chỉ khi chắc toàn bộ thay đổi đều thuộc về commit này).
4. **Soạn commit message tiếng Anh** theo cấu trúc 3 lớp (xem mẫu bên dưới):
   - **Summary** (dòng đầu): tổng quan, ≤ 72 ký tự, thể mệnh lệnh, có prefix Conventional Commit.
   - **Body**: mô tả đầy đủ — *what & why* (không chỉ *what*); liệt kê thay đổi chính theo gạch đầu dòng; nêu lý do/bối cảnh; ghi rõ tác động (breaking, migration, env mới).
   - **Footer** (nếu có): tham chiếu issue/PR, `BREAKING CHANGE:`, co-author.
5. **Commit**: dùng heredoc để giữ định dạng nhiều dòng.
6. **Push**: nếu đang ở nhánh feature → `git push -u origin <branch>`. Nếu đang ở `master` → tạo nhánh trước (`git checkout -b <type>/<short-desc>`) rồi push. Báo user nếu cần mở PR (gợi ý dùng `gh pr create`).
7. **Báo cáo**: in lại commit message đã dùng + kết quả push (nhánh, có cần PR không).

## Mẫu commit message (tiếng Anh, đầy đủ)

```
<type>(<scope>): <imperative summary, ≤72 chars>

<Overview: 1–2 câu nói rõ thay đổi này LÀM GÌ và TẠI SAO.>

- <Detailed change 1: file/khu vực + nội dung cụ thể>
- <Detailed change 2>
- <Detailed change 3>

<Tác động / lưu ý: breaking change, migration, env var mới, follow-up.>

Refs: #<pr-or-issue>
```

`type` ∈ `feat` | `fix` | `chore` | `refactor` | `docs` | `test` | `ci` | `perf` | `build`.
`scope` ví dụ: `chat`, `map`, `auth`, `ci`, `db`, `supabase`.

### Ví dụ thực tế

```
ci(discord): enrich deploy notification embed

Add commit metadata, clickable links, and build duration to the
Discord embed so notifications are actionable without opening Actions.

- ci.yml: add "Mark start time" step to compute build duration
- ci.yml: build payload with jq (safe-escapes commit messages with quotes)
- Distinguish pull_request vs push; use head_ref for the real source branch
- Add fields: commit message + author, PR/Run/Commit links, footer timestamp

No behavior change to the build/lint/typecheck gate.

Refs: #4
```

> Mục tiêu: người đọc `git log` 6 tháng sau vẫn hiểu được *cái gì đổi* và *vì sao*, không cần mở diff.
