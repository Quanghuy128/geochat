---
description: Dashboard chất lượng code GeoChat — chấm điểm + chỉ ra hotspot, nợ kỹ thuật
---

**health** — chụp nhanh sức khoẻ codebase GeoChat.

Thu thập (chạy lệnh thật, không đoán):
1. **Build/typecheck**: `npm run build` pass?
2. **Lint**: `npm run lint` — đếm error/warning, phân loại theo file (chỉ ra nợ pre-existing như use-messages.ts).
3. **Test coverage**: nếu có test → `npm test`; chưa có thì ghi "chưa có test" là nợ.
4. **Cấu trúc**: đếm component/hook/lib; file nào dài bất thường (hotspot).
5. **DB**: số migration; bảng nào RLS bật/tắt (qua MCP get_advisors nếu có, hoặc đọc migration).
6. **Secret hygiene**: `git ls-files | grep env` — chỉ .env.example được track.
7. **Nợ kỹ thuật**: liệt kê từ learnings.md + STATE các mục còn treo.

Output: bảng điểm 0–10 mỗi hạng mục + top 3 việc nên dọn. Ghi snapshot vào `docs/loops/health-<ngày>.md` nếu user muốn theo dõi xu hướng.
