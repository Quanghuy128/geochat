---
description: Retrospective — nhìn lại các feature đã ship, rút pattern, feed vào learnings
---

**retro** — nhìn lại công việc gần đây của GeoChat (đóng vòng REFLECT, compound kiến thức).

Phạm vi: **$ARGUMENTS** (mặc định: từ lần retro trước / vài feature gần nhất).

Thu thập:
1. **Đã ship gì**: `git log --oneline` từ mốc trước → liệt kê feature + commit.
2. **Pipeline chạy thế nào**: feature nào qua đủ Maker→Checker? Review bắt được gì (blocker quan trọng)?
3. **Bài học**: cái gì làm tốt (giữ), cái gì vấp (sửa quy trình). Rút pattern tái dùng.
4. **Nợ tích luỹ**: việc treo qua nhiều feature → có nên ưu tiên dọn?

Output:
- Tóm tắt: shipped, blocker đáng nhớ, thay đổi quy trình đề xuất.
- **Cập nhật `docs/learnings.md`**: thêm pattern mới (kèm confidence). Promote learning đã đủ tin cậy (xem /learn).
- Gợi ý 1-3 việc cho đợt tới.
