# Learnings — Pattern tích lũy GeoChat

> Sau mỗi feature, ghi pattern học được + độ tin cậy. Maker/Checker đọc trước khi làm việc tương tự.
> Format: `- [confidence: cao/vừa/thấp] <pattern>. **Bối cảnh**: ...`

## Hạ tầng / môi trường
- [confidence: cao] Máy này có Node 25 + npm 11, **chưa có Bun và gh CLI**. Dùng npm cho scaffold. **Bối cảnh**: check 2026-06-22.

## Realtime (Supabase)
- [confidence: cao] Supabase dùng **hệ key mới**: `publishable` (an toàn cho browser/`NEXT_PUBLIC_*`) thay anon; `secret` thay service_role (KHÔNG để client). Code đọc qua tên biến `NEXT_PUBLIC_SUPABASE_ANON_KEY` vẫn nhận publishable key. **Bối cảnh**: project geochat 2026-06-22.
- [confidence: cao] Bật Realtime cho 1 bảng = `alter publication supabase_realtime add table public.<t>`. Subscribe qua `.channel().on("postgres_changes",{event:"INSERT",schema:"public",table})`. Tin của mình về qua realtime → đừng tự append local (tránh trùng), dedup theo id cho chắc. **Bối cảnh**: useMessages hook.
- [confidence: cao] Phải `supabase.removeChannel(channel)` trong cleanup useEffect, nếu không leak subscription. **Bối cảnh**: review checklist.
- [confidence: vừa] DELETE qua REST trả 204 nhưng 0 rows nếu thiếu RLS DELETE policy (im lặng, không báo lỗi). Test xóa phải verify số rows thật. **Bối cảnh**: tin test không xóa được.

## Map (Google Maps)
_(chưa có — điền sau khi làm feature map)_

## Quy trình loop
- [confidence: vừa] Hook `careful` đặt ở `.claude/settings.json` không tự nạp nếu file chưa tồn tại lúc session khởi động → cần `/hooks` hoặc restart. **Bối cảnh**: tạo hook 2026-06-22.
