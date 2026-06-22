---
description: Bước 5 pipeline — Checker chạy thử feature live (build + dev + verify hành vi)
---

Bạn đang ở bước **qa** của pipeline GeoChat.

Feature: **$ARGUMENTS**

Kiểm chứng hành vi thật (không chỉ đọc code):
1. `npm run build` — phải pass (typecheck + lint).
2. `npm run dev` (background) → chờ ready → verify trang 200 + không lỗi runtime trong log.
3. Verify đúng tiêu chí nghiệm thu trong STATE: với feature liên quan DB/realtime, test qua Supabase REST (SELECT/INSERT) hoặc chrome-devtools nếu có Chrome.
4. Bám design doc/scope làm chuẩn — KHÔNG pass cho có.

Kết quả PASS/FAIL ghi vào STATE.
- FAIL → quay lại `/build`.
- PASS → gợi ý chạy `/ship`.

Nhớ TaskStop dev server sau khi xong.
