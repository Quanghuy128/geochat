# STATE — Feature: Message Reactions + Replies (cross-cutting on top of 3 message tables)

> Phase hiện tại: **ANALYZE — Done** (BA). Tiếp theo: `/office-hours` (THINK) để chốt các Open
> Questions dưới — đặc biệt câu #1 (scope: bao nhiêu loại chat?) và câu #4 (schema unification —
> đây là lần thứ 3 câu hỏi unification được đặt ra, sau khi đã bị defer 2 lần ở dm-chat-STATE.md
> và group-chat-STATE.md) — TRƯỚC khi `/plan`.

## ANALYZE

### Core user need

GeoChat hiện có **BA hệ thống tin nhắn hoàn toàn tách biệt**, mỗi hệ có bảng + RLS + hook +
Realtime channel riêng:

| Loại chat | Bảng tin nhắn | Bảng quan hệ/membership | RLS mở cho `anon`? | Hook |
|---|---|---|---|---|
| Global | `messages` (0001) | không có (mọi authenticated/anon đều là "thành viên") | **Có** (anon đọc/viết) | `useMessages` |
| DM 1-1 | `dm_messages` (0006) | `conversations` (2 cột `user_a_id`/`user_b_id`, friend-gated) | Không | `useDmMessages` |
| Group | `group_messages` (0007) | `group_members` (soft-delete `left_at`, friend-gated creator-to-member) | Không | `useGroupMessages` |

Người dùng hiện chỉ phản hồi 1 tin nhắn bằng cách gửi 1 tin MỚI ("@reply ý bạn nói gì") — không
có cách nào bày tỏ phản ứng nhanh (emoji) hay liên kết rõ ràng "tin này là trả lời cho tin nào"
trong CẢ BA loại chat. Đây là khoảng trống UX tiêu chuẩn của mọi app chat hiện đại (Messenger,
Zalo, Slack, Discord đều có reaction + reply-quote).

**Vấn đề cốt lõi không phải sản phẩm (reaction/reply là 2 tính năng UX đã quá quen thuộc) mà là
KIẾN TRÚC**: vì có 3 bảng tin nhắn độc lập, "thêm reaction" và "thêm reply" cho TẤT CẢ 3 loại chat
đồng nghĩa nhân 3 lần: 3 bảng `*_reactions`, 3 bộ RLS policy, có thể 3 hook riêng
(`use-message-reactions.ts` × 3 biến thể hoặc 1 hook tham số hóa theo bảng). Đây CHÍNH XÁC là câu
hỏi unification đã được nêu ra ở `dm-chat-STATE.md` (PLAN mục 0, do architect chủ động flag) và
lại được nêu ra lần 2 ở `group-chat-STATE.md` (THINK #8, user xác nhận trực tiếp "giữ tách bảng
riêng") — **đây là lần thứ 3**, và lần này áp lực hợp nhất nặng hơn vì không chỉ là tin nhắn nữa,
mà là 1 tính năng PHỤ phải gắn vào CẢ BA bảng cùng lúc.

**Rủi ro nền chưa được giải quyết, kế thừa nguyên vẹn cả 3 lần trước**: giả định
*"Supabase Realtime `postgres_changes` áp RLS theo role kết nối"* CHƯA được verify thật bằng 2+
tài khoản thật ở bất kỳ feature nào trước đó (friends → dm-chat → group-chat, mỗi lần đều ghi
"PARTIAL PASS — live DB verification BLOCKED"). Reactions/replies sẽ thêm ÍT NHẤT 1 bảng mới (reaction
counts hiển thị realtime) lên trên rủi ro này — đây là feature thứ 4 stack trên một giả định nền
tảng chưa từng được chứng minh đúng bằng thực nghiệm.

### User story

> Là một user đang chat (ở global, DM, hoặc group — tuỳ Open Question #1), tôi muốn bày tỏ phản
> ứng nhanh (emoji) lên một tin nhắn cụ thể mà không cần gửi tin mới, thấy ai đã react gì lên tin
> đó, gỡ phản ứng của chính tôi nếu đổi ý, và khi trả lời một tin nhắn cụ thể, tin trả lời của tôi
> hiển thị rõ kèm trích dẫn/tham chiếu tới đúng tin gốc — để cuộc trò chuyện dễ theo dõi hơn khi
> có nhiều tin nhắn chen ngang.

### Phạm vi (đề xuất — CẦN user chốt ở office-hours, đây là feature có nhiều taste-question
### hơn bất kỳ feature trước đó vì áp dụng lên 3 hệ thống đã tồn tại sẵn)

**IN (đề xuất, giả định scope đầy đủ cả 3 loại chat — xem Open Question #1 nếu cần giảm phạm vi):**
- React 1 emoji lên 1 tin nhắn cụ thể (global, DM, hoặc group — tuỳ scope chốt).
- Gỡ phản ứng của chính mình khỏi 1 tin nhắn.
- Xem tổng số lượng + (tối thiểu) ai đã react bằng emoji nào trên 1 tin nhắn — hiển thị
  count/aggregate, hover/tap để xem danh sách người react (chi tiết UI là việc designer).
- Cập nhật reaction count realtime khi người khác react/gỡ react (cùng pattern Realtime hiện có).
- Reply 1 tin nhắn cụ thể: tạo 1 tin nhắn mới có tham chiếu rõ ràng tới `reply_to_message_id` —
  hiển thị trích dẫn ngắn (preview) của tin gốc ngay trên tin trả lời.
- Click vào trích dẫn tin gốc trong 1 tin reply → nhảy/scroll tới đúng tin gốc trong lịch sử (nếu
  còn trong khung đã load — không bắt buộc load thêm lịch sử để tìm).
- Validate: chỉ react/reply được lên tin nhắn nằm trong đúng conversation/group mình là
  thành viên hiện tại — re-check membership tại THỜI ĐIỂM react/reply, không phải tại thời điểm
  tin gốc được gửi (nhất quán nguyên tắc đã lặp lại 2 lần ở DM-chat và group-chat: "rời/unfriend →
  mất quyền tương tác mới NGAY", không có ân hạn).

**OUT (đề xuất, cần user xác nhận):**
- Reaction bằng text tự do/sticker/GIF — chỉ emoji (xem Open Question #2 — emoji set nào).
- Nested/threaded replies nhiều cấp (reply-tới-reply tạo nhánh con) — chỉ 1 cấp "reply tới 1 tin
  gốc", không tạo cây thread lồng nhau kiểu Slack threads (xem Open Question #5).
- Sửa/xóa reaction của NGƯỜI KHÁC (chỉ tự gỡ reaction của chính mình).
- Reply tới tin nhắn đã bị xóa — KHÔNG áp dụng vì hiện chưa có tính năng xóa tin nhắn ở bất kỳ
  bảng nào (xác nhận: không có UPDATE/DELETE policy trên `messages`/`dm_messages`/`group_messages`
  — mọi tin nhắn bất biến sau khi gửi) — edge case này coi như MOOT cho tới khi có delete feature.
- Notification riêng cho reaction/reply (ngoài realtime in-app hiện có).
- Reaction analytics/most-used-emoji nào đó.
- Giới hạn số reaction/tin nhắn theo rate-limit chống spam — nhất quán quyết định "không
  rate-limit" đã chọn ở các feature trước, trừ khi user muốn đổi ở đây.

### Functional requirements

1. **React lên 1 tin nhắn**
   - Input: `message_id` (thuộc 1 trong 3 bảng tuỳ scope) + 1 emoji.
   - Tạo đúng 1 row reaction cho cặp (message, user, emoji) — không tạo trùng nếu user react
     lại đúng emoji đó (xem edge case "duplicate reaction").
   - Chỉ user đang là thành viên HIỆN TẠI của conversation/group chứa tin nhắn đó mới react được.

2. **Gỡ phản ứng của chính mình**
   - User gỡ reaction (message_id, emoji) của CHÍNH HỌ — không gỡ được reaction của người khác.
   - Gỡ reaction không tồn tại → no-op rõ ràng (không lỗi cứng — xem edge case).

3. **Xem reaction counts/ai đã react**
   - Mỗi tin nhắn hiển thị tổng hợp reaction (emoji → count, và/hoặc emoji → danh sách
     username đã react — UI chi tiết để designer, nhưng data cần trả về đủ để hiển thị cả 2 mức).
   - Cập nhật realtime: user khác react/gỡ trên tin đang xem → count cập nhật không cần reload,
     đo được trong khung thời gian tương tự pattern hiện có (≤2 giây).

4. **Reply tới 1 tin nhắn cụ thể**
   - Khi soạn tin mới, user chọn 1 tin nhắn hiện có làm "reply to" → tin mới được lưu kèm tham
     chiếu rõ ràng (`reply_to_message_id` hoặc tương đương) tới đúng tin gốc đó.
   - Tin trả lời hiển thị kèm 1 trích dẫn ngắn (preview nội dung + tên người gửi) của tin gốc.
   - Người xem tin reply biết NGAY (không cần thao tác thêm) tin này là phản hồi của tin nào.

5. **Ràng buộc tham chiếu reply không vượt biên giới conversation/group**
   - Reply CHỈ được tham chiếu tới 1 tin nhắn nằm trong CÙNG conversation/group với tin reply mới
     — không thể tạo 1 tin trong group X mà `reply_to_message_id` trỏ tới 1 tin nhắn của DM Y hay
     global chat. Đây là ràng buộc TOÀN VẸN DỮ LIỆU bắt buộc, không phải edge case phụ.

### Key edge cases bắt buộc xử lý

| # | Case | Hành vi mong đợi / cần làm rõ |
|---|------|-------------------------------|
| 1 | React lên 1 tin nhắn trong conversation/group mình KHÔNG còn là thành viên (đã unfriend/đã rời/bị xóa) | **Chặn, giống pattern gửi tin mới** — RLS re-check membership HIỆN TẠI tại thời điểm react, không phải tại thời điểm tin gốc được gửi hay tại thời điểm mình từng là member. Nhất quán nguyên tắc đã lặp lại ở `dm_messages`/`group_messages` INSERT policy. |
| 2 | Reply tới 1 tin nhắn trong conversation/group mình không còn là thành viên | Cùng enforcement với #1 — reply về bản chất là 1 INSERT tin nhắn mới, RLS INSERT hiện có đã chặn non-member; chỉ cần đảm bảo `reply_to_message_id` cũng được validate (xem case #5 dưới), không phải lỗ hổng mới. |
| 3 | Duplicate reaction: user react đúng 1 emoji lên đúng 1 tin nhắn 2 lần | Lần 2 phải là no-op hoặc lỗi rõ "đã react rồi" — KHÔNG tạo 2 row. Cần ràng buộc unique (message_id, user_id, emoji) ở DB level. **Câu hỏi taste**: user có được có NHIỀU emoji khác nhau trên CÙNG 1 tin nhắn (ví dụ vừa 👍 vừa ❤️) hay chỉ 1 emoji/tin nhắn (giống Messenger - đổi reaction cũ)? Xem Open Question #3. |
| 4 | Gỡ 1 reaction không tồn tại (user chưa từng react, hoặc đã gỡ rồi, bấm gỡ lần 2) | No-op rõ ràng, không lỗi cứng (giống pattern "update match 0 row → coi là không có gì để làm", đã dùng ở friends-STATE.md cho cancel/unfriend không hợp lệ). |
| 5 | Reply tới tin nhắn đã bị xóa | **MOOT** — hiện KHÔNG có tính năng xóa tin nhắn ở bất kỳ bảng nào trong 3 hệ thống (xác nhận: không UPDATE/DELETE policy nào trên `messages`/`dm_messages`/`group_messages`). Không cần xử lý ngay; nếu sau này có delete feature, đây sẽ thành 1 edge case thật (reply trỏ tới tin đã xóa — hiển thị "tin nhắn đã bị xóa" hay ẩn cả reply?) — ghi chú cho roadmap, không phải requirement của feature này. |
| 6 | Reply XUYÊN BIÊN GIỚI conversation/group — ví dụ tạo 1 tin trong group A có `reply_to_message_id` trỏ tới 1 message_id thuộc DM B (của chính người gửi, hợp lệ ở DM B) | **PHẢI là KHÔNG THỂ**, không chỉ "không nên". Vì 3 bảng tin nhắn riêng biệt (`messages`/`dm_messages`/`group_messages`), về kỹ thuật bản thân `message_id` của 1 bảng đã không tồn tại trong bảng khác — nhưng nếu reactions/replies dùng 1 bảng `reply_to_message_id uuid` chung KHÔNG có FK ràng buộc theo từng loại bảng cụ thể, có nguy cơ lưu được 1 UUID "trông hợp lệ" nhưng trỏ sai bảng (không FK-checked nếu thiết kế sai) — đây là rủi ro THIẾT KẾ trực tiếp từ việc có 3 bảng tin nhắn, KHÔNG phải edge case sản phẩm thông thường. Phải được architect giải quyết ở mức schema (FK đúng theo từng loại + CHECK group_id/conversation_id của reply phải khớp tin gốc), BA chỉ đảm bảo case này được nêu rõ và test được. |
| 7 | Emoji input không hợp lệ: chuỗi rất dài, không phải emoji thật (text thường, ví dụ gõ "lol"), hoặc emoji + text lẫn nhau | Cần validate ở tầng nào (client/DB) — phụ thuộc trực tiếp Open Question #2 (emoji set cố định hay tự do). Nếu tự do: tối thiểu cần giới hạn độ dài chuỗi (DB CHECK, ví dụ ≤ 8 ký tự, đủ cho emoji ghép/skin-tone modifier) để chặn spam text dài giả làm "reaction". Nếu emoji set cố định: validate input nằm trong whitelist, không cần CHECK độ dài phức tạp. |
| 8 | Race: 2 user react gần như đồng thời lên cùng 1 tin nhắn (không phải race trùng cặp — đây là 2 user KHÁC nhau) | Không có vấn đề — unique constraint là theo (message_id, user_id, emoji), 2 user khác nhau tạo 2 row độc lập hợp lệ, không xung đột. Chỉ case "cùng 1 user, react đúng emoji 2 lần gần như đồng thời" (network double-click) mới cần unique constraint chặn (đã nêu ở case #3). |
| 9 | Reaction/reply trên tin nhắn `messages` (global) — bảng này hiện mở cho `anon` | Nếu Open Question #1 chốt CÓ áp dụng cho global chat: reaction/reply từ `anon` có cho phép không, hay bắt buộc `authenticated`? Đây là quyết định privacy/spam khác hẳn DM/group (vốn đã đóng hoàn toàn cho anon) — KHÔNG suy luận tự động theo RLS hiện tại của `messages`, cần hỏi rõ. |
| 10 | User C (không phải thành viên) cố đọc reaction/reply data của 1 conversation/group qua REST trực tiếp | RLS phải chặn tương tự pattern đã áp dụng cho `dm_messages`/`group_messages` SELECT — 0 row cho non-member. |
| 11 | Reply chain rất dài bị xóa gốc dây chuyền (N/A do case #5 moot, nhưng liên quan): nếu sau này có xóa tin, 1 tin bị xóa có N tin khác đang reply tới nó | Ghi chú roadmap tương tự case #5 — không phải requirement bây giờ. |

### Acceptance criteria (đo được)

> Giả định scope đầy đủ cả 3 loại chat ở các tiêu chí dưới — nếu Open Question #1 thu hẹp scope,
> các tiêu chí áp dụng tương ứng cho đúng (các) loại chat được chốt, không áp dụng cho loại bị loại.

1. User A react emoji 👍 lên 1 tin nhắn trong conversation/group mà A là thành viên hiện tại →
   tạo đúng 1 row reaction; mọi thành viên hiện tại khác thấy count/emoji đó xuất hiện trên tin
   nhắn đó trong vòng 2 giây mà không cần reload (đo qua test 2-tab thật, theo đúng pattern QA của
   `friends`/`dm-chat`/`group-chat`).
2. User A react lại đúng emoji 👍 lên đúng tin nhắn đó lần 2 → không tạo row thứ 2 (DB unique
   constraint chặn hoặc app-level no-op rõ ràng — tuỳ quyết định kỹ thuật, nhưng kết quả cuối
   PHẢI là tối đa 1 row cho (message_id, user_id, emoji)).
3. User A gỡ reaction 👍 của chính mình → row reaction bị xoá/đánh dấu (tuỳ thiết kế); count cập
   nhật ngay cho mọi người xem; gỡ lần 2 (đã gỡ rồi) → no-op, không lỗi cứng cho người dùng.
4. User C (không phải thành viên của conversation/group chứa tin nhắn) cố react/reply qua REST
   trực tiếp → bị chặn (RLS reject hoặc 0 row), verify bằng test RLS qua REST giống cách
   `dm-chat-STATE.md`/`group-chat-STATE.md` đã làm.
5. User A đã unfriend/đã rời conversation/group → A không react/reply được tin MỚI trong đó nữa
   (RLS re-check membership hiện tại tại thời điểm react/reply, không chỉ lúc tin gốc tồn tại).
6. User A reply tới 1 tin nhắn cụ thể trong group/DM X → tin reply mới có `reply_to_message_id`
   trỏ ĐÚNG tin gốc đó VÀ tin gốc đó PHẢI thuộc cùng group/DM X — không thể tạo (qua REST trực
   tiếp, bypass UI) 1 tin reply trong X có `reply_to_message_id` trỏ tới 1 tin nhắn thuộc
   conversation/group Y khác (test trực tiếp case #6 trong bảng edge case).
7. Tất cả thành viên hiện tại của conversation/group X thấy tin reply mới kèm trích dẫn (preview)
   đúng nội dung + người gửi của tin gốc, hiển thị trong vòng 2 giây không cần reload.
8. RLS: `anon` (chưa đăng nhập) không react/reply được vào bất kỳ DM hay group nào (nhất quán
   pattern đã có — anon vẫn đóng hoàn toàn với DM/group). Hành vi với `messages` global tuỳ
   Open Question #1/#9.
9. `npm run build` + `npm run lint` + `npm run test` pass, không phát sinh lỗi mới từ feature này.

### Product risk notes (cho architect/dev — không phải spec)

- **Rủi ro nền chưa verify, giờ là feature thứ 4 stack lên trên nó**: "Supabase Realtime
  `postgres_changes` áp RLS theo role kết nối" CHƯA được test thật bằng 2+ account ở BẤT KỲ
  feature nào trước (friends → dm-chat → group-chat, đều "PARTIAL PASS"). Reaction realtime
  (count cập nhật live) lại phụ thuộc trực tiếp giả định này — nếu sai, rò rỉ không chỉ nội dung
  tin nhắn mà cả "ai react gì" (metadata hành vi, cũng nhạy cảm). Đây PHẢI là gate test sống trước
  khi feature này coi là ship — không phải lần thứ 4 để lại nợ giống nhau.
- **Nhân 3 lần schema/RLS nếu KHÔNG unify (rủi ro chính của chính feature này)**: nếu giữ nguyên
  3 bảng tin nhắn riêng và KHÔNG unify, feature này cần TỐI THIỂU 3 bảng reaction
  (`message_reactions`, `dm_message_reactions`, `group_message_reactions`) + 3 bộ RLS gần như
  giống nhau (chỉ khác điều kiện "ai là thành viên") + cột `reply_to_message_id` phải thêm vào
  CẢ BA bảng tin nhắn (`messages`, `dm_messages`, `group_messages`) với FK tự-tham-chiếu đúng
  bảng tương ứng. Đây là rủi ro maintainability + correctness (case edge #6 — reply xuyên biên
  giới — chính là hệ quả trực tiếp của việc không có 1 bảng tin nhắn chung để FK tự nhiên chặn).
  KHÔNG phải kiến trúc — nhưng là tín hiệu sản phẩm/quy trình quan trọng: câu hỏi unification đã
  bị defer 2 lần với lý do hợp lý mỗi lần ("rủi ro thấp nhất tại thời điểm đó"), nhưng chi phí
  defer đang TĂNG DẦN qua mỗi feature mới chồng lên (xem khuyến nghị bên dưới).
- **Privacy của "ai react gì"**: khác tin nhắn (nội dung), danh sách người react lên 1 tin có thể
  bị xem là metadata nhạy cảm nhẹ hơn nhưng vẫn là thông tin về tương tác xã hội — nếu quyết định
  hiển thị "danh sách người react" công khai cho mọi thành viên xem (Open Question liên quan đến
  FR #3), cần nhất quán với mô hình privacy hiện có (group/DM đã đóng cho non-member, nên về bản
  chất reaction list trong group/DM đã tự động giới hạn đúng phạm vi — KHÔNG có rủi ro privacy
  MỚI miễn RLS đúng, chỉ cần lưu ý nếu sau này có "anonymous reaction" request).
- **Abuse vector mới**: reaction không có giới hạn nội dung (chỉ 1 emoji, nhẹ hơn tin nhắn) có thể
  bị spam dễ hơn tin nhắn text (1 click thay vì gõ + gửi) — nếu UI cho phép react/un-react liên
  tục rất nhanh, có thể tạo nhiều Realtime event nhỏ liên tục (UPDATE/INSERT/DELETE xen kẽ) — nên
  lưu ý cho architect về khả năng cần debounce ở UI (không phải DB rate-limit, theo nhất quán
  "không rate-limit" đã chọn ở các feature trước, nhưng đáng nêu vì pattern tương tác khác hẳn
  gửi tin nhắn).

### Khuyến nghị (KHÔNG phải quyết định) — câu hỏi unification, lần thứ 3

BA không quyết kiến trúc, nhưng với tư cách người đã đọc đầy đủ lịch sử 2 lần defer trước, nêu rõ
tình huống để `/office-hours` và `/plan` có đủ thông tin ra quyết định lần này:

- **Lần 1 (dm-chat)**: architect quyết tách bảng vì "messages đang chạy thật, RLS đối lập hoàn
  toàn (mở/đóng), trộn lẫn rủi ro convention" — hợp lý, vì đây là lần ĐẦU thêm 1 hệ thống mới.
- **Lần 2 (group-chat)**: user xác nhận trực tiếp tiếp tục tách bảng — lý do "không đụng schema DM
  đã viết xong (dù chưa migrate live)" — vẫn hợp lý ở quy mô đó (2 bảng → 3 bảng, tăng trưởng
  tuyến tính).
- **Lần 3 (feature này)**: khác biệt CHẤT, không chỉ LƯỢNG — đây không phải "thêm 1 loại chat mới"
  mà là "thêm 1 tính năng PHỤ phải áp dụng đồng thời lên CẢ 3 bảng đã tồn tại". Chi phí không unify
  giờ không tuyến tính nữa: cần sửa/thêm cột trên cả 3 bảng tin nhắn (`reply_to_message_id`) +
  tạo 3 bảng reaction mới + 3×N RLS policies viết gần như giống nhau cho mỗi bảng. Đây CHÍNH XÁC
  là kiểu "duplicate hook/RLS pattern tăng theo số loại chat" mà chính architect (ở dm-chat PLAN)
  và chính user (ở group-chat THINK) đã lần lượt gọi tên là rủi ro cần "resolve dứt điểm" — và lần
  này không resolve thì sẽ có Run 4 nào khác (ví dụ "đính kèm file", "đã đọc/read receipt", "xóa
  tin nhắn") lại đối mặt y hệt câu hỏi này lần thứ 4.
- **Khuyến nghị của BA (không phải quyết định — architect/`plan` quyết kỹ thuật, user quyết
  taste/risk-tolerance)**: đây là điểm tự nhiên hợp lý nhất để cân nhắc lại unification một lần
  dứt điểm, NHƯNG quyết định cuối vẫn phải cân đối với chi phí migrate 3 bảng đang có dữ liệu thật
  (nếu đã có dữ liệu sống) — nếu chưa có dữ liệu thật đáng kể (theo STATE các feature trước, NHIỀU
  migration còn CHƯA chạy lên Studio thật tính tới giờ), chi phí unify NGAY BÂY GIỜ thấp hơn bất kỳ
  thời điểm nào trong tương lai. BA không quyết được điều này — chỉ đảm bảo câu hỏi được đặt ra
  EXPLICIT, không bị âm thầm quyết theo thói quen "tách bảng vì lần trước cũng tách".

### Open questions — CHỈ con người quyết, KHÔNG tự đoán

1. **Scope: áp dụng cho BAO NHIÊU loại chat?** Cả 3 (global + DM + group), hay thu hẹp (ví dụ chỉ
   DM + group, loại global ra vì global đang mở cho `anon` và có model privacy khác hẳn)? Đây là
   câu hỏi đầu tiên BẮT BUỘC chốt vì ảnh hưởng toàn bộ scope các câu hỏi sau.
2. **Emoji set: cố định (whitelist, kiểu Slack/Messenger 6 emoji mặc định) hay tự do (bất kỳ
   emoji nào, kiểu Discord/Telegram full emoji picker)?** Ảnh hưởng trực tiếp UI (emoji picker
   đơn giản 6 nút vs picker đầy đủ) + validate (whitelist DB CHECK vs giới hạn độ dài chuỗi).
3. **Multi-reaction: 1 user có được nhiều EMOJI KHÁC NHAU trên CÙNG 1 tin nhắn (vừa 👍 vừa ❤️),
   hay chỉ 1 reaction/tin nhắn/user (react emoji mới = tự động thay emoji cũ, giống Messenger)?**
   Ảnh hưởng schema (unique constraint (message_id, user_id) vs (message_id, user_id, emoji)).
4. **Schema unification (CÂU HỎI LẦN 3 — xem mục Khuyến nghị trên)**: tiếp tục tách 3 bảng
   reaction/3 cột reply riêng theo từng loại chat (Phương án B, nhất quán pattern đã chọn 2 lần
   trước), hay đây là lúc unify CẢ message schema + reaction/reply schema thành 1 hệ chung (kind=
   'global'|'direct'|'group') để tránh nhân 3 vĩnh viễn? **Đây là quyết định kiến trúc lớn nhất
   của feature này — KHÔNG tự quyết, cần user xác nhận trực tiếp giống cách đã làm ở group-chat
   THINK #1/#8.**
5. **Reply: chỉ 1 cấp ("reply tới X", hiển thị inline preview) hay cần threading lồng nhau nhiều
   cấp (reply-tới-reply tạo nhánh, kiểu Slack thread riêng)?** Đề xuất mặc định của BA là 1 cấp
   (đơn giản hơn, đủ cho "trả lời 1 tin cụ thể giữa nhiều tin chen ngang") — **cần user xác nhận**,
   không tự quyết vì ảnh hưởng lớn UI/schema (1 cấp = chỉ cần 1 FK tự tham chiếu; nhiều cấp = cần
   suy nghĩ về truy vấn cây + giới hạn độ sâu).
6. **Hiển thị "ai đã react"**: chỉ cần tổng số (count) theo từng emoji, hay cần xem được DANH SÁCH
   username đã react (hover/tap để mở danh sách)? Ảnh hưởng UI + lượng data cần trả về.
7. **Reaction cho `anon` ở global chat (nếu Q1 chốt CÓ áp dụng global)**: cho phép `anon` react,
   hay bắt buộc đăng nhập để react (khác với gửi tin nhắn — hiện `messages` cho anon insert tin
   nhắn thoải mái)? Đây là quyết định privacy/spam riêng, không suy luận tự động từ RLS hiện tại
   của `messages`.
8. **UI/UX placement**: long-press/hover để mở emoji picker trên mỗi tin nhắn (pattern phổ biến),
   hay 1 nút riêng luôn hiện cạnh mỗi tin? Reply: nút "Trả lời" riêng hay swipe-to-reply? Thuộc
   `/design`, nhưng nêu sớm để designer biết hướng kỳ vọng.
9. **Giới hạn**: có cần giới hạn số LOẠI emoji khác nhau hiển thị trên 1 tin nhắn (ví dụ tối đa
   hiển thị 5 emoji loại khác nhau, "+3 more") để tránh UI vỡ nếu rất nhiều người react nhiều emoji
   khác nhau, hay không giới hạn ở MVP (nhất quán "không giới hạn" đã chọn ở các feature trước)?

## THINK (office-hours)

| # | Câu hỏi | Quyết định | Lý do |
|---|---------|-----------|-------|
| 1 | Scope: bao nhiêu loại chat? | **Chỉ DM + group** — loại global ra hoàn toàn. | **User xác nhận trực tiếp.** Global mở cho `anon`, model privacy khác hẳn; không còn là "mặt chat chính" sau khi đã có DM/group. Giảm phạm vi rủi ro của feature đã nhiều taste-question nhất từ trước tới nay. |
| 2 | Emoji set | **Tự do** (bất kỳ emoji nào, không whitelist cố định) | Đơn giản hơn để build (không cần duy trì danh sách whitelist), trải nghiệm tốt hơn; giới hạn độ dài chuỗi ở DB (CHECK ≤ 8 ký tự, đủ cho emoji ghép/skin-tone) làm lưới an toàn chống spam text giả làm reaction — đã nêu rõ trong edge case #7 |
| 3 | Multi-reaction | **Chỉ 1 reaction/tin nhắn/user** — react emoji mới tự động thay emoji cũ (giống Messenger) | Đơn giản hơn cho schema (unique constraint (message_id, user_id) thay vì 3 cột) + UI (không cần hiển thị nhiều icon cạnh nhau của cùng 1 user) |
| 4 | Schema unification | **KHÔNG unify — tiếp tục tách bảng riêng theo từng loại chat (Phương án B), lần thứ 3.** | **User xác nhận trực tiếp.** Ưu tiên zero rủi ro cho 3 feature đã build/review/PR (#9, #10, #11) — không muốn reopen database layer của các PR đang mở chỉ vì feature phụ (reaction/reply). Chấp nhận nhân 2 bảng reaction mới (`dm_message_reactions`, `group_message_reactions`) + cột `reply_to_message_id` trên `dm_messages`/`group_messages` (KHÔNG cần touch `messages` global vì đã loại khỏi scope ở Q1). |
| 5 | Reply depth | **1 cấp duy nhất** ("reply tới X", hiển thị inline preview) — không nested/threading nhiều cấp | Đề xuất mặc định của BA — đủ cho mục đích "trả lời rõ 1 tin giữa nhiều tin chen ngang", tránh độ phức tạp truy vấn cây không cần thiết ở MVP |
| 6 | Hiển thị "ai đã react" | **Cả 2 mức**: count theo từng emoji hiển thị mặc định, danh sách username xem được khi hover/tap (đúng đề xuất FR #3 trong ANALYZE — data trả về đủ cho cả 2 mức, UI chi tiết để designer) | Trải nghiệm tốt hơn chỉ count, không tốn thêm thiết kế DB (data đã có sẵn từ bảng reaction, chỉ là cách hiển thị) |
| 7 | Anon reactions ở global | **N/A** — global đã loại khỏi scope ở Q1, câu hỏi này không còn áp dụng | — |
| 8 | UI placement | Thuộc `/design` — nêu hướng kỳ vọng: **nút/long-press mở emoji picker trên mỗi tin nhắn** (pattern phổ biến, không cần nút riêng luôn hiện); reply qua **nút "Trả lời" riêng** (không swipe — nhất quán mobile-first nhưng không cần gesture phức tạp ở MVP) | Pattern phổ biến nhất, designer tự do chi tiết hóa |
| 9 | Giới hạn loại emoji hiển thị | **Không giới hạn** ở MVP | Nhất quán "không giới hạn" đã chọn ở các feature trước (friends, group size đã có giới hạn riêng vì lý do abuse cụ thể — reaction display không có rủi ro tương đương) |

**Quyết định kỹ thuật kèm theo** (áp dụng cho architect):
- 2 bảng reaction mới: `dm_message_reactions` (FK → `dm_messages`), `group_message_reactions` (FK → `group_messages`) — KHÔNG có bảng reaction cho `messages` global (ngoài scope).
- Cột `reply_to_message_id` thêm vào `dm_messages` và `group_messages` — PHẢI là self-referencing FK đúng bảng tương ứng (không dùng 1 cột UUID chung không FK-checked) để chặn cứng edge case #6 (reply xuyên biên giới conversation/group) ngay ở schema, không chỉ ở application code.
- RLS reaction/reply: re-check membership HIỆN TẠI tại thời điểm react/reply (nhất quán nguyên tắc DM-chat/group-chat).
- Risk kế thừa (ghi lại lần thứ 4, KHÔNG được bỏ qua): "Realtime áp RLS cho `postgres_changes`" vẫn CHƯA verify thật. Đây là feature thứ 4 stack lên rủi ro này — architect/Checker PHẢI nhấn mạnh lại đây là gate bắt buộc trước khi TOÀN BỘ 4 feature (friends, DM, group, reactions) coi là ship thật, không chỉ riêng feature này.

## Phase

| Bước | Trạng thái |
|------|-----------|
| ANALYZE (BA) | ✅ Done — 2026-06-25 |
| THINK (office-hours) | ✅ Done — 2026-06-25 (câu #1 và #4 do user xác nhận trực tiếp; còn lại auto-decided nhất quán pattern friends/DM-chat/group-chat) |
| DESIGN (designer) | ✅ Done — 2026-06-25 (docs/loops/reactions-replies-design.md) |
| plan (architect) | ✅ Done — 2026-06-25 (migration 0010, hooks/components plan, TEST PLAN below) |
| build (Maker) | ✅ Done — 2026-06-25 (this section) |
| review (Checker) | ✅ Done — 2026-06-25 (code-reviewer: NEEDS-WORK, 2 blockers; architect: PASS, 1 fast-follow overlapping same issue) → all 3 fixed in post-review pass, see "BUILD — post-review fixes" below |
| qa | ⬜ |
| ship | ⬜ |

**Next action**: re-run `/review` to confirm the 3 fixes, then `/qa` (the unverified-live-Realtime-RLS
gate from THINK/PLAN remains open regardless of these fixes — still must be exercised with 2+ real
accounts before ship).

## BUILD — post-review fixes (Maker — 2026-06-25)

Code review (code-reviewer: NEEDS-WORK, 2 blockers) + architect review (PASS, 1 fast-follow
recommendation overlapping blocker #3) surfaced 3 required fixes. All 3 applied in this pass.
**No other changes made** — the other findings from this review round (missing mobile
bottom-sheet, missing debounce, missing some unit test coverage for Realtime patch handlers,
misleading `onLongPress` prop name) are accepted as documented deferred items (see BUILD
"Assumptions made"/"Deferred" sections above) and intentionally NOT touched in this pass.

### Fix 1 (blocker) — missing REPLICA IDENTITY FULL broke un-react Realtime sync

`supabase/migrations/0010_message_reactions_and_replies.sql`: added
`alter table public.dm_message_reactions replica identity full;` (after the `dm_message_reactions`
CREATE TABLE + index, before section 4) and the equivalent for `group_message_reactions` (after its
CREATE TABLE + index, before the RLS section). Without this, Postgres's default
`REPLICA IDENTITY DEFAULT` only includes the primary key (`id`) in the Realtime DELETE payload's
`old` field — `use-dm-message-reactions.ts`'s `patchDelete()` (and the group equivalent) read
`row.message_id`/`row.user_id`/`row.emoji` from that field, so non-actor viewers never received a
working un-react patch (only the actor's own optimistic local removal made un-react look like it
worked). Rollback block at the end of the migration now includes the reverse
(`alter table ... replica identity default;`) for both tables, noted as non-destructive to re-run.
**Migration file was NOT run against the live Supabase instance** (same constraint as the original
build pass and every other migration in this feature sequence) — Checker/QA must verify this
statement actually executes cleanly against Studio before/during the live Realtime QA gate.

### Fix 2 (blocker) — quoted-message-preview click bubbled into parent bubble's action sheet

`src/components/quoted-message-preview.tsx`: `QuotedMessagePreview`'s `onClick` handler now calls
`e.stopPropagation()` before invoking `onJumpToOriginal()`. Chose this fix (stopPropagation inside
the child) over moving `quotedSlot` outside the clickable div in `message-bubble.tsx`, because
`quotedSlot` is rendered INSIDE the bubble body intentionally (visually part of the bubble content,
unlike `reactionsSlot` which sits below/outside the bubble) — moving it out would change the visual
layout, not just fix the bug. `message-bubble.tsx` itself was NOT modified.

### Fix 3 (required, both reviewers flagged) — replaced brittle substring error-detection with Postgres error code check

`src/lib/use-dm-messages.ts` and `src/lib/use-group-messages.ts`: `send()`'s reply-scope-violation
detection (edge case #6) now branches on `err.code === "P0001"` instead of
`err.message.includes("edge case #6")`. The migration's `BEFORE INSERT` triggers
(`dm_messages_check_reply_scope`/`group_messages_check_reply_scope`) use a plain `raise exception`
with no `using errcode`, which Postgres surfaces under SQLSTATE `P0001` by default — distinct from
RLS policy denials, which always surface as `42501`. The migration's trigger functions/exception
text were NOT modified — only the JS-side detection branch changed. No other `sendBlockedReason`
logic was touched.

**Tests updated/added** (`src/lib/use-dm-messages.test.ts`, `src/lib/use-group-messages.test.ts`):
- Updated both existing "edge case #6 ... does NOT set sendBlockedReason" tests' mock `insertError`
  to include `code: "P0001"` (previously had no `code` field at all — passed before only because
  the substring check ran on `.message`).
- Added 2 new regression tests per file (4 total):
  1. `err.code === "P0001"` with REWORDED exception text (no "edge case #6" substring at all) still
     correctly classified as reply-scope violation, NOT unfriend/removed — proves detection no
     longer depends on the trigger's exact wording.
  2. Adversarial: `err.code === "42501"` (genuine RLS denial) whose message text happens to contain
     the literal substring `"(edge case #6)"` is correctly classified as an RLS denial (sets
     `sendBlockedReason`), NOT misclassified as a reply-scope violation — proves the OLD
     substring-based logic's exact failure mode is now closed.

### Verification

`npm run build` — pass, zero errors. `npm run lint` — pass, zero errors/warnings.
`npm run test` — **76 passed** (up from 72; +4 regression tests for fix 3, 0 removed/skipped).

### Assumptions made for this fix round (for Checker to verify)

1. **REPLICA IDENTITY FULL placement**: added directly after each reaction table's
   `CREATE TABLE`/index block (sections 3 and 4), BEFORE the RLS `ALTER TABLE ... ENABLE ROW LEVEL
   SECURITY` statements for that same table — task instructions said "after the CREATE TABLE
   statements, before the RLS section is fine," interpreted as per-table placement (dm block fully
   before dm RLS, group block fully before group RLS) rather than both REPLICA IDENTITY statements
   batched together right before all RLS. Semantically equivalent either way (statement order across
   unrelated tables doesn't matter), flagging only because it's an interpretation, not unambiguous
   in the original instruction.
2. **Rollback statements for REPLICA IDENTITY DEFAULT were inserted at the TOP of the rollback
   block** (immediately after the 2 `alter publication ... drop table` lines, before any
   `drop policy`) — chosen because logically reversing "the last forward-migration statements
   applied" first reads cleanest at the top of a reverse-order rollback list, though since this is
   non-destructive/idempotent it would work appended anywhere in the block.
3. **Did not re-verify migration against live Supabase** — per repeated constraint across this
   entire feature sequence (no live DB credentials/session in this environment). Fix 1 in
   particular is UNTESTED against a real Postgres instance; Checker/QA should confirm
   `alter table ... replica identity full;` runs cleanly (it's a standard, safe DDL statement with
   no data migration implications, but flagging since it's new SQL never executed).
4. **Fix 2's "smaller, more consistent fix" choice**: chose `stopPropagation` over relocating
   `quotedSlot` outside the clickable div, reasoning explained above (visual placement intent
   differs between `quotedSlot` and `reactionsSlot`). Flagging in case Checker disagrees and
   prefers structural relocation instead — that would be a 1-line change in `message-bubble.tsx`
   moving `{quotedSlot}` outside the `onClick` div, easy to swap if Checker wants the other
   approach.
5. **Fix 3's regression tests assert the FULL behavioral contract (both directions)**, not just the
   originally-reported brittleness — added the adversarial "RLS denial whose text coincidentally
   matches the old substring" case in addition to the "reworded P0001 exception" case, since the
   task description's bug report implies both directions are real risks of substring-matching (a
   wording change breaking detection, AND an unrelated error's wording accidentally matching).

## BUILD (Maker — 2026-06-25)

### Migration verification

Read `supabase/migrations/0010_message_reactions_and_replies.sql` in full before building.
Confirmed it matches PLAN exactly: `reply_to_message_id` self-FK + BEFORE INSERT scope-check
triggers on both `dm_messages`/`group_messages` (edge case #6), 2 new reaction tables with
`unique(message_id, user_id)` (NOT `(message_id,user_id,emoji)` — THINK #3 "1 reaction/user,
replace on re-react"), RLS re-checking live friend/membership status on INSERT/UPDATE but NOT
on DELETE (un-react always allowed, even after unfriend/leave), Realtime publication adds for
both new tables. **Did NOT run this migration against the live Supabase instance** — per task
constraint, same as all prior features in this sequence. Migration file itself was NOT
modified.

### Files changed

**Types**
- `src/lib/types.ts` — added `ReplyPreview` type, `ReactionSummary` type; extended `DmMessage`
  and `GroupMessage` with `replyToMessageId: string | null` and `replyPreview: ReplyPreview | null`.

**Hooks (modified)**
- `src/lib/use-dm-messages.ts` — `DmMessageRow` gained `reply_to_message_id`; `useDmMessages`
  gained optional 3rd param `peerUsername` (for denormalizing `replyPreview.senderLabel`
  without an extra query); `send()` signature extended to
  `send(body, replyToMessageId?)`; load() and the Realtime INSERT handler both denormalize
  `replyPreview` by looking up the target message in the already-loaded batch (load: the
  `rows` array being processed; Realtime: the `prev` messages state) — no extra round trip.
  Added special-case handling in `send()`: an insert error whose message contains
  `"edge case #6"` (the exact substring the DB trigger raises) is treated as a reply-scope
  violation, NOT an unfriend signal — does NOT set `sendBlockedReason`/`canSend=false` (this
  is a deliberate behavior difference from the generic RLS-rejection path, to avoid falsely
  locking the composer for a still-valid friendship just because one reply attempt referenced
  a cross-conversation message).
- `src/lib/use-group-messages.ts` — same shape of change, mirrored. `send()` extended with
  `replyToMessageId` param; load()/Realtime INSERT handler denormalize `replyPreview`; same
  `"edge case #6"` substring-based exemption from `sendBlockedReason`.

**Hooks (new)**
- `src/lib/use-dm-message-reactions.ts` — `useDmMessageReactions(conversationId, identity,
  messageIds)`. Bulk loads via `select * from dm_message_reactions where message_id in (...)`
  (1 query, NOT per-message — verified by test). Builds `Map<messageId, ReactionSummary[]>`.
  `react()`: optimistic local update (the one deliberate exception to "no optimistic UI" in
  this codebase, per PLAN/design doc) → `upsert(..., {onConflict: "message_id,user_id"})` →
  revert + `reactBlockedReason="unfriended"` on error. `unreact()`: optimistic removal →
  `delete().eq("message_id",...).eq("user_id",...)`; 0-row match is a normal success (edge
  case #4), not specially branched. Realtime: separate channel
  `dm-reactions-{conversationId}` (distinct from `dm-thread-{conversationId}`), patches the
  local map in place on INSERT/UPDATE/DELETE — no re-fetch. Cancelled-flag race-safety pattern
  used from the start in the bulk-load effect.
- `src/lib/use-group-message-reactions.ts` — structurally identical to the DM version
  (same function shapes, same comments minus DM-specific wording), `reactBlockedReason="removed"`
  on RLS rejection, channel `group-reactions-{groupId}`. Deliberately NOT unified into 1
  parameterized hook — per THINK #4/PLAN's explicit "2 separate hooks" decision.

**Components (new)**
- `src/components/message-bubble.tsx` — shared presentational `MessageBubble`. Verified: zero
  `createClient()`/hook imports, only plain props + callbacks + 2 render-prop slots
  (`reactionsSlot`, `quotedSlot`).
- `src/components/message-reactions.tsx` — `MessageReactions` (pills row, renders nothing if
  `reactions.length === 0`, own-reaction pill gets `ring-blue-500` highlight, trailing `[+]`
  chip per Open Design Q2 default).
- `src/components/message-action-sheet.tsx` — `MessageActionSheet` + `EmojiFreeInput` in one
  file (per PLAN, `EmojiFreeInput` is a sub-state not separately reusable). Quick-pick row of
  6 emoji + free-input with soft ASCII-text heuristic warning (non-blocking).
- `src/components/reactor-list-popover.tsx` — `ReactorListPopover`, skeleton-row loading state.
- `src/components/reply-preview-bar.tsx` — `ReplyPreviewBar`.
- `src/components/quoted-message-preview.tsx` — `QuotedMessagePreview`.

**Components (modified)**
- `src/components/dm-panel.tsx` — `DmThread` now wires `useDmMessageReactions`, renders
  `MessageBubble` per message instead of inline `.map()` JSX, manages `replyTarget`/
  `actionSheetMessageId`/`reactorPopover`/`jumpToast`/`highlightedId` local state, renders
  `ReplyPreviewBar` above composer, passes `peerUsername` into `useDmMessages` for reply
  denormalization, passes `replyTarget.messageId` into `send()`.
- `src/components/group-panel.tsx` — same shape of change for `GroupThread`.

**Tests (new)**
- `src/lib/use-dm-message-reactions.test.ts` — 6 tests: bulk-load-in-one-query (asserts
  `select().in()` called exactly once with all messageIds, not N times), upsert replace
  semantics, optimistic-before-server-resolves, RLS-rejection reverts + sets
  `reactBlockedReason`, unreact 0-row no-op, null-conversationId empty state.
- `src/lib/use-group-message-reactions.test.ts` — 5 tests mirroring the DM reaction hook test
  structure (per "structurally similar" instruction), with `reactBlockedReason="removed"`
  instead of `"unfriended"`.

**Tests (modified)**
- `src/lib/use-dm-messages.test.ts` — fixed pre-existing "trims body" assertion to include
  the new `reply_to_message_id: null` field. Added 3 new tests: `replyToMessageId` passthrough
  into insert payload, edge-case-#6-trigger-error does NOT set `sendBlockedReason`, and
  `replyPreview` denormalization when the reply target is in the same loaded batch.
- `src/lib/use-group-messages.test.ts` — same 4 changes, mirrored (1 fix + 3 new tests).

Total: 72 tests passing (up from 55 pre-existing), all in `npm run test`. `npm run build` and
`npm run lint` both pass clean (zero errors, zero warnings) after fixing 2
`react-hooks/refs` ESLint errors (see Assumptions below) and 2 unused-eslint-disable warnings.

### Assumptions made (for Checker to verify)

1. **`peerUsername` threaded into `useDmMessages` as an optional 3rd positional param**,
   defaulting to `undefined` → `senderLabel` falls back to `"?"` if absent. This was NOT
   explicitly specified in PLAN's hook signature table (PLAN only documented
   `ReactionSummary`/`UseDmMessageReactions` shapes) — I inferred it's necessary because
   `replyPreview.senderLabel` needs to render `"Bạn"` vs `"@peerUsername"` and the hook itself
   has no other source for the peer's username (it only knows `user_a_id`/`user_b_id` from a
   raw `conversations` query, not the resolved username `DmThread` already has from
   `useDmConversations`/`pendingOpenFriendUsername`). `DmThread` already receives
   `peerUsername` as a prop, so passing it straight through was the lowest-friction option.
   **Group's `useGroupMessages` did NOT need an equivalent param** — it already
   resolves all sender usernames via the existing `profiles` join in `load()`, so reply
   `senderLabel` is built from already-available `usernameById`.

2. **`reply_to_message_id` reply-scope trigger error detection via substring match on
   `err.message.includes("edge case #6")`** — both trigger functions in the migration
   literally embed the string `"(edge case #6)"` in their `raise exception` message text
   (`'dm_messages: reply_to_message_id phai thuoc cung conversation_id (edge case #6)'` etc.),
   so this substring match is reliable AS LONG AS the migration's exception text doesn't
   change. This is the only way I found to distinguish "reply across conversation/group
   boundary" from a generic RLS denial using only the existing single-string error surface —
   Postgres doesn't give a structured error code distinction here (RLS denials raise a
   different Postgres error code (`42501`) than a plpgsql `raise exception`, which is
   actually a MORE robust signal than substring-matching; I used substring-matching for
   simplicity but flag this as a possible improvement for Checker/future review: branching on
   `err.code !== "42501"` would be less brittle than matching exception text).

3. **`MessageActionSheet`'s `onOpenFreeInput` callback is wired to a no-op
   (`() => undefined`)** in both `DmThread`/`GroupThread` — the component manages its own
   `freeInputOpen` sub-state internally (per design doc, `EmojiFreeInput` is "a sub-state of
   Action Sheet", not separately reusable), so the parent callback doesn't need to do
   anything; I kept the prop in the interface per PLAN's component table but it's currently
   vestigial. Flagging in case Checker expects the parent to do something with this hook
   point (e.g. analytics) — none was specified anywhere in PLAN/design doc.

4. **Long-press is NOT implemented as an actual timed long-press gesture** — per design doc
   Interaction Notes ("on desktop, a small low-opacity '···' affordance appears on hover...
   avoids needing actual long-press emulation with a mouse"), I implemented `MessageBubble`'s
   bubble body AND the hover-revealed `···` button as both calling the SAME `onLongPress`
   callback on plain `onClick`/`onKeyDown` (Enter/Space) — i.e., tapping/clicking the bubble
   body itself opens the action sheet, no actual 400-500ms timer. This is a deliberate
   simplification consistent with "avoids needing actual long-press emulation" but means the
   ENTIRE bubble (not just the "···" corner) is clickable to open the sheet, which is a
   stronger interpretation than the wireframe implies (wireframe 3.4 shows the WHOLE bubble as
   "anchor", supporting this reading, but design doc's Interaction Notes describes a SMALL
   hover affordance as the click target, not the whole bubble). Flagging as a UI behavior
   delta for Checker/QA to confirm against the design intent.

5. **Mobile bottom-sheet vs desktop popover (Open Design Q3)** — I did NOT implement a
   responsive variant. `MessageActionSheet`/`ReactorListPopover` render as a single
   `absolute`-positioned small panel anchored near the triggering element on ALL viewport
   sizes (no `sm:` breakpoint switch to a bottom sheet). This satisfies desktop UX; on narrow
   mobile viewports the popover may render awkwardly close to a screen edge. Deferred — not
   blocking per design doc's own framing of Q3 as "minor", but explicitly flagging since it
   was never implemented, not just simplified.

6. **`EmojiFreeInput`'s soft-validation heuristic** (`looksLikePlainText`) checks if the ENTIRE
   string is within the printable-ASCII range (`/^[\x20-\x7E]+$/`) — this correctly flags
   plain text like `"lol"` as suspicious, but does NOT flag a mix like `"😀lol"` (since the
   regex requires the WHOLE string to be ASCII to trigger the warning, and `"😀lol"` contains a
   non-ASCII codepoint). This matches edge case #7's framing ("emoji + text lẫn nhau" is
   explicitly listed as a case needing thought) but I did NOT add stronger detection for mixed
   emoji+text — the DB `CHECK (char_length(emoji) between 1 and 8)` backstop still applies
   (and Postgres `char_length` would count `"😀lol"` as 4 characters, well under 8, so it would
   NOT be rejected by the DB either). This is a soft/advisory client warning only, consistent
   with THINK #2 "free emoji input, no real whitelist enforcement" — flagging so Checker
   doesn't mistake this for a security gap (it isn't one; reactions are low-stakes, 8-char-max
   metadata, not message content).

7. **Realtime reaction patch functions (`patchInsertOrUpdate`/`patchDelete`) rebuild the
   ENTIRE per-message `ReactionSummary[]` array on every single Realtime event** rather than
   mutating a single summary in place — this is O(distinct emoji count) per event, which is
   fine at the scale this app operates at (no pagination/virtualization anywhere yet) but
   would not scale to messages with hundreds of distinct reactor/emoji combinations. Not
   flagged as a problem per THINK #9 "no display limit at MVP" — just noting the
   implementation tradeoff for awareness.

8. **Did NOT implement the debounce-on-rapid-toggle mitigation** (PLAN's "edge case #12",
   trailing ~300ms debounce on the network call while keeping optimistic UI instant). This
   was explicitly flagged in PLAN as a UI-perf mitigation, not a correctness requirement —
   deferred for this build pass. Each tap currently fires its own `upsert`/`delete` call
   immediately. Flagging as explicitly deferred, not silently dropped.

9. **Tap-to-jump-to-original uses a `Map<string, HTMLDivElement>` ref populated via inline
   ref callbacks on each message row**, and `scrollIntoView({ behavior: "smooth", block:
   "center" })` + a 1-second `bg-yellow-100` highlight via local `highlightedId` state. The
   "found in loaded view" check used for the `QuotedMessagePreview`'s `foundInView` prop is
   `messageIds.includes(...)` against the **rendered `messages` array** (not the ref map) —
   this was a deliberate fix during build: the initial implementation read `messageRefs.current`
   directly during render, which Next.js/React's `react-hooks/refs` ESLint rule correctly
   flagged as an error ("Cannot access refs during render"); switched to deriving
   `foundInView` from the already-available `messages` state array instead, which is
   equivalent data (a message is rendered as a row iff it's in `messages`) without violating
   the render-purity rule.

10. **No e2e/live 2-account Realtime verification was performed** (same constraint as all
    prior features — Maker does not have live Supabase credentials/2 browser sessions in this
    environment). This is the 4th feature stacking on the still-unverified "Realtime
    postgres_changes applies RLS per connecting role" assumption per STATE's explicit risk
    note — this gate remains open and must be addressed in QA, not assumed passing.

### Deferred (explicitly, not silently dropped)

- Debounce on rapid react/un-react toggle (PLAN edge case #12) — see Assumption #8.
- Responsive mobile bottom-sheet variant for `MessageActionSheet`/`ReactorListPopover` (Open
  Design Q3) — see Assumption #5.
- Live 2-account Realtime RLS verification (inherited risk, 4th feature) — see Assumption #10.
- Auto-fetching additional message history to find an out-of-window reply target when
  jumping (explicitly out of scope per design doc "Future ideas").
- Reaction "burst" animations, emoji search/filter, read receipts — all explicitly out of
  scope per design doc "Future ideas".

## PLAN (architect)

> Input: ANALYZE + THINK above (locked, not re-litigated) + `docs/loops/reactions-replies-design.md`
> (UI/wireframes). Migration file: `supabase/migrations/0010_message_reactions_and_replies.sql`
> (full SQL there, summarized below). Scope = **DM + group only**, global `messages` untouched.

### 0. Resolving Design Open Questions #5 and #6 (architect decision, not silently assumed)

- **Design Q5 (shared `MessageBubble`)**: **YES — build a shared presentation-only
  `MessageBubble` + reaction/reply sub-components.** This does NOT reopen THINK #4
  (schema unification stays closed — `dm_messages`/`group_messages` remain separate tables,
  separate hooks, separate RLS). THINK #4 was scoped to **data/schema**, not **rendering
  JSX**. Deduplicating `.map()` bubble markup between `dm-panel.tsx`/`group-panel.tsx` is a
  pure UI refactor: the component takes plain props (`{ id, body, senderLabel, createdAt,
  mine, reactions?, replyPreview? }`), has zero Supabase/hook awareness, and is fed by
  `DmThread`/`GroupThread` from their own (still separate) hook state. Reduces ~40 lines of
  duplicated JSX per file to one shared file. File: `src/components/message-bubble.tsx`.
- **Design Q6 (shadcn vs hand-rolled)**: **Continue hand-rolled Tailwind.** The codebase has
  zero shadcn primitives installed despite CLAUDE.md's aspirational mention; introducing
  shadcn now (`Popover`/`Sheet`/`Dialog`) for exactly 2 new floating-UI surfaces
  (`MessageActionSheet`, `ReactorListPopover`) would create a visual/structural seam against
  every other existing screen for zero functional gain at this scope. Defer a real shadcn
  install to a future "design system" pass if the project grows that direction — flag to
  `process-manager`/`/audit-process` as a recurring stack-drift note, not a blocker here.

### 1. Architecture — server vs client, files to create/modify

All new/modified files are **client components** (`"use client"`) — reactions/replies are
fully interactive, mutate via Supabase JS client, and need Realtime subscriptions, matching
every existing chat surface in this codebase (no server components used for chat panels).

**Migration**
- `supabase/migrations/0010_message_reactions_and_replies.sql` (new, see file — already
  written, full SQL with rollback block included).

**Hooks (new)**
- `src/lib/use-dm-message-reactions.ts` — new hook, `useDmMessageReactions(conversationId, identity)`.
- `src/lib/use-group-message-reactions.ts` — new hook, `useGroupMessageReactions(groupId, identity)`.
  - **Decision: 2 separate hooks, NOT 1 parameterized hook.** Mirrors THINK #4's resolution
    exactly — a single `useMessageReactions<T extends "dm" | "group">(...)` hook would need a
    table-name parameter threaded through every query/RLS-shaped branch (`dm_messages` +
    `conversations` join vs `group_messages` + `group_members` join — the friend-gating vs
    active-membership re-check is structurally different SQL, not just a string swap). This is
    the exact "fake unification" anti-pattern already rejected for the messages tables
    themselves; keep the 1:1 mapping (1 source table family → 1 hook) for the same
    maintainability reasoning the user already confirmed twice. Some duplicated *hook
    boilerplate* (cancelled-flag race-guard, optimistic toggle logic) is accepted cost — already
    true of `use-dm-messages.ts`/`use-group-messages.ts` today.
- Each hook loads reactions for ALL currently-loaded messages in 1 query (not per-message),
  keyed by `message_id`, and exposes:
  ```ts
  type ReactionSummary = { emoji: string; count: number; reactedByMe: boolean; reactorUserIds: string[] };
  type UseDmMessageReactions = {
    reactionsByMessageId: Map<string, ReactionSummary[]>;
    ready: boolean;
    loading: boolean;
    react: (messageId: string, emoji: string) => Promise<{ error: string | null }>;   // upsert
    unreact: (messageId: string) => Promise<{ error: string | null }>;                // delete own row
  };
  ```
- `reactorUserIds` resolved to usernames lazily inside `ReactorListPopover` (separate light
  query on `profiles`, matches "Loading state" note in design doc) — NOT pre-joined in the
  bulk load query, to keep the hot-path query (reactions-by-message) cheap; the popover-open
  path is the one place a per-emoji username lookup is acceptable.

**Hooks (modified)**
- `src/lib/use-dm-messages.ts` — extend `DmMessageRow`/`rowToDmMessage` to carry
  `reply_to_message_id` → `replyToMessageId`; extend `send()` signature to
  `send(body: string, replyToMessageId?: string | null)`, pass through to the insert payload.
- `src/lib/use-group-messages.ts` — same shape of change for `GroupMessageRow`/`GroupMessage`.
- `src/lib/types.ts` — add `replyToMessageId: string | null` to `DmMessage` and `GroupMessage`.

**Components (new)**
- `src/components/message-bubble.tsx` — shared presentational `MessageBubble` (see Q5 above),
  hosts `reactionsSlot`/`quotedSlot` render props per design doc table.
- `src/components/message-reactions.tsx` — `MessageReactions` (pills row).
- `src/components/message-action-sheet.tsx` — `MessageActionSheet` + `EmojiFreeInput` (kept in
  one file, `EmojiFreeInput` is a sub-state, not separately reusable elsewhere).
- `src/components/reactor-list-popover.tsx` — `ReactorListPopover`.
- `src/components/reply-preview-bar.tsx` — `ReplyPreviewBar`.
- `src/components/quoted-message-preview.tsx` — `QuotedMessagePreview`.

**Components (modified)**
- `src/components/dm-panel.tsx` — `DmThread` wires `useDmMessageReactions`, renders
  `MessageBubble` instead of inline `.map()` JSX, manages `replyTarget` state, renders
  `ReplyPreviewBar` above the input, passes `replyToMessageId` to `send()`.
- `src/components/group-panel.tsx` — same shape of change for `GroupThread`.

### 2. Data flow

**React flow**: user taps quick-pick emoji or submits free-input emoji in `MessageActionSheet`
→ `MessageBubble`'s `onOpenPicker` callback bubbles to `DmThread`/`GroupThread` → calls
`reactionsHook.react(messageId, emoji)` → hook does an **optimistic local state update**
(per design doc Interaction Notes — the ONE place optimistic UI is justified in this feature)
on `reactionsByMessageId` → fires `supabase.from("dm_message_reactions").upsert({message_id,
user_id, emoji}, {onConflict: "message_id,user_id"})` → on success, no-op (Realtime echo will
arrive and reconcile, deduped by `message_id+user_id` key, same `prev.some(...)` style guard as
existing hooks) → on RLS rejection (edge case #1: no longer a member/friend), hook reverts the
optimistic pill change and surfaces error via existing `sendBlockedReason`-style flag
(`reactBlockedReason`) reusing the same UI banner pattern.

Other members see the pill update: subscribed `postgres_changes` channel
`dm-reactions-{conversationId}` (or `group-reactions-{groupId}`) on INSERT/UPDATE/DELETE of
the reaction table, filtered by joining message_id → re-fetch is NOT required; the payload
itself carries `message_id`/`user_id`/`emoji`, sufficient to patch
`reactionsByMessageId.get(messageId)` in place. Target ≤2s latency, same class of claim as
prior features (UNVERIFIED live — see Edge Cases #12 below, inherited risk).

**Un-react flow**: tap own pill → optimistic removal from local map → `delete from
dm_message_reactions where message_id=X and user_id=me` (RLS `using (user_id = auth.uid())`,
no friend-gating re-check per design decision in migration comments) → Realtime DELETE event
patches other clients' maps. Deleting a non-existent row is a 0-row no-op (Postgres `delete`
matching 0 rows is NOT an error) — satisfies edge case #4 without special handling.

**Reply flow**: user taps "Trả lời" in `MessageActionSheet` → `DmThread`/`GroupThread` sets
local `replyTarget = {messageId, senderLabel, bodyPreview}` state → `ReplyPreviewBar` renders
above composer → user types + sends → `send(body, replyTarget.messageId)` → hook inserts with
`reply_to_message_id: replyTarget.messageId` → DB triggers (`dm_messages_check_reply_scope`/
`group_messages_check_reply_scope`) verify same-conversation/same-group at INSERT time, raise
exception otherwise (edge case #6, enforced at DB, not just app code) → on success, Realtime
INSERT echo carries `reply_to_message_id`, recipient's `MessageBubble` renders
`QuotedMessagePreview` by looking up the referenced message in the ALREADY-LOADED
`messages` array (no extra fetch — per design doc scope, "not found" toast if absent) →
`replyTarget` cleared, draft cleared (success path only — same draft-restore-on-error
contract as plain send already has).

**Subscribe channels and cleanup** (explicit, per architect brief):

| Hook | Channel name | Subscribes on | Cleanup |
|---|---|---|---|
| `useDmMessages` (existing, untouched) | `dm-thread-{conversationId}` | mount / `conversationId` change | `removeChannel` in effect cleanup, re-subscribes on id change |
| `useDmMessageReactions` (new) | `dm-reactions-{conversationId}` | mount / `conversationId` change | same cancelled-flag + `removeChannel` pattern, **separate channel from messages** (different table, avoids overloading one channel's `.on()` chain with unrelated payload shapes) |
| `useGroupMessages` (existing, untouched) | `group-thread-{groupId}` | mount / `groupId` change | unchanged |
| `useGroupMessageReactions` (new) | `group-reactions-{groupId}` | mount / `groupId` change | same pattern |

Each reaction hook follows the **exact** cancelled-flag race-safety pattern already used in
`use-dm-messages.ts`/`use-group-messages.ts` (`isCancelled()` checked after every `await`,
local `cancelled` flag closed over in the subscribe effect) — **from day one**, per the
explicit instruction in this task (not a post-review fix this time).

### 3. Edge cases — enforcement mechanism per STATE's 11 cases

| # | Case | Enforcement |
|---|---|---|
| 1 | React/reply while no longer member | RLS INSERT `with check` on `dm_message_reactions`/`group_message_reactions` re-checks friend/membership status live (same subquery shape as `dm_messages`/`group_messages` INSERT policies) — DB rejects, hook surfaces error and reverts optimistic UI |
| 2 | Reply to message in a conversation/group you've left | Same INSERT RLS on `dm_messages`/`group_messages` already blocks (reply is just an INSERT with `reply_to_message_id` set) — no new RLS surface needed, confirmed not a gap |
| 3 | Duplicate reaction (same user, same message, react twice) | `unique (message_id, user_id)` constraint on both reaction tables (NOT `(message_id,user_id,emoji)` — THINK #3 locked "1 reaction per user per message"). App layer uses `upsert(..., {onConflict: "message_id,user_id"})` so re-reacting with a DIFFERENT emoji **updates** the existing row (replace), not insert-then-conflict-error. Re-reacting with the SAME emoji is a harmless no-op upsert (same value written). |
| 4 | Un-react a reaction that doesn't exist | `delete ... where message_id=X and user_id=me` matching 0 rows is a normal 0-row success in Postgres/PostgREST — hook treats `{error: null, count: 0}` as no-op, no special-case code needed |
| 5 | Reply to a deleted message | MOOT per STATE — no delete feature exists; `on delete set null` on `reply_to_message_id` FK is the forward-compatible default chosen now so a future delete feature doesn't need a new migration just to pick this behavior |
| 6 | Reply across conversation/group boundary | **DB trigger** `dm_messages_check_reply_scope`/`group_messages_check_reply_scope` (BEFORE INSERT) — compares target message's `conversation_id`/`group_id` to the new row's; raises exception on mismatch. This is the answer to the explicit ask: a bare self-referencing FK only proves row existence in the same table, NOT same-conversation scoping — the trigger closes that exact gap. Verified directly in TEST PLAN E6. |
| 7 | Invalid emoji input (long string, plain text, mixed) | Client: `EmojiFreeInput` soft-validates (best-effort emoji-codepoint heuristic, non-blocking warning per design doc). DB: `varchar(8)` + `check (char_length(emoji) between 1 and 8)` on both reaction tables — hard backstop regardless of client bypass |
| 8 | Two different users react near-simultaneously | No conflict — `unique(message_id, user_id)` is per-user, two distinct users insert two independent rows safely under concurrent transactions |
| 9 | N/A — global chat excluded from scope (THINK #1) | — |
| 10 | Non-member reads reaction/reply data via direct REST | RLS SELECT policies on both reaction tables gate identically to `dm_messages`/`group_messages` SELECT (member-or-ever-member check) — 0 rows for non-members, verified in TEST PLAN E-series |
| 11 | Reply chain orphaned by future delete cascade | Roadmap note only, not in this feature's scope — `on delete set null` chosen specifically so this doesn't need revisiting at delete-feature time without at least graceful default behavior already in place |

**Additional edge case surfaced during PLAN (#12 — not in original STATE table, flagging
explicitly per house style)**: **rapid react/un-react toggling** generating bursty
INSERT/DELETE/INSERT Realtime events. Per design doc Interaction Notes, debounce the *network*
call client-side (trailing ~300ms) while keeping optimistic local state instant — this is a
UI-perf mitigation, not a DB-level rate-limit (consistent with "no rate-limit" decision applied
elsewhere in this codebase).

### 4. Risk carried forward (4th time, explicit per STATE THINK closing note)

"Supabase Realtime `postgres_changes` applies RLS per connecting role" remains **unverified
live** with 2+ real accounts across friends → dm-chat → group-chat → this feature. This
migration adds 2 MORE realtime-published tables stacking on the same unverified assumption —
**TEST PLAN E6/E7 below are the mandatory gate**; if this fails, ALL FOUR features' realtime
behavior is suspect, not just this one. Do not let this slip a 5th time.

### 5. Trade-offs / assumptions for dev + Checker to track

1. **Reactions are NOT optimistic-free** — this is the one deliberate exception to this
   codebase's "no optimistic insert for messages" rule (established in `dm-panel.tsx`/
   `group-panel.tsx` comments). Checker should NOT flag optimistic reaction state as
   inconsistent with that rule — it's an explicit, scoped exception per design doc.
2. **Bulk reaction load, not per-message query** — `useDmMessageReactions`/
   `useGroupMessageReactions` load ALL reactions for the currently-loaded message window in
   one `select * from dm_message_reactions where message_id in (...)` call (mirrors the
   message-history `.limit(100)` window) — not N+1 per-message queries. Dev must implement it
   this way; Checker should flag if found doing per-message fetches.
3. **`reactorUserIds` → usernames resolved lazily** (only when `ReactorListPopover` opens) —
   bulk load query does NOT join `profiles`, keeping the hot path cheap. This means the popover
   has its own brief loading state (per design doc skeleton-rows note).
4. **No separate `MessageActionSheet` exists per emoji-set whitelist** — free emoji input
   (THINK #2) means client-side validation is advisory only; `varchar(8)` CHECK is the real
   gate. Dev should not be tempted to add a hidden server-side emoji whitelist — out of scope.
5. **`MessageBubble` extraction is presentational-only** — Checker should verify it has zero
   `createClient()`/hook imports; if dev accidentally wires Supabase calls into it directly
   (instead of via props/callbacks from `DmThread`/`GroupThread`), that's an architecture
   violation of Q5's resolution above.
6. **Trigger functions use `language plpgsql`, not `security definer`** — they run with the
   privileges of whoever fires the INSERT (RLS still applies to the trigger's own subquery
   reads against `dm_messages`/`group_messages`, which the inserting user can already SELECT
   per existing policies) — no privilege escalation introduced.

**Next action**: `/build` (feature-builder implements hooks + components per this PLAN, runs
migration `0010_message_reactions_and_replies.sql` against Supabase Studio) → `/review`
(code-reviewer checks against this PLAN + TEST PLAN as acceptance standard) → flag Realtime
RLS live-verification gate explicitly in QA.

## QA

**Run**: 2026-06-25, by `dev` (Maker, running QA in absence of a dedicated live-DB pass —
static checks only, per task constraint that migrations 0005-0010 are NOT applied to the live
DB yet and Claude never applies migrations directly).

### What WAS verified (static, no live DB required)

| # | Check | Result |
|---|---|---|
| 1 | `npm run build` | PASS — Next.js 16.2.9 Turbopack build compiled successfully, TypeScript check clean, all routes generated (`/`, `/_not-found`, `/auth/callback`) |
| 2 | `npm run lint` | PASS — zero ESLint errors/warnings |
| 3 | `npm run test` | PASS — 9 test files, **76/76 tests passed** (matches expected count) |
| 4 | `npm run dev` + root route check | PASS — dev server started, `GET /` returned HTTP 200; server killed after check |
| 5 | Static re-read of `supabase/migrations/0010_message_reactions_and_replies.sql` | PASS — see detailed findings below |
| 6 | Confirm 3 post-review fixes present in code | PASS — all 3 confirmed, see below |

### Migration 0010 final static re-verification — detailed findings

- **REPLICA IDENTITY FULL statements (post-review fix, blocker #1)**: present and correctly
  placed. `alter table public.dm_message_reactions replica identity full;` immediately follows
  the `dm_message_reactions` table + index creation (line 156), and
  `alter table public.group_message_reactions replica identity full;` immediately follows the
  `group_message_reactions` table + index creation (line 175) — both BEFORE the RLS sections,
  syntactically valid, accompanied by a clear comment explaining the un-react Realtime DELETE
  payload gap they fix (`payload.old` missing `message_id`/`user_id`/`emoji` under default
  REPLICA IDENTITY).
- **Rollback block completeness**: the rollback comment block (end of file) correctly includes
  the two new reversal lines — `alter table public.group_message_reactions replica identity
  default;` and `alter table public.dm_message_reactions replica identity default;` — placed in
  proper reverse order (publication removal → replica identity reversal → policy drops → table
  drops → trigger/function drops → column/index drops), each annotated non-destructive/safe to
  re-run. No gaps found versus the forward migration's full set of DDL.
- **BEFORE INSERT reply-scope-check triggers**: both `dm_messages_check_reply_scope_before_write`
  and `group_messages_check_reply_scope_before_write` are defined as `before insert`, call
  `plpgsql` functions that subquery the same table for the target row's `conversation_id`/
  `group_id` and `raise exception` (plain, no `using errcode` — relevant to the P0001 check
  below) on mismatch or missing target. Logic correctly defends against cross-boundary replies
  (edge case #6) since FK alone cannot enforce same-conversation/same-group scoping.
- **`unique(message_id, user_id)` constraints**: `dm_message_reactions_one_per_user` and
  `group_message_reactions_one_per_user` both present, named consistently with what the design
  doc/testplan's trade-off note #1 requires for the hooks' `upsert(..., {onConflict:
  "message_id,user_id"})` calls to target correctly (replace-not-duplicate contract).
- No syntax issues found anywhere in the file on this re-read.

### 3 post-review fixes confirmed present in code

1. **REPLICA IDENTITY FULL** — confirmed in `supabase/migrations/0010_message_reactions_and_replies.sql` (lines 156, 175) — see above.
2. **`stopPropagation` in quoted message preview** — confirmed in
   `src/components/quoted-message-preview.tsx` (line 30): the `<button>`'s `onClick` calls
   `e.stopPropagation()` before `onJumpToOriginal()`, preventing tap-on-quote from also
   triggering the parent bubble's `onLongPress` action sheet (blocker #2 fix).
3. **`err.code === "P0001"` check (not string-match)** — confirmed in both
   `src/lib/use-dm-messages.ts` (line 335) and `src/lib/use-group-messages.ts` (line 348) —
   both replace the prior brittle substring-match on `err.message` with a SQLSTATE code check,
   correctly distinguishing the reply-scope trigger's plain `raise exception` (P0001) from RLS
   policy denial (42501), so a cross-boundary-reply rejection no longer gets misclassified as
   "unfriended"/"removed" and incorrectly locks out subsequent normal sends.

### What CANNOT be verified right now (blocked)

Migrations 0005 through 0010 have NOT been applied to the live Supabase DB (Claude does not
apply migrations directly per project convention — user runs them manually in Supabase Studio).
This blocks ALL live-DB-dependent verification for this feature, including:

- RLS enforcement for `dm_message_reactions`/`group_message_reactions` (insert/update/delete/
  select policies, friend/membership re-check at react-time vs send-time — edge cases #1, #5)
- `dm_messages_check_reply_scope` / `group_messages_check_reply_scope` trigger actually firing
  and rejecting cross-boundary replies (edge case #6, testplan E6/E7)
- REPLICA IDENTITY FULL actually fixing un-react Realtime DELETE propagation to non-actor
  viewers (testplan E5, the specific bug the post-review fix targets)
- Realtime cross-account delivery for reactions (testplan E1/E2/E15 — the RLS isolation gate
  that is explicitly called out as carried-forward risk for the 4th consecutive feature)
- `anon` role full block (testplan E14), DB CHECK backstop on long emoji (testplan E16)
- All Playwright e2e scenarios in `e2e/reactions-replies.spec.ts` (E1–E17) that depend on a
  live, multi-account, RLS-active database

### Overall status

**PARTIAL PASS — static checks pass; live DB verification BLOCKED pending user running
migrations 0005 through 0010 IN ORDER in Supabase Studio. This is the 4th and final feature in
the sequence — a SINGLE combined multi-account live verification pass covering friends, DM,
group chat, AND reactions/replies is now required before considering ANY of these 4 features
production-ready, not 4 separate passes.**

**Next action**: user applies migrations 0005→0010 in order in Supabase Studio, then runs ONE
combined live verification pass (multi-account, covering friend requests, DM chat, group chat,
and reactions/replies together) before any of these 4 stacked features is marked
production-ready. Until that combined pass runs and passes, treat the entire friends→DM→
group→reactions/replies stack as unverified for the Realtime-RLS assumption it all shares.
