# Test Plan — Typing indicator

> /qa đọc file này chạy từng bước. Mỗi bước: hành động → kết quả mong đợi.

1. **Build**: `npm run build` → PASS (TS strict, không lỗi).
2. **Lint**: `npm run lint` → file feature mới (use-typing.ts, chat-panel.tsx) sạch; lỗi pre-existing use-messages.ts không tính.
3. **Dev server**: `npm run dev` → `/` HTTP 200, không lỗi runtime trong log.
4. **Không vỡ khi thiếu Supabase**: code null-safe — useTyping trả rỗng nếu chưa cấu hình, app không crash.
5. **Không tự hiện cho mình**: logic lọc bỏ event của chính userId (đọc code xác nhận).
6. **Cleanup**: useTyping cleanup có removeChannel + clearTimeout (đọc code xác nhận, tránh leak).
7. **(thủ công, cần 2 tab + login)**: tab A gõ → tab B thấy "A đang nhập…"; A dừng 2s → ẩn; A gửi tin → ẩn ngay. Ghi nhận để user tự xác nhận trải nghiệm.
8. **Timeout phía nhận**: nếu A đóng tab khi đang gõ → B tự ẩn sau ~4s (không kẹt indicator).
