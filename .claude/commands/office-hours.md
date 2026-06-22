---
description: Bước 1 pipeline — ép làm rõ scope feature bằng 6 câu hỏi trước khi code
---

Bạn đang ở bước **office-hours** của pipeline GeoChat (xem [CLAUDE.md](../../CLAUDE.md)).

Feature cần làm rõ: **$ARGUMENTS**

Đặt tối đa **6 câu hỏi** ép làm rõ scope (dùng AskUserQuestion). Bám:
1. Mục tiêu người dùng cuối của feature là gì? Định nghĩa "xong".
2. Phạm vi IN / OUT (cái gì KHÔNG làm lần này).
3. Data model + thay đổi DB (bảng/cột/RLS)?
4. Edge case quan trọng (mạng rớt, đồng thời, dữ liệu thiếu).
5. Ảnh hưởng tới phần đã có (chat realtime, identity)?
6. Tiêu chí nghiệm thu để Checker kiểm.

Sau khi có câu trả lời, ghi tóm tắt scope vào `docs/loops/<feature>-STATE.md` rồi gợi ý chạy `/plan`.
