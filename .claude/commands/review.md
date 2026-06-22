---
description: Bước 4 pipeline — Checker (code-reviewer) review độc lập code vừa build
---

Bạn đang ở bước **review** của pipeline GeoChat.

Feature: **$ARGUMENTS**

**Gọi subagent `code-reviewer`** (Checker) qua Agent tool — đây là agent KHÁC với feature-builder đã code (tránh thiên kiến tự kiểm).

Truyền cho code-reviewer:
- Tên feature + đường dẫn STATE + plan + tiêu chí nghiệm thu.
- Danh sách assumption mà Maker đã nêu (yêu cầu verify từng cái).
- Diff/file đã thay đổi (chạy `git diff` để biết).

code-reviewer trả về finding 🔴/🟡/🟢 + kết luận PASS/NEEDS-WORK.
- NEEDS-WORK → quay lại `/build` cho Maker sửa (truyền finding).
- PASS → gợi ý chạy `/qa`.

Ghi kết quả review vào STATE.
