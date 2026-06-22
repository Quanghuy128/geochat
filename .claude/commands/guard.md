---
description: An toàn tối đa — bật cả careful (chặn lệnh phá hủy) lẫn freeze (giới hạn vùng sửa)
---

Bật **guard** = `/careful` + `/freeze` cho công việc nhạy cảm (production, DB shared).

Làm:
1. Xác nhận hook `careful` đang hoạt động (đã wire sẵn trong settings.json — chặn rm -rf/DROP/force-push). Nếu chưa nạp (vừa tạo session này) → nhắc user restart/`/hooks`.
2. Bật freeze: ghi vùng cho phép vào `.claude/.freeze` theo `$ARGUMENTS` (như /freeze).
3. Báo user: "Guard ON — careful (chặn lệnh phá hủy) + freeze (chỉ sửa trong <list>). Gỡ freeze: /unfreeze."

Dùng khi: thao tác trên Supabase shared, deploy, hoặc bất kỳ việc nào một lệnh sai = mất dữ liệu.
