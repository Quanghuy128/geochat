---
description: Chạy office-hours + plan tự động, chỉ dừng hỏi ở quyết định "taste" (1 cổng duyệt cuối)
---

**autoplan** cho feature: **$ARGUMENTS** — chạy chuỗi planning với ít gián đoạn nhất (mượn gstack /autoplan).

Nguyên tắc auto-decide vs escalate:
- **Auto-decide** (tự quyết, ghi rõ đã chọn gì): mọi thứ reversible, có nguyên tắc trong CLAUDE.md / learnings.md, lựa chọn mặc định hợp lý của stack (vd dùng Supabase Realtime, TS strict, RLS siết theo auth.uid).
- **Escalate** (hỏi user): quyết định một chiều / khó đảo ngược, ảnh hưởng UX cốt lõi, đánh đổi product thật (vd auth method, ai thấy dữ liệu ai, schema chính).

Quy trình:
1. **office-hours (rút gọn)**: tự trả các câu có default rõ; GOM các câu "taste" lại.
2. **plan**: dựng architecture + data flow + edge case + **test plan** (xem /plan) + thay đổi DB.
3. **CỔNG DUYỆT DUY NHẤT**: trình user — (a) các quyết định đã auto chọn (để biết), (b) CHỈ các câu taste cần chốt (1 lần AskUserQuestion gộp). 
4. Sau khi user chốt → ghi STATE đầy đủ (scope + plan + test plan), sẵn sàng `/build`.

Mục tiêu: user chỉ phải trả lời 1 lần các quyết định thật sự cần họ, thay vì qua từng bước.
