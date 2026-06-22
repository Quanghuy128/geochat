---
description: Bước 2 pipeline — thiết kế architecture + data flow + edge case cho feature
---

Bạn đang ở bước **plan** của pipeline GeoChat.

Feature: **$ARGUMENTS** (đọc scope đã chốt trong `docs/loops/<feature>-STATE.md`).

Tạo plan kỹ thuật, KHÔNG code:
1. **Architecture**: file nào thêm/sửa, component/hook/lib, ranh giới Server vs Client Component.
2. **Data flow**: từ user action → state → Supabase → realtime → UI.
3. **Thay đổi DB**: migration mới (bảng/cột/RLS/policy) — viết dạng plan, file thực tế để bước build tạo.
4. **Edge case** + cách xử lý.
5. **Tiêu chí nghiệm thu** (Checker sẽ kiểm chính xác cái này).

Ghi plan vào `docs/loops/<feature>-STATE.md` (phần Plan). Gợi ý chạy `/build`.
