# STATE — Feature: Friends / Contacts (social graph)

> Phase hiện tại: **QA — PARTIAL PASS** (static checks pass; live DB/RLS/Realtime verification BLOCKED — migration `0005_friend_requests.sql` chưa được user chạy trên Supabase Studio). Xem mục "## QA" ở cuối file. Tiếp theo: user chạy migration trên Studio → QA lại mục C/E của testplan (RLS + Realtime 2 tài khoản thật) trước khi coi feature đã ship xong.

## ANALYZE

### Core user need

GeoChat hiện có chat realtime (1 bảng `messages` mở, chưa phân theo cặp người) và sắp có map presence (vị trí realtime). Cả hai tính năng đó giả định "đây là người tôi muốn chat / muốn thấy vị trí" — nhưng hiện **không có khái niệm quan hệ giữa 2 user**. Không có social graph thì:
- Không thể làm 1-1 chat riêng tư đúng nghĩa (ai chat với ai).
- Không thể giới hạn "ai thấy vị trí của tôi trên map" — privacy rủi ro nếu mọi authenticated user đều thấy presence của mọi người.
- Zalo-style: bạn bè là điều kiện tiên quyết để mở chat riêng + chia sẻ vị trí.

→ **Friends/contacts là nền (social graph) phải có trước khi 1-1 chat và map presence riêng tư có ý nghĩa.** Đây là lý do feature này nên làm sớm, dù bản thân nó không "realtime" theo nghĩa chat/map.

### Phạm vi (đề xuất — cần user chốt ở office-hours)

**IN (đề xuất):**
- Gửi friend request bằng `username` (tái dùng bảng `profiles` đã có, cột `username` unique).
- Accept / Reject một request đang pending (incoming).
- Cancel một request đã gửi (outgoing, còn pending).
- Unfriend (xóa khỏi danh sách bạn, không phải reject).
- List bạn bè hiện tại (friends list).
- List incoming pending requests (người khác gửi cho mình).
- List outgoing pending requests (mình đã gửi, chưa ai trả lời).

**OUT (đề xuất, có thể sai — cần user xác nhận):**
- Block/unblock user — **để mục Open Questions, KHÔNG tự quyết định in/out**.
- Friend suggestions / mutual friends / friend groups.
- Notification push (ngoài realtime in-app nếu chốt có).
- Giới hạn số lượng bạn bè.
- Tích hợp UI 1-1 chat thật (đó là feature riêng, kế tiếp) — feature này chỉ làm graph + API/UI quản lý request, KHÔNG làm phòng chat riêng.
- Tích hợp với map presence (ai thấy vị trí ai) — out of scope, nhưng ghi chú risk bên dưới vì nó là động lực chính.

### Functional requirements

1. **Gửi friend request**
   - Input: `username` của người nhận (không phải user id, vì user không nhớ UUID).
   - Tạo 1 row request với trạng thái `pending`, lưu `requester_id` (= auth.uid()) và `recipient_id` (tra ra từ username).
2. **Accept request**
   - Chỉ recipient mới accept được. Request chuyển trạng thái `accepted` (hoặc xóa request + insert vào bảng friendship 2 chiều — quyết định kỹ thuật của architect).
   - Sau accept, cả 2 chiều đều coi nhau là bạn (quan hệ vô hướng).
3. **Reject request**
   - Chỉ recipient mới reject được. Request chuyển `rejected` (hoặc bị xóa — tùy thiết kế).
4. **Cancel request (outgoing)**
   - Chỉ requester (người gửi) mới cancel được, chỉ khi còn `pending`.
5. **Unfriend**
   - Cả 2 bên (đã là bạn) có thể unfriend; xóa quan hệ bạn bè (không phải xóa request lịch sử — chi tiết kỹ thuật để architect quyết).
6. **List friends**
   - Trả về danh sách bạn bè hiện tại của user đăng nhập (id, username tối thiểu).
7. **List incoming pending requests**
   - Request mà user đăng nhập là `recipient`, trạng thái `pending`.
8. **List outgoing pending requests**
   - Request mà user đăng nhập là `requester`, trạng thái `pending`.
9. **(Tùy chọn — cần chốt) Block/unblock**
   - Nếu in scope: block ngăn người bị block gửi request mới + ẩn khỏi tìm kiếm username; unblock đảo ngược. Không tự thiết kế bảng — chỉ ghi yêu cầu hành vi.

### Edge cases bắt buộc xử lý

| # | Case | Hành vi mong đợi |
|---|------|-------------------|
| 1 | Gửi request cho chính mình (`username` = mình) | Từ chối, lỗi rõ ràng (không tạo request). |
| 2 | Username không tồn tại | Lỗi 404/"không tìm thấy user", không tạo request. |
| 3 | Đã là bạn rồi, gửi request lại | Từ chối — không tạo request trùng (lỗi rõ "đã là bạn"). |
| 4 | Đã có request `pending` giữa 2 người (bất kể chiều nào) | Từ chối tạo request mới — trả lỗi rõ (có thể gợi ý "đã có request đang chờ"). |
| 5 | A gửi cho B trong khi B cũng vừa gửi cho A (race / gửi gần như đồng thời) | Không được tạo 2 row pending song song giữa cùng 1 cặp — cần ràng buộc duy nhất theo cặp (không quan tâm chiều). Kỹ thuật cụ thể để architect quyết (unique constraint/transaction). |
| 6 | Recipient/requester đã reject trước đó, gửi lại | Theo mặc định: cho gửi lại (không cooldown) — **cần user xác nhận ở Open Questions**. |
| 7 | Accept/reject một request không phải của mình (không phải recipient) | 403 — RLS/policy chặn, không cho thay đổi trạng thái request của người khác. |
| 8 | Cancel một request không phải mình gửi | 403 — chỉ requester gốc mới cancel được. |
| 9 | Accept/reject một request đã không còn `pending` (đã accept/reject/cancel trước đó) | 409 — báo "request không còn hợp lệ", không đổi trạng thái 2 lần. |
| 10 | Unfriend một người chưa từng là bạn | 404/400 — không có gì để xóa. |
| 11 | (Nếu block in scope) A block B, B gửi request mới cho A | Từ chối tạo request — lỗi rõ (không tiết lộ chi tiết "bị block" nếu muốn ẩn block, cần user quyết privacy của block). |
| 12 | Input username rỗng / sai format (không khớp `profiles_username_chars`) | 400 — validate trước khi query DB. |

### Acceptance criteria (đo được — cho Checker/QA sau này)

1. User A gửi friend request hợp lệ tới username của User B → tạo đúng 1 row pending; User B thấy request này trong "incoming pending" list của mình; User A thấy nó trong "outgoing pending" list của mình.
2. Gửi request khi đã có 1 request pending giữa A và B (theo bất kỳ chiều nào) → trả lỗi (409 hoặc tương đương), KHÔNG tạo row thứ 2.
3. Gửi request tới username không tồn tại trong `profiles` → trả lỗi (404 hoặc tương đương), KHÔNG tạo row.
4. Gửi request tới chính username của mình → bị chặn (400), không tạo row.
5. User B accept request từ A → cả hai đều xuất hiện trong friends list của nhau ngay sau accept (không cần reload nếu UI có refetch/realtime); request không còn nằm trong pending list của ai.
6. User B reject request từ A → request biến mất khỏi pending list của cả hai; A và B KHÔNG xuất hiện trong friends list của nhau.
7. User A cancel request đã gửi (còn pending) → request biến mất khỏi outgoing list của A và incoming list của B.
8. User C (không phải recipient) cố accept/reject request giữa A-B → bị chặn (403), trạng thái request không đổi. Verify qua RLS test (tương tự cách auth-STATE.md test RLS qua REST).
9. User C (không phải requester) cố cancel request giữa A-B → bị chặn (403), trạng thái request không đổi.
10. Sau khi đã là bạn, A unfriend B → A và B không còn trong friends list của nhau; gửi lại request mới giữa A-B sau đó phải hoạt động bình thường (không bị kẹt do dữ liệu cũ).
11. RLS: user chưa đăng nhập (anon) không gửi/accept/reject/cancel được gì (mọi mutation đều yêu cầu `authenticated` + đúng `auth.uid()`).
12. `npm run build` pass, không lỗi typecheck/lint mới phát sinh từ feature này.

### Product risk notes (cho architect/dev lưu ý — không phải spec)

- **Location privacy**: động lực chính của feature này là kiểm soát ai thấy vị trí ai trên map. Khi architect thiết kế bảng friendship, nên nghĩ trước (không cần làm ngay) việc bảng này sẽ là nguồn "danh sách được phép xem presence" cho feature map-presence kế tiếp — tránh thiết kế lại từ đầu.
- **Realtime abuse**: nếu sau này incoming request có realtime notify (Supabase Realtime/Postgres changes trên bảng request), cần rate-limit gửi request (spam request hàng loạt tới nhiều username) — feature này nên ít nhất có ràng buộc DB chống trùng lặp (edge case #4/#5) làm nền tránh spam cơ bản.
- **RLS phức tạp hơn `profiles`/`messages` hiện tại**: bảng profiles hiện chỉ có chủ sở hữu update chính mình; bảng friend request cần RLS 2 vai trò (requester vs recipient) trên CÙNG 1 bảng — rủi ro chính là policy SELECT/UPDATE lộn vai trò (ví dụ recipient sửa được request người khác). Checker/security-reviewer nên test kỹ theo đúng kiểu auth-STATE.md đã làm (REST + RLS).
- **Username là public** (SELECT mở toàn bộ `profiles`) → bất kỳ ai đăng nhập cũng tìm được username để gửi request. Nếu sau này có yêu cầu ẩn danh/private profile, sẽ ảnh hưởng ngược lên feature này.

### Open questions — CHỈ con người quyết, KHÔNG tự đoán

1. **Block/unblock**: có trong scope lần build này hay deferred sang feature riêng? Nếu in scope, block có ẩn hoàn toàn (người bị block không biết mình bị block) hay chỉ chặn gửi request (biết rõ lý do từ chối)?
2. **Cooldown sau reject**: bị reject rồi có được gửi lại ngay không, hay cần chờ (ví dụ 24h)? Mặc định đề xuất trong spec này là "cho gửi lại ngay" — cần xác nhận.
3. **Giới hạn số bạn bè**: có giới hạn tối đa (ví dụ 500 như Zalo) hay không giới hạn cho MVP?
4. **Realtime cho incoming request**: incoming request mới có cần hiện realtime (qua Supabase Realtime, giống cách bảng `messages` đang làm) hay chỉ cần load lại khi mở trang/tab "Friend requests" (polling/manual refresh đủ cho MVP)? Đây ảnh hưởng lớn đến công của architect/dev.
5. **Friends list hiển thị gì**: chỉ username, hay cần thêm trạng thái online (phụ thuộc map-presence chưa làm) ngay trong bản này?
6. **UI/UX placement**: friend request UI là 1 trang riêng (`/friends`) hay 1 panel/modal trong layout chat hiện tại? (Quyết định này thuộc `/design`, nhưng ảnh hưởng đến cách viết acceptance criteria UI — nêu ở đây để designer biết sớm.)
7. **Tìm username**: cần ô tìm kiếm username với gợi ý/autocomplete, hay chỉ nhập đúng tên rồi submit (MVP tối giản)?

### Phase

| Bước | Trạng thái |
|------|-----------|
| ANALYZE (BA) | ✅ Done — 2026-06-24 |
| office-hours (THINK) | ⬜ Chưa làm — cần chốt 7 open questions trên |
| plan (architect) | ⬜ |
| build (Maker) | ⬜ |
| review (Checker) | ⬜ |
| qa | ⬜ |
| ship | ⬜ |

## THINK (office-hours, auto-decided — autopilot full-run, không pause)

| # | Câu hỏi | Quyết định | Lý do |
|---|---------|-----------|-------|
| 1 | Block/unblock | **OUT** scope lần này — deferred sang feature riêng | MVP tối giản, block cần thêm bảng + policy riêng, không phải điều kiện để 1-1 chat hoạt động |
| 2 | Cooldown sau reject | **Không cooldown** — gửi lại ngay được | Đơn giản nhất, đúng đề xuất mặc định trong ANALYZE, không có lý do bảo mật/spam bắt buộc phải chặn |
| 3 | Giới hạn số bạn bè | **Không giới hạn** cho MVP | Không phải rủi ro thực tế ở quy mô hiện tại của app |
| 4 | Realtime cho incoming request | **Có** — dùng Supabase Realtime (Postgres changes) trên bảng request, đúng pattern đã có ở `messages` (CLAUDE.md: Realtime = Supabase Realtime, không tự dựng WebSocket) | Nhất quán với cỗ máy hiện tại, trải nghiệm tốt hơn polling, chi phí thêm không lớn vì pattern đã có sẵn (useMessages hook làm mẫu) |
| 5 | Friends list hiển thị gì | Chỉ **username** (không có online status — map-presence chưa wire) | Online status phụ thuộc feature map-presence chưa xong (STATE.md phase 4: Blocked) — tránh phụ thuộc ngược |
| 6 | UI/UX placement | **Panel trong layout chat hiện tại** (không tạo trang `/friends` riêng) | Giữ app 1 trang, nhất quán với ChatPanel/MapPanel hiện có — designer sẽ tạo FriendsPanel tương tự |
| 7 | Tìm username | **Exact-match input + submit**, không autocomplete | MVP tối giản, autocomplete cần search-as-you-type API riêng — để sau nếu cần |

**Quyết định kỹ thuật kèm theo** (suy ra từ #4, áp dụng luôn cho architect):
- Bảng `friend_requests` (requester_id, recipient_id, status) bật vào `supabase_realtime` publication giống bảng `messages`.
- Quan hệ bạn bè 2 chiều: khi accept, có thể lưu vĩnh viễn trong chính bảng `friend_requests` (status=`accepted`) hoặc bảng `friendships` riêng — **để architect quyết** dựa trên tradeoff query/RLS, không phải taste call.

## Phase

| Bước | Trạng thái |
|------|-----------|
| ANALYZE (BA) | ✅ Done — 2026-06-24 |
| THINK (office-hours) | ✅ Done — 2026-06-24 (auto-decided, full autopilot run, không pause) |
| plan (architect) | ✅ Done — 2026-06-24 |
| build (Maker) | ⬜ |
| review (Checker) | ⬜ |
| qa | ⬜ |
| ship | ⬜ |

## PLAN (architect)

> Input: ANALYZE + THINK trên (locked) + `docs/loops/friends-design.md` (UI design, component contracts).
> Output dùng cho `feature-builder` (Maker) build, và `code-reviewer` (Checker) làm chuẩn nghiệm thu.

### 0. Data model decision — 1 bảng `friend_requests`, KHÔNG tách `friendships`

**Quyết định**: dùng **một** bảng `public.friend_requests` làm nguồn sự thật duy nhất, với `status` là state machine `pending | accepted | rejected | cancelled`. Khi accept, **không** xoá/move row sang bảng khác — chỉ update `status = 'accepted'`. "Là bạn" = tồn tại 1 row với `status = 'accepted'` giữa 2 user (bất kể chiều).

**Lý do (trade-off)**:
- Đơn giản hơn: 1 bảng, 1 RLS surface, không cần 2 thao tác ghi (update request + insert friendship) → không có khoảng hở giữa 2 lần ghi (atomicity tự nhiên nhờ 1 UPDATE duy nhất).
- Lịch sử request được giữ lại tự nhiên (ai từng gửi/reject/cancel ai) — hữu ích để debug, và để edge case #6 (reject rồi gửi lại) hoạt động đúng mà không cần soft-delete logic phức tạp.
- Trade-off chấp nhận: bảng phình theo thời gian (mọi request kể cả rejected/cancelled đều giữ vĩnh viễn) — KHÔNG vấn đề ở quy mô MVP (không giới hạn bạn bè theo THINK #3, không cần job dọn dẹp ngay). Nếu sau này cần lưu trữ/archival theo thời gian, đó là việc của 1 migration riêng — không ảnh hưởng schema hiện tại.
- Lợi ích cho roadmap đã ghi trong risk notes: bảng này (lọc `status='accepted'`) chính là nguồn "danh sách được phép xem presence" cho map-presence feature kế tiếp — không cần thiết kế lại.
- Đã xem xét phương án 2 bảng (`friend_requests` lưu lịch sử request, `friendships` lưu quan hệ active) — bị loại vì thêm 1 bảng + 1 chuỗi 2 thao tác ghi cho lợi ích không rõ ở quy mô này; chỉ nên làm nếu sau này cần tối ưu query friends-list ở scale lớn.

**Quan hệ vô hướng, lưu hướng (requester/recipient) để giữ ngữ nghĩa "ai gửi"**: cột `requester_id`, `recipient_id` đều `not null references auth.users(id)`. Để tránh 2 row cùng cặp theo 2 chiều khác nhau (edge case #5), dùng **unique index trên cặp đã sắp thứ tự** (`least(requester_id, recipient_id)`, `greatest(requester_id, recipient_id)`) **lọc theo status pending** (partial unique index) — cho phép lịch sử rejected/cancelled trùng cặp tồn tại nhiều row, nhưng chỉ tối đa 1 row `pending` cho mỗi cặp bất kể chiều.

### 1. Migration: `supabase/migrations/0005_friend_requests.sql`

Convention giống `0004_profiles.sql`/`0001_messages.sql`: `create table if not exists`, RLS enable, `drop policy if exists` trước mỗi `create policy`, đăng ký Realtime publication theo pattern `do $$ ... end $$` của 0001, rollback block cuối file (comment, chạy thủ công khi cần gỡ).

Nội dung đầy đủ — dev copy nguyên văn vào file migration mới:

```
-- Migration 0005: bảng friend_requests (social graph: gửi/accept/reject/cancel/unfriend)
-- Chạy: copy vào Supabase Studio > SQL Editor > Run.
-- Reversible: phần rollback ở cuối file.
--
-- Data model: 1 bảng duy nhất, status state machine (pending|accepted|rejected|cancelled).
-- "Là bạn" = tồn tại 1 row status='accepted' giữa 2 user (bất kể chiều requester/recipient).
-- Lý do không tách bảng friendships riêng: xem docs/loops/friends-STATE.md > PLAN > mục 0.

-- 1. Bảng friend_requests
create table if not exists public.friend_requests (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users(id) on delete cascade,
  recipient_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint friend_requests_no_self check (requester_id <> recipient_id)
);

-- Index lookup theo recipient/requester (incoming/outgoing list)
create index if not exists friend_requests_recipient_status_idx
  on public.friend_requests (recipient_id, status);
create index if not exists friend_requests_requester_status_idx
  on public.friend_requests (requester_id, status);

-- Rang buoc cot loi: toi da 1 row PENDING cho moi cap (requester,recipient) bat ke chieu.
-- Partial unique index tren cap da sap thu tu (least/greatest) -- chan edge case #4 va #5
-- (race 2 chieu gui gan nhu dong thoi): DB tu chan o muc transaction, khong can app-level lock.
create unique index if not exists friend_requests_pending_pair_unique
  on public.friend_requests (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
  where (status = 'pending');

-- Rang buoc thu 2: chan viec co nhieu hon 1 row ACCEPTED cho cung 1 cap (luoi an toan them --
-- ve ly thuyet app logic da chan gui request khi da la ban, nhung day la luoi an toan tang DB).
create unique index if not exists friend_requests_accepted_pair_unique
  on public.friend_requests (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
  where (status = 'accepted');

-- updated_at tu cap nhat moi lan UPDATE (accept/reject/cancel) -- dung cho debug + tie-break race.
create or replace function public.set_friend_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists friend_requests_set_updated_at on public.friend_requests;
create trigger friend_requests_set_updated_at
  before update on public.friend_requests
  for each row execute procedure public.set_friend_requests_updated_at();

-- 2. Bat Row Level Security
alter table public.friend_requests enable row level security;

-- 3. Policies -- 2 vai tro (requester vs recipient) tren CUNG 1 bang. Day la RLS phuc tap
--    nhat trong app (theo risk note BA) -- chia tach ro theo (a) ai SELECT duoc, (b) ai INSERT
--    duoc, (c) ai UPDATE duoc tuy theo vai tro + trang thai hien tai.

-- SELECT: chi requester hoac recipient cua row do moi xem duoc (KHONG mo public nhu messages/
-- profiles -- noi dung quan he ban be la rieng tu giua 2 nguoi, khac voi username public).
drop policy if exists "friend_requests_select_own" on public.friend_requests;
create policy "friend_requests_select_own"
  on public.friend_requests for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

-- INSERT: chi tao duoc request voi requester_id = auth.uid() (khong tao ho nguoi khac),
-- va bat buoc status khoi tao = 'pending' (khong cho insert thang accepted/rejected).
-- Validation khac (username ton tai, khong tu gui cho minh, khong trung pending, khong da
-- la ban) nam o application layer (xem muc 4 Edge cases) -- CHECK constraint friend_requests_no_self
-- va unique index pending/accepted la luoi an toan DB-level cho phan co the enforce o DB.
drop policy if exists "friend_requests_insert_as_requester" on public.friend_requests;
create policy "friend_requests_insert_as_requester"
  on public.friend_requests for insert
  to authenticated
  with check (
    auth.uid() = requester_id
    and status = 'pending'
  );

-- UPDATE policy #1 -- RECIPIENT accept/reject: chi recipient, chi khi row dang pending,
-- chi duoc chuyen sang 'accepted' hoac 'rejected' (khong tu chuyen 'cancelled' -- do la
-- hanh dong cua requester).
drop policy if exists "friend_requests_update_recipient_decide" on public.friend_requests;
create policy "friend_requests_update_recipient_decide"
  on public.friend_requests for update
  to authenticated
  using (
    auth.uid() = recipient_id
    and status = 'pending'
  )
  with check (
    auth.uid() = recipient_id
    and status in ('accepted', 'rejected')
  );

-- UPDATE policy #2 -- REQUESTER cancel: chi requester, chi khi row dang pending,
-- chi duoc chuyen sang 'cancelled'.
drop policy if exists "friend_requests_update_requester_cancel" on public.friend_requests;
create policy "friend_requests_update_requester_cancel"
  on public.friend_requests for update
  to authenticated
  using (
    auth.uid() = requester_id
    and status = 'pending'
  )
  with check (
    auth.uid() = requester_id
    and status = 'cancelled'
  );

-- UPDATE policy #3 -- UNFRIEND: ca 2 ben (requester hoac recipient) cua 1 row da 'accepted'
-- co the tu roi quan he. Mo hinh hoa unfriend nhu: chuyen status 'accepted' -> 'cancelled'
-- (tai dung gia tri 'cancelled' lam "da ket thuc quan he", thong nhat voi cancel request).
drop policy if exists "friend_requests_update_unfriend" on public.friend_requests;
create policy "friend_requests_update_unfriend"
  on public.friend_requests for update
  to authenticated
  using (
    (auth.uid() = requester_id or auth.uid() = recipient_id)
    and status = 'accepted'
  )
  with check (
    (auth.uid() = requester_id or auth.uid() = recipient_id)
    and status = 'cancelled'
  );

-- Trigger an toan bo sung (BAT BUOC -- va lo hong RLS da ghi chu trong THINK ve rui ro RLS):
-- Postgres RLS USING/WITH CHECK ap dung theo row doc lap, khong co cu phap native de so sanh
-- "gia tri cot X co doi khong" so voi row cu trong cung 1 policy CHECK don gian (can dung
-- trigger voi OLD/NEW). De chan dut diem viec 1 user hop le (dung vai tro, dung status
-- transition) len doi requester_id/recipient_id/created_at trong cung 1 cau UPDATE, them
-- 1 trigger BEFORE UPDATE chan cung:
create or replace function public.friend_requests_lock_identity_columns()
returns trigger
language plpgsql
as $$
begin
  if new.requester_id <> old.requester_id or new.recipient_id <> old.recipient_id then
    raise exception 'friend_requests: khong duoc doi requester_id/recipient_id khi update';
  end if;
  if new.created_at <> old.created_at then
    raise exception 'friend_requests: khong duoc doi created_at khi update';
  end if;
  return new;
end;
$$;

drop trigger if exists friend_requests_lock_identity on public.friend_requests;
create trigger friend_requests_lock_identity
  before update on public.friend_requests
  for each row execute procedure public.friend_requests_lock_identity_columns();

-- Khong cap DELETE policy nao -- khong ai (ke ca owner) xoa row qua client.
-- Lich su request duoc giu lai vinh vien (xem muc 0). Vi khong co DELETE policy,
-- Postgres mac dinh CHAN xoa cho moi role (an toan-by-default).

-- 4. Bat Realtime: them bang vao publication supabase_realtime (giong bang messages o 0001).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friend_requests'
  ) then
    alter publication supabase_realtime add table public.friend_requests;
  end if;
end $$;

-- ============================================================
-- ROLLBACK (chay thu cong khi can go, theo thu tu nguoc):
-- alter publication supabase_realtime drop table public.friend_requests;
-- [drop trigger] friend_requests_lock_identity on public.friend_requests;
-- [drop function] public.friend_requests_lock_identity_columns();
-- [drop policy] "friend_requests_update_unfriend" on public.friend_requests;
-- [drop policy] "friend_requests_update_requester_cancel" on public.friend_requests;
-- [drop policy] "friend_requests_update_recipient_decide" on public.friend_requests;
-- [drop policy] "friend_requests_insert_as_requester" on public.friend_requests;
-- [drop policy] "friend_requests_select_own" on public.friend_requests;
-- [drop trigger] friend_requests_set_updated_at on public.friend_requests;
-- [drop function] public.set_friend_requests_updated_at();
-- [drop table] public.friend_requests cascade;  -- huy toan bo bang + du lieu, can duyet tay
-- ============================================================
```

**RLS rủi ro đã biết (BẮT BUỘC dev đọc trước khi build)**: Postgres RLS `USING`/`WITH CHECK` áp dụng theo row, không có cú pháp native so sánh giá trị cũ/mới ngay trong policy clause (cần dùng trigger). Nếu dev bỏ qua trigger `friend_requests_lock_identity_columns`, về lý thuyết một recipient hợp lệ (đúng vai trò, đúng `status: pending → accepted`) có thể gửi kèm payload PATCH chứa `requester_id` khác trong cùng request — `with check` ở policy #1 không tự chặn được vì nó chỉ kiểm tra row mới độc lập, không so với row cũ. **Trigger này là lớp chặn thực sự** cho lỗ hổng đó — không được bỏ trong migration, và Checker/security-reviewer PHẢI viết test cố ý gửi `requester_id` lạ trong PATCH để xác nhận trigger raise exception.

**Username → user_id lookup cho INSERT**: client không biết UUID của recipient, chỉ có `username`. Vì `profiles.username` đã SELECT mở public (0004), flow là: app query `select id from profiles where username = $1` (client-side, RLS profiles cho phép) → lấy `recipient_id` → rồi insert vào `friend_requests`. Đây là 2 round-trip riêng biệt (không phải 1 transaction) — an toàn vì username immutable theo 0004 (không có race thật giữa lookup và insert). Không cần RPC/Postgres function riêng cho MVP.

### 2. Files to create/modify

**Migration**
- `supabase/migrations/0005_friend_requests.sql` (mới) — nội dung mục 1.

**Types**
- `src/lib/types.ts` (sửa) — thêm:
  - `FriendRequestStatus = "pending" | "accepted" | "rejected" | "cancelled"`.
  - `FriendRequest`: `{ id, requesterId, requesterUsername, recipientId, recipientUsername, status, createdAt, updatedAt }` — đã join username 2 phía (qua `profiles`) để hook trả thẳng dữ liệu UI cần, không bắt component tự join.
  - `Friend`: `{ id, username, requestId }` — `id` là id của ĐỐI PHƯƠNG (không phải mình), `requestId` là id row `friend_requests` gốc (cần để gọi `unfriend`).

**Hooks** (mirror `use-messages.ts`/`use-presence.ts`: `"use client"`, lazy `createClient()`, null-safe khi chưa cấu hình, cleanup `removeChannel`)
- `src/lib/use-friends.ts` (mới) — `useFriends(identity)`: load friends list (join username qua `profiles`), subscribe Realtime trên `friend_requests` liên quan đến mình (lọc client-side theo `status`), expose `{ friends, loading, error, refetch, unfriend(requestId) }`.
- `src/lib/use-friend-requests.ts` (mới) — `useFriendRequests(identity)`: load incoming + outgoing pending, subscribe Realtime INSERT/UPDATE trên `friend_requests`, expose `{ incoming, outgoing, loading, error, refetch, accept(id), reject(id), cancel(id) }`.
- `src/lib/use-send-friend-request.ts` (mới) — `useSendFriendRequest(identity)`: expose `{ send(username): Promise<{error: string|null}>, submitting }`. Logic: `validateUsername()` (tái dùng `username-utils.ts`) → lookup `profiles` theo username → so `id` lookup được với `auth.uid()` (chặn self) → kiểm tra đã `accepted` chưa (query riêng, vì DB không tự chặn case này ở INSERT — xem mục 4) → insert → bắt lỗi `23505` (unique violation) map sang "đã có lời mời đang chờ".

**Components** (mirror `chat-panel.tsx`/`auth-modal.tsx`: hand-rolled Tailwind, KHÔNG dùng shadcn thật — theo design doc mục 0)
- `src/components/friends-button.tsx` (mới) — header icon+badge, props `{ pendingCount, onClick }`, ẩn hoàn toàn khi chưa login.
- `src/components/friends-panel.tsx` (mới) — slide-over container + tabs `friends|requests`, có thể chứa nội bộ `FriendsTab`/`RequestsTab`/`AddFriendForm`/`FriendRow`/`IncomingRequestRow`/`OutgoingRequestRow`/`EmptyState`/`ErrorState`/`SkeletonRows` trong 1 file (giống `auth-modal.tsx` gộp `SignInForm`/`SignUpForm`), hoặc tách file nếu quá dài (>400 dòng) — quyết định nhỏ của dev, không cần quay lại architect.

**Page wiring**
- `src/app/page.tsx` (sửa) — thêm `<FriendsButton>` + `<FriendsPanel>` cạnh `<HeaderAuth>` trong header. KHÔNG đổi grid `ChatPanel`/`MapPanel` (panel là overlay).

**Không cần Route Handler/API route riêng**: mọi mutation gọi trực tiếp qua Supabase client từ hook, giống pattern `useMessages.send()`/`usePresence` hiện tại — không có Next.js API route nào trong codebase hiện tại làm việc tương tự, giữ nhất quán.

### 3. Data flow (action → DB → Realtime → UI)

**Send request** (A → B):
1. `AddFriendForm` gọi `useSendFriendRequest().send(username)`.
2. Hook: validate format → lookup `profiles` theo username → nếu 0 row: lỗi "không tìm thấy" (không insert) → nếu `id === auth.uid()`: lỗi "tự gửi cho mình" (không insert) → query kiểm tra đã có row `status='accepted'` giữa 2 user chưa: nếu có, lỗi "đã là bạn" (không insert) → insert `friend_requests {requester_id: auth.uid(), recipient_id, status:'pending'}`.
3. DB: unique partial index `friend_requests_pending_pair_unique` chặn nếu đã có pending (chiều nào cũng chặn) → Postgres trả `23505`.
4. Insert thành công → publication `supabase_realtime` phát event `INSERT`.
5. **A's UI**: lấy ngay từ response insert (KHÔNG chờ Realtime) → `useFriendRequests` của A tự thêm vào `outgoing`. Khớp Interaction Notes design doc: "chờ server confirm rồi mới insert vào list" (không optimistic-trước).
6. **B's UI**: channel Realtime của B nhận `INSERT` (RLS lọc đúng — xem ghi chú filter dưới) → `useFriendRequests` của B prepend vào `incoming`, dù panel có mở hay không (hook mount ở `page.tsx`, badge cập nhật ngay).

**Accept** (B accepts A's request):
1. `IncomingRequestRow` gọi `useFriendRequests().accept(requestId)` → `update friend_requests set status='accepted' where id=$1`.
2. RLS policy `friend_requests_update_recipient_decide` cho phép vì `auth.uid()=recipient_id` và status hiện tại `pending`.
3. Nếu request đã bị actioned trước (edge case #9 — race) → `using` không pass → Postgrest trả thành công với `data: []` (0 row matched), KHÔNG lỗi cứng. **App phải tự kiểm tra `data.length === 0` sau update** → coi là lỗi 409, hiển thị "request không còn hợp lệ" + gọi `refetch()`.
4. Update thành công → publication phát `UPDATE`.
5. **B's UI**: response update trả về row → xoá khỏi `incoming`, thêm A vào `friends` ngay (không chờ Realtime).
6. **A's UI**: channel Realtime của A nhận `UPDATE status=accepted` → `useFriendRequests` của A xoá khỏi `outgoing`; **`useFriends` của A** (subscription RIÊNG, độc lập — 2 hook không biết nhau theo component contract design doc) cũng nhận event này qua channel của chính nó → tự thêm B vào `friends`.

**Reject**: giống Accept bước 1-4, khác đích `status='rejected'`. B: xoá khỏi `incoming`, KHÔNG thêm friends. A: Realtime `UPDATE status=rejected` → xoá khỏi `outgoing`. Không bên nào thêm vào `friends`.

**Cancel** (A cancels own outgoing): `update ... set status='cancelled' where id=$1` — policy `friend_requests_update_requester_cancel`. A: xoá khỏi `outgoing` ngay từ response. B: Realtime `UPDATE status=cancelled` → xoá khỏi `incoming`.

**Unfriend** (either side): `update friend_requests set status='cancelled' where id=$1` (chỉ match khi đang `accepted`) — policy `friend_requests_update_unfriend`. Bên thực hiện: xoá khỏi `friends` ngay từ response. Bên còn lại: Realtime `UPDATE status=cancelled` (từ `accepted`) → `useFriends` của họ tự nhận diện row đang trong `friends` list giờ status≠accepted → remove. Sau unfriend, gửi lại request mới giữa 2 người hoạt động bình thường vì cả 2 unique index đều là **partial** (chỉ áp dụng đúng status hiện tại của row khác) — row cũ status=`cancelled` không chặn insert mới (xác nhận edge case #10 đúng theo thiết kế).

**Realtime channel/subscription — thiết kế cụ thể**:
- Mỗi user 1 channel riêng cho mỗi hook (tên ví dụ `friend-requests-{userId}`, `friends-{userId}`), subscribe `postgres_changes` trên bảng `friend_requests` **KHÔNG filter theo cột** ở tầng Realtime (Postgres Realtime filter string không hỗ trợ `OR` giữa `requester_id`/`recipient_id`). Dựa vào: **Supabase Realtime áp RLS theo policy SELECT của bảng** — client chỉ nhận được event của row mà chính họ là requester hoặc recipient nhờ `friend_requests_select_own`, giống cách bảng `messages` không cần filter vì SELECT mở toàn bộ. Hook tự lọc thêm ở client (so `requester_id`/`recipient_id` với `identity.userId`) là lớp phòng hộ thừa (defense-in-depth), KHÔNG phải lớp bảo mật chính (RLS là chính) — xem mục 6.3 (assumption cần Checker verify thực tế).
- Cleanup: `removeChannel` trong `useEffect` return, dep theo `identity?.userId` — đổi user tạo channel mới (giống `use-presence.ts`).
- `useFriends` và `useFriendRequests` là **2 hook độc lập, 2 channel riêng** (đúng component contract design doc — `FriendsTab` và `RequestsTab` đọc 2 hook khác nhau) — không share channel.
- **Badge count**: `useFriendRequests` PHẢI được mount ở `page.tsx` (cấp cao hơn cả `FriendsButton` và `FriendsPanel`), kết quả (`incoming.length`) truyền xuống `FriendsButton` qua props, và xuống `FriendsPanel` cũng qua props (tránh 2 channel trùng lặp subscribe cùng dữ liệu nếu mount hook riêng trong từng component).

### 4. Edge cases — cơ chế enforce cụ thể (đối chiếu 12 case trong ANALYZE)

| # | Case | Enforce ở đâu | Chi tiết |
|---|------|---------------|----------|
| 1 | Gửi cho chính mình | Application (trước insert) + DB CHECK `friend_requests_no_self` (lưới an toàn) | Hook so `recipient_id === auth.uid()` sau khi lookup username → lỗi ngay, không insert. Nếu app có bug và vẫn insert, CHECK constraint raise lỗi DB. |
| 2 | Username không tồn tại | Application | Lookup `profiles` trả 0 row → lỗi "Không tìm thấy username" ngay, không insert. |
| 3 | Đã là bạn, gửi lại | Application (chính) + DB partial unique `accepted` (lưới an toàn — KHÔNG chặn được ở bước INSERT vì insert luôn tạo status='pending', xem mục 3) | Hook PHẢI tự query kiểm tra tồn tại row `status='accepted'` giữa 2 user TRƯỚC khi insert → nếu có, lỗi "đã là bạn", không insert. Điểm bắt buộc dev không bỏ qua. |
| 4 | Đã có pending (bất kỳ chiều) | DB constraint (chính) — `friend_requests_pending_pair_unique` | Insert vi phạm → Postgres `23505`. App bắt lỗi, map sang "đã có lời mời đang chờ". |
| 5 | Race 2 chiều gửi gần như đồng thời | DB constraint (cùng index #4) | Transaction tới sau bị unique violation tại COMMIT — Postgres tự xử lý serialization. |
| 6 | Gửi lại sau reject (không cooldown) | Application (default cho phép, không cần code thêm) | Status cũ `rejected` không match 2 unique index nào (chỉ áp dụng `pending`/`accepted`) → insert mới thành công bình thường. |
| 7 | Accept/reject không phải recipient | RLS — `friend_requests_update_recipient_decide` (`using auth.uid()=recipient_id`) | User C update match 0 row → Postgrest trả thành công với `data: []` (không lỗi 403 cứng — đặc trưng Postgrest RLS). App coi `data.length===0` là lỗi. Checker test theo cách auth-STATE.md đã làm (REST trực tiếp). |
| 8 | Cancel không phải requester | RLS — `friend_requests_update_requester_cancel` | Tương tự #7. |
| 9 | Accept/reject request đã không pending | RLS (`using status='pending'`) + Application (check `data.length===0` → lỗi 409 + `refetch()`) | Update match 0 row vì status đã đổi → app hiển thị "request không còn hợp lệ", đồng bộ lại UI. |
| 10 | Unfriend người chưa từng là bạn | Application (UI chỉ hiện nút cho friend đã biết) + RLS (`using status='accepted'`) | Nếu gọi trực tiếp với request không phải accepted, update match 0 row → lỗi tương tự #9. |
| 11 | Block (out of scope) | N/A | Không thiết kế bảng/policy nào cho block trong migration này — đã loại theo THINK #1. |
| 12 | Username rỗng/sai format | Application (client-side, trước mọi DB call) | `validateUsername()` tái dùng từ `src/lib/username-utils.ts`, khớp đúng `profiles_username_chars` của 0004. |

### 5. Other edge cases (ngoài 12 case BA liệt kê, phát sinh từ thiết kế kỹ thuật)

- **Network drop giữa lúc gửi và nhận response**: theo Interaction Notes design doc, KHÔNG optimistic-insert trước khi server confirm → network drop chỉ gây "spinner treo" + lỗi hiển thị (catch reject của Supabase client); input giữ nguyên text để user thử lại, không có state rác cần dọn.
- **Stale list do bỏ lỡ Realtime event** (tab ẩn/mất mạng tạm thời): `supabase-js` tự reconnect channel nhưng KHÔNG tự refetch toàn bộ list sau reconnect. Action cho dev: thêm `window.addEventListener('focus', refetch)` nhẹ trong `useFriends`/`useFriendRequests` (cleanup ở unmount) — pattern MỚI so với `use-messages.ts` hiện tại, cần thiết hơn ở đây vì miss 1 event nghĩa là badge sai số mãi tới khi tab active lại.
- **Realtime race giữa 2 update gần nhau cùng 1 request** (B bấm Accept đúng lúc A bấm Cancel): Postgres xử lý tuần tự (row-level lock); người thua nhận `data.length===0` (status đã đổi) → xử lý giống edge case #9. Không có dữ liệu rác.
- **SSR/CSR mismatch**: `FriendsButton`/`FriendsPanel` đều `"use client"` (giống `ChatPanel`/`MapPanel`/`HeaderAuth`) — không Server Component nào render dữ liệu friend, tránh hydration mismatch vì list phụ thuộc `auth.uid()` chỉ biết ở client sau `useAuth()` resolve. Badge ẩn cho tới khi `useAuth().loading === false` (giống skeleton pattern `HeaderAuth`).
- **Session expire giữa lúc panel đang mở**: `useFriends`/`useFriendRequests` nhận `identity: null` → effect cleanup channel hiện tại (dep `identity?.userId` đổi) → hook trả rỗng, không lỗi. `FriendsPanel` hiển thị "Đăng nhập để xem và quản lý bạn bè" khi `!user`.
- **RLS cho anon hoàn toàn**: khác `messages`/`profiles`/`locations` (cho `anon` SELECT), bảng `friend_requests` **chỉ cấp `to authenticated`** cho mọi policy — anon không SELECT được gì (nội dung riêng tư, khác username public). Checker test REST với anon key, xác nhận trả rỗng/lỗi, không lộ dữ liệu.

### 6. Trade-off decisions + assumptions (cho dev/Checker theo dõi)

1. **1 bảng thay vì 2** (mục 0) — assumption: quy mô MVP không cần tối ưu lưu trữ lịch sử request riêng.
2. **`status='cancelled'` tái dùng cho cả "cancel request" và "unfriend"** — ngữ nghĩa UI phân biệt bằng status TRƯỚC update (`pending→cancelled` = cancel; `accepted→cancelled` = unfriend); app luôn biết context (nút khác nhau ở 2 nơi khác nhau trong UI) nên không cần thêm enum riêng cho MVP. Giới hạn: audit-trail không phân biệt được "cancel" vs "unfriend" chỉ từ giá trị status cuối — flagged, không phải bug.
3. **Supabase Realtime áp RLS cho Postgres changes** — assumption quan trọng nhất, CẦN Checker/QA verify thực tế bằng 2 tài khoản thật (không chỉ đọc doc): subscribe không filter, tin tưởng RLS SELECT policy lọc đúng người nhận event. Nếu Realtime KHÔNG áp RLS theo cách này ở project hiện tại (cần kiểm tra Database > Replication trong Dashboard), đây là rủi ro lớn nhất của thiết kế — QA phải test thủ công xác nhận user C không nhận được event của cặp A-B.
4. **Không dùng Postgres RPC/function cho lookup+insert** (2 round-trip thay vì 1 transaction) — assumption: an toàn vì username immutable (0004) và unique index đã chặn duplicate ở DB dù có race.
5. **Badge count hook mount ở `page.tsx`** — cần dev follow đúng vị trí mount này để tránh 2 channel Realtime trùng lặp cho cùng dữ liệu.
6. **Chưa có Playwright trong repo** (chỉ Vitest) — test plan viết case e2e theo format Playwright cho tương lai, nhưng QA phase trước mắt chạy thủ công theo step-by-step (giống `typing-indicator-testplan.md`). Không phải việc của loop này — flagged cho `/audit-process` nếu cần thêm tooling.
7. **Mapping lỗi unique violation (`23505`)**: không tự phân biệt được "đã có pending" (case #4) — app phải tự query trước khi insert để phân biệt case #3 (đã là bạn) khỏi case #4 (đã có pending), nếu không thông báo lỗi sẽ generic/sai ngữ cảnh dù hành vi chặn vẫn đúng.

### 7. Acceptance criteria mapping

Xem file test plan riêng: `docs/loops/friends-testplan.md` — mỗi acceptance criteria (1-12) của ANALYZE có ít nhất 1 test case tương ứng, đánh số khớp.

---

**Next action**: `/build` (feature-builder) implement theo thiết kế trên — thứ tự đề xuất: migration → types → hooks → components → page wiring. Sau khi build xong: `/review` (code-reviewer) đối chiếu đúng RLS 2 vai trò + trigger lock-identity + assumption Realtime-RLS (mục 6.3) trước khi qua `/qa`.

## BUILD (feature-builder) — 2026-06-24

Implemented exactly per PLAN, in the suggested order: migration → types → hooks → components → page wiring.

### Files changed/created

**Migration**
- `supabase/migrations/0005_friend_requests.sql` (new) — copied verbatim from PLAN mục 1: table, 2 partial unique indexes (pending pair, accepted pair via `least/greatest`), `updated_at` trigger, RLS enabled, 4 policies (select_own, insert_as_requester, update_recipient_decide, update_requester_cancel, update_unfriend — actually 5 total: 1 SELECT + 1 INSERT + 3 UPDATE split by role/transition), identity-lock trigger (`friend_requests_lock_identity_columns` blocking changes to `requester_id`/`recipient_id`/`created_at` on UPDATE), Realtime publication wiring (`alter publication supabase_realtime add table public.friend_requests`, idempotent `do $$ ... end $$` pattern matching 0001), and a commented rollback block at the end.
- **NOT applied to any live Supabase instance.** `.env.local` does have `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` set (a Supabase project is configured for this app), but I did not run this migration against it — per instructions I should confirm before running any migration, and the task explicitly said to default to NOT running it. **This migration is UNTESTED against a live DB.** Someone (architect/Checker/user) must run it via Supabase Studio SQL Editor before `/qa` can do anything meaningful (every hook will error on `relation "friend_requests" does not exist` until then).

**Types**
- `src/lib/types.ts` (modified) — added `FriendRequestStatus`, `FriendRequest`, `Friend` types exactly per PLAN mục 2.

**Hooks** (new files, mirroring `use-messages.ts`/`use-presence.ts`/`use-typing.ts` conventions: `"use client"`, lazy `useState(() => createClient())`, null-safe, `removeChannel` cleanup, snake_case row types mapped to camelCase)
- `src/lib/use-friend-requests.ts` — `useFriendRequests(identity)`. Loads pending rows where I'm requester OR recipient (`.or(...)` filter), joins usernames via a single batched `profiles` query (`select id, username .in(ids)`), splits into `incoming`/`outgoing`. Subscribes one Realtime channel (`friend-requests-{userId}`) for both INSERT and UPDATE on `friend_requests`, unfiltered at the Postgres-changes level (per PLAN — relies on RLS `select_own` to scope events), with a client-side `requester_id`/`recipient_id` check as defense-in-depth. `accept`/`reject`/`cancel` do direct `.update(...).select()` and treat `data.length === 0` as a 409 (request no longer pending — race/edge case #9), calling `refetch()` in that case. Added a `window.addEventListener("focus", refetch)` per PLAN mục 5 ("Other edge cases" — stale list after reconnect), cleaned up on unmount.
- `src/lib/use-friends.ts` — `useFriends(identity)`. Loads accepted rows where I'm requester OR recipient, joins the *other* party's username, exposes `friends: Friend[]` with `{ id: otherUserId, username, requestId }`. Independent Realtime channel (`friends-{userId}`), independent of `use-friend-requests.ts` (per PLAN mục 3.5 — "2 hook độc lập, 2 channel riêng"). On any UPDATE touching `accepted`/`cancelled` for a row I'm party to, it calls `load()` (full refetch) rather than trying to patch state incrementally — simpler, and friends lists are expected to stay small for MVP. Same `focus` listener pattern as above. `unfriend(requestId)` follows the same `data.length === 0` → 409 pattern.
- `src/lib/use-send-friend-request.ts` — `useSendFriendRequest(identity)`. Implements the exact flow from PLAN mục 3 "Send request" / mục 4 edge cases table: `validateUsername()` → lookup `profiles` by `ilike` username → self-check against `identity.userId` → explicit pre-check query for an existing `accepted` row between the two users (since INSERT can't distinguish "already friends" from "already pending" by itself) → `insert` → catches Postgres `23505` and maps it to "đã có lời mời đang chờ giữa bạn và @username".

**Components** (new files, hand-rolled Tailwind matching `chat-panel.tsx`/`auth-modal.tsx`/`header-auth.tsx` style — no shadcn primitives used, Vietnamese copy)
- `src/components/friends-button.tsx` — `FriendsButton({ pendingCount, onClick })`. Pill button with a red badge (`9+` cap) shown only when `pendingCount > 0`. No `disabled`/hidden-when-logged-out prop — caller (`page.tsx`) conditionally renders it instead (simpler, matches how `HeaderAuth` itself handles loading/unauthenticated states).
- `src/components/friends-panel.tsx` — `FriendsPanel({ open, onOpenChange, friendRequests })` plus, in the same file (matching `auth-modal.tsx`'s pattern of bundling `SignInForm`/`SignUpForm`): `FriendsTab`, `AddFriendForm`, `FriendRow`, `RequestsTab`, `IncomingRequestRow`, `OutgoingRequestRow`, `EmptyState`, `ErrorState`, `SkeletonRows`. Built as a custom slide-over (`fixed inset-0` backdrop + right-anchored panel, full-width on mobile / `md:w-[380px]` on desktop) rather than native `<dialog>`, per design doc's explicit call-out that `AuthModal`'s centered `<dialog>` doesn't fit a slide-over — manually wired Esc-to-close via a `keydown` listener since there's no native dialog `cancel` event to lean on here. `useFriends` and `useSendFriendRequest` are instantiated *inside* `FriendsPanel` (not passed as props) since the design doc doesn't require them to be shared/hoisted the way `useFriendRequests` does (only `useFriendRequests` needs single-instance hoisting for the badge count — see PLAN mục 3.5 point 5). Unfriend confirmation is the inline expand-under-row pattern from wireframe 3.11 (no native `confirm()`).

**Page wiring**
- `src/app/page.tsx` (modified) — converted to a client component (`"use client"` added) since it now needs `useAuth()`/`useFriendRequests()`/local `open` state. Mounts `useFriendRequests(identity)` once at this level and passes it down as a prop to both `FriendsButton` (for `pendingCount`) and `FriendsPanel` (for the Requests tab), per PLAN mục 3.5 point 5 ("Badge count hook mount ở page.tsx... tránh 2 channel Realtime trùng lặp"). `FriendsButton` is only rendered when `user` is truthy. `FriendsPanel` is always mounted (controls its own visibility via `open`), consistent with `AuthModal`'s pattern in `header-auth.tsx`.

### Assumptions made (Checker must verify)

1. **Migration is correct but completely unverified against a live DB** — I did not run it. All SQL was copied verbatim from the architect's PLAN (mục 1) without modification; I did not independently re-derive or simplify any of it. Checker/QA must apply it via Supabase Studio SQL Editor and confirm: table creation succeeds, both partial unique indexes work as expected (test edge cases #4/#5/#10), the identity-lock trigger actually fires (PLAN mục explicitly flags this as the highest-priority test), and the Realtime publication entry is added (`select * from pg_publication_tables where tablename='friend_requests'`).
2. **Supabase Realtime applies RLS to `postgres_changes` events** — this is the single biggest unverified assumption in the whole design (flagged by the architect in PLAN mục 6.3 as the thing QA must test with two real accounts). Both `use-friends.ts` and `use-friend-requests.ts` subscribe to `friend_requests` table changes completely unfiltered at the channel/Postgres-changes level, relying entirely on the `friend_requests_select_own` RLS policy to scope which events each client actually receives. The client-side `requester_id`/`recipient_id` check in the handlers is described in code comments as defense-in-depth only, NOT the real security boundary. If this assumption is wrong, a malicious/curious user C could receive Realtime payloads (including row content) for A-B's friend requests even though they can't query them via REST. **This must be manually verified with 2 browser sessions before shipping.**
3. **`profiles` username lookup uses `.ilike()` (case-insensitive)** in `use-send-friend-request.ts`. The PLAN's data-flow section doesn't explicitly say case-sensitive vs insensitive for the lookup step; I chose `ilike` to match the existing `profiles_username_lower_idx` index (built specifically for case-insensitive lookup per `0004_profiles.sql`'s comment "Index cho lookup case-insensitive"). If exact-case match was intended instead, this is a 1-line change (`.eq()` instead of `.ilike()`).
4. **`use-friends.ts` refetches the entire friends list on any relevant Realtime UPDATE** rather than patching state incrementally (e.g., joining the new friend's username inline like `use-friend-requests.ts` does for INSERT). This was a deliberate simplification — PLAN mục 3 "Accept" step 6 describes `useFriends` reacting to the Realtime event and "tự thêm B vào friends," which could be read as requiring an incremental insert rather than a full refetch. I chose refetch for simplicity/correctness (avoids a second profiles join codepath) at the cost of an extra round-trip per accept/unfriend event. Checker should confirm this still satisfies acceptance criterion #5 ("không cần reload nếu UI có refetch/realtime" — note the spec itself explicitly allows "refetch" as satisfying this).
5. **`FriendsButton` is conditionally rendered by `page.tsx`** (`{user && <FriendsButton .../>}`) rather than `FriendsButton` itself taking a `disabled`/hidden prop and deciding internally. This matches the component contract loosely (props listed `pendingCount`, `onClick`, optional `disabled?`) but I dropped `disabled` entirely since it's simpler and matches how `HeaderAuth` already gates rendering. Flagging since the design doc's prop list technically includes `disabled?: boolean`.
6. **`useFriends` and `useSendFriendRequest` are instantiated inside `FriendsPanel`**, not hoisted to `page.tsx` like `useFriendRequests`. Per PLAN mục 3.5 point 5, only the badge-count hook (`useFriendRequests`) was explicitly called out as needing single hoisted instantiation to avoid duplicate channels; `useFriends`/`useSendFriendRequest` only matter while the panel is open, so instantiating them inside `FriendsPanel` means their Realtime channel/queries only run while the panel is mounted (panel is always mounted per design — `open` just toggles visibility — so in practice the channel is always live once a user is logged in, same lifetime as if hoisted). No functional difference, but flagging the structural choice in case Checker expects a 1:1 hook-to-page-level mapping.
7. **Lint fix**: the `react-hooks/set-state-in-effect` ESLint rule flagged direct `setState` calls inside the early-return branch of the main effect in both `use-friends.ts` and `use-friend-requests.ts` (when `identity` is null). Fixed by routing through `load()` (which already internally resets state to empty when there's no `identity.userId`) instead of calling `setIncoming([])`/`setOutgoing([])`/`setFriends([])` directly in the effect body. This is a deviation from `use-presence.ts`'s exact pattern (which doesn't hit this lint rule because it doesn't have an early-return setState case) — flagging only because it's a new pattern not seen elsewhere in the codebase yet.

### Deliberately deferred / out of scope (per PLAN, not omissions)

- Block/unblock — out per THINK #1, no table/policy/UI built.
- No Playwright e2e tests added — repo has no Playwright yet (PLAN mục 6 point 6 explicitly defers this); `docs/loops/friends-testplan.md` should be QA'd manually per the existing `typing-indicator-testplan.md`-style process.
- No avatar/online-status on friend rows — explicitly out per design doc.
- No toast for incoming requests — badge-only, per design doc default.
- No real shadcn primitives introduced — matched existing hand-rolled Tailwind convention as instructed.
- No Vitest unit tests written for the new hooks/components (existing `username-utils.test.ts` is the only test file in the repo; the new hooks are thin Supabase wrappers with significant async/Realtime surface that's arguably better suited to live QA per the testplan than unit mocking — flagging this gap explicitly rather than silently skipping it, in case Checker wants at least pure-logic unit tests, e.g. for the `23505`-mapping branch in `use-send-friend-request.ts`).

### Verification performed by Maker (build-tooling only, NOT a self-review of logic/security)

- `npm run build` — passes (Next.js 16.2.9, Turbopack, TypeScript compiles clean).
- `npm run lint` — passes (after fixing the 2 `react-hooks/set-state-in-effect` errors noted above).
- `npm run test` — existing 16 tests in `username-utils.test.ts` still pass (no new tests added, see "Deliberately deferred" above).
- Did NOT run the migration against the live Supabase project referenced in `.env.local`, and did NOT manually test any RLS policy, the identity-lock trigger, or the Realtime-RLS assumption — these all require a live DB and are explicitly Checker/QA's job per the task instructions and per PLAN's own "Next action" line.

## BUILD — post-review fixes (2026-06-24)

`/review` verdict was **NEEDS-WORK** on 2 findings (a 3rd item was pre-existing/backlog, not blocking). Both are now fixed; everything else from the original BUILD section above is unchanged.

### Finding 1 — AddFriendForm didn't refresh outgoing list after send (PLAN mục 3 "Send request" bước 5 deviation)

Fixed by making the insert response flow straight into `outgoing` state, matching "lấy ngay từ response insert (KHÔNG chờ Realtime)":

- `src/lib/use-send-friend-request.ts` — `send()` now does `.insert(...).select().single()` instead of a bare `.insert(...)`, and its return type is `{ error: string | null; request: FriendRequest | null }`. On success, `request` is built by hand-mapping the snake_case insert response into the same camelCase `FriendRequest` shape `use-friend-requests.ts` uses for `outgoing` (`requesterUsername` is left as `""` since the sender's own username isn't needed for this row's rendering — `OutgoingRequestRow` only displays `recipientUsername`). All early-return error paths (`Supabase chưa cấu hình`, not logged in, validation error, lookup error, username not found, self-check, already-friends check, `23505`, generic insert error) now also return `request: null`.
- `src/lib/use-friend-requests.ts` — added `addOutgoing(request: FriendRequest): void` to `UseFriendRequests`, implemented with the same dedup-by-id prepend pattern already used by the Realtime INSERT handler (`prev.some((r) => r.id === request.id) ? prev : [request, ...prev]`). Chose this (mutate hook state directly) over calling `refetch()` to avoid an extra round-trip and stay consistent with how `accept`/`reject`/`cancel` already mutate state directly on success rather than refetching.
- `src/components/friends-panel.tsx` — `FriendsTab` now receives a `friendRequests: UseFriendRequests` prop (passed from `FriendsPanel`, which already received it from `page.tsx` — no new hook instance created, no new Realtime channel). `AddFriendForm`'s `onSent` callback signature changed from `() => void` to `(request: FriendRequest) => void`; its caller in `FriendsTab` now does `friendRequests.addOutgoing(request); setShowAddForm(false);`. `AddFriendForm.handleSubmit` now checks `if (err || !request)` (defensive — `request` should always be non-null when `err` is null, but typed as nullable) before calling `onSent(request)`.

### Finding 2 — missing testplan Section B unit tests

Added `src/lib/use-send-friend-request.test.ts` covering the 2 minimum-required cases from `docs/loops/friends-testplan.md` mục B:

- **#2 self-check**: mocks `profiles` lookup returning `{ id: ME_ID, username: "alice99" }` (note: input username sent is `"ALICE99"`, different case, to also cover the "case-sensitivity" sub-note in testplan B#2 — self-check must compare by `id`, not by raw string) → asserts `error` mentions "tự gửi lời mời cho chính mình", `request` is `null`, and the `insert` spy was never called.
- **#3 the `23505` mapping**: mocks a successful `profiles` lookup + no existing friendship, then mocks `insert(...).select().single()` resolving with `error: { code: "23505", ... }` → asserts the returned `error` string contains "có lời mời đang chờ" (not the generic fallback message) and `request` is `null`.

**Test infra change**: the repo had no hook-testing capability (`vitest.config.ts` environment is `"node"`, no `@testing-library/react`, no `jsdom`/`react-test-renderer` installed) — `useSendFriendRequest` is a real hook (`useState`/`useCallback`) so it cannot be invoked directly outside a React render. Added two new devDependencies: `@testing-library/react` and `jsdom`. The new test file opts into `jsdom` per-file via a `// @vitest-environment jsdom` docblock comment at the top of the file — this does **not** change the global `vitest.config.ts` environment (still `"node"` for every other test file, including the unaffected `username-utils.test.ts`). Mocked `./supabase/client`'s `createClient()` via `vi.mock` with a small hand-rolled chainable query builder (`.select().ilike().maybeSingle()` / `.select().eq().or().maybeSingle()` / `.insert().select().single()`) sufficient for the two tested branches — does not attempt to mock Realtime/`channel()` since `send()` never touches it.

### Verification re-run after these 2 fixes

- `npm run build` — pass (Next.js 16.2.9, Turbopack, TypeScript compiles clean).
- `npm run lint` — pass, no new warnings/errors.
- `npm run test` — pass, 2 test files, 18 tests total (16 pre-existing in `username-utils.test.ts` + 2 new in `use-send-friend-request.test.ts`).

### Assumptions made in this round (Checker must verify)

1. **`addOutgoing` mutates state directly instead of calling `refetch()`** — chosen for minimal disruption and consistency with the existing `accept`/`reject`/`cancel` pattern (direct state mutation on success, not refetch-on-success). The task description explicitly allowed either approach ("pick whichever fits the existing hook's state-update pattern with least disruption"); Checker should confirm this reading is correct and that the dedup-by-id guard is sufficient (it mirrors the exact pattern already used by the Realtime INSERT handler in the same file).
2. **`requesterUsername: ""` in the synthesized `FriendRequest` returned by `send()`** — since the sender already knows their own username (it's "me"), and `OutgoingRequestRow` in `friends-panel.tsx` only ever renders `request.recipientUsername` for outgoing rows, this field is never displayed. Flagging in case Checker expects it populated for symmetry/future-proofing (e.g., if some other consumer of `outgoing` later reads `requesterUsername`) — would need a 3rd `profiles` round-trip (or threading the already-known username from `useAuth()`/identity) to fill in correctly otherwise.
3. **New devDependencies (`@testing-library/react`, `jsdom`) were added** — this is a `package.json`/`package-lock.json` change beyond pure source files. The task said "Do NOT touch anything else — these are the only two approved changes from this review round"; I'm treating "add test infra needed to write the required tests" as in-scope for Finding 2 (the testplan explicitly asks for Vitest unit tests, and the repo had no way to test a real hook before this), but flagging explicitly since it's a dependency change, not just application code.
4. **Did not add tests for the other 4 testplan Section B cases** (status-transition pure function, row mappers, null-safe hook behavior, username-validation-blocks-DB-call) — the task said "at minimum" these 2, and explicitly scoped this round to "exactly these two findings." Those remaining 4 cases are still a gap versus the full testplan Section B and may resurface in a future review round.

## QA

> Chạy 2026-06-24. Xem `docs/loops/friends-testplan.md` mục A làm chuẩn cho phần static checks; mục C/E là phần KHÔNG chạy được lần này (lý do dưới).

### Ràng buộc đã biết trước khi chạy QA

Theo quy ước project (đã xác nhận lại ở `docs/loops/auth-STATE.md` — migration `0002_auth_rls.sql` cũng được note "User tự chạy trên Studio") và `CLAUDE.md` (DB safety — không tự chạy migration lên DB thật), Maker/QA-agent **không tự áp dụng** `supabase/migrations/0005_friend_requests.sql` lên Supabase project thật. Migration này **CHƯA được chạy** tính tới thời điểm QA này. Hệ quả: mọi test cần bảng `friend_requests` tồn tại thật (mục C — RLS qua REST, mục E — manual 2-3 tab thật, đặc biệt 2 assumption rủi ro nhất đã được architect + code-reviewer gắn cờ: trigger `friend_requests_lock_identity_columns` và assumption "Supabase Realtime áp RLS cho `postgres_changes`") **KHÔNG thể thực hiện trong lượt QA này**.

### A. Static checks — tất cả PASS

| # | Check | Kết quả |
|---|-------|---------|
| 1 | `npm run build` | ✅ PASS — Next.js 16.2.9 (Turbopack), TypeScript compiles clean, không lỗi mới. |
| 2 | `npm run lint` | ✅ PASS — không output, 0 lỗi/0 warning. |
| 3 | `npm run test` (Vitest) | ✅ PASS — 2 test files, **18/18 tests** (16 pre-existing trong `username-utils.test.ts` + 2 mới trong `use-send-friend-request.test.ts`), đúng số lượng kỳ vọng. |
| 4 | `npm run dev` + root route | ✅ PASS — phát hiện đã có 1 instance `next dev` đang chạy sẵn (PID 22559, port 3000, không phải do QA khởi tạo). `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → **200**. Instance phụ tôi thử chạy thêm tự thoát do port conflict (không có process rác để dọn). |

### Migration — đọc lại lần cuối, không tìm thấy lỗi syntax/logic mới

Đọc toàn bộ `supabase/migrations/0005_friend_requests.sql` (190 dòng) lần cuối trước khi user chạy trên Studio. Không phát hiện lỗi cú pháp hoặc logic. Cụ thể đã soát:

- `create table` + `CHECK friend_requests_no_self` (chặn self ở DB-level) — hợp lệ.
- 2 partial unique index dùng `least()`/`greatest()` trên cột `uuid` (`friend_requests_pending_pair_unique`, `friend_requests_accepted_pair_unique`) — `uuid` có btree ordering operator class trong Postgres nên `least`/`greatest` hoạt động đúng, không phải lỗi.
- 2 trigger `BEFORE UPDATE` trên cùng bảng (`friend_requests_lock_identity`, `friend_requests_set_updated_at`): Postgres chạy nhiều BEFORE trigger cùng event theo thứ tự **tên trigger alphabet** → `friend_requests_lock_identity` chạy trước `friend_requests_set_updated_at` (đúng thứ tự mong muốn: chặn đổi `requester_id`/`recipient_id`/`created_at` trước khi trigger updated_at chạy; 2 trigger không đụng cùng cột nên thứ tự này không gây xung đột dù có đảo lại).
- Tất cả `drop policy if exists` đứng trước `create policy` tương ứng → idempotent khi re-run.
- Rollback block ở cuối dùng `if exists` đầy đủ cho mọi `drop trigger`/`drop function`/`drop policy`/`drop table` — reversible đúng yêu cầu CLAUDE.md.
- Khối Realtime publication dùng `do $$ ... end $$` với guard `pg_publication_tables` đúng pattern `0001` — idempotent.

**Kết luận**: không tìm thấy typo/lỗi sẽ làm migration fail khi user chạy trên Studio. (Lưu ý: đây là static read-through, KHÔNG phải chạy thật — không thể loại trừ 100% lỗi runtime, ví dụ thiếu extension `pgcrypto`/`uuid-ossp` cho `gen_random_uuid()` nếu project chưa enable, nhưng các migration trước (`0001`/`0004`) trong repo đã dùng `gen_random_uuid()` thành công nên rủi ro này thấp.)

### Post-review fixes — xác nhận đã có trong code

| Fix | File | Xác nhận |
|-----|------|----------|
| `send()` trả về row vừa insert | `src/lib/use-send-friend-request.ts` | ✅ Có. `UseSendFriendRequest.send` trả `Promise<{ error: string \| null; request: FriendRequest \| null }>` (dòng 14). Trên success, `.insert(...).select().single()` (dòng 91-99) rồi map `inserted` sang `FriendRequest` camelCase (dòng 114-123), trả `{ error: null, request }`. Mọi early-return lỗi đều kèm `request: null`. |
| `AddFriendForm` gọi `addOutgoing` khi gửi thành công | `src/components/friends-panel.tsx` | ✅ Có. `AddFriendForm.handleSubmit` (dòng 221-233): `if (err \|\| !request) { setError(...); return; }` rồi `onSent(request)`. `FriendsTab` truyền `onSent={(request) => { friendRequests.addOutgoing(request); setShowAddForm(false); }}` (dòng 175-178). `addOutgoing` tồn tại trong `UseFriendRequests` (`src/lib/use-friend-requests.ts` dòng 45, implement dòng 290). |

### Tổng kết — Overall status

**PARTIAL PASS — static checks pass; live DB verification (RLS, identity-lock trigger, Realtime cross-account delivery) BLOCKED pending user running `supabase/migrations/0005_friend_requests.sql` in Supabase Studio. Two-account manual QA must happen before this feature is considered fully shipped, even though it's about to be merged to make the migration file available.**

### Việc còn lại (sau khi user chạy migration trên Studio) — không phải lỗi, là phần QA tiếp theo

1. Chạy lại mục C (RLS qua REST, testplan #7-24) — đặc biệt #23/#24 (trigger lock-identity) vì đây là lớp chặn bảo mật chính theo PLAN mục 6.3, chưa từng được verify thật.
2. Chạy mục E #1 và #5 (testplan) — Realtime 2 chiều với 2 tài khoản thật, xác nhận assumption "Realtime áp RLS cho `postgres_changes`" đúng như thiết kế. Đây là rủi ro kỹ thuật lớn nhất được cả architect và code-reviewer gắn cờ — nếu sai, đây là bug nghiêm trọng cần `/investigate` hoặc quay lại `/plan`, KHÔNG vá tạm trong `/qa`.
3. Chạy mục D (hook/component test còn thiếu theo testplan, ngoài 2 test đã có) nếu muốn tăng coverage trước khi PASS toàn phần — không chặn merge nhưng là gap đã biết.
4. Sau khi cả 2 mục trên PASS thật bằng 2-3 tài khoản, cập nhật lại mục QA này thành **FULL PASS** trước khi coi feature đã ship xong (không chỉ "đã merge code").
