---
description: Giám sát sau khi ship/deploy — bắt lỗi runtime, regression trước khi user gặp
---

**canary** sau ship/deploy feature: **$ARGUMENTS**

Kiểm chứng app vẫn khoẻ sau thay đổi:
1. `npm run build` — vẫn pass.
2. `npm run dev` (background) → chờ ready → curl `/` 200, các route mới 200/redirect đúng.
3. Soi log dev: KHÔNG có error/unhandled rejection mới.
4. Smoke test chức năng chính qua REST/MCP nếu đụng DB: chat SELECT/INSERT, RLS còn đúng (anon bị chặn), locations còn truy vấn được.
5. Nếu có Chrome/devtools: chụp màn hình, soi console error.
6. TaskStop dev server.

Phát hiện regression → `/investigate` → fix qua pipeline.
Sạch → ghi "canary PASS" vào STATE. Đây là bước REFLECT, đóng vòng sau ship.
