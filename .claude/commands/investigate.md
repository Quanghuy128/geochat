---
description: Debug root-cause có kỷ luật — điều tra trước, fix sau (Iron Law)
---

Điều tra bug: **$ARGUMENTS**

**Iron Law: KHÔNG fix khi chưa hiểu nguyên nhân.** (mượn từ gstack /investigate)

Quy trình:
1. **Khoanh vùng**: xác định module liên quan → bật `/freeze` vùng đó (ghi `.claude/.freeze`) để không sửa lan man trong lúc điều tra.
2. **Tái hiện**: dựng cách tái hiện bug (test/log/curl/dev server). Bug không tái hiện được = chưa hiểu.
3. **Giả thuyết**: nêu 1-3 giả thuyết nguyên nhân, có bằng chứng (log, code path, data). Xếp theo khả năng.
4. **Kiểm chứng**: test từng giả thuyết bằng quan sát thật (đọc code, thêm log, query DB), KHÔNG đoán.
5. **Root cause**: chỉ khi xác định chắc nguyên nhân mới đề xuất fix.

**Giới hạn 3 lần**: nếu sửa 3 lần vẫn không hết → DỪNG, chất vấn lại architecture/giả định thay vì thử tiếp.

Sau khi tìm ra: gỡ freeze (`/unfreeze`), rồi đưa qua `/build` (Maker fix) → `/review` → `/qa`. Ghi nguyên nhân + cách phát hiện vào `docs/learnings.md`.
