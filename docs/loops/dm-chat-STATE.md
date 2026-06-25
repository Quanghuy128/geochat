# STATE — Feature: 1-on-1 Private DM Chat

> Phase hiện tại: **ANALYZE — Done** (BA). Tiếp theo: `/office-hours` (THINK) để chốt các Open Questions dưới — đặc biệt câu hỏi #1 (global chat) và #8 (dependency on unmigrated friends feature) trước khi `/plan`.

## ANALYZE

### Core user need

GeoChat hiện chỉ có **một phòng chat toàn cục** (`public.messages`, migration `0001_messages.sql`): mọi user (kể cả `anon`, RLS hiện đang mở `to anon, authenticated`) đọc/viết vào đúng 1 bảng tin, không có khái niệm "cuộc trò chuyện" hay "ai chat với ai" — `user_id` còn là `text` tự khai, chưa gắn `auth.uid()`.

Feature **friends/contacts** (`docs/loops/friends-STATE.md`) vừa được build xong (BUILD + QA static pass) để trả lời câu hỏi "ai là bạn của ai" qua bảng `friend_requests` (status `pending|accepted|rejected|cancelled`, "là bạn" = tồn tại 1 row `accepted` giữa 2 user) và hook `useFriends()` trả `Friend[]` (`{ id, username, requestId }`, `id` = id của đối phương). **Friend/contacts CHƯA được merge/migrate lên DB thật** — đây là tiền đề bắt buộc của feature này (xem Open Question #8 + Risk notes).

Nhu cầu người dùng: muốn nói chuyện **riêng tư** với một người bạn cụ thể, không bị lẫn vào dòng chat công khai, đúng kiểu Messenger/Zalo 1-1. Đây là bước tự nhiên tiếp theo sau khi đã có social graph (friends) — không có quan hệ bạn bè thì "DM" không có ý nghĩa kiểm soát quyền truy cập (ai được mở chat với ai).

### User story

> Là một user đã đăng nhập và đã có ít nhất 1 bạn (friend đã accepted), tôi muốn mở một cuộc trò chuyện riêng 1-1 với một người bạn cụ thể, gửi/nhận tin nhắn realtime, và chỉ tôi + người bạn đó nhìn thấy nội dung cuộc trò chuyện này — không lẫn với chat toàn cục, không ai khác (kể cả bạn khác) đọc được.

### Phạm vi (đề xuất — cần user chốt ở office-hours)

**IN (đề xuất):**
- Mở DM với một friend đã `accepted` (từ friends list / friend row UI).
- Gửi/nhận tin nhắn realtime trong đúng cuộc trò chuyện đó (Supabase Realtime, theo đúng pattern `useMessages` hiện tại — Postgres changes, KHÔNG tự dựng WebSocket, khớp CLAUDE.md).
- Lưu lịch sử tin nhắn của cuộc trò chuyện, load lại khi mở lại DM (giống `useMessages` load 100 tin gần nhất hiện tại — pagination nếu cần, xem Open Question #4).
- RLS: chỉ 2 thành viên của cuộc trò chuyện đọc/viết được tin của cuộc trò chuyện đó (không mở `anon`, khác hẳn `messages` hiện tại).
- Validate: chỉ tạo/mở được DM giữa 2 user đang có quan hệ `accepted` trong `friend_requests` tại thời điểm tạo conversation.
- Giữ nguyên giới hạn nội dung tin nhắn hiện có (`char_length(body) between 1 and 2000`) — tái dùng convention từ `0001_messages.sql`, trừ khi Open Question #5 đổi.

**OUT (đề xuất, cần user xác nhận):**
- Group chat (>2 người) — chỉ 1-1, không phải nền cho group sau này (nếu cần mở rộng group, đó là thiết kế lại từ đầu, không phải lý do để over-engineer bây giờ).
- Đính kèm file/ảnh/media — chỉ text, khớp tên feature "private text chat".
- Đã đọc (read receipt) — để Open Question #6, KHÔNG tự quyết định in/out.
- Xóa tin nhắn / thu hồi tin nhắn (unsend).
- Tìm kiếm trong lịch sử tin nhắn (full-text search).
- Thông báo đẩy (push notification) ngoài realtime in-app.
- Block/unblock (đã loại ở friends feature, vẫn out ở đây — không có cơ chế chặn DM riêng ngoài việc unfriend).
- Multiple devices / đồng bộ "đã đọc" qua nhiều tab — không trong scope MVP.

### Functional requirements

1. **Mở DM với một friend**
   - Trigger: từ `FriendRow` trong `FriendsPanel` (hoặc nơi khác — UI placement là việc của `/design`), user chọn "Nhắn tin" với một friend cụ thể.
   - Hệ thống tìm conversation 1-1 đã tồn tại giữa 2 user đó, hoặc tạo mới nếu chưa có (idempotent — không tạo 2 conversation trùng cho cùng 1 cặp).
   - Điều kiện bắt buộc: 2 user phải đang là friend (`accepted`) tại thời điểm mở/tạo — nếu không, không cho mở.

2. **Gửi tin nhắn trong DM**
   - Input: nội dung text, độ dài 1-2000 ký tự (theo convention hiện tại, có thể đổi — Open Question #5).
   - Chỉ 2 thành viên của conversation gửi được; tin được gắn vào đúng conversation đó (không lẫn sang global chat hay DM khác).

3. **Nhận tin nhắn realtime**
   - Người nhận thấy tin mới xuất hiện trong đúng cuộc trò chuyện đang mở, không cần refresh — đúng pattern Postgres changes hiện tại của `useMessages`.
   - Nếu DM panel đang đóng/chưa mở, vẫn cần một cách để biết có tin mới (badge/notification — chi tiết UI là việc designer, nhưng cần có nguồn dữ liệu, xem Open Question #7).

4. **Lịch sử tin nhắn / pagination**
   - Mở lại một DM đã có lịch sử → load lại đúng các tin của conversation đó, theo thời gian.
   - Nếu lịch sử dài, cần cơ chế tải thêm (infinite scroll/"tải tin cũ hơn") — ngưỡng cụ thể là Open Question #4 (architect quyết kỹ thuật, nhưng cần user xác nhận có cần ngay ở MVP hay load N tin gần nhất là đủ).

5. **Danh sách các cuộc trò chuyện đang có (inbox)**
   - User cần thấy danh sách các DM đang có (với ai, tin cuối là gì) để chọn mở lại — tương tự "Friends" panel nhưng cho conversations. Đây là 1 UI/data mới, không có sẵn trong friends feature.

6. **Typing indicator trong DM** (nếu in scope — xem Open Question #2)
   - Feature `typing-indicator` đã build & ship xong (`docs/loops/typing-indicator-STATE.md`) cho **global chat**, dùng Supabase **broadcast** trên 1 channel chung `"geochat-typing"` — KHÔNG phân biệt theo conversation. Để dùng lại cho DM, cần channel/scope riêng theo từng conversation (ví dụ `typing-dm-{conversationId}`) — đây là việc thiết kế lại nhẹ của architect, KHÔNG phải tái dùng nguyên trạng 100%, vì payload/channel hiện tại không có khái niệm "phòng".

7. **Quan hệ với global chat**
   - Bảng `messages` hiện tại tiếp tục tồn tại hay được thay thế bởi conversation-based schema có `conversation_id` (và global chat trở thành 1 "conversation" đặc biệt)? Đây là quyết định kiến trúc + sản phẩm quan trọng nhất của feature này — KHÔNG tự quyết, xem Open Question #1.

### Edge cases bắt buộc xử lý

| # | Case | Hành vi mong đợi |
|---|------|-------------------|
| 1 | Mở DM với một user KHÔNG phải friend (`accepted`) | Từ chối — không tạo/mở conversation. Lỗi rõ ("chỉ chat riêng được với bạn bè"). |
| 2 | Mở DM với chính mình | Từ chối — không tạo conversation tự-chat (trừ khi user quyết định ngược lại — không có use case rõ ràng cho self-DM ở MVP). |
| 3 | Đã unfriend (status chuyển từ `accepted` → `cancelled`), conversation cũ vẫn còn | Không cho gửi tin MỚI (chặn ở RLS/app theo trạng thái friend hiện tại — không phải tại thời điểm tạo). Lịch sử tin nhắn CŨ: hiển thị tiếp hay ẩn — **Open Question #3**, KHÔNG tự quyết. |
| 4 | Gửi tin nhắn rỗng / chỉ whitespace | Từ chối client-side trước khi gọi DB (giống `useMessages.send` hiện tại đã `trim()` và bỏ qua nếu rỗng) + DB CHECK constraint là lưới an toàn. |
| 5 | Tin nhắn rất dài (vượt giới hạn ký tự) | Từ chối — validate trước khi insert + DB CHECK constraint chặn. Giới hạn cụ thể: Open Question #5. |
| 6 | User C (không phải 1 trong 2 thành viên) cố đọc/gửi vào conversation của A-B | RLS chặn — 403/0-row tương tự pattern đã làm ở `friend_requests` (Postgrest trả `data: []` cho UPDATE/INSERT vi phạm `with check`, hoặc 0 row cho SELECT). |
| 7 | A và B gửi yêu cầu mở DM gần như đồng thời (cả 2 cùng bấm "nhắn tin" lần đầu) | Không được tạo 2 conversation trùng cho cùng cặp — cần ràng buộc unique theo cặp (giống cách `friend_requests` dùng `least/greatest` unique partial index) — chi tiết kỹ thuật để architect quyết. |
| 8 | Conversation đã tồn tại, user mở lại từ friend khác nhau trong list (race điều hướng UI) | Phải route về ĐÚNG 1 conversation hiện có, không tạo bản sao. |
| 9 | Tin nhắn đến khi DM panel đang đóng | Không bị mất — phải load được khi mở lại (persisted DB, không chỉ realtime broadcast). Badge/notification: xem Open Question #7. |
| 10 | Lịch sử dài (hàng trăm/nghìn tin) | Load trang đầu hợp lý (ví dụ N tin gần nhất, giống `useMessages` hiện tại lấy 100), không load toàn bộ một lần — pagination nếu cần, xem Open Question #4. |
| 11 | Network drop giữa lúc gửi | Không tạo state rác — theo pattern hiện tại của `useMessages.send` (không optimistic-insert, lỗi hiển thị rõ, user thử gửi lại). |
| 12 | Friend request bị huỷ (chưa từng `accepted`) — chưa từng là bạn | Không có conversation nào để mở — UI không hiện nút "nhắn tin" cho non-friend (chặn ở nguồn, không chỉ chặn ở backend). |
| 13 | Migration friends (`0005_friend_requests.sql`) CHƯA chạy trên DB thật khi feature DM được build | DM feature build trên giả định bảng `friend_requests` tồn tại — nếu chưa migrate, MỌI thứ phụ thuộc friends (kiểm tra "đã là bạn chưa") sẽ lỗi runtime. Đây là edge case vận hành, không phải edge case sản phẩm — ghi rõ ở Risk notes + Open Question #8. |

### Acceptance criteria (đo được)

1. User A (đã là bạn với B, `accepted`) mở DM với B lần đầu → tạo đúng 1 conversation giữa A-B; mở lại lần 2 (từ A hoặc từ B) → route về ĐÚNG conversation đó, không tạo bản sao.
2. User A gửi tin nhắn trong DM với B → B thấy tin nhắn xuất hiện trong đúng conversation đó **trong vòng 2 giây** mà không cần reload (đo được qua test 2-tab thật, giống pattern QA của `friends`/`typing-indicator`).
3. User C (không phải A hoặc B) không đọc được nội dung tin nhắn của conversation A-B qua bất kỳ kênh nào (REST trực tiếp, Realtime payload) — verify bằng test RLS qua REST giống cách `friends-STATE.md` đã làm.
4. User A cố mở DM với User D — KHÔNG phải friend (`accepted`) — bị chặn, không tạo conversation, lỗi rõ ràng hiển thị cho A.
5. Gửi tin nhắn rỗng/chỉ whitespace bị chặn ở UI (không gọi DB) VÀ ở DB (CHECK constraint) nếu app có bug.
6. Gửi tin nhắn vượt giới hạn ký tự bị chặn tương tự (UI + DB).
7. Sau khi A unfriend B, A không gửi được tin nhắn MỚI tới B trong conversation cũ (RLS chặn dựa theo trạng thái friend hiện tại, không chỉ tại thời điểm tạo conversation).
8. `npm run build` + `npm run lint` + `npm run test` pass, không phát sinh lỗi mới từ feature này.
9. RLS: user `anon` (chưa đăng nhập) không đọc/viết được bất kỳ conversation hay tin nhắn DM nào (khác hẳn `messages` hiện tại đang mở cho `anon`).
10. Danh sách conversations (inbox) của A chỉ chứa các DM mà A là 1 trong 2 thành viên — không lẫn DM của người khác.

### Product risk notes (cho architect/dev — không phải spec)

- **Phụ thuộc vào feature CHƯA migrate lên DB thật**: `friend_requests` (migration `0005`) mới chỉ ở trạng thái BUILD+QA-static-pass, **chưa chạy trên Supabase Studio** (xác nhận từ `friends-STATE.md` mục QA: "PARTIAL PASS — live DB verification BLOCKED"). Nếu DM feature được `/plan`/`/build` trước khi migration 0005 được áp dụng, mọi logic "kiểm tra đã là bạn chưa" sẽ không thể test thật cho tới khi user chạy migration đó trước. Khuyến nghị: xác nhận với user thứ tự — migration 0005 nên được áp dụng (hoặc ít nhất được duyệt chạy) TRƯỚC khi `/build` DM feature, để tránh build chồng lên một bảng ảo.
- **RLS phức tạp hơn mọi feature trước đó**: bảng tin nhắn cũ (`messages`) đang mở hoàn toàn cho `anon` — nếu giữ nguyên bảng đó cho global chat và thêm bảng mới cho DM, RLS của 2 bảng phải khác biệt rõ rệt (mở vs đóng). Rủi ro: nhầm convention giữa 2 bảng nếu dev copy-paste từ `0001_messages.sql` mà quên siết RLS cho bảng DM.
- **Quan hệ "đã là bạn" có thể thay đổi sau khi conversation đã tồn tại** (unfriend): cần quyết định rõ RLS có re-check trạng thái friend mỗi lần gửi tin (không chỉ tại thời điểm tạo) — nếu không, unfriend sẽ không thực sự chặn được DM mới, làm vô hiệu mục đích chính của friends feature (kiểm soát ai chat được với ai).
- **Realtime channel/scope theo conversation**: pattern `useMessages` hiện tại dùng 1 channel cố định `"messages-realtime"` cho TOÀN BỘ bảng `messages` — với DM, cần channel/filter theo từng `conversation_id` (nhiều conversation đang mở cùng lúc ở inbox, hoặc filter Postgres changes theo `conversation_id` để tránh nhận tất cả tin của mọi DM). Đây là thay đổi kỹ thuật so với pattern hiện tại — risk nếu architect không thiết kế đúng filter, client có thể leak nhận event của conversation không liên quan (giảm bớt nhờ RLS, nhưng cần xác nhận lại assumption "Realtime áp RLS cho postgres_changes" — đúng risk đã được flag ở `friends-STATE.md` mục PLAN 6.3, CHƯA được verify thật bằng 2 tài khoản. DM feature kế thừa risk này nguyên vẹn, có thể còn nặng hơn vì nội dung tin nhắn riêng tư nhạy cảm hơn metadata friend request).
- **Reuse typing-indicator cần thiết kế lại channel scope**: implementation hiện tại (`use-typing.ts`) dùng 1 channel toàn cục cho global chat — tái dùng cho DM cần tham số hóa theo `conversationId`, không phải "cắm thẳng" được.
- **Migration cũ `0001_messages.sql` có comment để ngỏ**: "tạm dùng text (chưa có auth); sau đổi sang uuid references auth.users" — feature DM là cơ hội tự nhiên để dọn nợ kỹ thuật này nếu Open Question #1 quyết định gộp/thay thế global chat, nhưng KHÔNG nên tự ý sửa bảng `messages` hiện tại nếu user quyết định giữ nguyên global chat song song.

### Open questions — CHỈ con người quyết, KHÔNG tự đoán

1. **Global chat room đi đâu?** Giữ nguyên `messages` (global, mở cho `anon`) chạy SONG SONG với DM mới (2 bảng/2 hệ thống riêng), hay thay thế bằng schema "conversations" tổng quát (global chat trở thành 1 conversation đặc biệt, mọi tin nhắn — global và DM — đi qua cùng 1 bảng có `conversation_id`)? Đây là quyết định kiến trúc + sản phẩm lớn nhất, ảnh hưởng toàn bộ `/plan` sau này.
2. **Typing indicator trong DM**: có cần ngay ở MVP của feature này (tái dùng + scope lại theo conversation), hay deferred sang sau? `typing-indicator` hiện tại CHỈ hoạt động cho global chat.
3. **Lịch sử tin nhắn sau unfriend**: khi A unfriend B, lịch sử DM CŨ giữa 2 người bị ẩn/xoá, hay vẫn xem được (chỉ chặn gửi tin MỚI)? Ảnh hưởng trực tiếp đến thiết kế RLS SELECT.
4. **Pagination/infinite scroll**: cần ở MVP (lịch sử dài) hay load N tin gần nhất (ví dụ 100, giống global chat hiện tại) là đủ cho bản đầu?
5. **Giới hạn độ dài tin nhắn**: giữ nguyên 2000 ký tự (convention `messages` hiện tại) hay khác cho DM?
6. **Read receipts ("đã xem")**: có trong scope MVP hay deferred? Ảnh hưởng lớn đến schema (cần cột/bảng riêng theo dõi last-read).
7. **Thông báo có tin mới khi DM đóng**: cần badge/đếm số tin chưa đọc (ngoài realtime khi đang mở), hay MVP chỉ cần "mở DM lên thì thấy tin mới" là đủ?
8. **Thứ tự triển khai với friends migration**: có nên CHỜ migration `0005_friend_requests.sql` được áp dụng lên Supabase Studio thật rồi mới `/plan`/`/build` DM feature, hay build song song và chỉ chặn ở bước QA (giống cách friends feature đã làm — build trước, QA chờ migration)? Ảnh hưởng trực tiếp đến việc DM's migration (sẽ tham chiếu `friend_requests` qua foreign key hoặc check logic) có thể test thật ngay hay phải đợi.
9. **UI/UX placement**: DM là 1 trang/route riêng (`/dm/[conversationId]`), hay panel/overlay giống `FriendsPanel`, hay thay thế hẳn `ChatPanel` hiện tại theo tab "Global / Direct Messages"? Việc này thuộc `/design`, nhưng ảnh hưởng cách viết acceptance criteria UI — nêu sớm để designer biết.
10. **Giới hạn số conversation/tin nhắn**: có cần rate-limit gửi tin (spam 1 người bạn) hay không giới hạn cho MVP (giống quyết định "không giới hạn bạn bè" của friends feature)?

## THINK (office-hours, auto-decided — autopilot full-run, không pause)

| # | Câu hỏi | Quyết định | Lý do |
|---|---------|-----------|-------|
| 1 | Global chat đi đâu? | **Thay thế bằng schema "conversations" tổng quát.** Tạo bảng `conversations` (kind: `direct`/`global`) + `dm_messages` (hoặc đổi `messages` thêm `conversation_id`). Global chat hiện tại trở thành 1 row `conversations` đặc biệt (kind=`global`, mọi authenticated user là thành viên ngầm định). | Tránh 2 hệ thống RLS/Realtime song song mãi về sau (group chat ở Run 3 sẽ cần đúng khái niệm "conversation" này) — làm đúng từ đầu rẻ hơn làm lại. Architect tự quyết chi tiết kỹ thuật migrate `messages` cũ (giữ bảng cũ làm "global conversation" data, hoặc migrate dữ liệu — ưu tiên ÍT rủi ro nhất, có thể giữ bảng `messages` riêng cho global và chỉ tạo bảng mới cho DM nếu gộp chung phức tạp/rủi ro hơn lợi ích — architect free để chọn phương án ít rủi ro hơn miễn đạt được mục tiêu sản phẩm "global vẫn chạy, DM mới tách biệt rõ"). |
| 2 | Typing indicator trong DM | **Deferred** — KHÔNG làm ở MVP này | Cần thiết kế lại channel scope theo conversationId, không phải nhu cầu lõi của "gửi/nhận tin riêng tư" — tránh mở rộng phạm vi |
| 3 | Lịch sử sau unfriend | **Vẫn xem được lịch sử CŨ** — chỉ chặn gửi tin MỚI | Giữ dữ liệu là hành vi an toàn hơn (không mất dữ liệu người dùng), nhất quán với Zalo/Messenger thực tế (unfriend không xóa lịch sử chat) |
| 4 | Pagination | **Không cần ở MVP** — load N tin gần nhất (100, giống global chat hiện tại) là đủ | Nhất quán với `useMessages` hiện tại, tránh over-engineering trước khi có dữ liệu thật cho thấy cần |
| 5 | Giới hạn độ dài tin nhắn | **Giữ nguyên 2000 ký tự** | Nhất quán convention hiện tại, không có lý do sản phẩm để đổi |
| 6 | Read receipts | **Deferred** — KHÔNG làm ở MVP này | Cần schema riêng (last-read tracking), không phải lõi của "chat riêng tư hoạt động được" |
| 7 | Badge tin chưa đọc khi DM đóng | **MVP tối giản: chỉ cần mở DM lên thấy tin mới** (không cần unread count/badge số) | Tránh phụ thuộc vào read-receipt schema (Q6 deferred) — badge đếm số cần biết "đã đọc tới đâu", ra cùng quyết định với Q6 |
| 8 | Thứ tự với friends migration | **Build song song, chặn ở QA** — giống cách friends feature đã làm | Nhất quán pattern đã thiết lập; migration 0005 + migration DM mới có thể gộp thành 1 lần chạy Studio cho user (đỡ phải chạy nhiều lần) — ghi rõ cho user ở PR |
| 9 | UI/UX placement | **Tab trong layout hiện tại: "Global" / "Direct Messages"**, KHÔNG tạo route `/dm/[id]` riêng | Nhất quán quyết định THINK #6 của friends feature (panel trong layout, không tách trang riêng) |
| 10 | Rate-limit | **Không giới hạn** cho MVP | Nhất quán quyết định "không giới hạn" của friends feature (THINK #2, #3) |

**Quyết định kỹ thuật kèm theo** (áp dụng cho architect):
- RLS cho conversation/message DM phải re-check trạng thái `friend_requests.status='accepted'` tại THỜI ĐIỂM GỬI (không chỉ lúc tạo conversation) — bắt buộc, đây là mục đích chính của cả 2 feature nối tiếp nhau (friends → DM kiểm soát quyền chat).
- Bảng `messages` cũ (global) — KHÔNG sửa cấu trúc nếu giữ song song; nếu architect chọn gộp vào 1 bảng `conversation_id`, cần migration data-safe (không mất tin nhắn cũ), rollback đầy đủ.
- Realtime: kế thừa risk "Realtime áp RLS cho postgres_changes" CHƯA verify thật từ friends feature — risk này áp dụng nguyên vẹn, ghi rõ lại trong PLAN, BẮT BUỘC nằm trong QA gate trước khi merge thật (không chỉ note suông).

## Phase

| Bước | Trạng thái |
|------|-----------|
| ANALYZE (BA) | ✅ Done — 2026-06-24 |
| THINK (office-hours) | ✅ Done — 2026-06-24 (auto-decided, full autopilot run, không pause) |
| DESIGN (designer) | ✅ Done — 2026-06-24 (`docs/loops/dm-chat-design.md`) |
| plan (architect) | ✅ Done — 2026-06-24 (xem mục PLAN dưới + `docs/loops/dm-chat-testplan.md`) |
| build (Maker) | ✅ Done — 2026-06-24 (xem mục BUILD dưới) |
| review (Checker) | ✅ Done — 2026-06-24 (2 bugs found, both fixed — see Post-review fixes round 1) |
| qa | 🟡 PARTIAL — 2026-06-24 (static checks pass; live DB verification BLOCKED, see QA section) |
| ship | ⬜ |

**Next action**: `/build` (feature-builder) — implement theo PLAN dưới (schema `0006_dm_chat.sql` đã viết sẵn, hooks `useDmConversations`/`useDmMessages`, components `ChatTabs`/`DmPanel`, sửa `page.tsx`/`friends-panel.tsx`). Sau đó `/review` rồi `/qa` (test plan: `docs/loops/dm-chat-testplan.md`).

## PLAN

> Phase: **architect**. Input: ANALYZE + THINK (locked, không re-litigate) + `dm-chat-design.md`.
> Output: kiến trúc + migration + data flow + edge cases + test plan (file riêng `dm-chat-testplan.md`).
> Migration file: `supabase/migrations/0006_dm_chat.sql`.

### 0. Schema decision (justification)

**Quyết định: KHÔNG gộp `messages` vào schema chung. Tạo schema mới hoàn toàn tách biệt: `conversations` + `dm_messages`. Bảng `messages` (global chat, migration 0001) giữ nguyên 100% — không ALTER, không migrate dữ liệu.**

Lý do (risk-based, theo đúng tinh thần THINK #1 cho architect tự quyết "ít rủi ro nhất"):
1. `messages.user_id` hiện là `text` tự khai (chưa migrate sang `uuid references auth.users`) và RLS đang **mở cho `anon`** — đây là 1 hệ thống đang chạy thật với dữ liệu thật trên production. Gộp vào 1 bảng `conversation_id`-based đồng nghĩa phải ALTER bảng đang sống, viết migration data-safe phức tạp hơn, và rủi ro hơn nhiều so với lợi ích kiến trúc "đẹp" của 1 schema thống nhất.
2. RLS của 2 hệ thống đối lập hoàn toàn: `messages` mở (anon đọc/viết), DM phải đóng tuyệt đối (chỉ 2 thành viên). Trộn vào 1 bảng buộc phải dùng `CASE`/điều kiện phức tạp trong cùng 1 policy cho 2 "kind" khác nhau — đúng risk BA đã cảnh báo ("dev copy-paste từ 0001 mà quên siết RLS cho bảng DM"). Tách bảng = tách RLS = không thể nhầm convention.
3. Tách bảng vẫn đạt đúng mục tiêu sản phẩm của THINK #1 ("global vẫn chạy, DM mới tách biệt rõ") — câu chữ "global chat trở thành 1 conversation đặc biệt" được hiểu ở mức **khái niệm sản phẩm** (người dùng thấy tab Global/DM, không phân biệt được bảng nào ở dưới), không bắt buộc *vật lý* phải là 1 bảng SQL. Cột `kind` trong `conversations` (hiện chỉ cho phép `'direct'`) để dành slot kiến trúc nếu tương lai muốn thật sự hợp nhất — không cần làm ngay, không over-engineer.
4. Trade-off chấp nhận: 2 hook (`useMessages` vs `useDmMessages`) và 2 đường UI vẫn tồn tại song song — giảm nhẹ bằng cách trích xuất phần JSX bubble/composer dùng chung (`MessageList`/`MessageComposer`) theo đề xuất của design doc, KHÔNG trùng lặp logic Realtime/RLS (2 hook khác nhau vẫn là đúng, vì RLS/Realtime channel khác nhau).

### 1. Architecture — server vs client components

Toàn bộ feature là **client components** (`"use client"`), khớp 100% pattern hiện tại (`ChatPanel`, `FriendsPanel` đều client — cần realtime subscription + browser state). Không có Server Component mới nào cần thiết vì không có data fetch SSR-only — toàn bộ data qua Supabase client + Realtime, giống `useMessages`/`useFriends`.

**Files to create:**
| File | Vai trò |
|---|---|
| `supabase/migrations/0006_dm_chat.sql` | Schema + RLS + Realtime (đã viết, xem trên) |
| `src/lib/types.ts` (sửa, không tạo mới) | Thêm `DmConversation`, `DmMessage` types |
| `src/lib/use-dm-conversations.ts` | Hook inbox: load + realtime + find-or-create |
| `src/lib/use-dm-messages.ts` | Hook 1 thread: load + realtime + send + canSend/sendBlockedReason |
| `src/components/chat-tabs.tsx` | `ChatTabs` — tab switcher Global/Tin nhắn, thay thế mount `<ChatPanel>` trực tiếp trong `page.tsx` |
| `src/components/dm-panel.tsx` | `DmPanel` (chứa `DmInbox` + `DmThread` + `DmConversationRow`) — gộp trong 1 file theo đúng convention `friends-panel.tsx` (1 file/feature-panel, nhiều component nội bộ) |
| `src/components/ui/states.tsx` | Trích xuất `EmptyState`/`ErrorState`/`SkeletonRows` từ `friends-panel.tsx` ra file chung (theo đề xuất design doc mục 4) — dùng lại cho cả Friends và DM |

**Files to modify:**
| File | Thay đổi |
|---|---|
| `src/app/page.tsx` | Thay `<ChatPanel fallback={...} />` bằng `<ChatTabs fallback={...} onMessageFriend=.../>`; thêm state `pendingOpenFriendId: string | null`; wire `onMessageFriend` từ `FriendsPanel` |
| `src/components/friends-panel.tsx` | Thêm prop `onMessageFriend: (friendId: string) => void`, thread xuống `FriendsTab` → `FriendRow`; thêm nút `[Nhắn tin]`; sau khi sửa, import `EmptyState`/`ErrorState`/`SkeletonRows` từ `src/components/ui/states.tsx` (xóa định nghĩa inline cũ) |
| `src/components/chat-panel.tsx` | KHÔNG sửa logic — tùy chọn: trích xuất message-list + input JSX thành `MessageList`/`MessageComposer` để `DmThread` dùng lại (đề xuất, không bắt buộc — xem Trade-off #5 dưới) |

### 2. Data model (types, src/lib/types.ts bổ sung)

```ts
/** 1 cuộc trò chuyện 1-1 (hook đã join username đối phương + last message). */
export type DmConversation = {
  id: string;
  peerId: string;
  peerUsername: string;
  lastMessageBody: string | null;
  lastMessageAt: string; // ISO — fallback = conversation.created_at nếu chưa có tin nào
  lastMessageMine: boolean;
};

/** 1 tin nhắn DM. */
export type DmMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string; // ISO
};
```

### 3. Hooks

#### `useDmConversations(identity: { userId: string } | null)`

Trả về: `{ conversations: DmConversation[], ready, loading, error, refetch, findOrCreate(peerId): Promise<{ conversationId: string | null; error: string | null }> }`

- **Load**: `select * from conversations where user_a_id=me or user_b_id=me` (Supabase `.or()` giống `useFriends`), rồi với mỗi conversation: lấy peer username (join `profiles` qua id còn lại) + lấy tin nhắn cuối (1 query `dm_messages` order by created_at desc limit 1 per conversation — thực hiện bằng N+1 query nhỏ giống `useFriends`/`useFriendRequests` đã làm, vì danh sách DM thường nhỏ, KHÔNG cần optimize JOIN phức tạp ở MVP).
- **findOrCreate(peerId)**: 
  1. Query `select id from conversations where (user_a_id=me and user_b_id=peerId) or (user_a_id=peerId and user_b_id=me) limit 1`.
  2. Nếu có → trả về `id` đó ngay (route về đúng conversation, edge case #8).
  3. Nếu không có → `insert into conversations (user_a_id, user_b_id)` (thứ tự cột không quan trọng — unique index dùng `least/greatest` nên không tạo trùng dù app gọi theo thứ tự nào).
  4. **Race 2 user bấm đồng thời (edge case #7)**: cả 2 INSERT cùng lúc → unique index `conversations_pair_unique` chặn 1 trong 2 ở DB level → INSERT thứ 2 trả lỗi `23505` (unique violation) → catch lỗi này cụ thể, **fallback tự động SELECT lại** (bước 1) để lấy `id` do request đầu tạo ra, trả về thành công (không hiển thị lỗi cho user — đây là race vô hại, kết quả cuối đúng).
  5. Nếu RLS chặn INSERT (không phải bạn `accepted`) → Postgres trả `data: null` + 0 rows / lỗi RLS → map thành lỗi rõ: `"Chỉ chat riêng được với bạn bè đã kết bạn."`
- **Realtime**: subscribe channel `dm-conversations-${userId}` trên bảng `conversations`, event INSERT — khi nhận row có `user_a_id`/`user_b_id` = mình → refetch (đủ rẻ, danh sách nhỏ). Subscribe thêm `dm_messages` INSERT (không filter theo conversation_id ở tầng Realtime — xem mục 5 Realtime scoping) để cập nhật `lastMessageBody`/`lastMessageAt`/re-sort inbox khi có tin mới ở BẤT KỲ conversation nào của mình (lọc ở client bằng kiểm tra `conversation_id` có nằm trong tập conversations hiện có không).
- Cleanup: `removeChannel` cả 2 subscription trong return của `useEffect`, giống pattern `useFriends`.

#### `useDmMessages(conversationId: string | null, identity: { userId: string } | null, peerFriendStatusHint?: ...)`

Trả về: `{ messages: DmMessage[], ready, loading, error, canSend: boolean, sendBlockedReason: "unfriended" | null, send(body): Promise<{ error: string | null }> }`

- **Load**: `select * from dm_messages where conversation_id=X order by created_at asc limit 100` — pattern giống `useMessages` (không pagination, THINK #4).
- **canSend / sendBlockedReason**: query 1 lần khi mở thread: `select status from friend_requests where (...) and (requester_id, recipient_id) = (me, peer) or (peer, me)`. Nếu không có row `accepted` → `canSend=false`, `sendBlockedReason="unfriended"`. Đây là **client-side hint hiển thị UI sớm** (3.11 banner) — KHÔNG phải lưới an toàn bảo mật (RLS ở DB mới là lưới an toàn thật, xem mục 4 dưới).
- **send(body)**: trim, nếu rỗng → no-op (giống `useMessages.send`). Insert vào `dm_messages`. Nếu RLS chặn (unfriended tại thời điểm gửi, kể cả khi client hint stale) → Postgrest trả lỗi (RLS violation hoặc 0 rows) → hook set `sendBlockedReason="unfriended"` ngay (transition reactive theo đúng Interaction Notes của design doc mục 5) + trả `{ error: "..." }` để UI hiện thông báo, KHÔNG xóa draft (edge case #11 — input không optimistic-clear nếu lỗi, theo design doc mục 5 "Sending a message").
- **Realtime**: subscribe channel `dm-thread-${conversationId}` (tham số hóa theo conversationId — mỗi thread mở 1 channel riêng, đóng khi đổi conversation/unmount). Event INSERT trên `dm_messages` — KHÔNG thể filter server-side theo `conversation_id` qua Postgres changes filter cú pháp đơn giản nếu muốn kèm điều kiện RLS phức tạp, nhưng **CÓ THỂ** dùng filter cơ bản `conversation_id=eq.${conversationId}` (Supabase Realtime hỗ trợ filter 1 cột đơn giản dạng `column=eq.value` — khác với trường hợp `friend_requests` cần OR giữa 2 cột không filter được). Dùng filter này để giảm tải nhận event của conversation khác (xem mục 5 Realtime scoping — đây chính là chỗ tối ưu hiệu năng so với friends feature).
- Cleanup: `removeChannel` trong return effect, re-subscribe khi `conversationId` đổi (dependency array gồm `conversationId`).

### 4. RLS (đã implement trong 0006_dm_chat.sql — tóm tắt lại lý do)

- `conversations` SELECT: chỉ thành viên — không public.
- `conversations` INSERT: chỉ thành viên + **bắt buộc friend `accepted` tại thời điểm tạo** (`exists` subquery vào `friend_requests`).
- `dm_messages` SELECT: chỉ thành viên của conversation (không re-check friend status — THINK #3: lịch sử cũ luôn xem được).
- `dm_messages` INSERT: thành viên + sender_id=auth.uid() + **re-check friend `accepted` TẠI THỜI ĐIỂM GỬI** qua `exists` subquery — đây là điểm enforce chính của edge case #3/#7 trong acceptance criteria. Vì policy này query lại `friend_requests` mỗi lần INSERT (không cache), unfriend (`accepted`→`cancelled`) có hiệu lực NGAY LẬP TỨC cho lần gửi tiếp theo — không có khoảng trễ nào ở DB level.
- Không có UPDATE/DELETE policy nào trên cả 2 bảng → Postgres mặc định chặn (an toàn-by-default, giống pattern `friend_requests` không có DELETE).

### 5. Data flow

**Mở DM (find-or-create) → send → Realtime → UI:**

```
User tap [Nhắn tin] trên FriendRow (FriendsPanel)
  → page.tsx: setActiveChatTab("dm"); setPendingOpenFriendId(friend.id); setFriendsOpen(false)
  → ChatTabs render DmPanel với pendingOpenConversationFriendId=friend.id
  → DmPanel effect: gọi useDmConversations().findOrCreate(friend.id)
       → SELECT existing? → có → dùng id đó
                            → không → INSERT (race-safe nhờ unique index, fallback SELECT khi 23505)
       → set activeConversationId, view="thread"
       → gọi onConsumedPendingOpen() để clear pending (tránh re-trigger loop nếu component re-render)
  → DmThread mount với conversationId mới
       → useDmMessages(conversationId): load 100 tin gần nhất + subscribe channel `dm-thread-{id}`
       → useDmMessages: query friend status 1 lần → canSend/sendBlockedReason

User gõ tin, tap [Gửi]
  → DmThread.handleSend(): draft.trim() → useDmMessages.send(body)
  → supabase.from("dm_messages").insert({conversation_id, sender_id: me, body})
  → RLS INSERT policy check (mục 4) — nếu pass: row được tạo, KHÔNG optimistic local append
       (giống ChatPanel/useMessages — đợi Realtime echo về)
  → nếu RLS reject: insert trả lỗi → send() trả {error} → DmThread restore draft + hiện lỗi inline
       + set sendBlockedReason="unfriended" (suy luận từ lỗi RLS, theo Interaction Notes mục 5)

Realtime (cả người gửi VÀ người nhận đều nhận qua channel `dm-thread-{conversationId}`):
  → postgres_changes INSERT, filter conversation_id=eq.{conversationId}
  → handler: rowToDmMessage(payload.new) → dedup theo id → append vào messages[]
  → UI: bottomRef.scrollIntoView (giống ChatPanel)

Đồng thời, nếu DM Inbox đang mounted (kể cả không phải thread đang mở):
  → useDmConversations subscribe riêng dm_messages INSERT (không filter theo 1 conversation
     cụ thể — cần biết MỌI conversation của mình) → nếu conversation_id thuộc danh sách
     conversations hiện có của mình → cập nhật lastMessageBody/lastMessageAt + re-sort lên đầu.
     Nếu KHÔNG thuộc danh sách hiện có (vd conversation vừa được tạo bởi PEER, mình chưa
     từng load) → trigger refetch() toàn bộ list 1 lần (đủ rẻ, danh sách nhỏ).

Tap [‹ Tin nhắn] (back) trong DmThread
  → DmPanel: setView("inbox") → DmThread unmount → cleanup: removeChannel(`dm-thread-{id}`)
  → DmInbox vẫn dùng channel riêng của useDmConversations (không bị ảnh hưởng)

Tap tab "Chung" (rời DM, về Global)
  → ChatTabs setActiveTab("global") → nếu DmPanel unmount theo lựa chọn implementation
     (xem Open Design Q3 trong design doc) → cleanup toàn bộ channel DM (cả inbox + thread)
     → khi quay lại "Tin nhắn", re-mount → useDmConversations load lại từ đầu (chấp nhận
       theo Open Design Q3, KHÔNG giữ state qua unmount — đơn giản hơn, tránh leak channel
       nếu giữ mounted-but-hidden quá lâu)
```

**Quyết định kỹ thuật cho Open Design Q3 (design doc)**: `DmPanel` **UNMOUNT khi rời tab "Tin nhắn"** (không giữ mounted-but-hidden). Lý do: đơn giản hóa cleanup channel (mỗi lần mount = subscribe mới, mỗi lần unmount = cleanup chắc chắn, không có channel "treo" khi ẩn lâu); chi phí load lại inbox là rẻ (1-2 query nhỏ). Trade-off: mất vị trí scroll/thread đang mở khi tab-switch qua lại trong cùng session — chấp nhận được, không phải acceptance criteria.

**Global tab (`ChatPanel`/`useMessages`) — không đổi gì**: `ChatTabs` mount `ChatPanel` nguyên trạng dưới tab "Chung" — `useMessages` tiếp tục hoạt động 100% như cũ, không chạm vào bảng `messages`, không đổi channel `"messages-realtime"`. Khi tab chuyển sang "Tin nhắn", `ChatPanel` có thể unmount cùng lý do với DM (đơn giản, tránh giữ 2 set hook cùng active) — nếu giữ mounted để giữ scroll position của global chat là tối ưu UX nhưng KHÔNG bắt buộc (không phải acceptance criteria, design doc cũng note "not guaranteed in MVP").

### 5b. Realtime channel/filter strategy (trả lời câu hỏi performance trong yêu cầu)

| Channel | Subscribe bởi | Filter | Lý do |
|---|---|---|---|
| `messages-realtime` | `useMessages` (Global) | không filter (toàn bảng `messages`) | Không đổi — bảng global, mọi user thấy mọi tin |
| `dm-conversations-{userId}` | `useDmConversations` (Inbox) | không filter cột (Postgres Realtime filter string không hỗ trợ OR 2 cột `user_a_id`/`user_b_id` — giống hạn chế đã gặp ở `friend_requests`) | Nhận TẤT CẢ event INSERT của `conversations` + `dm_messages` toàn hệ thống ở tầng transport, nhưng **RLS-enforced postgres_changes** đảm bảo Supabase chỉ thực sự phát event mà policy SELECT của role đó cho phép — tức về lý thuyết client CHỈ nhận event của conversation mình là thành viên. Đây là risk đã được flag từ friends feature, CHƯA verify thật — **bắt buộc nằm trong QA gate** (xem TEST PLAN). |
| `dm-thread-{conversationId}` | `useDmMessages` (Thread đang mở) | **CÓ filter**: `{ event: "INSERT", schema: "public", table: "dm_messages", filter: "conversation_id=eq.{conversationId}" }` | Khác với `friend_requests` (không filter được vì cần OR 2 cột), ở đây filter là 1 cột đơn (`conversation_id`) — Postgres Realtime HỖ TRỢ filter dạng `column=eq.value` tại tầng publication, nên đây là tối ưu thật (giảm traffic client nhận, không chỉ dựa vào RLS) — đúng yêu cầu "tránh mỗi client nhận event của mọi conversation". Đây là điểm khác biệt/tốt hơn so với pattern `friend_requests` đã chấp nhận risk. |

**Lưu ý quan trọng cho dev/Checker**: filter `conversation_id=eq.{id}` ở tầng Realtime là tối ưu hiệu năng (giảm message lượng client nhận), nhưng **KHÔNG phải lớp bảo mật** — bảo mật thật vẫn là RLS SELECT/INSERT trên `dm_messages` (mục 4). Một client cố tình subscribe channel với `conversation_id` của người khác (không phải thành viên) vẫn bị RLS chặn không nhận được payload thật (theo cùng assumption "Realtime áp RLS cho postgres_changes" — risk #6 dưới).

### 6. Edge cases — enforcement mechanism (đối chiếu 13 case trong STATE > ANALYZE)

| # | Case | Enforcement |
|---|---|---|
| 1 | Mở DM với non-friend | RLS `conversations_insert_friends_only` (DB) + UI không hiện nút "Nhắn tin" cho non-friend vì `FriendRow` chỉ render trong friends list đã `accepted` (nguồn chặn ở UI level) |
| 2 | Self-DM | CHECK constraint `conversations_no_self` (DB) — `user_a_id <> user_b_id`. Không cần UI chặn riêng vì friend list không chứa chính mình |
| 3 | Lịch sử sau unfriend | RLS `dm_messages_select_member` KHÔNG check friend status → lịch sử cũ luôn đọc được (THINK #3) |
| 4 | Tin rỗng/whitespace | Client: `useDmMessages.send()` trim + no-op nếu rỗng (giống `useMessages.send`). DB: CHECK `char_length(body) between 1 and 2000` trên `dm_messages` |
| 5 | Tin quá dài | Cùng CHECK constraint trên (giới hạn 2000, THINK #5). Client nên validate trước (tùy `/build`, không bắt buộc theo design) |
| 6 | User C đọc/gửi vào conversation A-B | RLS `dm_messages_select_member`/`insert_member_and_friends` — C không match `exists` subquery → 0 rows SELECT, INSERT reject |
| 7 | Race tạo conversation đồng thời | Unique index `conversations_pair_unique` (DB) — INSERT thứ 2 lỗi `23505` → `findOrCreate` catch + fallback SELECT (mục 3) |
| 8 | Mở lại từ friend khác nhau trong list | `findOrCreate` luôn SELECT trước khi INSERT → route về đúng 1 conversation hiện có |
| 9 | Tin đến khi panel đóng | Persisted DB (`dm_messages` insert thành công dù không ai đang xem) — load lại khi mở lại thread (`useDmMessages` load on mount). Không cần Presence/badge (THINK #7 deferred) |
| 10 | Lịch sử dài | `limit(100)` trong `useDmMessages` load query (giống `useMessages`, THINK #4 — không pagination) |
| 11 | Network drop khi gửi | Không optimistic insert — lỗi trả về từ Supabase client → `send()` trả `{error}` → UI restore draft, không append message rác |
| 12 | Chưa từng accepted | Không có row `friend_requests` accepted → `findOrCreate` RLS reject → UI lỗi rõ. Nguồn chặn chính: nút "Nhắn tin" không xuất hiện (friends list rỗng/không chứa người đó) |
| 13 | Migration 0005 chưa chạy | `exists (select ... from friend_requests ...)` trong RLS sẽ lỗi runtime "relation does not exist" nếu bảng chưa tồn tại — **operational risk, không phải bug code**. Ghi rõ trong README/PR: migration 0005 PHẢI chạy trước hoặc cùng lúc với 0006 trên Supabase Studio |

**Thêm 2 edge case kỹ thuật mới phát sinh từ thiết kế (không có trong ANALYZE gốc, ghi nhận cho Checker):**
- **SSR/CSR mismatch**: toàn bộ component DM là `"use client"`, không có data fetch SSR — không có nguy cơ mismatch hydration (giống `ChatPanel`/`FriendsPanel` hiện tại, không có gì mới).
- **Stale `canSend` hint sau unfriend trong khi thread đang mở**: `useDmMessages` chỉ query friend status 1 lần khi mount — nếu peer unfriend mình NGAY khi mình đang nhìn thread (real-time), client hint không tự cập nhật cho tới khi mình thử gửi (RLS sẽ reject, hook catch + cập nhật `sendBlockedReason` reactive). Đây là gap nhỏ được chấp nhận theo Interaction Notes của design doc ("treat an RLS-denial response on send the same as the pre-detected case") — KHÔNG cần subscribe `friend_requests` UPDATE riêng trong `useDmMessages` ở MVP (over-engineering so với lợi ích, vì window race rất hẹp và hệ quả chỉ là 1 lần gửi thất bại + banner xuất hiện ngay sau).

### 7. Trade-off decisions + assumptions (cho dev/Checker theo dõi)

1. **2 schema song song (messages vs conversations/dm_messages)** — chấp nhận trùng lặp nhẹ về pattern hook, đổi lại an toàn tuyệt đối cho global chat đang chạy thật. KHÔNG migrate `messages` trong feature này.
2. **`findOrCreate` không dùng Postgres function/RPC riêng** — implement hoàn toàn ở client (SELECT rồi INSERT, bắt lỗi 23505 fallback SELECT) để khớp pattern hiện tại (`useFriends`/`useFriendRequests` đều gọi trực tiếp qua supabase-js, không có Route Handler/RPC nào trong codebase). Nếu muốn atomic hơn, có thể nâng cấp thành 1 Postgres function `get_or_create_dm_conversation(peer_id uuid)` ở vòng sau — KHÔNG cần ở MVP vì unique index đã đủ an toàn (race chỉ gây 1 INSERT lỗi vô hại, không gây data corruption).
3. **`DmPanel` unmount khi rời tab** (xem mục 5) — đơn giản hóa cleanup, đánh đổi mất state UI tạm thời khi tab-switch trong session.
4. **Realtime risk "RLS-enforced postgres_changes"** kế thừa nguyên vẹn từ friends feature, CHƯA verify thật. Bắt buộc test 2-account thật trước khi ship (xem TEST PLAN mục E2E #3).
5. **Không trích xuất `MessageList`/`MessageComposer` ngay là acceptable** nếu dev thấy rủi ro touch `chat-panel.tsx` đang chạy ổn cao hơn lợi ích — đây là đề xuất, không bắt buộc (theo design doc Open Question #5). Checker không nên fail review chỉ vì JSX trùng lặp giữa `ChatPanel` và `DmThread`, miễn style nhất quán.
6. **Migration 0005 phải chạy trước/cùng 0006** trên Supabase Studio thật — ghi rõ trong PR description khi `/ship`.

**Next action**: `/build` (feature-builder) — implement theo đúng file list mục 1, hooks mục 3, RLS đã có sẵn trong `0006_dm_chat.sql`. Sau đó `/review` (code-reviewer dùng PLAN này làm acceptance standard) → `/qa` (đặc biệt risk Realtime RLS mục 5b + 13 edge case mục 6, cần migration 0005+0006 đã áp dụng lên Supabase Studio thật).

## BUILD

> Phase: **Maker** (feature-builder). Implemented theo đúng file list/hooks/RLS đã định ở PLAN — KHÔNG tự self-review, Checker (`code-reviewer`) độc lập sẽ verify.

### Files created

| File | Nội dung |
|---|---|
| `src/lib/use-dm-conversations.ts` | Hook inbox: load (join peer username + last message qua N+1 query nhỏ) + Realtime (`dm-conversations-{userId}`, subscribe `conversations` INSERT + `dm_messages` INSERT, không filter cột) + `findOrCreate(peerId)` (SELECT-trước, INSERT-sau, catch `23505` → fallback SELECT, map RLS-reject sang lỗi tiếng Việt, chặn self-DM client-side trước khi gọi DB). |
| `src/lib/use-dm-messages.ts` | Hook 1 thread: load 100 tin gần nhất + check friend-status hint 1 lần khi mount (`canSend`/`sendBlockedReason`) + Realtime (`dm-thread-{conversationId}`, filter `conversation_id=eq.{id}`) + `send()` (trim, no-op nếu rỗng, không optimistic-insert, set `sendBlockedReason="unfriended"` reactive khi RLS reject). |
| `src/lib/use-dm-conversations.test.ts` | Unit test `findOrCreate`: no-existing→insert, existing-found→no-insert, race 23505→fallback SELECT, RLS-reject→mapped Vietnamese error (not raw Postgres message), self-DM blocked client-side. 5/5 pass. |
| `src/lib/use-dm-messages.test.ts` | Unit test `send()`: empty/whitespace no-op, trim trước insert, `canSend`/`sendBlockedReason` initial check khi không có accepted friendship, RLS-rejection → `sendBlockedReason` cập nhật reactive, `conversationId=null` → empty-safe. 5/5 pass. |
| `src/components/ui/states.tsx` | `EmptyState`/`ErrorState`/`SkeletonRows` trích xuất từ `friends-panel.tsx` (theo đề xuất design doc mục 4) — dùng chung cho Friends + DM Inbox + DM Thread. |
| `src/components/dm-panel.tsx` | `DmPanel` (view inbox/thread switcher, xử lý `pendingOpenFriendId` trigger từ FriendsPanel) + `DmInbox` + `DmConversationRow` + `DmThread` (gộp 1 file, theo convention `friends-panel.tsx`). |
| `src/components/chat-tabs.tsx` | `ChatTabs` — tab switcher "Chung"/"Tin nhắn", mount `ChatPanel` (Global, nguyên trạng) hoặc `DmPanel` (DM, mới) theo `activeTab`. |

### Files modified

| File | Thay đổi |
|---|---|
| `src/lib/types.ts` | Thêm `DmConversation`, `DmMessage` (đúng shape PLAN mục 2). |
| `src/app/page.tsx` | Thay `<ChatPanel fallback={...}/>` bằng `<ChatTabs .../>`; thêm state `activeChatTab`, `pendingOpenFriendId`; thêm `handleMessageFriend()` (set tab="dm" + set pending + đóng FriendsPanel); wire `onMessageFriend` xuống `FriendsPanel`. |
| `src/components/friends-panel.tsx` | Thêm prop `onMessageFriend`, thread xuống `FriendsTab` → `FriendRow`; thêm nút `[Nhắn tin]` (đặt trước `[⋯]` kebab, theo design doc 3.12); xóa định nghĩa inline `EmptyState`/`ErrorState`/`SkeletonRows`, import từ `src/components/ui/states.tsx` thay thế (replace_all qua cả 2 nơi dùng — FriendsTab + RequestsTab). |
| `src/components/chat-panel.tsx` | **KHÔNG sửa** — đúng theo PLAN trade-off #5, giữ behavior/contract 100% nguyên trạng. `DmThread` trong `dm-panel.tsx` tái implement bubble/input JSX riêng (không trích xuất `MessageList`/`MessageComposer` chung — xem Assumptions #6 dưới). |

### Migration

- `supabase/migrations/0006_dm_chat.sql` đã được architect viết sẵn trong PLAN — đọc kỹ, xác nhận khớp 100% với mô tả PLAN (schema `conversations` + `dm_messages`, RLS re-check friend status tại thời điểm gửi, unique index `conversations_pair_unique`, Realtime publication) — **KHÔNG sửa file migration**, build chỉ code lớp ứng dụng phía trên.
- **CHƯA chạy migration `0006` (và `0005`) lên Supabase Studio thật** — giống tình trạng `0005_friend_requests.sql` ở friends feature trước đó. Toàn bộ hook/component build dựa trên giả định schema này tồn tại trên DB thật; KHÔNG thể test live (Realtime 2-account, RLS qua REST) cho tới khi user áp dụng cả 2 migration. Đây là constraint đã biết trước (STATE > Risk notes #13, THINK #8) — Maker KHÔNG tự chạy migration theo đúng giới hạn nhiệm vụ.

### Verification run by Maker (build-time only, NOT QA/live verification)

```
npx tsc --noEmit         → pass (0 errors)
npm run lint              → pass (0 errors/warnings)
npm run build             → pass (Next.js build + typecheck succeeded)
npm run test              → pass (28/28 — 18 pre-existing + 10 new for use-dm-conversations/use-dm-messages)
```

### Assumptions made (for Checker to verify)

1. **`ChatPanel` border duplication when "Chung" tab active**: `ChatTabs` wraps content in its own `border-r`, and `ChatPanel` (unchanged) also draws its own `border-r` internally — when "Chung" is the active tab there are 2 stacked `border-r` (cosmetically harmless, 1px double-border at most, not touched per "do not modify chat-panel.tsx" constraint). Flagging as a known minor visual nit, not a functional bug.
2. **Peer username during the "Nhắn tin" → thread-open transition**: `DmPanel`'s pending-open effect resolves `conversationId` via `findOrCreate`, then tries to find the peer's username by looking it up in the *already-loaded* `conversations` list from `useDmConversations`. If this is the user's very first-ever DM with that peer (so `conversations` is still empty/stale at that exact moment), `activePeerUsername` falls back to `""` and the thread header briefly shows `@` with no name until the inbox's own Realtime/refetch catches up (triggered by the new `conversations` INSERT event). This is a minor cosmetic gap not explicitly resolved in PLAN/design — design doc's Interaction Notes (mục 5) say "header shows @alice99 right away, since we know the peer username synchronously," which assumes the caller (FriendsPanel) already knows the peer's username at trigger time but the current `onMessageFriend(friendId)` contract only passes the id, not username. **Flagging for Checker/Designer**: could be fixed by changing the callback to pass `{id, username}` instead of just `id` — chose NOT to do this unilaterally since it changes the prop contract documented in PLAN (`onMessageFriend: (friendId: string) => void`) without explicit sign-off.
3. **`MessageList`/`MessageComposer` extraction NOT done** — per PLAN's trade-off #5 ("acceptable if dev sees touching chat-panel.tsx as higher risk than benefit"), `DmThread` duplicates the bubble/input JSX pattern from `ChatPanel` rather than sharing an extracted component. Both visually match (Tailwind classes copied verbatim) but are now 2 independent implementations that could drift over time.
4. **`useDmConversations.load()`'s last-message fetch is N+1** (1 query per conversation, sequential via `Promise.all`) — matches PLAN's explicit acceptance of this pattern ("đủ rẻ vì danh sách DM thường nhỏ"), not optimized into a single JOIN/RPC.
5. **`findOrCreate`'s RLS-rejection error message is a single generic string** (`"Chỉ chat riêng được với bạn bè đã kết bạn."`) regardless of whether the actual cause is "not friends" vs. some other RLS/DB failure (e.g. transient network error during INSERT) — mirrors the PLAN's specified behavior exactly (PLAN mục 3, step 5), but means a genuine transient error would show a misleading "you're not friends" message to the user. Accepted as-is per PLAN, not introducing additional error-code branching not specified.
6. **`useDmMessages`'s friend-status hint query runs only once on mount/conversationId-change** — does NOT subscribe to `friend_requests` UPDATE events while a thread is open (explicitly scoped out in PLAN mục 6, "Stale canSend hint" edge case — accepted gap, RLS at send-time is the real enforcement, not this hint).
7. **`conversationIdRef`/`identityRef` indirection in `use-dm-messages.ts`**: introduced specifically to satisfy the `react-hooks/set-state-in-effect` ESLint rule (React Compiler lint), which flagged the direct-closure-variable pattern even though it's structurally equivalent to `useFriends.ts`'s existing `identityRef` pattern. Verified behaviorally equivalent via unit tests (5/5 pass) — but this is a non-obvious lint-driven refactor Checker should sanity-check for any subtle effect-ordering bug (relies on React running effects in declaration order within the same commit, which is guaranteed behavior but worth a second look given the indirection).
8. **DM Inbox loading state, error state styling**: built to match `friends-panel.tsx`/design doc visual conventions (icons, copy) but NOT pixel-verified against the ASCII wireframes in `dm-chat-design.md` — Checker/QA should visually spot-check against design doc sections 3.3–3.11.
9. **No E2E/Playwright tests added** — `dm-chat-testplan.md` mục 2 (E2E/Live tests) explicitly require migrations 0005+0006 applied to a real Supabase project, which is out of scope for Maker per task constraints. Only mục 1 (unit tests) was implemented, and only a subset of the listed cases (the highest-risk ones: `findOrCreate` race/RLS, `send()` block/unfriend) — NOT the full matrix listed in testplan mục 1.1/1.2 (e.g. Realtime handler dedup-on-mount-event tests, channel-filter-string assertion tests, cleanup/`removeChannel`-called-on-unmount tests were not written — existing hooks' own test suites in this repo also don't cover this depth, no established pattern to follow for those specific assertions).
10. **Component-level tests (testplan mục 1.3) NOT written** — testplan itself says "if none exist for ChatPanel/FriendsPanel, skip and rely on e2e only, do not introduce a new testing pattern unilaterally." Confirmed no existing component-render tests in the repo (`ChatPanel`/`FriendsPanel` have zero test files) — skipped per that explicit instruction.

### Deferred (explicitly out of scope per THINK/PLAN, not omissions)

- Typing indicator in DM (THINK #2).
- Read receipts (THINK #6).
- Unread badge count (THINK #7).
- Pagination/infinite scroll (THINK #4).
- Rate limiting (THINK #10).
- `MessageList`/`MessageComposer` shared extraction (PLAN trade-off #5, optional).

**Next action**: `/review` (code-reviewer, independent Checker — do NOT let Maker self-review) using this BUILD section + PLAN as acceptance standard. Then `/qa` per `dm-chat-testplan.md` — BLOCKED until migrations `0005_friend_requests.sql` AND `0006_dm_chat.sql` are both applied to a real (non-prod) Supabase project by the user/admin (manual apply via Studio SQL Editor, per CLAUDE.md DB safety convention — not run automatically by any agent).

### Post-review fixes (round 1 — code-reviewer + architect, parallel)

Both reviewers independently flagged the same 2 real bugs as NEEDS-WORK (all other findings accepted as documented debt/non-blocking, see Assumptions list above). Both fixed in this round — no other changes made.

1. **Bug 1 fixed — `activePeerUsername` never resolves on a brand-new first-ever DM, no self-heal** (this was exactly Assumption #2 above, now resolved instead of deferred).
   - Root cause: `DmPanel`'s pending-open effect looked up the peer's username in the stale/excluded-from-deps `conversations` snapshot. On a brand-new first DM, the row isn't in `conversations` yet → `activePeerUsername` set to `""` permanently (no effect anywhere re-syncs it once `conversations` refetches/gets the Realtime echo).
   - Fix: changed the `onMessageFriend` contract to pass `(friendId: string, friendUsername: string)` instead of just `friendId`. The friend row already has `friend.username` available at the call site — threaded straight through `FriendsPanel` → `page.tsx` (new state `pendingOpenFriendUsername`) → `ChatTabs` → `DmPanel` (new prop `pendingOpenFriendUsername`). `DmPanel`'s pending-open effect now sets `activePeerUsername` directly from the prop — no lookup in `conversations` at all, correct from first render, no self-heal needed because there's no longer a window where it's wrong.
   - Files touched: `src/components/friends-panel.tsx` (type sig `onMessageFriend`/`onMessage`, `FriendRow` onClick passes `friend.username`), `src/app/page.tsx` (new state + `handleMessageFriend` signature), `src/components/chat-tabs.tsx` (new prop threaded to `DmPanel`), `src/components/dm-panel.tsx` (new prop, removed `conversations` lookup, destructure simplified to just `findOrCreate`).

2. **Bug 2 fixed — stale-closure race in `use-dm-messages.ts`'s `load()` when switching DM threads quickly.**
   - Root cause: `load()` was a `useCallback` with only `[supabase]` as deps, doing 3 sequential awaited Supabase calls with no cancellation guard. Switching from thread X to thread Y before X's `load()` resolved could let X's stale result land after Y's and overwrite Y's `messages`/`canSend`/`sendBlockedReason`.
   - Fix: `load()` now takes an `isCancelled: () => boolean` callback, checked before every `setState` call that happens after an `await` (4 check points: empty/null guard, after message select, after conversation select, after friend_requests select). The calling effect declares a local `cancelled` flag (same pattern as the sibling Realtime-subscribe effect in the same file) and flips it to `true` in its cleanup function, so a stale `load()` invocation becomes a no-op instead of overwriting newer state.
   - Lint note: the React Compiler ESLint rule `react-hooks/set-state-in-effect` flagged calling `load(() => cancelled)` directly in the effect body (even though `load` is async) when combined with a cleanup `return` function in the same effect — resolved by wrapping the call in an inline async IIFE (`(async () => { await load(...) })()`), matching the exact structural pattern already used by `DmPanel`'s own pending-open effect in `dm-panel.tsx`. This is a lint-satisfying wrapper only, no behavior change.
   - Files touched: `src/lib/use-dm-messages.ts` only.
   - Added 1 regression test: `src/lib/use-dm-messages.test.ts` — "switching conversationId quickly does not let a stale slower load() overwrite the newer thread's state" (mocks conversation X's `dm_messages` select to resolve via a manually-controlled deferred Promise, switches to conversation Y before resolving it, asserts Y's messages win and resolving X's stale promise afterward is a no-op).

**Verification run by Maker after both fixes:**
```
npm run build   → pass (Next.js build + typecheck succeeded)
npm run lint    → pass (0 errors/warnings)
npm run test    → pass (29/29 — 28 pre-existing + 1 new regression test for Bug 2)
```

**Assumptions made in this round (for Checker to verify):**
1. `pendingOpenFriendUsername` is threaded as a plain `string` (default `""` in `page.tsx` state) rather than `string | null` — paired 1:1 with `pendingOpenFriendId` at every call site, so it's always set correctly together with the id whenever `handleMessageFriend` fires; never read independently before `pendingOpenFriendId` is set.
2. Did not add a regression test for Bug 1 (the username-threading fix) — it's a straightforward prop-threading change with no async/race behavior to unit-test in isolation (would require a component-level render test of `FriendsPanel`→`page.tsx`→`DmPanel`, which the repo has no existing pattern for, consistent with Assumption #10 in the original BUILD section about component-level tests being explicitly out of scope per testplan).
3. The `conversations` destructure in `DmPanel` was simplified to `const { findOrCreate } = conversationsHook;` since `conversations` is no longer needed in the pending-open effect — `conversations` is still independently destructured again inside `DmInbox` (different scope, unaffected).
4. No other files were touched besides what's listed above — did not touch `chat-panel.tsx`, migrations, or any other previously-flagged-but-accepted finding from the review round.

**Next action**: re-run `/review` (or have the Checker verify just these 2 fixes against this section) → `/qa` (still BLOCKED on migrations `0005`+`0006` being applied to a real Supabase project, unchanged from before).

## QA

> Phase: QA (static-only run, 2026-06-24). Acceptance standard: `docs/loops/dm-chat-testplan.md`. Per task constraint, migrations `0005_friend_requests.sql` AND `0006_dm_chat.sql` are NOT applied to the live DB by this agent — the user runs them manually in Supabase Studio. All checks below are what can be verified WITHOUT a live DB.

### Static checks run

| Check | Result |
|---|---|
| `npm run build` | ✅ PASS — Next.js 16.2.9 (Turbopack), compiled successfully, TypeScript finished with no errors, all routes generated (`/`, `/_not-found`, `/auth/callback`). |
| `npm run lint` | ✅ PASS — 0 errors/warnings (eslint, no output). |
| `npm run test` | ✅ PASS — **29/29 tests**, 4 test files, as expected (18 friends + 10 DM original + 1 new regression test from post-review fix round for the `use-dm-messages.ts` stale-load race). Duration 818ms. |
| `npm run dev` + root route | ✅ PASS — root route `/` returns HTTP 200. Note: a dev server was already running from an earlier session on port 3000 (PID 22571); the newly spawned instance correctly detected the port conflict and exited, but `curl http://localhost:3000/` returned 200 either way, confirming the app serves the root route without errors. |

### Final static re-verification of `supabase/migrations/0006_dm_chat.sql`

Re-read the full file end-to-end one more time before it goes to the user for manual application. No syntax or logic errors found:

- `create table if not exists` — idempotent, safe to re-run.
- `conversations_no_self` CHECK (`user_a_id <> user_b_id`) — correct, matches edge case #2.
- `conversations_pair_unique` unique index on `(least(user_a_id, user_b_id), greatest(user_a_id, user_b_id))` — correct pattern reused from `friend_requests` (0005), prevents duplicate pairs regardless of insert order, matches edge case #7 (race).
- `dm_messages` CHECK `char_length(body) between 1 and 2000` — matches THINK #5 decision (2000 chars), matches `messages` (0001) convention.
- FKs `on delete cascade` on both `user_a_id`/`user_b_id` (conversations) and `conversation_id`/`sender_id` (dm_messages) — consistent, no orphan rows possible.
- RLS `conversations_select_member` — correctly scoped to `auth.uid() = user_a_id or auth.uid() = user_b_id`, `to authenticated` only (no `anon`) — matches AC9.
- RLS `conversations_insert_friends_only` — correctly requires `kind = 'direct'`, caller is a member, AND an `accepted` `friend_requests` row exists between the two parties at creation time (`exists` subquery with symmetric OR on `requester_id`/`recipient_id`) — matches AC4/AC1.
- RLS `dm_messages_select_member` — correctly does NOT re-check friend status (intentional per THINK #3 — old history stays visible after unfriend) — matches AC7 step 4 and edge case #3.
- RLS `dm_messages_insert_member_and_friends` — correctly re-checks `accepted` friend status via a fresh subquery against `conversations` + `friend_requests` at INSERT time (not just at conversation-creation time) — this is the core security enforcement for AC7 (unfriend blocks new sends) and matches the THINK requirement "RLS phải re-check trạng thái friend tại THỜI ĐIỂM GỬI". Also checks `sender_id = auth.uid()` (no spoofing).
- No UPDATE/DELETE policies on either table — Postgres default-deny applies, matches "immutable" design intent (no edit/unsend in scope).
- Realtime publication blocks (`do $$ ... if not exists ... $$`) are idempotent/safe to re-run, correctly guarded with `pg_publication_tables` existence checks before `alter publication ... add table`.
- Rollback section at the bottom is present, in correct reverse order (publication → policies → tables), and explicitly calls out that dropping `conversations`/`dm_messages` destroys DM history requiring manual approval — consistent with CLAUDE.md DB safety rules (no unguarded destructive statements run automatically).
- Cross-file dependency note (lines 12-16) correctly flags that `0005_friend_requests.sql` must be applied before or together with `0006` — confirmed accurate, since RLS on both `conversations` and `dm_messages` queries `friend_requests` directly with no FK, so the policy would simply fail to find the table if 0005 is missing (not silently bypass security — Postgres errors loudly on `relation does not exist`, which is the safe failure mode).

**No issues found.** The migration is syntactically valid SQL and its logic is internally consistent with the documented PLAN/RLS design. This is a static read-through only — actual execution against Postgres (e.g. confirming `gen_random_uuid()` extension is available, confirming the `least`/`greatest` functions work as expected on `uuid` columns under the project's Postgres version) cannot be confirmed without running it in Supabase Studio.

### Post-review fixes — confirmed present in code

1. **`src/components/dm-panel.tsx`** — confirmed: `activePeerUsername` is set directly from the `pendingOpenFriendUsername` prop (line 86, `setActivePeerUsername(pendingOpenFriendUsername)`) inside the pending-open effect, with NO lookup into the `conversations` list. The prop's JSDoc (lines 34-40) explicitly documents the review fix rationale. Confirmed correct per BUILD section's described fix.
2. **`src/lib/use-dm-messages.ts`** — confirmed: the `cancelled` flag pattern is present in the calling effect (lines 175-184) — a local `cancelled` flag is declared, `load(() => cancelled)` is invoked inside an async IIFE, and `cancelled = true` is set in the effect's cleanup function. `load()` itself (lines 99-163) checks `isCancelled()` at 4 points after each `await` (lines 102, 119, 139, 154) before any subsequent `setState`, exactly matching the BUILD section's description of the fix for the stale-load race when switching DM threads quickly.

### What was NOT verified (blocked, requires live DB)

Per task constraint, the following from `dm-chat-testplan.md` section 4 (QA gate) and section 2 (E2E) remain **unverified**:

- Migrations `0005_friend_requests.sql` and `0006_dm_chat.sql` have NOT been applied to any real Supabase project (confirmed — these are pending the user's manual action in Supabase Studio per CLAUDE.md DB safety convention; this agent did not and will not run them).
- AC3 step 5 / testplan gate item 2 — **Realtime RLS isolation** (`@test_c` not receiving `postgres_changes` payloads for conversations they're not a member of) across the 3 new subscriptions this feature adds (`dm-conversations-{userId}`, `dm-thread-{conversationId}`, plus the existing `messages-realtime` is unaffected/unchanged) — the single highest-risk unverified assumption, inherited from the friends feature, flagged repeatedly throughout ANALYZE/PLAN/BUILD. Cannot be tested without 2+ real accounts against a live, migrated DB.
- AC2 (2-second realtime delivery) — requires 2 real browser tabs against a live DB.
- AC7 (unfriend blocks new sends, re-checked at send time) — requires a real unfriend action + real send attempt against a live, migrated DB.
- AC9 (anon fully blocked) — requires a real anon Supabase client against a live, migrated DB.
- AC1, AC4, AC10, and edge cases #2/#7/#8/#11 from testplan section 3 — all require live DB access for the INSERT/SELECT-level verification described.

### Overall QA status

**PARTIAL PASS — static checks pass; live DB verification (RLS, friend-status re-check at send time, Realtime cross-account delivery across 3 subscriptions) BLOCKED pending user running `supabase/migrations/0005_friend_requests.sql` AND `supabase/migrations/0006_dm_chat.sql` in Supabase Studio. Two-account manual QA required before considered fully shipped.**

**Next action**: User applies migrations `0005` + `0006` (in that order, or together in one Studio run) to a non-prod/test Supabase project → re-run the live/E2E portion of `dm-chat-testplan.md` section 2 + the QA gate checklist in section 4, with special attention to AC3 step 5 (Realtime RLS isolation) — the highest-risk unverified item — before `/ship`.
