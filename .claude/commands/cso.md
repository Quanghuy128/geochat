---
description: Audit bảo mật (OWASP Top 10 + STRIDE) bằng security-reviewer độc lập
---

Bước **cso** (Chief Security Officer) của pipeline GeoChat.

Phạm vi: **$ARGUMENTS** (mặc định: diff hiện tại / feature đang làm).

**Gọi subagent `security-reviewer`** (Checker bảo mật độc lập) qua Agent tool.

Truyền cho nó:
- File/diff cần audit (chạy `git diff` để biết phạm vi).
- Bối cảnh feature từ `docs/loops/<feature>-STATE.md`.
- Nhắc trọng tâm GeoChat: RLS Supabase, secret/NEXT_PUBLIC, auth callback, input validation.

Nhận finding 🔴/🟠/🟡/🟢 + PASS/NEEDS-WORK.
- Có finding 🔴/🟠 → quay lại `/build` cho Maker vá (truyền finding) rồi cso lại.
- PASS → ghi vào STATE, tiếp `/qa` hoặc `/ship`.

Khi nào chạy: thay đổi đụng auth, RLS, migration, input người dùng, secret, API route.
