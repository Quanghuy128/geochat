-- Migration 0007: Group chat — bảng group_conversations + group_members + group_messages
-- Chạy: copy toàn bộ file này vào Supabase Studio > SQL Editor > Run.
-- Reversible: phần rollback ở cuối file.
--
-- Quyết định kiến trúc (xem group-chat-STATE.md > THINK #8, xác nhận trực tiếp bởi user):
--   TÁCH BẢNG RIÊNG hoàn toàn khỏi `conversations`/`dm_messages` (0006) — KHÔNG unify.
--   `group_conversations` + `group_members` + `group_messages` độc lập 100%, không ALTER
--   bảng nào của 0006, không rủi ro cho DM-chat đã thiết kế xong.
--
-- Phụ thuộc: bảng `friend_requests` (0005) PHẢI đã chạy trước (RLS INSERT group_members
-- query trực tiếp friend_requests, giống pattern dm_messages ở 0006). Nếu 0005 chưa chạy,
-- INSERT vào group_members sẽ luôn lỗi "relation does not exist", không phải "RLS denied".
--
-- QUYẾT ĐỊNH KIẾN TRÚC QUAN TRỌNG (khác với mô tả gốc trong yêu cầu /plan — ghi rõ lý do):
--   `group_members` dùng SOFT-DELETE (cột `left_at timestamptz null`) thay vì hard DELETE
--   row khi 1 member rời/bị xóa. Lý do bắt buộc: THINK #2 đã chốt "lịch sử CŨ vẫn xem được
--   sau khi rời/bị xóa" — nếu hard-DELETE row group_members, schema KHÔNG CÒN CÁCH NÀO để
--   RLS group_messages phân biệt "user chưa từng là member" (phải chặn) vs "user đã từng
--   là member nhưng đã rời" (phải cho xem lịch sử cũ theo THINK #2) — 2 trường hợp này có
--   CÙNG MỘT trạng thái dữ liệu (không có row group_members) nếu dùng hard-delete, không có
--   tín hiệu nào để RLS phân biệt. Soft-delete (left_at) là giải pháp ÍT RỦI RO NHẤT: vẫn
--   giữ đúng 1 row/cặp (group_id,user_id) vĩnh viễn (kể cả rời rồi join lại — UPDATE lại
--   left_at=null thay vì insert row mới), "thành viên HIỆN TẠI" = where left_at is null
--   (derivable, không cần bảng phụ), và group_messages SELECT có thể gate đúng theo "đã từng
--   có row ở group này" (left_at is null hoặc not null đều SELECT được) mà KHÔNG làm rò rỉ
--   quyền GỬI (group_messages INSERT vẫn re-check left_at is null, đúng yêu cầu re-check tại
--   thời điểm gửi).

-- ============================================================
-- 1. Bảng group_conversations — 1 row = 1 group.
-- ============================================================
create table if not exists public.group_conversations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 100),
  creator_id    uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now()
);

-- Index lookup theo creator (không bắt buộc cho RLS nhưng hữu ích cho query "groups tôi tạo").
create index if not exists group_conversations_creator_idx
  on public.group_conversations (creator_id);

-- ============================================================
-- 2. Bảng group_members — membership của 1 group, SOFT-DELETE qua `left_at`.
--    KHÔNG có cột `role` — creator/member phân biệt được bằng so sánh
--    group_members.user_id = group_conversations.creator_id (derivable, theo THINK #4).
--    "Thành viên HIỆN TẠI" = where left_at is null. Rời/bị xóa → UPDATE left_at = now(),
--    KHÔNG DELETE row (xem lý do bắt buộc ở đầu file).
-- ============================================================
create table if not exists public.group_members (
  group_id      uuid not null references public.group_conversations(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  joined_at     timestamptz not null default now(),
  left_at       timestamptz null,

  primary key (group_id, user_id)
);

-- primary key (group_id, user_id) = đúng 1 row/cặp group-user VĨNH VIỄN (kể cả rời rồi vào
-- lại — UPDATE left_at, không insert row mới) — chống duplicate add (edge case #4 STATE)
-- ở dạng "không có 2 row cho cùng cặp", nhất quán yêu cầu edge case #7 (race add/remove).

-- Index lookup "groups của tôi hiện tại" (inbox) — theo user_id, chỉ active.
create index if not exists group_members_active_user_idx
  on public.group_members (user_id) where left_at is null;
-- Index lookup "thành viên hiện tại của 1 group" + dùng trong COUNT cho cap 50.
create index if not exists group_members_active_group_idx
  on public.group_members (group_id) where left_at is null;

-- ------------------------------------------------------------
-- 2a. Enforce cap 50 thành viên ACTIVE/group ở DB level — trigger BEFORE INSERT OR UPDATE
--     trên group_members. Cần bắt cả UPDATE (không chỉ INSERT) vì "thêm lại" 1 member đã
--     rời = UPDATE left_at null→giá trị cũ→null (re-join), không phải INSERT row mới.
--     Dùng trigger (không CHECK constraint, vì CHECK không thể subquery COUNT trên chính
--     bảng) — COUNT(*) where left_at is null bao gồm các row active đã commit trước nó;
--     đây là lưới an toàn DB-level chính cho cap 50 (xem PLAN > Edge cases #7/cap-race để
--     biết mức rủi ro thực tế còn lại của race 2 transaction concurrent).
-- ------------------------------------------------------------
create or replace function public.group_members_enforce_cap()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
begin
  -- Chỉ đếm/áp cap khi row đang trở thành ACTIVE (left_at null) — UPDATE đặt left_at
  -- (leave/remove) không bao giờ bị cap chặn, chỉ chặn khi THÊM/RE-JOIN.
  if new.left_at is not null then
    return new;
  end if;

  select count(*) into active_count
  from public.group_members
  where group_id = new.group_id and left_at is null;

  -- Khi UPDATE (re-join), row của chính nó CHƯA commit left_at=null nên có thể đã được
  -- đếm là active từ TRƯỚC nếu transaction khác đang race — chấp nhận biên rủi ro đã ghi.
  if active_count >= 50 then
    raise exception 'group_members: nhom da dat gioi han 50 thanh vien';
  end if;

  return new;
end;
$$;

drop trigger if exists group_members_cap_before_write on public.group_members;
create trigger group_members_cap_before_write
  before insert or update on public.group_members
  for each row execute procedure public.group_members_enforce_cap();

-- ============================================================
-- 3. Bảng group_messages — tin nhắn của 1 group.
-- ============================================================
create table if not exists public.group_messages (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.group_conversations(id) on delete cascade,
  sender_id     uuid not null references auth.users(id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now()
);

-- Index cho load lịch sử theo group, sắp xếp thời gian (giống dm_messages_conversation_created_idx).
create index if not exists group_messages_group_created_idx
  on public.group_messages (group_id, created_at desc);

-- ============================================================
-- 4. RLS — group_conversations
-- ============================================================
alter table public.group_conversations enable row level security;

-- SELECT: chỉ user đã/đang từng có row group_members cho group này (active HOẶC đã rời) —
-- bắt buộc để ex-member vẫn truy được tên group khi xem lại lịch sử cũ (THINK #2). Đây KHÁC
-- với "chỉ active member" — nếu chỉ cho active member SELECT, ex-member mở lại thread cũ sẽ
-- không lấy được group_conversations.name (lỗi UI, không phải security risk vì group_messages
-- vẫn bị gate đúng ở mục 6 dưới).
drop policy if exists "group_conversations_select_ever_member" on public.group_conversations;
create policy "group_conversations_select_ever_member"
  on public.group_conversations for select
  to authenticated
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = id and gm.user_id = auth.uid()
    )
  );

-- INSERT: chỉ tạo được group mà mình là creator (creator_id = auth.uid()) — không tạo hộ.
-- "Phải có ≥1 member ban đầu" (THINK #11) validate ở application layer (RPC/transaction:
-- insert group_conversations rồi insert group_members ngay sau, xem mục Data flow PLAN) —
-- group_conversations không tự biết về group_members tại thời điểm insert của chính nó.
drop policy if exists "group_conversations_insert_as_creator" on public.group_conversations;
create policy "group_conversations_insert_as_creator"
  on public.group_conversations for insert
  to authenticated
  with check (creator_id = auth.uid());

-- Không có UPDATE policy — không rename (THINK #6, deferred), group_conversations bất biến
-- sau khi tạo. Không có DELETE policy — Postgres mặc định chặn (an toàn-by-default), nhất
-- quán pattern friend_requests/conversations: group "vô chủ" tồn tại vô thời hạn (THINK #9).

-- ============================================================
-- 5. RLS — group_members
-- ============================================================
alter table public.group_members enable row level security;

-- SELECT: user xem được CÁC ROW group_members của group nào mà CHÍNH HỌ đã/đang từng có
-- mặt (active hoặc đã rời) — KHÔNG nghĩa là họ thấy được full danh sách "ai từng ở group"
-- mãi mãi nếu họ chỉ có 1 row của riêng mình; điều kiện dưới dùng self-row để gate "tôi có
-- quyền nhìn vào group này không", rồi USING áp cho MỌI row khớp group_id đó (kể cả ex-member
-- khác) — nghĩa là ai đã từng ở group X thì thấy mọi row (active+left) của group X, bao gồm
-- người khác đã rời/bị xóa. Đây là TRADE-OFF CHẤP NHẬN: ex-member vẫn thấy "ai từng ở group"
-- (không chỉ giới hạn xem chính mình) — chấp nhận được vì đây chỉ là metadata membership
-- (không phải nội dung tin nhắn riêng tư hơn), và cần thiết để UI 3.13 hiển thị đúng sender
-- username trong lịch sử cũ mà KHÔNG cần query riêng cho từng message.
drop policy if exists "group_members_select_ever_member" on public.group_members;
create policy "group_members_select_ever_member"
  on public.group_members for select
  to authenticated
  using (
    exists (
      select 1 from public.group_members self
      where self.group_id = group_members.group_id and self.user_id = auth.uid()
    )
  );

-- INSERT: ĐÂY LÀ RÀNG BUỘC BẢO MẬT CỐT LÕI — chỉ CREATOR của group được insert, VÀ bắt
-- buộc tồn tại friend_requests row 'accepted' giữa creator và user_id được thêm, RE-CHECK
-- TẠI THỜI ĐIỂM ADD (không chỉ lúc tạo group) — khớp THINK quyết định kỹ thuật.
-- Member KHÔNG cần là bạn của NHAU (chỉ creator-to-each-member, đúng THINK #1).
-- with check bắt buộc left_at IS NULL (insert ban đầu luôn là active — không insert thẳng
-- 1 row đã "left_at not null", vô nghĩa).
drop policy if exists "group_members_insert_creator_friend_gated" on public.group_members;
create policy "group_members_insert_creator_friend_gated"
  on public.group_members for insert
  to authenticated
  with check (
    left_at is null
    and exists (
      select 1 from public.group_conversations gc
      where gc.id = group_id and gc.creator_id = auth.uid()
    )
    and (
      -- Creator luôn được tự thêm chính mình (membership ban đầu lúc tạo group) —
      -- không cần friend-check với chính mình.
      user_id = auth.uid()
      or exists (
        select 1 from public.friend_requests fr
        where fr.status = 'accepted'
          and (
            (fr.requester_id = auth.uid() and fr.recipient_id = group_members.user_id)
            or (fr.requester_id = group_members.user_id and fr.recipient_id = auth.uid())
          )
      )
    )
  );

-- UPDATE: soft-delete (leave/remove) VÀ re-join (creator re-add 1 ex-member) đều là UPDATE
-- trên row hiện có, không phải INSERT/DELETE. 2 trường hợp hợp lệ:
--   (a) CREATOR đặt left_at cho BẤT KỲ member nào (remove), hoặc đặt left_at=null cho 1
--       ex-member để re-add (vẫn phải re-check friend-gating — with check bên dưới).
--   (b) Member thường tự đặt left_at = now() cho CHÍNH MÌNH (leave) — KHÔNG tự re-join
--       chính mình (chỉ creator mới re-add được, nhất quán "chỉ creator add member").
drop policy if exists "group_members_update_leave_or_creator_manage" on public.group_members;
create policy "group_members_update_leave_or_creator_manage"
  on public.group_members for update
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.group_conversations gc
      where gc.id = group_id and gc.creator_id = auth.uid()
    )
  )
  with check (
    -- Member thường (không phải creator) chỉ được set left_at NOT NULL trên CHÍNH MÌNH
    -- (leave) — không được tự re-join (left_at null) hoặc động vào left_at của người khác.
    (
      user_id = auth.uid()
      and left_at is not null
    )
    or (
      -- Creator: remove (left_at not null) tự do; re-add (left_at null) phải re-pass
      -- đúng friend-gating như INSERT (re-check tại thời điểm re-add, không phải lúc đầu).
      exists (
        select 1 from public.group_conversations gc
        where gc.id = group_id and gc.creator_id = auth.uid()
      )
      and (
        left_at is not null
        or user_id = auth.uid()
        or exists (
          select 1 from public.friend_requests fr
          where fr.status = 'accepted'
            and (
              (fr.requester_id = auth.uid() and fr.recipient_id = group_members.user_id)
              or (fr.requester_id = group_members.user_id and fr.recipient_id = auth.uid())
            )
        )
      )
    )
  );

-- Không có DELETE policy trên group_members — Postgres mặc định chặn (an toàn-by-default).
-- Mọi "rời/xóa" đi qua UPDATE left_at, không hard-delete (xem lý do bắt buộc đầu file).

-- ============================================================
-- 6. RLS — group_messages
-- ============================================================
alter table public.group_messages enable row level security;

-- SELECT: user đã/đang TỪNG có row group_members cho group này (active HOẶC đã rời, tức
-- left_at null hoặc not null đều tính) — đúng THINK #2 "lịch sử cũ vẫn xem được sau khi
-- rời/bị xóa", và KHÔNG mở cho user chưa từng là member (group_members không có row nào
-- cho cặp đó → exists() false → chặn đúng edge case #9 "user C không phải thành viên").
drop policy if exists "group_messages_select_ever_member" on public.group_messages;
create policy "group_messages_select_ever_member"
  on public.group_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = group_messages.group_id and gm.user_id = auth.uid()
    )
  );

-- INSERT: re-check membership HIỆN TẠI (left_at IS NULL) tại thời điểm gửi (nhất quán
-- pattern DM-chat) — sender_id = auth.uid() (không gửi giả danh) VÀ user hiện đang ACTIVE
-- trong group đó. Rời/bị xóa (left_at được set) → mất quyền gửi NGAY lần gửi kế tiếp.
drop policy if exists "group_messages_insert_active_member" on public.group_messages;
create policy "group_messages_insert_active_member"
  on public.group_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = group_id and gm.user_id = auth.uid() and gm.left_at is null
    )
  );

-- Không có UPDATE/DELETE policy — tin nhắn bất biến (không sửa/xóa, khớp pattern dm_messages).

-- ============================================================
-- 7. Realtime — thêm cả 3 bảng vào publication supabase_realtime.
--    Risk kế thừa lần thứ 3 (KHÔNG được bỏ qua, ghi rõ trong STATE THINK):
--    "Realtime postgres_changes áp RLS của role kết nối" CHƯA verify thật bằng 2+ account.
--    Với group >2 người hệ quả nếu sai nghiêm trọng hơn DM — BẮT BUỘC nằm trong QA gate
--    trước khi coi feature này ship thật (xem TEST PLAN > Realtime RLS isolation).
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_conversations'
  ) then
    alter publication supabase_realtime add table public.group_conversations;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_members'
  ) then
    alter publication supabase_realtime add table public.group_members;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_messages'
  ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;
end $$;

-- ============================================================
-- ROLLBACK (chạy thủ công khi cần gỡ, theo thứ tự ngược — KHÔNG ảnh hưởng bảng
-- messages/conversations/dm_messages/friend_requests):
-- alter publication supabase_realtime drop table public.group_messages;
-- alter publication supabase_realtime drop table public.group_members;
-- alter publication supabase_realtime drop table public.group_conversations;
-- drop policy if exists "group_messages_insert_active_member" on public.group_messages;
-- drop policy if exists "group_messages_select_ever_member" on public.group_messages;
-- drop policy if exists "group_members_update_leave_or_creator_manage" on public.group_members;
-- drop policy if exists "group_members_insert_creator_friend_gated" on public.group_members;
-- drop policy if exists "group_members_select_ever_member" on public.group_members;
-- drop policy if exists "group_conversations_insert_as_creator" on public.group_conversations;
-- drop policy if exists "group_conversations_select_ever_member" on public.group_conversations;
-- drop trigger if exists group_members_cap_before_write on public.group_members;
-- drop function if exists public.group_members_enforce_cap();
-- drop table if exists public.group_messages cascade;
-- drop table if exists public.group_members cascade;
-- drop table if exists public.group_conversations cascade;  -- huỷ toàn bộ group + tin nhắn, cần duyệt tay
-- ============================================================
