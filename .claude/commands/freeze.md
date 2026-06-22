---
description: Giới hạn mọi Edit/Write trong (các) thư mục chỉ định — tránh sửa nhầm vùng khác
---

Bật **freeze**: chỉ cho phép sửa file trong vùng `$ARGUMENTS` (mặc định: thư mục feature đang làm).

Làm:
1. Ghi mỗi đường dẫn (tương đối repo root) vào `.claude/.freeze`, 1 dòng/path. Nếu `$ARGUMENTS` rỗng, hỏi user vùng cần khoá hoặc suy từ feature hiện tại trong STATE.
2. Xác nhận với user: "Đã đóng băng — chỉ sửa được trong: <list>. Gỡ bằng /unfreeze."

Hook `.claude/hooks/freeze.sh` (PreToolUse Write|Edit) sẽ chặn mọi sửa ngoài vùng. Hook đã wire trong settings.json — nếu vừa tạo trong session này, cần restart/`/hooks` để nạp.

Dùng khi: debug/điều tra một module, hoặc làm trên DB shared, muốn chắc không đụng phần khác.
