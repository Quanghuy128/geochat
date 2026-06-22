---
description: Bước 6 pipeline — chốt feature: test cuối + cập nhật STATE/learnings + commit
---

Bạn đang ở bước **ship** của pipeline GeoChat.

Feature: **$ARGUMENTS**

Chỉ ship khi `/review` PASS và `/qa` PASS.

1. Chạy lại `npm run build` lần cuối cho chắc.
2. Cập nhật `docs/loops/<feature>-STATE.md`: đánh dấu Done, ghi gì đã verify.
3. Thêm pattern học được vào `docs/learnings.md` (kèm confidence).
4. `git add -A` → kiểm `.env.local`/secret KHÔNG bị track → commit với message mô tả feature + "qua pipeline Maker→Checker".
5. Báo cáo: feature đã ship, các finding đã xử lý, nợ kỹ thuật còn lại.
