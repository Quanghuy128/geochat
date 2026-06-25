# Test Plan — Friends / Contacts

> `/qa` đọc file này chạy từng bước. Mỗi bước: hành động → kết quả mong đợi.
> Mapping: mỗi case dưới đây khớp số thứ tự với "Acceptance criteria" trong `docs/loops/friends-STATE.md` (ANALYZE).
> Chưa có Playwright trong repo (chỉ Vitest) — case E2E viết theo format Playwright cho tương lai nhưng chạy THỦ CÔNG (2-3 tài khoản thật + 2-3 tab/browser) cho tới khi tooling được thêm.

## A. Build / static checks (chạy trước mọi thứ khác)

1. `npm run build` → PASS, không lỗi TS strict mới phát sinh từ feature này. *(Khớp acceptance criteria #12.)*
2. `npm run lint` → file mới (`use-friends.ts`, `use-friend-requests.ts`, `use-send-friend-request.ts`, `friends-button.tsx`, `friends-panel.tsx`, sửa `types.ts`/`page.tsx`) sạch; lỗi pre-existing (nếu có ở file khác) không tính.
3. `npm run test` (Vitest) → toàn bộ unit test pass, không có test cũ bị regress.

## B. Unit tests (Vitest) — pure logic, không cần Supabase thật

> Đặt tại file mới, ví dụ `src/lib/friend-request-utils.test.ts` nếu architect/dev tách phần validate thuần (self-check, status-transition check) ra hàm pure giống `username-utils.ts` — khuyến nghị để dễ test không cần mock Supabase. Nếu dev giữ logic trong hook, dùng test #4-#6 dưới dạng test hook với mock `createClient()`.

1. **Validate username rỗng/sai format trước khi gọi DB** (case #12): gọi `send("")`, `send("1abc")`, `send("ab")` → trả lỗi ngay (object có `error` khác null) — verify spy/mock KHÔNG gọi `supabase.from(...)` (không có round-trip DB nào xảy ra).
2. **Self-request check dùng `id` không dùng string username** (case #1 + edge case "case-sensitivity"): mock lookup trả `id` trùng `auth.uid()` (kể cả username input khác case, ví dụ `ALICE99` vs profile lưu `alice99`) → trả lỗi "tự gửi cho mình", không insert.
3. **Map lỗi unique violation (`23505`) → message đúng** (case #2): mock insert trả `error.code === "23505"` → hàm xử lý lỗi trả message "đã có lời mời đang chờ" (không phải message generic).
4. **Status transition hợp lệ** (pure function nếu có, ví dụ `canTransition(from, to, role)`): test các cặp hợp lệ (`pending→accepted` bởi recipient, `pending→rejected` bởi recipient, `pending→cancelled` bởi requester, `accepted→cancelled` bởi cả 2) trả `true`; cặp không hợp lệ (`accepted→pending`, `rejected→accepted`, `cancelled→accepted`) trả `false`.
5. **`rowToFriendRequest`/`rowToFriend` mapper** (snake_case → camelCase, giống `rowToMessage` trong `use-messages.ts`): input row mock → output đúng field, đúng kiểu (`createdAt`/`updatedAt` là string ISO).
6. **Hook null-safe khi Supabase chưa cấu hình** (giống `use-messages.ts` pattern): `createClient()` trả `null` → `useFriends()`/`useFriendRequests()` trả `{ friends: [] }`/`{ incoming: [], outgoing: [] }`, không throw, không crash.

## C. RLS tests (REST trực tiếp qua `curl`/Postgrest, giống cách `auth-STATE.md` đã làm) — cần Supabase project thật + 3 user test (A, B, C)

> Setup: tạo 3 user qua signup (A, B, C — dùng `username-utils.buildFakeEmail`), lấy JWT của từng user qua `/auth/v1/token?grant_type=password`. Dùng JWT trong header `Authorization: Bearer <jwt>` + `apikey: <anon key>` gọi REST `https://<project>.supabase.co/rest/v1/friend_requests`.

7. **Anon không SELECT được gì** (acceptance #11): `curl` không có `Authorization` (chỉ `apikey`) → GET `friend_requests` trả `[]` hoặc lỗi 401/403, KHÔNG trả data.
8. **Anon không INSERT được** (acceptance #11): POST không `Authorization` → 401/403, không tạo row (verify bằng service-role key sau đó: 0 row mới).
9. **A gửi request tới B (hợp lệ)** (acceptance #1): A POST `{requester_id: A.id, recipient_id: B.id, status: 'pending'}` với JWT của A → 201, đúng 1 row tạo. B GET (JWT của B) thấy row trong kết quả (filter `recipient_id=eq.{B.id}&status=eq.pending`). A GET (JWT của A) thấy row trong kết quả filter `requester_id=eq.{A.id}&status=eq.pending`.
10. **C không SELECT được request giữa A-B** (RLS select_own): C GET `friend_requests` (JWT của C, không filter) → kết quả KHÔNG chứa row A-B (verify bằng cách đếm tổng số row trả về tương ứng đúng số row liên quan đến C).
11. **A insert request với `requester_id` không phải mình** (RLS insert_as_requester): A POST `{requester_id: C.id, recipient_id: B.id, status:'pending'}` với JWT của A → 403/lỗi RLS, không tạo row.
12. **A insert thẳng `status='accepted'`** (RLS insert_as_requester check status='pending'): A POST `{requester_id: A.id, recipient_id: B.id, status:'accepted'}` → 403/lỗi RLS, không tạo row.
13. **Đã có pending, gửi lại từ B sang A (chiều ngược)** (acceptance #2, edge case #4/#5): sau test #9 (A→B pending tồn tại), B POST `{requester_id: B.id, recipient_id: A.id, status:'pending'}` (JWT của B) → 409/lỗi unique violation (`23505`), KHÔNG tạo row thứ 2. Verify bằng service-role: tổng số row pending giữa A-B vẫn là 1.
14. **Gửi request tới username không tồn tại** (acceptance #3): tầng application — không test REST trực tiếp (REST không biết "username"), test ở tầng hook/component (xem mục D #1).
15. **Gửi request tới chính mình** (acceptance #4): A POST `{requester_id: A.id, recipient_id: A.id, status:'pending'}` → 400/lỗi CHECK constraint `friend_requests_no_self`, không tạo row.
16. **B accept request từ A** (acceptance #5): B PATCH `friend_requests?id=eq.{requestId}` body `{status:'accepted'}` (JWT của B) → 200, row update thành `accepted`. Verify: A GET thấy row biến mất khỏi outgoing-pending filter (status đổi); cả A và B GET friends-derived query (status=accepted, liên quan đến mình) thấy row xuất hiện.
17. **B reject request từ A** (acceptance #6): (dùng request mới, chưa accept) B PATCH `{status:'rejected'}` → 200. Verify: row biến mất khỏi pending filter của cả A và B; KHÔNG xuất hiện trong accepted-query của ai.
18. **A cancel request đã gửi (còn pending)** (acceptance #7): (dùng request mới) A PATCH `{status:'cancelled'}` (JWT của A) → 200. Verify: biến mất khỏi outgoing của A và incoming của B.
19. **C cố accept/reject request giữa A-B** (acceptance #8): (dùng request mới pending giữa A-B) C PATCH `{status:'accepted'}` với JWT của C → 200 NHƯNG `data: []` (0 row matched bởi RLS `using`), verify bằng GET lại (JWT A hoặc service-role) row VẪN còn `status='pending'` — KHÔNG đổi.
20. **C cố cancel request giữa A-B** (acceptance #9): C PATCH `{status:'cancelled'}` với JWT của C trên request pending của A-B → `data: []`, verify row không đổi status.
21. **B cố accept lại 1 request đã rejected** (edge case #9): B PATCH `{status:'accepted'}` trên request đã có `status='rejected'` → `data: []` (vì `using status='pending'` không pass), row không đổi.
22. **A unfriend B sau khi đã accepted** (acceptance #10): A PATCH `{status:'cancelled'}` trên request đã `accepted` (JWT của A, dùng policy unfriend) → 200, row chuyển `cancelled`. Verify: cả A và B không còn thấy nhau trong accepted-query. Sau đó A gửi lại request mới tới B → 201 thành công (verify edge case #10 "không bị kẹt do dữ liệu cũ" — không bị chặn bởi index pending/accepted vì row cũ đã là `cancelled`).
23. **Trigger chặn đổi `requester_id` trong PATCH** (RLS rủi ro đã biết, mục PLAN 6.3): B PATCH `{status:'accepted', requester_id: C.id}` trên request pending A-B (JWT của B) → lỗi từ trigger `friend_requests_lock_identity_columns` ("không được đổi requester_id..."), row không đổi gì cả (không accept, không đổi requester_id).
24. **Trigger chặn đổi `created_at`**: tương tự #23, PATCH kèm `created_at` khác → lỗi trigger.

## D. Hook / component tests (Vitest, mock Supabase client) hoặc manual QA nếu mock phức tạp

1. **Username không tồn tại** (acceptance #3): mock `profiles` lookup trả 0 row → `useSendFriendRequest().send("khongtontai")` trả `{error: "Không tìm thấy username..."}`, verify KHÔNG có lệnh insert nào được gọi (spy).
2. **Đã là bạn, gửi lại** (edge case #3): mock lookup `accepted` row tồn tại giữa 2 user → `send()` trả lỗi "đã là bạn" TRƯỚC khi gọi insert (verify spy insert không gọi).
3. **AddFriendForm error display**: submit username rỗng → hiển thị lỗi inline đúng copy thiết kế ("Username không hợp lệ" hoặc tương đương), input giữ nguyên text (theo Interaction Notes).
4. **FriendsButton ẩn khi chưa login**: render với `user=null` → không có `<FriendsButton>` trong DOM (theo design doc 3.12 / mục Interaction Notes "Disabled state khi logged out").
5. **Badge count hiển thị đúng**: mock `useFriendRequests` trả `incoming: [r1, r2]` → `FriendsButton` render badge "2".

## E. Manual QA / E2E (2-3 browser tab thật, cần Supabase project + 2-3 user đã tạo) — chạy thay Playwright cho tới khi tooling sẵn

> Format mỗi case: Setup → Hành động → Kết quả mong đợi. Đánh số khớp acceptance criteria ANALYZE.

1. **(#1) Gửi + 2 list hiện đúng**: Tab A login user `alice`, Tab B login user `bob`. A mở FriendsPanel → tab Lời mời → "+ Thêm bạn" → nhập `bob` → Gửi. Kỳ vọng: A thấy `@bob` trong "Đang chờ phản hồi" ngay (không cần reload). B (đã mở FriendsPanel từ trước, KHÔNG reload trang) thấy `@alice muốn kết bạn` xuất hiện trong "Lời mời nhận được" **trong vòng vài giây, không cần F5** (verify Realtime, không phải polling).
2. **(#2) Duplicate pending**: tiếp B1, A thử gửi lại request tới `bob` lần 2 → lỗi inline "đã có lời mời đang chờ", không tạo thêm row (verify Tab B vẫn chỉ thấy 1 request từ alice).
3. **(#3) Username không tồn tại**: A gửi tới `khongtontai123` → lỗi "Không tìm thấy username".
4. **(#4) Tự gửi cho mình**: A gửi tới `alice` (chính username của mình) → lỗi "Không thể tự gửi lời mời cho chính mình".
5. **(#5) Accept → friends list cả 2 bên live**: B bấm "Chấp nhận" trên request của alice. Kỳ vọng: B thấy `@alice` xuất hiện ngay trong tab "Bạn bè" (không reload); request biến mất khỏi "Lời mời nhận được". Tab A (không reload, panel đang mở ở tab Lời mời) thấy request biến mất khỏi "Đang chờ phản hồi" VÀ chuyển sang tab "Bạn bè" thấy `@bob` xuất hiện — **không cần F5** (verify Realtime 2 chiều cho accept).
6. **(#6) Reject**: (request mới giữa A-C) C bấm "Từ chối" → request biến mất khỏi 2 phía, không ai xuất hiện trong friends list của nhau.
7. **(#7) Cancel outgoing**: (request mới A→B) A bấm "Hủy lời mời" trên outgoing pending row → biến mất khỏi outgoing (A) và incoming (B) ngay, không cần reload ở tab B.
8. **(#8) RLS qua UI** (đã verify kỹ qua REST ở mục C #19-20 — bước này chỉ xác nhận UI không cho phép thực hiện hành động sai vai trò ngay từ đầu): user C không thấy nút Accept/Reject nào cho request giữa A-B (vì C không SELECT được row đó — không hiện trong list của C).
9. **(#9) Tương tự #8** cho cancel — C không thấy nút "Hủy lời mời" của request A-B vì không nằm trong outgoing list của C.
10. **(#10) Unfriend + gửi lại**: sau khi A-B đã là bạn (từ case #5), A bấm "Hủy kết bạn" trên row `@bob` (qua confirm inline 3.11 design doc) → `@bob` biến mất khỏi friends list của A; tab B (không reload) cũng thấy `@alice` biến mất khỏi friends list của B (verify Realtime cho unfriend). Sau đó A gửi lại request tới `bob` → thành công, không bị lỗi "đã có request" (verify dữ liệu cũ không kẹt).
11. **(#11) Anon hoàn toàn không thấy gì**: mở incognito tab, không login, thử truy cập trực tiếp link app → không có `FriendsButton` trong header (theo "ẩn khi chưa login").
12. **(#12) Build pass**: đã verify ở mục A #1.

## F. Network/reconnect edge case (manual)

13. Tab A mở panel, tab B tắt wifi/mất mạng ~10s rồi nối lại (hoặc throttle Network trong DevTools → Offline → Online). Trong lúc B offline, A gửi 1 request mới tới B. Kỳ vọng: sau khi B online lại VÀ focus lại tab (hoặc `window.focus` event), badge/incoming list của B cập nhật đúng số mới — KHÔNG bị kẹt số cũ vô thời hạn (verify cơ chế `refetch on focus` đã thiết kế ở mục PLAN > Other edge cases).

---

**Ghi chú cho QA**: case ở mục C (RLS) là phần quan trọng nhất để nghiệm thu an toàn dữ liệu — không được skip dù tốn thời gian setup 3 user. Case ở mục E #1 và #5 (Realtime 2 chiều) là phần xác nhận giả định kỹ thuật rủi ro nhất trong PLAN (mục 6.3 — Supabase Realtime áp RLS cho Postgres changes) — nếu Realtime KHÔNG hoạt động như giả định, đây là bug nghiêm trọng cần quay lại `/plan` hoặc `/investigate`, KHÔNG tự vá tạm trong `/qa`.
</content>
