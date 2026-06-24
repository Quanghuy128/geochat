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
-- drop trigger if exists friend_requests_lock_identity on public.friend_requests;
-- drop function if exists public.friend_requests_lock_identity_columns();
-- drop policy if exists "friend_requests_update_unfriend" on public.friend_requests;
-- drop policy if exists "friend_requests_update_requester_cancel" on public.friend_requests;
-- drop policy if exists "friend_requests_update_recipient_decide" on public.friend_requests;
-- drop policy if exists "friend_requests_insert_as_requester" on public.friend_requests;
-- drop policy if exists "friend_requests_select_own" on public.friend_requests;
-- drop trigger if exists friend_requests_set_updated_at on public.friend_requests;
-- drop function if exists public.set_friend_requests_updated_at();
-- drop table if exists public.friend_requests cascade;  -- huy toan bo bang + du lieu, can duyet tay
-- ============================================================
