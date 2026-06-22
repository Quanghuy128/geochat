---
description: Quản lý learnings — thêm pattern mới (quarantine) và promote khi đủ tin cậy
---

**learn** — quản lý trí nhớ tích luỹ tại `docs/learnings.md`. Pattern: **quarantine → promote** (mượn gstack domain skills).

Hành động (theo `$ARGUMENTS`):

**Thêm learning mới** (mặc định): ghi vào `docs/learnings.md` đúng section (Realtime/Auth/Map/Quy trình...), format:
`- [confidence: thấp/vừa/cao] <pattern>. **Bối cảnh**: <khi nào học được>.`
- Mới rút ra, chưa lặp lại → **confidence: thấp** (quarantine — biết nhưng chưa chắc).
- Đã thấy đúng ≥2 lần qua các feature → nâng **vừa/cao** (promote).

**Promote**: rà các learning confidence thấp/vừa — cái nào đã được xác nhận lại qua feature mới → nâng cấp + ghi lý do. Cái nào hoá ra sai → sửa hoặc xóa.

**Áp dụng**: khi bắt đầu feature mới, đọc learnings liên quan trước (đặc biệt confidence cao) để không lặp lỗi cũ.

Nguyên tắc: learning confidence cao = luật áp dụng mặc định; thấp = gợi ý cần kiểm lại. Đừng để learnings phình rác — gộp/xóa cái lỗi thời.
