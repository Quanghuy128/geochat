-- Migration 0006: DM 1-1 riêng tư — bảng conversations + dm_messages
-- Chạy: copy toàn bộ file này vào Supabase Studio > SQL Editor > Run.
-- Reversible: phần rollback ở cuối file.
--
-- Quyết định kiến trúc (xem dm-chat-STATE.md > PLAN > mục 0 để biết lý do đầy đủ):
--   KHÔNG gộp vào bảng `messages` hiện tại (0001). Tạo schema MỚI hoàn toàn tách biệt:
--   `conversations` (chỉ kind='direct' ở MVP này) + `dm_messages`. Bảng `messages`
--   (global chat) giữ nguyên 100% — không ALTER, không migrate dữ liệu, không rủi ro
--   cho global chat đang chạy thật. RLS đóng hoàn toàn (KHÔNG mở cho anon) — khác hẳn
--   `messages`/`profiles` đang mở public.
--
-- Phụ thuộc: bảng `friend_requests` (migration 0005) PHẢI đã chạy trước migration này
-- (RLS INSERT trên dm_messages query trực tiếp friend_requests). Nếu 0005 chưa chạy,
-- script này vẫn tạo bảng được (không có FK cứng tới friend_requests), nhưng RLS sẽ
-- luôn chặn (không tìm thấy bảng) — chạy thử insert sẽ lỗi "relation does not exist".
-- Khuyến nghị: áp dụng 0005 trước hoặc cùng lúc với 0006 trong 1 lần chạy Studio.

-- ============================================================
-- 1. Bảng conversations — 1 row = 1 cuộc trò chuyện 1-1 giữa 2 user.
--    kind='direct' duy nhất ở MVP (cột kind để dành cho group/global hợp nhất sau này,
--    KHÔNG dùng ngay — global chat tiếp tục đi qua bảng `messages` riêng).
-- ============================================================
create table if not exists public.conversations (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'direct' check (kind in ('direct')),
  user_a_id     uuid not null references auth.users(id) on delete cascade,
  user_b_id     uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),

  constraint conversations_no_self check (user_a_id <> user_b_id)
);

-- Idempotent pair creation: tối đa 1 conversation cho mỗi cặp (a,b) bất kể chiều,
-- dùng đúng pattern least/greatest đã chứng minh ở friend_requests (0005).
-- Đây là ràng buộc DB-level duy nhất chống race "2 user cùng bấm Nhắn tin đồng thời"
-- (edge case #7 trong STATE) — không cần app-level lock.
create unique index if not exists conversations_pair_unique
  on public.conversations (least(user_a_id, user_b_id), greatest(user_a_id, user_b_id));

-- Index lookup "conversations của tôi" (inbox) — cần cả 2 chiều vì user có thể là
-- user_a hoặc user_b tùy thứ tự tạo.
create index if not exists conversations_user_a_idx on public.conversations (user_a_id);
create index if not exists conversations_user_b_idx on public.conversations (user_b_id);

-- ============================================================
-- 2. Bảng dm_messages — tin nhắn của 1 conversation.
--    Tách bảng riêng khỏi `messages` (không dùng chung + thêm conversation_id) vì
--    `messages.user_id` hiện là TEXT (chưa migrate sang uuid) và RLS đang mở cho anon —
--    trộn lẫn 2 RLS rất khác biệt (mở/đóng) vào 1 bảng là rủi ro convention lớn nhất
--    BA đã cảnh báo (risk note "RLS phức tạp hơn mọi feature trước đó").
-- ============================================================
create table if not exists public.dm_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  sender_id         uuid not null references auth.users(id) on delete cascade,
  body              text not null check (char_length(body) between 1 and 2000),
  created_at        timestamptz not null default now()
);

-- Index cho load lịch sử theo conversation, sắp xếp thời gian (giống messages_created_at_idx).
create index if not exists dm_messages_conversation_created_idx
  on public.dm_messages (conversation_id, created_at desc);

-- ============================================================
-- 3. RLS — conversations
-- ============================================================
alter table public.conversations enable row level security;

-- SELECT: chỉ 2 thành viên (user_a hoặc user_b) — không mở public.
drop policy if exists "conversations_select_member" on public.conversations;
create policy "conversations_select_member"
  on public.conversations for select
  to authenticated
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

-- INSERT: chỉ tạo được conversation mà mình là 1 trong 2 thành viên, KHÔNG self-DM
-- (constraint conversations_no_self là lưới an toàn DB, đây là lưới RLS), và bắt buộc
-- 2 user đang là bạn (`friend_requests.status='accepted'`) TẠI THỜI ĐIỂM TẠO.
-- Lưu ý: đây là check ở thời điểm TẠO — re-check tại thời điểm GỬI nằm ở RLS dm_messages
-- (mục 4 dưới), vì conversation có thể tồn tại lâu dài qua nhiều lần unfriend/refriend.
drop policy if exists "conversations_insert_friends_only" on public.conversations;
create policy "conversations_insert_friends_only"
  on public.conversations for insert
  to authenticated
  with check (
    kind = 'direct'
    and (auth.uid() = user_a_id or auth.uid() = user_b_id)
    and exists (
      select 1 from public.friend_requests fr
      where fr.status = 'accepted'
        and (
          (fr.requester_id = user_a_id and fr.recipient_id = user_b_id)
          or (fr.requester_id = user_b_id and fr.recipient_id = user_a_id)
        )
    )
  );

-- Không có UPDATE/DELETE policy nào — conversations là bất biến sau khi tạo (immutable
-- by default — Postgres mặc định chặn khi không có policy).

-- ============================================================
-- 4. RLS — dm_messages
-- ============================================================
alter table public.dm_messages enable row level security;

-- SELECT: chỉ 2 thành viên của conversation chứa tin nhắn đó. KHÔNG re-check trạng thái
-- friend ở SELECT (THINK #3 đã quyết: lịch sử CŨ vẫn xem được sau unfriend) — chỉ cần
-- là thành viên của conversation, bất kể friend status hiện tại.
drop policy if exists "dm_messages_select_member" on public.dm_messages;
create policy "dm_messages_select_member"
  on public.dm_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (auth.uid() = c.user_a_id or auth.uid() = c.user_b_id)
    )
  );

-- INSERT: ĐÂY LÀ RÀNG BUỘC BẢO MẬT CỐT LÕI CỦA FEATURE (re-check friend status tại
-- THỜI ĐIỂM GỬI, không chỉ lúc tạo conversation — quyết định kỹ thuật bắt buộc từ THINK).
-- Điều kiện:
--   (a) sender_id = auth.uid() (không gửi giả danh người khác)
--   (b) mình là 1 trong 2 thành viên của conversation
--   (c) TẠI THỜI ĐIỂM GỬI, 2 thành viên của conversation đang có 1 row friend_requests
--       status='accepted' giữa họ — nếu đã unfriend (status chuyển 'cancelled'), điều
--       kiện này fail → INSERT bị RLS chặn ngay, bất kể conversation cũ vẫn tồn tại.
drop policy if exists "dm_messages_insert_member_and_friends" on public.dm_messages;
create policy "dm_messages_insert_member_and_friends"
  on public.dm_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (auth.uid() = c.user_a_id or auth.uid() = c.user_b_id)
        and exists (
          select 1 from public.friend_requests fr
          where fr.status = 'accepted'
            and (
              (fr.requester_id = c.user_a_id and fr.recipient_id = c.user_b_id)
              or (fr.requester_id = c.user_b_id and fr.recipient_id = c.user_a_id)
            )
        )
    )
  );

-- Không có UPDATE/DELETE policy — tin nhắn bất biến (không sửa/xóa ở MVP, khớp
-- "OUT" của ANALYZE: không có unsend).

-- ============================================================
-- 5. Realtime — thêm cả 2 bảng vào publication supabase_realtime.
--    Lưu ý risk đã ghi trong STATE: Postgres Realtime KHÔNG filter theo arbitrary
--    computed membership ở tầng publication — client lọc tại RLS (postgres_changes áp
--    RLS của role kết nối, theo tài liệu Supabase) chứ KHÔNG filter ở DB engine theo
--    cột tùy ý. Risk "Realtime áp RLS cho postgres_changes" kế thừa nguyên vẹn từ
--    friends feature, CHƯA verify thật bằng 2 account — bắt buộc nằm trong QA gate
--    (xem PLAN > mục Edge cases > #6 + TEST PLAN).
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dm_messages'
  ) then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
end $$;

-- ============================================================
-- ROLLBACK (chạy thủ công khi cần gỡ, theo thứ tự ngược — KHÔNG ảnh hưởng bảng messages):
-- alter publication supabase_realtime drop table public.dm_messages;
-- alter publication supabase_realtime drop table public.conversations;
-- drop policy if exists "dm_messages_insert_member_and_friends" on public.dm_messages;
-- drop policy if exists "dm_messages_select_member" on public.dm_messages;
-- drop policy if exists "conversations_insert_friends_only" on public.conversations;
-- drop policy if exists "conversations_select_member" on public.conversations;
-- drop table if exists public.dm_messages cascade;
-- drop table if exists public.conversations cascade;  -- huỷ toàn bộ tin nhắn DM, cần duyệt tay
-- ============================================================
