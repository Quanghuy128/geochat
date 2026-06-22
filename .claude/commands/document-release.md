---
description: Cập nhật docs khớp với thay đổi vừa ship (README, CLAUDE.md, STATE)
---

**document-release** — đồng bộ tài liệu sau khi ship feature: **$ARGUMENTS**

Làm:
1. Xem `git diff` / commit gần nhất để biết đã thay đổi gì.
2. Cập nhật cho khớp thực tế:
   - **README.md**: tính năng mới, cách chạy, env cần thiết (nếu đổi).
   - **CLAUDE.md**: stack/convention nếu thay đổi (vd đổi lib, thêm bảng).
   - **docs/loops/<feature>-STATE.md**: đánh dấu ship done.
   - **.env.example**: thêm/bớt biến môi trường nếu có.
3. Đảm bảo KHÔNG tài liệu nào còn mô tả sai (vd nhắc Google Maps khi đã đổi MapLibre).
4. Không bịa tính năng chưa có; chỉ ghi cái đã ship thật.

Mục tiêu: người mới clone đọc docs là chạy được, không lệch với code.
