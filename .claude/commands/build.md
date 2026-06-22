---
description: Bước 3 pipeline — Maker (feature-builder) code feature theo plan
---

Bạn đang ở bước **build** của pipeline GeoChat.

Feature: **$ARGUMENTS**

**Gọi subagent `feature-builder`** (Maker) qua Agent tool để implement feature theo plan trong `docs/loops/<feature>-STATE.md`.

QUAN TRỌNG — đúng nguyên tắc Maker ≠ Checker:
- Maker (feature-builder) CHỈ code + cập nhật STATE + nêu assumption.
- KHÔNG để Maker tự kết luận "đã ổn". Việc nghiệm thu là của `/review` và `/qa` (Checker độc lập).

Truyền cho feature-builder: tên feature, đường dẫn STATE, plan, và yêu cầu liệt kê assumption cần Checker verify.

Sau khi Maker xong, gợi ý chạy `/review`.
