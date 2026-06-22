# Learnings — Pattern tích lũy GeoChat

> Sau mỗi feature, ghi pattern học được + độ tin cậy. Maker/Checker đọc trước khi làm việc tương tự.
> Format: `- [confidence: cao/vừa/thấp] <pattern>. **Bối cảnh**: ...`

## Hạ tầng / môi trường
- [confidence: cao] Máy này có Node 25 + npm 11, **chưa có Bun và gh CLI**. Dùng npm cho scaffold. **Bối cảnh**: check 2026-06-22.

## Realtime (Supabase)
_(chưa có — điền sau khi làm feature chat)_

## Map (Google Maps)
_(chưa có — điền sau khi làm feature map)_

## Quy trình loop
- [confidence: vừa] Hook `careful` đặt ở `.claude/settings.json` không tự nạp nếu file chưa tồn tại lúc session khởi động → cần `/hooks` hoặc restart. **Bối cảnh**: tạo hook 2026-06-22.
