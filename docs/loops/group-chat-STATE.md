# STATE — Feature: Group Chat

> Phase hiện tại: **ANALYZE — Done** (BA). Tiếp theo: `/office-hours` (THINK) để chốt các Open Questions dưới — đặc biệt câu hỏi #1 (friend-gating cho group, khác hẳn DM) và #8 (schema unification — gắn cờ từ architect ở review DM-chat) trước khi `/plan`.

## ANALYZE

### Core user need

GeoChat hiện có:
- **Global chat** (`messages`, mở cho `anon`).
- **1-1 DM riêng tư** (`conversations` kind=`'direct'` + `dm_messages`, chỉ giữa 2 friend đã `accepted`, vừa build/QA static-pass — xem `docs/loops/dm-chat-STATE.md`).
- **Friends/contacts** (`friend_requests`, social graph, vừa build, PR đang mở — xem `docs/loops/friends-STATE.md`).

Còn thiếu: nói chuyện với **nhiều người cùng lúc** trong 1 phòng riêng (ví dụ nhóm bạn cùng đi chơi, theo dõi vị trí nhau trên map) mà không phải broadcast ra toàn bộ global chat và không bị giới hạn chỉ 2 người như DM. Đây là nhu cầu tự nhiên tiếp theo sau khi đã có social graph + pattern 1-1 chat đã chứng minh hoạt động.

**Tín hiệu quan trọng nhất cho feature này**: cột `kind` trong bảng `conversations` (migration `0006_dm_chat.sql`) hiện bị `CHECK (kind in ('direct'))` — đây là **seam đã được architect chủ động để lại** lúc làm DM chat, đúng như comment trong migration: "cột kind để dành cho group/global hợp nhất sau này, KHÔNG dùng ngay." Group chat feature là nơi seam này được dùng tới lần đầu.

**Cờ đã gắn từ review DM-chat (BẮT BUỘC `/plan` của Run 3 resolve, không để lại quyết định ad hoc nữa)**: kiến trúc DM-chat đã quyết KHÔNG gộp `dm_messages` vào bảng `messages` chung — đây là quyết định đúng cho lúc đó (rủi ro touch bảng `messages` global đang chạy thật). Architect lúc review đã ghi rõ: *"Run 3's PLAN phase nên resolve rõ liệu có unify `dm_messages` vào 1 schema chung với conversation membership (kind='group'), hay tiếp tục tách bảng message riêng theo từng loại chat — không để việc này bị quyết định tùy tiện lần nữa."* BA không tự quyết câu này (architecture, không phải requirement) — xem mục "Khuyến nghị cho /plan" ở cuối file.

### User story

> Là một user đã đăng nhập, tôi muốn tạo một nhóm chat với một tên và một tập thành viên ban đầu (chọn từ friends list của tôi), gửi/nhận tin nhắn realtime trong nhóm đó cùng tất cả thành viên khác, thêm/xóa thành viên sau khi nhóm đã tạo, và rời nhóm khi không muốn tham gia nữa — tất cả tách biệt hoàn toàn khỏi global chat và khỏi các DM 1-1 khác.

### Phạm vi (đề xuất — cần user chốt ở office-hours)

**IN (đề xuất):**
- Tạo group: nhập tên group + chọn ≥1 thành viên ban đầu từ friends list (người tạo tự động là thành viên).
- Thêm thành viên vào group đã tồn tại.
- Xóa thành viên khỏi group (ai được xóa — xem Open Question #3).
- Rời group tự nguyện (member tự xóa chính mình).
- Gửi/nhận tin nhắn realtime trong group, chỉ thành viên hiện tại của group thấy được.
- List thành viên hiện tại của 1 group.
- List các group user đang tham gia (group inbox, tương tự DM inbox).
- Lịch sử tin nhắn của group, load N tin gần nhất khi mở lại (nhất quán pattern DM/global: không pagination ở MVP).

**OUT (đề xuất, cần user xác nhận):**
- Group avatar/icon — xem Open Question #7.
- Đổi tên group sau khi tạo — xem Open Question #6.
- Vai trò admin phức tạp (nhiều cấp quyền) — xem Open Question #4, mặc định đề xuất mô hình đơn giản nhất (creator = admin duy nhất, hoặc bất kỳ ai cũng được thêm/xóa — KHÔNG tự quyết).
- Typing indicator trong group (giống DM, đã deferred ở DM-chat THINK #2) — deferred theo cùng lý do.
- Read receipts / unread badge — deferred theo cùng lý do đã deferred ở DM-chat (THINK #6/#7).
- Group lớn kiểu broadcast/channel (hàng trăm/nghìn thành viên, kiểu Telegram channel) — KHÔNG phải mục tiêu, đây vẫn là "nhóm bạn nhỏ" kiểu Zalo/Messenger group.
- Mời qua link/QR — chỉ thêm qua friends list đã có quan hệ.
- Đổi quyền sở hữu group (transfer ownership).

### Functional requirements

1. **Tạo group**
   - Input: tên group (bắt buộc, không rỗng) + danh sách thành viên ban đầu chọn từ friends list của người tạo (≥1 thành viên ngoài creator — xem edge case nhóm rỗng).
   - Tạo đúng 1 group; creator tự động là thành viên (và là "admin" nếu Open Question #4 chốt có vai trò).
2. **Thêm thành viên**
   - Thêm 1 user vào group đã tồn tại. Ai được thêm — chỉ friend của NGƯỜI THÊM, hay friend của BẤT KỲ thành viên nào, hay không cần friend-gating cho group? **Đây là câu hỏi taste quan trọng nhất, xem Open Question #1.**
   - Ai có quyền thêm (chỉ admin/creator hay mọi member) — Open Question #4.
3. **Xóa thành viên**
   - Xóa 1 thành viên khỏi group. Ai có quyền xóa ai (chỉ admin xóa member khác, hay mọi member tự rời) — Open Question #4.
4. **Rời group (tự nguyện)**
   - Member tự xóa chính mình khỏi group bất kỳ lúc nào.
5. **Gửi tin nhắn trong group**
   - Chỉ thành viên HIỆN TẠI (tại thời điểm gửi, không phải tại thời điểm tham gia) mới gửi được — nhất quán pattern re-check tại DM-chat (unfriend → mất quyền gửi ngay).
6. **Nhận tin nhắn realtime**
   - Mọi thành viên hiện tại thấy tin mới xuất hiện trong group đang mở, không cần refresh, đúng pattern Postgres changes hiện tại.
7. **List thành viên của group**
   - Trả về danh sách thành viên hiện tại (id, username tối thiểu) của 1 group cụ thể.
8. **List groups của user (group inbox)**
   - Trả về danh sách group mà user đang là thành viên (tên group, tin cuối — tương tự DM inbox).

### Key edge cases bắt buộc xử lý

| # | Case | Cần làm rõ / hành vi mong đợi |
|---|------|-------------------------------|
| 1 | Thêm 1 non-friend vào group | **Chưa rõ là bug hay feature** — friend-gating ở DM nghĩa là "chỉ chat riêng với người mình add làm bạn". Group có nhất thiết giữ ràng buộc đó cho TẤT CẢ thành viên (mọi cặp phải là bạn của nhau), hay chỉ ràng buộc creator-với-mỗi-member (member không cần là bạn của NHAU)? Đây là Open Question #1 — ảnh hưởng RLS hoàn toàn khác nhau. |
| 2 | Xóa thành viên cuối cùng / creator rời nhóm | Nếu creator rời, group còn lại không có ai quản lý (nếu có vai trò admin) — group có tự xóa khi rỗng, hay tồn tại vô chủ, hay chuyển quyền tự động cho member khác? Nếu member cuối cùng rời (group còn 0 người) — group có nên tự động xóa/archive? |
| 3 | Tên group rỗng | Từ chối tạo group, lỗi rõ ràng — validate trước khi insert (giống pattern message rỗng). |
| 4 | Thêm thành viên đã có trong group (duplicate add) | Từ chối tạo row trùng — cần ràng buộc unique (group_id, user_id) ở DB level, lỗi rõ "đã là thành viên". |
| 5 | Group quá lớn (số lượng thành viên) | Có giới hạn tối đa hay không — ảnh hưởng UI (chọn nhiều member) và hiệu năng Realtime (mỗi tin phát tới N người) — Open Question #5. |
| 6 | Gửi tin vào group mình không còn là thành viên | RLS chặn (re-check membership tại thời điểm gửi, không chỉ lúc tham gia) — nhất quán pattern "unfriend chặn gửi DM mới" của DM-chat. |
| 7 | Race thêm/xóa thành viên đồng thời (2 admin cùng thêm/xóa 1 lúc, hoặc thêm đúng lúc người đó bị xóa) | Cần ràng buộc DB-level (unique constraint) chống duplicate; hành vi cụ thể khi 2 thao tác ngược nhau xảy ra gần như đồng thời (ví dụ A đang được thêm trong khi cũng đang bị xóa bởi admin khác) — để architect quyết kỹ thuật, nhưng kết quả cuối phải nhất quán (không có 2 row cho cùng 1 cặp group-user). |
| 8 | Xóa 1 thành viên không phải mình, mình không phải admin/creator | Tùy mô hình quyền chốt ở Open Question #4 — nếu "chỉ admin xóa", member thường cố xóa người khác phải bị chặn RLS (403/0-row). |
| 9 | User C (không phải thành viên group) cố đọc/gửi tin vào group | RLS chặn — pattern giống `dm_messages`/`friend_requests` (0 row SELECT, INSERT reject). |
| 10 | Tin nhắn rỗng/quá dài | Chặn client + DB CHECK — nhất quán convention `dm_messages`/`messages` (1-2000 ký tự, trừ khi đổi). |
| 11 | Group có đúng 1 thành viên (mọi người khác đã rời) | Có còn là "group" hợp lệ hay nên tự đóng — liên quan #2, cần quyết rõ. |

### Acceptance criteria (đo được)

1. User A tạo group với tên hợp lệ + ≥1 member ban đầu (từ friends list) → tạo đúng 1 group; A và các member ban đầu đều thấy group này trong "groups của tôi" ngay sau tạo.
2. Tạo group với tên rỗng/whitespace → bị chặn client-side (không gọi DB) VÀ ở DB (CHECK constraint nếu app có bug).
3. User A gửi tin nhắn trong group → mọi thành viên HIỆN TẠI của group thấy tin xuất hiện trong vòng 2 giây mà không cần reload (đo qua test nhiều tab thật, theo đúng pattern QA của `dm-chat`/`friends`).
4. User C (không phải thành viên) không đọc được tin nhắn của group qua bất kỳ kênh nào (REST trực tiếp, Realtime payload) — verify bằng test RLS qua REST giống cách `dm-chat-STATE.md` đã làm.
5. Thêm 1 user đã là thành viên (duplicate add) → bị chặn, không tạo row trùng, lỗi rõ "đã là thành viên".
6. Member tự rời group → không còn thấy group đó trong "groups của tôi"; không gửi/đọc tin MỚI được nữa (lịch sử cũ — xem Open Question #2 về việc có ẩn không); các thành viên còn lại tiếp tục hoạt động bình thường.
7. Sau khi 1 thành viên bị xóa/rời, họ KHÔNG gửi được tin nhắn mới vào group đó (RLS re-check membership tại thời điểm gửi, không chỉ lúc tham gia) — nhất quán acceptance criterion tương đương của DM-chat (#7).
8. RLS: `anon` (chưa đăng nhập) không đọc/viết được bất kỳ group hay tin nhắn group nào.
9. List thành viên của 1 group chỉ trả về thành viên HIỆN TẠI (không còn member đã rời/bị xóa).
10. `npm run build` + `npm run lint` + `npm run test` pass, không phát sinh lỗi mới từ feature này.

### Product risk notes (cho architect/dev — không phải spec)

- **Location privacy kế thừa từ social graph**: nếu group chat sau này được dùng làm cơ sở để chia sẻ vị trí nhóm (map presence theo group, tương tự cách `friend_requests` là nền cho presence 1-1), thiết kế bảng membership nên tính trước khả năng tái dùng làm "danh sách được phép xem vị trí trong group" — không cần làm ngay, chỉ tránh thiết kế lại từ đầu (đúng pattern risk note đã ghi ở friends-STATE.md).
- **Friend-gating cho group là quyết định bảo mật/sản phẩm lớn nhất, KHÔNG phải kỹ thuật thuần**: nếu group KHÔNG yêu cầu mọi cặp thành viên phải là bạn của nhau (chỉ creator-với-từng-member), thì 2 stranger có thể nằm trong cùng 1 group và nhìn thấy username/tin nhắn của nhau dù không phải bạn — đây là thay đổi privacy model so với DM (DM tuyệt đối chỉ giữa 2 friend). Phải được user xác nhận rõ, không suy luận từ DM sang group.
- **Realtime RLS isolation cho group lớn hơn 2 người**: risk "Supabase Realtime áp RLS cho `postgres_changes`" đã được flag CHƯA verify thật ở friends-STATE.md và kế thừa nguyên vẹn ở dm-chat-STATE.md (vẫn PARTIAL PASS, chưa test 2-account thật). Với group >2 người, hệ quả của risk này (nếu sai) nghiêm trọng hơn — rò rỉ payload tới N người thay vì 1. Đây là rủi ro kỹ thuật cấp cao nhất cần test thật trước khi ship group chat, không chỉ đọc doc.
- **Migration phụ thuộc dây chuyền chưa chạy thật**: `friend_requests` (0005) và `conversations`/`dm_messages` (0006) ĐỀU chưa được áp dụng lên Supabase Studio thật tính tới lúc viết file này. Nếu group chat reference `friend_requests` (theo Open Question #1) hoặc tái dùng concept `conversations`, feature này sẽ build chồng lên 2 bảng còn "ảo" — nhất quán risk đã ghi 2 lần trước (friends-STATE.md, dm-chat-STATE.md), nhắc lại rõ ở đây để không bị quên lần thứ 3.
- **Group size & Realtime fanout**: mỗi tin nhắn group sẽ phát tới tất cả thành viên đang mở app — nếu không giới hạn số lượng member (Open Question #5), nguy cơ spam/abuse tăng theo số người trong group (1 user gửi 1 tin = N lượt nhận), khác hẳn DM (luôn đúng 2). Nên có ý kiến rõ ràng về giới hạn trước khi `/plan` thiết kế RLS/index.

### Khuyến nghị (không phải quyết định) cho /plan — schema unification

Architect đã gắn cờ rõ: Run 3 (group chat) phải resolve dứt điểm việc unify `dm_messages` vào schema chung (`messages` + `conversation_members`, `conversations.kind` mở rộng `'direct'|'group'`) hay giữ bảng riêng (`group_messages` tách biệt khỏi `dm_messages`). Đây là **quyết định kiến trúc, không phải requirement** — BA không quyết, nhưng nêu rõ tradeoff để `/office-hours` và `/plan` có đủ thông tin:

- **Phương án A — Unify**: 1 bảng `conversation_members` (group_id/conversation_id, user_id, role) làm nguồn sự thật cho CẢ DM và group; `dm_messages` đổi tên/mở rộng thành `messages` chung có `conversation_id`, không phân biệt `kind='direct'` hay `'group'` ở tầng message. Lợi ích: 1 RLS surface, 1 hook pattern (`useMessages(conversationId)` dùng chung cho DM và group), tránh trùng lặp logic đã thấy giữa `useDmMessages`/tương lai `useGroupMessages`. Rủi ro: phải ALTER bảng `dm_messages`/`conversations` đang tồn tại (dù chưa chạy thật trên Studio — vẫn là rủi ro thiết kế lại, không phải rủi ro dữ liệu sống vì chưa apply), và RLS membership-based (group) phức tạp hơn RLS 2-cột cố định (`user_a_id`/`user_b_id`) hiện tại của DM — cần viết lại RLS DM theo membership table thay vì 2 cột trực tiếp.
- **Phương án B — Tách bảng riêng**: `group_conversations` + `group_members` + `group_messages`, hoàn toàn độc lập khỏi `conversations`/`dm_messages`. Lợi ích: không đụng schema DM đã thiết kế xong (dù chưa chạy thật, vẫn tái dùng được toàn bộ tư duy + tránh rebase lại PLAN/BUILD đã viết của DM-chat); rủi ro thấp nhất theo đúng tinh thần "ít rủi ro nhất" mà chính architect đã áp dụng khi quyết KHÔNG gộp `dm_messages` vào `messages` (0001) trước đó. Đánh đổi: 3 hệ message riêng biệt tồn tại song song (`messages` global, `dm_messages` DM, `group_messages` group) — trùng lặp pattern hook/RLS tăng theo số loại chat, đúng đúng rủi ro mà chính architect cảnh báo cần "resolve dứt điểm" ở Run 3 để không lặp lại lần thứ 4 nếu có Run 4.
- **Điểm mấu chốt KHÔNG ảnh hưởng user-facing requirement nào trong file này** — mọi acceptance criteria ở trên đúng với cả 2 phương án. Đây thực sự là quyết định của `/plan` (architect), BA chỉ đảm bảo câu hỏi này được đặt ra EXPLICIT một lần nữa ở `/office-hours` trước khi vào `/plan`, đúng yêu cầu của architect ở review trước — không để bị bỏ qua hoặc quyết định ngầm trong code.

### Open questions — CHỈ con người quyết, KHÔNG tự đoán

1. **Friend-gating cho group — mọi cặp thành viên phải là bạn của nhau, hay chỉ creator-với-mỗi-member, hay không cần friend-gating (ai cũng add được ai)?** Đây là câu hỏi quan trọng nhất, khác hẳn DM (DM bắt buộc 2 phía là bạn). Ảnh hưởng trực tiếp RLS INSERT của group_members và privacy model toàn feature.
2. **Lịch sử tin nhắn sau khi rời/bị xóa khỏi group**: member cũ còn xem được lịch sử CŨ (trước khi rời) hay bị ẩn hoàn toàn ngay khi rời? (DM-chat đã chốt "vẫn xem được lịch sử cũ" cho unfriend — group có nên nhất quán hay khác vì group có thể có nội dung nhạy cảm hơn với nhiều người lạ?)
3. **Ai được xóa thành viên?** Chỉ creator/admin, hay bất kỳ member nào cũng xóa được người khác (mô hình "phẳng" không phân cấp)?
4. **Mô hình vai trò (admin)**: có cần khái niệm "admin" (1 hoặc nhiều) tách biệt với "member" thường, hay mọi thành viên ngang quyền (ai cũng add/remove được, kiểu group chat tối giản)? Quyết định này ảnh hưởng schema (`role` column hay không) và toàn bộ RLS.
5. **Giới hạn số lượng thành viên tối đa**: có giới hạn (ví dụ 50/100 như nhiều app) hay không giới hạn cho MVP (nhất quán "không giới hạn" đã chọn cho friends)?
6. **Đổi tên group sau khi tạo**: có cần ở MVP hay deferred?
7. **Group avatar/icon**: có trong scope MVP hay deferred (chỉ tên text)?
8. **Schema unification (dm_messages vs group_messages)**: xem mục "Khuyến nghị cho /plan" trên — đây là quyết định của architect, nhưng cần được NÊU RA và XÁC NHẬN rõ ràng (không quyết ngầm) trước khi `/plan` viết migration, theo đúng yêu cầu architect đã ghi ở review DM-chat.
9. **Group rỗng / creator rời nhóm**: group có tự đóng/archive khi còn 0 hoặc 1 thành viên, hay tồn tại vô thời hạn dù không ai hoạt động?
10. **UI/UX placement**: group là tab thứ 3 cạnh "Chung"/"Tin nhắn" (nhất quán pattern `ChatTabs` đã có), hay 1 mục riêng trong `FriendsPanel`/`DmPanel`? Thuộc `/design`, nhưng nêu sớm để designer biết kế thừa `ChatTabs` thế nào.
11. **Tạo group có bắt buộc ≥1 member ngoài creator, hay cho phép tạo group "rỗng" (chỉ creator) rồi thêm sau?**

## THINK (office-hours)

| # | Câu hỏi | Quyết định | Lý do |
|---|---------|-----------|-------|
| 1 | Friend-gating cho group | **Creator-to-each-member only** — creator phải là bạn (`accepted`) với MỖI member lúc thêm; member KHÔNG cần là bạn của nhau. **Người dùng xác nhận trực tiếp câu hỏi này** (không auto-decide) vì là quyết định privacy/security lớn nhất của feature. | Khớp hành vi Zalo/Messenger thực tế (group thường có người lạ với nhau); vẫn giữ social-graph làm cổng kiểm soát (chỉ creator-to-member, không mở hoàn toàn) |
| 2 | Lịch sử sau khi rời/bị xóa | **Vẫn xem được lịch sử CŨ** (trước khi rời) — chỉ chặn gửi/nhận tin MỚI | Nhất quán quyết định DM-chat THINK #3 (giữ dữ liệu, không xóa lịch sử khi rời quan hệ) |
| 3 | Ai được xóa thành viên | **Chỉ creator** (không có nhiều admin) | Mô hình đơn giản nhất cho MVP — tránh thiết kế role phức tạp khi chưa có nhu cầu rõ |
| 4 | Mô hình vai trò | **Chỉ 2 vai: creator (duy nhất, không chuyển nhượng) + member thường.** Creator add/remove member; member thường chỉ tự rời (leave), không xóa được người khác. | Đơn giản nhất, đủ cho "nhóm bạn nhỏ" — không cần multi-admin ở MVP |
| 5 | Giới hạn số thành viên | **Giới hạn 50 thành viên/group** (khác với friends/DM — group có Realtime fanout N người/tin, nên cần giới hạn cứng để tránh abuse, không như friends "không giới hạn") | Risk note đã ghi rõ: group fanout tăng rủi ro abuse theo số người, cần giới hạn rõ ràng trước khi `/plan` thiết kế RLS/index — chọn 50 (tương đương ngưỡng "nhóm nhỏ" thực tế, không phải broadcast channel) |
| 6 | Đổi tên group | **Không** ở MVP — deferred | Không phải lõi của "group chat hoạt động được" |
| 7 | Group avatar/icon | **Không** ở MVP — deferred | Tương tự friends feature (không avatar), tránh mở rộng phạm vi |
| 8 | Schema unification | **Tách bảng riêng**: `group_conversations` + `group_members` + `group_messages`, độc lập hoàn toàn khỏi `conversations`/`dm_messages`. **Người dùng xác nhận trực tiếp** theo đúng yêu cầu architect ở review DM-chat (không quyết ngầm). | Rủi ro thấp nhất — không đụng schema DM đã viết xong (dù chưa migrate live); nhất quán tinh thần "ít rủi ro nhất" mà architect đã áp dụng từ migration 0001. Đánh đổi (3 hệ message song song) được CHẤP NHẬN rõ ràng, không phải bị bỏ qua. |
| 9 | Group rỗng/creator rời | **Group tồn tại vô thời hạn** dù còn 0-1 thành viên — KHÔNG tự đóng/archive | Đơn giản nhất, tránh logic cleanup phức tạp không cần thiết ở MVP; nếu creator rời, group "vô chủ" (không ai add/remove được nữa) — chấp nhận làm tech debt, ghi rõ cho architect |
| 10 | UI placement | **Tab thứ 3 trong `ChatTabs`** ("Chung" / "Tin nhắn" / "Nhóm"), kế thừa pattern đã có | Nhất quán `ChatTabs` đã build ở DM-chat |
| 11 | Tạo group cần ≥1 member ban đầu? | **Bắt buộc ≥1 member** ngoài creator (không cho tạo group rỗng chỉ có creator) | Tránh group "vô nghĩa" ngay từ đầu — nhất quán mục đích "group chat" (cần ≥2 người mới gọi là group) |

**Quyết định kỹ thuật kèm theo** (áp dụng cho architect):
- `group_members` cần unique constraint `(group_id, user_id)` chống duplicate add — tương tự pattern `friend_requests`/`dm_messages` đã dùng.
- RLS INSERT vào `group_members`: chỉ creator được thêm, VÀ phải tồn tại `friend_requests` row `accepted` giữa creator và user được thêm (re-check tại thời điểm add, không phải tại thời điểm tạo group nếu thêm sau).
- RLS INSERT vào `group_messages`: re-check membership HIỆN TẠI tại thời điểm gửi (nhất quán pattern DM-chat: rời/bị xóa → mất quyền gửi ngay), không chặn đọc lịch sử cũ (THINK #2).
- Giới hạn 50 thành viên: enforce ở DB (trigger hoặc CHECK qua subquery COUNT) + client-side validate trước khi gọi DB.
- Risk kế thừa (ghi lại lần thứ 3, KHÔNG được bỏ qua): "Realtime áp RLS cho `postgres_changes`" vẫn CHƯA verify thật qua 2+ tài khoản; với group >2 người, hệ quả nếu sai nghiêm trọng hơn (rò rỉ tới N người). User đã được hỏi và chọn "tiếp tục, verify sau" ở cấp độ pipeline (xem ghi chú ngoài file) — nhưng group chat là lúc risk này nặng nhất, architect/Checker PHẢI nhấn mạnh lại đây là gate bắt buộc trước khi feature này coi là ship thật.

## PLAN (architect)

> Input: ANALYZE + THINK (locked, not re-litigated) + `docs/loops/group-chat-design.md` (UI).
> Migration written: `supabase/migrations/0007_group_chat.sql` (full SQL, RLS, rollback —
> read directly, not duplicated here). Test plan: `docs/loops/group-chat-testplan.md`.

### 0. Architecture decision — schema confirms THINK #8, one deviation flagged

Tách bảng riêng (`group_conversations` / `group_members` / `group_messages`), độc lập
hoàn toàn khỏi `conversations`/`dm_messages` (0006) — đúng quyết định user đã xác nhận.
KHÔNG ALTER bảng nào của 0001/0005/0006.

**Một deviation BẮT BUỘC so với mô tả gốc trong yêu cầu /plan, ghi rõ lý do**: `group_members`
dùng **soft-delete** (`left_at timestamptz null`, PK `(group_id, user_id)`) thay vì hard
`DELETE` row khi rời/bị xóa. Lý do: THINK #2 chốt "lịch sử CŨ vẫn xem được sau khi rời" —
với hard-delete, schema không còn cách phân biệt "chưa từng là member" (phải chặn SELECT
group_messages) vs "đã từng là member, đã rời" (phải cho xem lịch sử) vì cả 2 đều có cùng
trạng thái dữ liệu (0 row). Soft-delete là route rủi ro thấp nhất: vẫn đúng 1 row/cặp vĩnh
viễn (PK enforced — chống duplicate, edge case #4), "thành viên hiện tại" = `where left_at
is null` (derivable, không cần bảng phụ), rời rồi được add lại = `UPDATE left_at = null`
(không phải insert row mới — re-pass friend-gating qua RLS UPDATE `with check`).

Hệ quả UX cần dev/Checker biết: ex-member vẫn SELECT được `group_conversations.name` và
**toàn bộ** `group_members` rows (kể cả ex-member khác) của group đó — chỉ riêng
`group_messages` INSERT và đếm vào cap-50 là bị cắt thật. Đây là trade-off CHẤP NHẬN ĐƯỢC
(metadata membership, không phải nội dung tin nhắn riêng tư hơn) — xem mục Trade-off #3
trong test plan.

### 1. Files to create / modify

**Migration**
- `supabase/migrations/0007_group_chat.sql` (NEW — written, see file for full SQL).

**Types** (`src/lib/types.ts` — extend, additive only)
```ts
export type GroupConversation = {
  id: string;
  name: string;
  creatorId: string;
  lastMessageBody: string | null;
  lastMessageAt: string; // ISO, fallback = group created_at
  lastMessageSenderUsername: string | null;
  lastMessageMine: boolean;
  memberCount: number;
};

export type GroupMember = {
  id: string;        // user id
  username: string;
  isCreator: boolean;
  joinedAt: string;
};

export type GroupMessage = {
  id: string;
  groupId: string;
  senderId: string;
  senderUsername: string;
  body: string;
  createdAt: string;
};
```

**Hooks (new, parallel to DM hooks — `src/lib/`)**
- `use-group-conversations.ts` — `useGroupConversations(identity)`:
  `{ groups, ready, loading, error, refetch, createGroup }`.
- `use-group-messages.ts` — `useGroupMessages(groupId, identity)`:
  `{ messages, ready, loading, error, canSend, sendBlockedReason, send }`.
  **Must use the cancelled-flag race-safety pattern from day one** (see `use-dm-messages.ts`
  lines 99-184 for the exact pattern: `load(isCancelled: () => boolean)`, effect wraps with
  local `cancelled` flag, checked after every `await`). Do not ship without it — this was a
  post-review fix on DM, must not repeat as a second review round here.
- `use-group-members.ts` — `useGroupMembers(groupId, identity)`:
  `{ members, ready, loading, error, isCreator, creatorId, addMembers, removeMember, leaveGroup }`.
  Shared by both `GroupThread` (pill count + `isCreator`) and `GroupMemberList` (full list +
  mutations) per design doc Open Question #7 default — **one hook**, not two.
- Optional/recommended: `create_group` Postgres RPC (see mục 6 below) — if added, hook calls
  `supabase.rpc("create_group", { p_name, p_member_ids })` instead of sequential inserts.

**Components (new, parallel to DM components — `src/components/`)**
- `group-panel.tsx` — `GroupPanel` (composes `GroupInbox`/`CreateGroupForm`/`GroupThread`/
  `GroupMemberList` via internal `view` state, per design doc mục 4). No external props
  (no pending-open trigger, unlike `DmPanel`).
- `friend-multi-select.tsx` — `FriendMultiSelect` (new, reusable — used by both create-group
  form and add-member picker). Pure controlled component per design doc contract.

**Modified**
- `src/components/chat-tabs.tsx` — extend `ChatTab` to `"global" | "dm" | "group"`, add
  third `<TabButton>` ("Nhóm") + third branch rendering `<GroupPanel />`.
- `src/lib/types.ts` — additive types above.

### 2. Server vs client components

All new components are **client components** (`"use client"`), consistent with
`dm-panel.tsx`/`friends-panel.tsx` — they hold interactive state (view switching, form
inputs, realtime subscriptions) that cannot be server-rendered. No new Server Components
needed; `ChatTabs`'s parent (`page.tsx`) remains the only place that could theoretically be
server-rendered, and it already isn't (per existing DM precedent — tab state lives client-side).

### 3. Data flow

**Create group → add initial members (atomic)**
1. User submits `CreateGroupForm` (name + ≥1 selected friend id).
2. `useGroupConversations().createGroup(name, memberIds)` calls **`create_group` RPC**
   (see mục 6 — recommended addition, not yet in 0007) which, in one Postgres transaction:
   - `insert into group_conversations (name, creator_id) values (...)` → returns `id`.
   - `insert into group_members (group_id, user_id, left_at) values (id, creator_id, null), (id, member_1, null), ...`.
   - If ANY member insert fails friend-gating (RLS `with check` inside the `security
     invoker` RPC still applies) → entire transaction rolls back → group row never persists.
3. On success: `GroupPanel` switches `view` to `"thread"` with the new `groupId` (no detour
   through inbox, per design doc mục 1 step 5).
4. Each initial member's own `useGroupConversations` Realtime subscription receives
   `postgres_changes` INSERT on `group_members` (their own row) → triggers refetch → group
   appears in their inbox without reload.

**Send / receive realtime**
1. `GroupThread` mounted with `groupId` → `useGroupMessages` loads last 100 messages +
   checks own active-membership hint (`group_members` where `left_at is null`).
2. User sends → `insert into group_messages` → RLS re-checks `left_at is null` at this
   exact moment (not cached) → on success, row appears via the user's own Realtime echo
   (non-optimistic, consistent with DM/global).
3. Other active members' `useGroupMessages` (same `groupId`, subscribed to
   `postgres_changes` INSERT filtered `group_id=eq.{id}`) receive the new row → dedupe by
   `id` → append → auto-scroll.
4. Other members' `useGroupConversations` (inbox, different channel/subscription) ALSO
   receives the INSERT on `group_messages` → updates that group's last-message preview +
   re-sorts inbox, without needing to have the thread open.

**Add member later**
1. Creator opens `GroupMemberList` → "+ Thêm thành viên" → `FriendMultiSelect` (filtered to
   friends not already active members) → confirms.
2. `useGroupMembers().addMembers(userIds)` → for each id: if no existing `(group_id,
   user_id)` row → `insert`; if a row exists with `left_at not null` (ex-member re-add) →
   `update set left_at = null`. RLS re-checks creator-friend-gating at this exact INSERT/
   UPDATE moment (re-check, not cached from group-creation time, per locked decision).
3. On success: `GroupMemberList`'s own state updates; the **newly-added user's**
   `useGroupConversations` Realtime subscription (INSERT or UPDATE on `group_members`
   matching their own `user_id`) fires → group appears in their inbox immediately.
4. Anyone else with `GroupMemberList` open for this group (Realtime UPDATE/INSERT on
   `group_members` filtered by `group_id`) sees the new member row appear live, and the
   member-count pill in `GroupThread` header updates live too (shared hook, single
   subscription).

**Remove member / leave**
1. Creator taps `[Xóa]` on a member row (or any member taps `[Rời nhóm]`) → inline confirm
   → `useGroupMembers().removeMember(userId)` / `.leaveGroup()` → `update group_members set
   left_at = now() where group_id=X and user_id=Y`.
2. RLS `group_members_update_leave_or_creator_manage` policy enforces: self can only set
   own `left_at`; creator can set anyone's.
3. On success: removed/left user's row disappears from everyone's live `GroupMemberList`
   (Realtime UPDATE on `group_members`).
4. The affected user's own `useGroupMessages` hook: if they have the thread open, Realtime
   UPDATE on `group_members` where `user_id = me` and `left_at` transitions null→timestamp
   → reactively flips `canSend = false`, `sendBlockedReason = "removed"` WITHOUT requiring a
   failed send first (matches Interaction Notes section 5's explicit reactive requirement —
   stronger than DM's fallback-only detection, since group THINK explicitly calls this out).
5. The affected user's `useGroupConversations` inbox: on next fetch/Realtime update, their
   own row count for that group drops to "not a current member" → group disappears from
   their inbox list (acceptable fallback per design doc: a stale tapped row still correctly
   lands on the blocked-send thread, not a hard failure).

### Subscribe channels and cleanup (explicit)

| Hook | Channel name pattern | Subscribes to | Cleanup |
|---|---|---|---|
| `useGroupConversations` | `group-conversations-{userId}` | `postgres_changes` INSERT on `group_members` (own rows) + INSERT on `group_messages` (any, filtered client-side by groups already in list) | `supabase.removeChannel()` in effect cleanup, on `identity?.userId` change or unmount — mirrors `useDmConversations` exactly |
| `useGroupMessages` | `group-thread-{groupId}` | `postgres_changes` INSERT on `group_messages` filtered `group_id=eq.{id}` + UPDATE on `group_members` filtered `group_id=eq.{id}` (for reactive blocked-send detection) | `supabase.removeChannel()` on `groupId` change or unmount — mirrors `useDmMessages` |
| `useGroupMembers` | `group-members-{groupId}` | `postgres_changes` INSERT/UPDATE on `group_members` filtered `group_id=eq.{id}` | `supabase.removeChannel()` on `groupId` change or unmount |

`GroupPanel` unmounts entirely on tab-leave (per design doc mục 5, carried from DM PLAN
decision) — this alone tears down all 3 channels above without needing per-hook
unmount-detection beyond the existing `cancelled`-flag/effect-cleanup pattern.

### 4. Edge cases — enforcement mechanism per case (11 from ANALYZE)

| # | Case | Enforcement |
|---|---|---|
| 1 | Non-friend added to group | RLS INSERT/UPDATE on `group_members` requires accepted `friend_requests` between **creator** and the target user (THINK #1 locked) — member↔member friendship NOT required. Verified by E14 in test plan. |
| 2 | Creator/last member leaves, group orphaned/empty | No DB-level prevention — THINK #9 explicitly accepts indefinite orphaned/empty groups as tech debt. No cleanup job, no auto-archive. `leaveGroup()` has no special-case block on creator. |
| 3 | Empty/whitespace group name | Client-side trim+reject before any Supabase call (`CreateGroupForm`); DB `CHECK (char_length(btrim(name)) between 1 and 100)` as second layer (E3 forces this path directly). |
| 4 | Duplicate add | `primary key (group_id, user_id)` — a second `insert` for an existing active member fails with `23505`; UI should pre-filter `FriendMultiSelect` options to exclude existing active members so this mostly can't be attempted from the UI, only via direct API (E7). |
| 5 | Group too large | Trigger `group_members_enforce_cap()` (BEFORE INSERT OR UPDATE, counts `left_at is null` rows, rejects at ≥50) — DB is the real gate; client (`FriendMultiSelect`'s `maxSelectable`) is UX-only pre-emption. |
| 6 | Send after removal | RLS `group_messages_insert_active_member` re-checks `left_at is null` at the literal moment of INSERT — no caching, no grace period. |
| 7 | Race: simultaneous add/remove, or add-during-remove of the same user | PK `(group_id, user_id)` makes "2 rows for the same pair" structurally impossible — any conflicting concurrent write either succeeds in some final state or raises `23505`/RLS-denial, never duplicates. For the specific "added right as they're being removed" race: whichever transaction commits last wins (last-write-wins on `left_at`) — **no additional app-level lock needed**, acceptable per STATE's explicit "consistent end-state, no ad-hoc decision" requirement (the requirement was "no duplicate rows", not "deterministic winner ordering" — last-write-wins satisfies it). |
| 7b | **Cap-50 race** (two near-simultaneous adds both observe count=49, both attempt to cross to 50/51) | Trigger's `COUNT(*)` runs inside each INSERT/UPDATE's own transaction at statement time — Postgres default `READ COMMITTED` isolation means the second transaction's COUNT will see the first transaction's row **only if the first has already committed**; if truly concurrent (both readers see 49 before either commits), **both could pass the check and one ends up at 51** — this is the residual risk flagged explicitly in the migration's trigger comment. Mitigated practically because: (a) only the creator can add members (single actor, UI serializes their own clicks), (b) realistic concurrency window is sub-second and requires the creator to fire two separate add-requests in parallel, which the UI doesn't do (single submit button, disabled while in-flight). **Accepted residual risk, not fully closed at DB level** — flag to Checker; closing it fully would require `SELECT ... FOR UPDATE` on a per-group lock row, which is NOT implemented (over-engineering for "single creator, serialized UI clicks" reality). |
| 8 | Non-creator tries to remove someone else | RLS `group_members_update_leave_or_creator_manage`'s `with check` only allows `user_id = auth.uid() and left_at is not null` (self-leave) for non-creators — removing another user's row fails RLS (0 rows updated), tested E15/E26. |
| 9 | Stranger reads/writes a group they're not in | `group_members`/`group_conversations`/`group_messages` SELECT all gate on `exists (select 1 from group_members where user_id = auth.uid() ...)` — a user with zero rows ever in that group gets 0 results / RLS-rejected INSERT. Tested E5/E6/E10. |
| 10 | Empty/too-long message body | DB `CHECK (char_length(body) between 1 and 2000)` (identical to `dm_messages`) + client-side trim+reject before insert. |
| 11 | Group with exactly 1 active member (everyone else left) | Valid state, no special handling — THINK #9. `useGroupMembers` simply returns a 1-row list; UI shows the lone member normally, "+ Thêm thành viên" still works if that member is the creator. |

### 5. SSR/CSR + network-drop edge cases (beyond the 11 above)

- **SSR/CSR mismatch**: none of the new components render on the server (all client
  components, mirroring DM) — no hydration mismatch risk introduced. `GroupPanel` itself
  starts with `view: "inbox"` deterministically on both server-render-skip and client mount
  (no `localStorage`/`window` read before first paint).
- **Network drop mid-session**: Supabase Realtime auto-reconnects (`createClient()`'s
  default behavior, unchanged) — on reconnect, `postgres_changes` subscriptions resume;
  any messages/membership-changes missed during the drop are NOT backfilled automatically
  by the hooks as designed (same limitation as DM — acceptable, consistent, not a regression
  introduced here). Recommend (not blocking): hooks could call `refetch()`/`load()` on the
  channel's `SUBSCRIBED` status event after a reconnect to self-heal gaps — flag as a
  possible future hardening, not required for this feature's MVP parity with DM.
- **Stale presence/membership client state**: `canSend`/`isCreator`/member list snapshots in
  React state can be stale relative to DB truth between Realtime events — this is explicitly
  acceptable because **RLS is the real authorization boundary**, not client state (every
  mutation re-validates server-side regardless of what the client believed). Client state
  staleness is a UX-polish concern only, never a security concern.
- **RLS verification gate (inherited risk, 3rd time flagged)**: "Realtime `postgres_changes`
  honors connection-role RLS" remains UNVERIFIED with 2+ real accounts as of this PLAN.
  This is the single highest-priority QA gate for this feature (E6 in test plan) — group
  chat's fanout (N members) makes a leak worse than DM's fixed 2. **Do not ship this feature
  as "done" without running E6 against real Supabase, not just reading this doc.**

### 6. Recommended addition NOT yet in 0007 — flag to dev/Checker

`createGroup` needs atomicity across `group_conversations` insert + N `group_members`
inserts. The Supabase JS client does not expose multi-statement transactions for arbitrary
sequential `.insert()` calls. **Recommend dev add a follow-up migration `0008_create_group_rpc.sql`**
defining:

```sql
create or replace function public.create_group(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security invoker  -- runs as the calling user — RLS policies on group_conversations/
                   -- group_members still apply inside this function, no privilege escalation
as $$
declare
  v_group_id uuid;
  v_member_id uuid;
begin
  insert into public.group_conversations (name, creator_id)
  values (p_name, auth.uid())
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, left_at)
  values (v_group_id, auth.uid(), null);

  foreach v_member_id in array p_member_ids loop
    insert into public.group_members (group_id, user_id, left_at)
    values (v_group_id, v_member_id, null);
  end loop;

  return v_group_id;
end;
$$;
```
Wrapped automatically in a single transaction by Postgres function semantics — any RLS
rejection inside the loop raises an exception, rolling back the entire group creation
(no orphaned group-with-0-members state). `security invoker` (NOT `security definer`) is
mandatory — this must run as the calling user so RLS still applies, otherwise this function
would silently bypass friend-gating entirely (would be a security hole, not a convenience).
This is flagged as **a gap in scope for `/build`**, not yet written into 0007 — dev should
add it as 0008 (reversible: `drop function if exists public.create_group(text, uuid[]);`).

### 7. Trade-off decisions + assumptions (for dev/Checker to track)

1. Soft-delete (`left_at`) chosen over hard-delete for `group_members` — see mục 0. This is
   the single biggest schema deviation from a naive reading of the original ask ("group_id,
   user_id, joined_at — no role column") — `joined_at` is kept as specified, `left_at` is
   an ADDITION, not a replacement of anything asked for. Flag to Checker as an intentional,
   justified deviation, not scope creep.
2. `create_group` RPC (mục 6) is a recommended addition not yet in 0007 — dev must add it
   (0008) or explicitly choose + document the sequential-insert-without-transaction
   alternative with its accepted partial-failure risk before `/build` is considered done.
3. Cap-50 race (edge case 7b) has a small residual window not fully closed at DB level —
   accepted given realistic single-creator-serialized-UI-clicks usage, not closed via
   row-locking (over-engineering for MVP).
4. Ex-member retains SELECT on `group_conversations.name` and the **full** `group_members`
   list (including other ex-members) after leaving — only message-sending and cap-50
   counting are truly cut off. Accepted per mục 0 — flag to Checker as intentional.
5. `useGroupMembers` is ONE shared hook (count + full list + mutations) per design doc's
   Open Question #7 default — not split into a lightweight count-only hook. Means opening a
   `GroupThread` always also subscribes to full `group_members` Realtime, not just a count.
   Accepted for simplicity; revisit only if perf becomes a real issue (no evidence of that
   risk at "nhóm bạn nhỏ" scale, max 50 members).
6. No pagination, no rename, no avatar, no typing indicator, no read receipts — all
   confirmed OUT per THINK, migration and hook design carry no seams for these (consistent
   with "don't design for hypothetical future requirements" — except the explicitly-flagged
   product-risk note about `group_members` being reusable later for map-presence
   authorization, which the soft-delete shape does NOT block or help either way — neutral).


## BUILD (Maker)

### Files created

**Migration**
- `supabase/migrations/0008_group_chat_create_rpc.sql` (NEW) — closes the gap PLAN flagged
  in mục 6: `create_group(p_name text, p_member_ids uuid[]) returns uuid`, `security invoker`
  (NOT `security definer` — RLS/friend-gating/cap-50 trigger still apply inside the function,
  no privilege escalation), wraps `group_conversations` insert + creator's own
  `group_members` insert + N member inserts in one Postgres transaction (implicit function
  semantics — any RLS rejection raises an exception, rolling back the whole creation,
  all-or-nothing per testplan mục 3.2 U7). Reversible (`drop function if exists
  public.create_group(text, uuid[]);` in the rollback comment block). **NOT applied to any
  live Supabase instance** — same constraint as 0005/0006/0007, must be run manually in
  Supabase Studio SQL Editor before this feature works against a real backend.
- `supabase/migrations/0007_group_chat.sql` — verified against PLAN, NOT modified (matches
  exactly: soft-delete `left_at`, creator-to-each-member friend-gating RLS, cap-50 trigger,
  re-check-at-send-time RLS on `group_messages`, Realtime publication for all 3 tables).

**Types**
- `src/lib/types.ts` — added `GroupConversation`, `GroupMember`, `GroupMessage` (additive
  only, matches PLAN's exact shape).

**Hooks**
- `src/lib/use-group-conversations.ts` — `useGroupConversations(identity)`. Inbox load
  (active memberships → join group name/creator/member-count/last-message+sender), Realtime
  (INSERT on `group_members` own rows → refetch; INSERT on `group_messages` → in-place
  last-message update + re-sort, falls back to refetch if group not yet in local list —
  mirrors `useDmConversations` exactly), `createGroup(name, memberIds)` calling the
  `create_group` RPC with client-side validation BEFORE any network call (empty/whitespace
  name, name >100 chars, zero members, dedupes/excludes own id from memberIds since the RPC
  adds the creator itself).
- `src/lib/use-group-messages.ts` — `useGroupMessages(groupId, identity)`. **Uses the
  cancelled-flag race-safety pattern from the first commit** (`load(isCancelled: () =>
  boolean)`, checked after every `await`, effect wraps with a local `cancelled` closure
  flag) — ported directly from `use-dm-messages.ts` lines 99-184, not added as an
  afterthought. Loads last 100 messages + joins `senderUsername` per message (group needs
  this, unlike DM). Membership hint (`canSend`/`sendBlockedReason: "removed" | null`) checked
  once on load via `group_members` `(group_id, user_id=me)` `left_at`. Realtime subscribes
  to INSERT on `group_messages` (dedupe-by-id) AND UPDATE on `group_members` filtered to the
  viewer's own row — the latter gives **reactive** blocked-send detection (flips
  `canSend`/`sendBlockedReason` the instant the viewer is removed/leaves, without requiring
  a failed send first, per Interaction Notes section 5's explicit stronger-than-DM
  requirement). `send()` re-treats RLS denial as "removed" reactively, same fallback pattern
  as DM's "unfriended".
- `src/lib/use-group-members.ts` — `useGroupMembers(groupId, identity)`. ONE shared hook
  (PLAN/design doc decision) used by both `GroupThread` (pill count) and `GroupMemberList`
  (full list + mutations) — `{ members, isCreator, creatorId, addMembers, removeMember,
  leaveGroup }`. `addMembers()` tries `UPDATE ... SET left_at = null` first (re-join path for
  ex-members, since PK already exists) and falls back to `INSERT` only if 0 rows matched
  (brand-new member) — per PLAN's data-flow + testplan U29. `removeMember`/`leaveGroup` are
  soft-delete UPDATEs (`left_at = now()`), never hard DELETE. `isCreator` derived client-side
  as `creatorId === identity.userId` — UI-only hint, RLS is the real boundary.

**Components**
- `src/components/friend-multi-select.tsx` — `FriendMultiSelect`, pure controlled component
  (no internal state), used by both `CreateGroupForm` and the add-member picker. Accepts a
  minimal `{id, username}` shape (named `SelectableFriend` internally, not the full `Friend`
  type) since the add-member picker passes group-member-derived friend lists that don't
  carry `Friend.requestId`.
- `src/components/group-panel.tsx` — `GroupPanel` (top-level, no external props, unlike
  `DmPanel`) composing `GroupInbox`, `CreateGroupForm`, `GroupThread`, `GroupMemberList`
  (+ `AddMemberPicker` as a `GroupMemberList` sub-view) via internal `view` state
  (`"inbox" | "create" | "thread" | "members"`). Creator-only controls (`[Xóa]` per-member,
  `[+ Thêm thành viên]`) are **entirely absent from the DOM** for non-creators (not merely
  disabled), per design doc's explicit requirement — client hides, RLS is the real boundary
  (test U26/E15/E26 verify the RLS side separately at the hook level).

**Modified**
- `src/components/chat-tabs.tsx` — `ChatTab` extended to `"global" | "dm" | "group"`, third
  `<TabButton>` ("Nhóm") + third branch rendering `<GroupPanel />`. `GroupPanel` takes no
  props (no pending-open trigger needed, per design doc — all group navigation originates
  inside the tab itself).
- `src/app/page.tsx` — **no changes needed**. `ChatTabs` already owned `activeTab` state
  generically; widening the `ChatTab` union type was sufficient, no new wiring required at
  the page level (confirmed by reading the file — `GroupPanel` is fully self-contained).

**Tests (new, beyond the existing 29)**
- `src/lib/use-group-conversations.test.ts` — 7 tests: `createGroup` happy path (RPC called
  with trimmed name + deduped member ids), empty/whitespace name rejected client-side, zero
  members rejected client-side (THINK #11), name >100 chars rejected client-side, RPC
  rejection mapped to a clean Vietnamese error (not raw Postgres message), creator id
  excluded from `p_member_ids`, `identity=null` safety.
- `src/lib/use-group-messages.test.ts` — 8 tests: send() no-op on empty/whitespace, trims
  body, membership-hint on mount (both blocked and allowed cases), RLS-rejection flips
  `sendBlockedReason` reactively, `groupId=null` safety, per-message `senderUsername` join,
  **and the cancelled-flag race-safety regression test** (X→Y groupId switch before X's
  slow `load()` resolves — directly ported from `use-dm-messages.test.ts`'s equivalent test,
  confirms the pattern works from day one as PLAN required).
- `src/lib/use-group-members.test.ts` — 10 tests: active-only member load + per-row
  `isCreator`, viewer-level `isCreator` flag derivation, `addMembers` update-then-insert
  fallback (re-join vs brand-new), `addMembers` DB-rejection mapping, `removeMember` success
  + RLS-rejection (non-creator), `leaveGroup` success for regular member and for creator
  (THINK #9 — no special-case block), null-safety.

Total: **54/54 tests pass** (29 pre-existing + 25 new). `npm run build` and `npm run lint`
both pass with zero errors/warnings.

### Assumptions made (for Checker to verify)

1. **`create_group` RPC return type**: assumed `supabase.rpc("create_group", {...})` returns
   `{ data: uuid-as-string, error }` directly (Postgres `returns uuid` maps to a JS string).
   Not verified against a live Supabase instance (migration not applied) — Checker/QA should
   confirm the actual RPC response shape once 0008 is applied for real.
2. **`addMembers` re-join detection via UPDATE-then-INSERT-fallback**: chose to always
   attempt `UPDATE ... WHERE group_id=X AND user_id=Y` first and only `INSERT` if 0 rows
   matched, rather than doing a separate `SELECT` to check existence first. This is 1 fewer
   round-trip than a check-then-act pattern, but means a brand-new member always incurs one
   wasted UPDATE call before the INSERT. Accepted as a minor inefficiency, not a correctness
   issue (RLS gates both UPDATE and INSERT identically per migration 0007).
3. **`useGroupMembers`'s `isCreator` is computed from the `identity` prop directly** (not
   from a ref) — re-renders correctly if `identity` changes, unlike a ref-based read which
   would be stale until the next effect run. This was a deliberate deviation from blindly
   copying the `identityRef.current` pattern used elsewhere in the hook for async callbacks
   (refs are needed there to avoid stale closures inside `useCallback`, but `isCreator` is a
   plain derived render-time value, so reading the prop directly is more correct here).
4. **`GroupConversationRow` (inbox row) last-message sender lookup**: when the last message
   in a group is NOT mine, the hook does a per-group extra `profiles` query to resolve
   `lastMessageSenderUsername`. This is N+2 queries per group in the inbox load (member
   count + last message + sender lookup) — consistent with the already-accepted N+1 pattern
   in `useDmConversations`/`useFriends`, just one query deeper because group inbox previews
   need a sender name (DM didn't). Not optimized into a single join — acceptable at "nhóm
   bạn nhỏ" scale per PLAN's stated risk tolerance.
5. **No e2e Playwright tests written** (`e2e/group-chat.spec.ts` from testplan mục 2, E1-E16)
   — out of scope for Maker/build phase per the task instructions (unit tests only, build
   verified via `npm run build/lint/test`). **This is the single biggest open item**: the
   testplan's E6 ("Non-member cannot read via Realtime payload") is explicitly flagged
   across ANALYZE/THINK/PLAN as the **highest-priority unverified risk** for this entire
   feature (Realtime `postgres_changes` honoring connection-role RLS, now with N-way fanout
   instead of DM's fixed 2) — this remains completely unverified by this build phase and
   MUST be run against a real Supabase instance with 2+ accounts before this feature ships.
6. **Migration NOT applied to any live/shared Supabase instance** — per task constraints,
   neither 0007 (pre-existing, written by architect) nor 0008 (new, written this session)
   were run against Studio. Both must be applied manually (Supabase Studio SQL Editor, in
   order: 0007 then 0008) before any QA/E2E pass against a real backend can begin. 0007 also
   depends on 0005 (`friend_requests`) already having been applied — same dependency chain
   risk flagged 3x in STATE/PLAN, repeated here for the 4th time intentionally.
7. **`FriendMultiSelect`'s prop type widened to a minimal `{id, username}` shape** (not the
   full `Friend` type with `requestId`) — this was a necessary fix during build (TypeScript
   build failure) because the add-member picker in `GroupMemberList` constructs friend-like
   objects from `members`/`friends` data that doesn't always carry a `requestId`. This is a
   compatible widening (every `Friend` still satisfies the narrower shape), not a breaking
   change to the design doc's contract.
8. **`GroupThread` subscribes to `useGroupMembers` purely for `members.length`** (the pill
   count) and does not use `isCreator` from that call — per PLAN's explicit "one shared
   hook" decision, this means opening a thread always also opens a full membership Realtime
   subscription even though only the count is displayed there. This was called out as an
   accepted tradeoff in PLAN's mục 7 point 5, not introduced as a new deviation.

### Post-review fixes (after code-reviewer PASS-with-nit + architect NEEDS-WORK)

Three fixes applied in this follow-up build session, addressing 2 architect NEEDS-WORK
items + 1 code-reviewer 🟡 nit. `npm run build`, `npm run lint`, `npm run test` all re-run
and pass (55/55 tests — 54 pre-existing + 1 new regression test for fix 3).

1. **Architect NEEDS-WORK #1 — unbounded ex-member visibility into `group_members`.**
   `supabase/migrations/0009_group_members_visibility_fix.sql` (NEW, additive — does NOT
   edit 0007 directly, per codebase's additive-migration pattern 0005→0006→0007→0008).
   Drops and recreates only the `group_members_select_ever_member` SELECT policy:
   - Old (0007): viewer with ANY row in a group (active or left, no time-bound) sees ALL
     rows of that group forever, including members who joined AFTER the viewer left — an
     ever-growing live view, broader than PLAN's intended "snapshot at departure."
   - New (0009): viewer always sees their OWN row. For OTHER members' rows: visible if the
     viewer is currently active (`left_at is null`, unchanged behavior — sees everyone
     current), OR if the viewer has left (`left_at is not null`) AND that member's
     `joined_at <= viewer's own left_at` (member was present while viewer was still there).
     This makes ex-member visibility a bounded snapshot-at-departure instead of a live feed.
   - Reversible: rollback block at the bottom of 0009 restores the exact original 0007
     policy text.
   - `docs/loops/group-chat-testplan.md` updated: new test case **E17** (ex-member cannot
     see members who joined after they left, via direct REST call bypassing UI) and
     Trade-off #3 note updated to describe the corrected bounded-snapshot behavior.
   - **NOT applied to any live Supabase instance** — same constraint as 0007/0008, must be
     run manually (Supabase Studio SQL Editor) AFTER 0008, before this fix takes effect
     against a real backend.

2. **Architect NEEDS-WORK #2 — undocumented cross-migration dependency in 0008.**
   `supabase/migrations/0008_group_chat_create_rpc.sql` — added an explicit comment
   immediately above the member-insertion `foreach` loop inside `create_group()`,
   stating plainly that the 50-member cap is enforced ENTIRELY by the
   `group_members_cap_before_write` trigger defined in 0007 (fires BEFORE INSERT on every
   row inserted inside this function's loop, within the same implicit transaction) — the
   RPC itself contains zero cap-checking logic. Comment also flags that if 0007's trigger is
   ever changed/removed without updating this function, the cap silently stops being
   enforced on the create-group path. No SQL behavior changed — comment-only fix.

3. **Code-reviewer 🟡 nit — `addMembers()` silently no-ops on duplicate-add of an already-
   active member.** `src/lib/use-group-members.ts`:
   - Added a `membersRef` (mirrors the existing `groupIdRef`/`identityRef` ref pattern in
     this same hook, used to avoid a stale closure inside the `useCallback`) that tracks the
     latest `members` state.
   - `addMembers()` now checks, BEFORE attempting any UPDATE/INSERT, whether any requested
     `userId` is already present in the currently-loaded active `members` list. If so,
     returns `{ error: "đã là thành viên" }` immediately — no DB call made at all — instead
     of proceeding into the UPDATE-then-insert-fallback path, which previously "succeeded"
     as a no-op (UPDATE `left_at: null` on a row that already has `left_at: null` still
     reports 1 row matched) and returned `error: null` as if a genuine add had happened.
   - Not reachable via the current UI (`AddMemberPicker` pre-filters existing members out of
     the selectable list), but this closes the gap at the hook/API layer per edge case #4 /
     AC5, consistent with what duplicate-add is supposed to surface.
   - New regression test added: `src/lib/use-group-members.test.ts` — "addMembers(): target
     already an active member -> clear error, no UPDATE/INSERT attempted" (loads 2 active
     members, attempts to add one of them again, asserts the new error string and that
     neither `updateSpy` nor `insertSpy` were called). `docs/loops/group-chat-testplan.md`
     updated with new case **U29b**.

### Deferred / not done in this build phase

- **E2E Playwright suite** (`e2e/group-chat.spec.ts`) — not written; see assumption #5.
- **Migrations not applied to Supabase Studio** — per task constraint (Maker must not run
  migrations against live instance); see assumption #6.
- **No manual QA / no 2+ real-account Realtime RLS verification** — the single most
  important unresolved risk for this feature (E6), inherited and unresolved 4 times now
  across ANALYZE → THINK → PLAN → BUILD. Whoever runs `/qa` next MUST treat this as the
  top-priority gate, not a formality.
- Everything explicitly OUT of scope per THINK/design doc (rename, avatar, typing
  indicator, read receipts, pagination, multi-admin) — not built, consistent with locked
  scope, no seams added for any of these.

## Phase

| Bước | Trạng thái |
|------|-----------|
| ANALYZE (BA) | ✅ Done — 2026-06-25 |
| THINK (office-hours) | ✅ Done — 2026-06-25 (câu #1 và #8 do user xác nhận trực tiếp; còn lại auto-decided theo pattern nhất quán friends/DM-chat) |
| DESIGN (designer) | ✅ Done — 2026-06-25 |
| plan (architect) | ✅ Done — 2026-06-25 |
| build (Maker) | ✅ Done — 2026-06-25 (npm run build/lint/test pass, 54/54 tests; migration 0008 added for `create_group` RPC; migrations NOT applied to live Supabase — manual apply required before QA) |
| review (Checker) | ✅ Done — code-reviewer PASS (1 🟡 nit), architect NEEDS-WORK (2 items) |
| build — post-review fixes (Maker) | ✅ Done — 2026-06-25 (3 fixes: migration 0009 tightens `group_members` ex-member visibility, comment added to 0008 documenting cross-migration cap-50 dependency on 0007's trigger, `addMembers()` duplicate-active-member error fixed in `use-group-members.ts`; npm run build/lint/test pass, 55/55 tests — see "Post-review fixes" section above) |
| review (Checker) — re-verify fixes | ⬜ |
| qa | 🟡 PARTIAL PASS — 2026-06-25 (static checks only: build/lint/test/dev all pass, migrations 0007-0009 statically re-verified, 3 post-review fixes confirmed in code; live DB verification BLOCKED — migrations 0005-0009 not applied. See "## QA" section above.) |
| ship | ⬜ |

**Next action**: re-run `/review` (Checker — independent) to verify the 3 post-review fixes
above, specifically: (a) migration 0009's policy logic against E17 in testplan, (b) the 0008
comment is accurate and doesn't change runtime behavior, (c) the new `use-group-members.ts`
duplicate-active-member check + its regression test. Then proceed to `/qa`, which still must
close the previously-flagged top-priority gate: real 2+-account Realtime RLS verification
(testplan E6), unresolved since BUILD. Migrations 0007, 0008, AND 0009 must all be applied
manually (Supabase Studio SQL Editor, in that order) before any QA/E2E pass against a real
backend.

## QA

> Run date: 2026-06-25. Scope: static-only verification (no live Supabase access — migrations
> 0005-0009 NOT applied to any shared/live instance, per task constraint: Claude never applies
> migrations directly, user runs them manually in Supabase Studio). Acceptance standard:
> `docs/loops/group-chat-testplan.md`.

### 1. `npm run build` — PASS

Next.js 16.2.9 (Turbopack) production build compiles successfully, TypeScript check passes,
all routes generate (`/`, `/_not-found`, `/auth/callback`). Zero errors.

### 2. `npm run lint` — PASS

ESLint runs clean, zero warnings/errors.

### 3. `npm run test` — PASS, 55/55

```
Test Files  7 passed (7)
     Tests  55 passed (55)
```
Matches expected count (29 pre-existing DM/friends/global tests + 25 group-chat unit tests +
1 post-review regression test for the `addMembers()` duplicate-active-member fix = 55).

### 4. `npm run dev` — root route 200, confirmed

Started a background `next dev` instance; it detected an already-running dev server on port
3000 (pre-existing from an earlier session, PID 22571) and exited cleanly via Next.js's own
single-instance lock rather than conflicting. Verified directly against the already-running
server: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → **200**. Response
body confirmed real app HTML with `<title>GeoChat</title>`, not an error page. No duplicate
dev process left running as a side effect of this QA pass.

### 5. Migration static re-verification — 0007, 0008, 0009 — PASS, no syntax/logic errors found

Read all three files in full this session.

- **0007_group_chat.sql**: schema (`group_conversations`, `group_members` soft-delete via
  `left_at`, `group_messages`), cap-50 trigger (`group_members_enforce_cap`, BEFORE INSERT OR
  UPDATE, skips rows where `new.left_at is not null`), all 6 RLS policies (2 per table), and
  Realtime publication adds for all 3 tables (each guarded by `pg_publication_tables` existence
  check — idempotent/rerunnable). Rollback block present, correctly ordered in reverse
  (publication drops → policy drops → trigger/function drop → table drops, `group_conversations`
  drop last with an explicit "cần duyệt tay" callout). No syntax issues found; `with check`
  clauses on `group_members` INSERT/UPDATE correctly encode creator-to-each-member friend-gating
  (THINK #1) without requiring member-to-member friendship.
- **0008_group_chat_create_rpc.sql**: `create_group(p_name text, p_member_ids uuid[])`,
  `security invoker` (correctly NOT `security definer` — confirmed by reading the function body;
  using `definer` here would have been a real privilege-escalation bug, it is not present).
  Implicit single-transaction semantics via plpgsql function correctly deliver the all-or-nothing
  behavior testplan U7 requires. The cap-50 cross-reference comment (lines 38-49) is present,
  accurate, and comment-only (no SQL behavior change) — confirms verification item #6 below.
  Guards against `v_member_id = auth.uid()` collision before insert (defends the loop against a
  caller accidentally including the creator's own id in `p_member_ids`, which would otherwise
  violate the `(group_id, user_id)` primary key from 0007). Rollback (`drop function`) present
  and correctly scoped (does not touch existing group/member data).
- **0009_group_members_visibility_fix.sql**: drops and recreates ONLY the
  `group_members_select_ever_member` SELECT policy on `group_members`. New policy logic
  verified line-by-line against testplan E17: self-row always visible; for other rows, visible
  if viewer is currently active (`left_at is null`, unchanged from 0007) OR viewer has left AND
  `group_members.joined_at <= self.left_at` (bounded snapshot-at-departure, blocks visibility
  into members who joined after the viewer's own departure). Logic is correct and matches the
  testplan's stated intent exactly — no off-by-one or boundary error spotted (`<=` correctly
  includes a member who joined at the exact same instant the viewer left, which is the
  conservative/inclusive choice, consistent with "present while viewer was still around").

**Migration ORDER dependency (explicitly checked per task instructions)**: 0009's `drop policy
if exists "group_members_select_ever_member" on public.group_members;` targets the exact
policy name first created in 0007. Diffed 0007's original policy SQL (lines 176-184) against
0009's rollback-restoration block (lines 52-60) character-for-character —
**byte-for-byte identical**, including the `create policy` statement and its `using` clause.
This confirms running 0009's rollback after the fact correctly and exactly restores 0007's
original (unbounded) behavior, with no drift introduced by hand-copying the SQL into the
rollback comment block. Practically: 0009 is technically idempotent even if mistakenly run
before 0007 in a fresh database (the `drop policy if exists` would no-op, then `create policy`
would simply define it fresh) — but it is NOT meaningful as "the fix" unless it runs after
0007's original (unbounded) policy has actually been created and would otherwise persist;
confirmed the task's stated required order (0007 → 0008 → 0009) is the documented and only
intended sequence in all three files' header comments. No bugs found in the dependency
handling.

### 6. Post-review fixes — all 3 confirmed present in code

1. **Migration 0009 — bounded ex-member visibility**: confirmed above (section 5). Matches
   architect NEEDS-WORK #1 and testplan E17 exactly.
2. **0008's cap-50 cross-reference comment**: confirmed present at lines 38-49 of
   `supabase/migrations/0008_group_chat_create_rpc.sql`, accurate, comment-only.
3. **`src/lib/use-group-members.ts` — `addMembers()` duplicate-active-member check**: confirmed
   `membersRef` (mirrors existing `groupIdRef`/`identityRef` pattern, lines 82-85) and the
   early-return check (lines 228-237) that returns `{ error: "đã là thành viên" }` before any
   UPDATE/INSERT call if any requested `userId` is already in the active `members` list.
   Regression test confirmed present: `src/lib/use-group-members.test.ts` line 178,
   `"addMembers(): target already an active member -> clear error, no UPDATE/INSERT attempted"`,
   asserts the exact error string at line 204.

### What CANNOT be verified without a live DB (explicitly blocked)

None of the following can be exercised right now — migrations 0005 (`friend_requests`), 0006
(`conversations`/`dm_messages`), 0007, 0008, 0009 have NOT been applied to any live/shared
Supabase instance:

- **RLS enforcement** for all 3 group tables (testplan E5, E10, E15) — policies read correctly
  in isolation but have never executed against real Postgres with real `auth.uid()` values.
- **Friend-gating re-check** at group_members INSERT/UPDATE time (E14, E26) — the
  creator-to-each-member-only model (not member-to-member) is untested against a real
  `friend_requests` table.
- **50-member cap enforcement + the documented cap-race residual risk** (E13, edge case 7b) —
  the trigger's `COUNT(*)` behavior under real concurrent transactions has never been observed.
- **Soft-delete history visibility** (E8, E11, E17) — specifically E17, the exact scenario
  migration 0009 was written to fix (ex-member cannot see members who joined after they left),
  has NEVER been run against a real DB. Static SQL review (section 5) is the strongest evidence
  available right now but is not a substitute for execution.
- **Realtime cross-account delivery for groups up to 50 members** (E4, E6) — E6 in particular
  ("non-member receives zero Realtime payloads") is the single highest-priority unverified risk
  for this entire feature, flagged repeatedly across ANALYZE → THINK → PLAN → BUILD, and remains
  completely unexercised. Group fanout (N members) makes any leak worse than DM's fixed 2.
- E2E Playwright suite (`e2e/group-chat.spec.ts`, testplan section 2, E1-E17) does not exist yet
  (confirmed not written in BUILD phase) — these scenarios have no automated coverage at all,
  live or otherwise, beyond this manual static read-through.

### Overall QA status

**PARTIAL PASS — static checks pass; live DB verification (RLS, friend-gating, 50-member cap,
soft-delete visibility, Realtime cross-account delivery for groups) BLOCKED pending user
running migrations 0005 through 0009 IN ORDER in Supabase Studio. Multi-account manual QA
required before considered fully shipped — this is now the 3rd feature stacked on the
unverified Realtime-RLS assumption, flag this explicitly as escalating risk.**

The escalating-risk framing is deliberate and quantified: `friend_requests` (0005) shipped with
this risk unverified → `dm_messages` (0006) shipped on top of it, still unverified, with a
2-account leak surface → `group_*` tables (0007-0009) now ship a 3rd layer on top, with an
N-account (up to 50) leak surface that is structurally worse than either prior feature if the
underlying assumption ("Realtime `postgres_changes` honors connection-role RLS") turns out to
be false. No new evidence either confirming or refuting that assumption was producible in this
QA pass — it remains exactly as unverified as it was at BUILD time. **This must be the next
real action taken (E6 against 2+ real Supabase accounts) before this feature, or any future
feature building further on `group_members`, is treated as shipped.**
