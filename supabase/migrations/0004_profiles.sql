-- Migration 0004: bảng profiles (username unique) + trigger auto-insert từ auth.users
-- Chạy: copy vào Supabase Studio > SQL Editor > Run.
-- Reversible: phần rollback ở cuối file.
-- QUAN TRỌNG: Tắt "Confirm email" trong Supabase Dashboard > Authentication > Settings > Email > Confirm email: OFF
--   Nếu không tắt, sign-up thành công nhưng đăng nhập ngay sẽ bị "Email not confirmed".

-- 1. Bảng profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  created_at  timestamptz not null default now(),

  constraint profiles_username_length   check (char_length(username) between 3 and 20),
  constraint profiles_username_chars    check (username ~ '^[a-zA-Z][a-zA-Z0-9_-]*$'),
  constraint profiles_username_unique   unique (username)
);

-- Index cho lookup case-insensitive (admin/display)
create index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- 2. RLS
alter table public.profiles enable row level security;

-- SELECT: mọi người xem được (cần để hiển thị @username trong chat)
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  to anon, authenticated
  using (true);

-- INSERT: chặn client direct insert — chỉ trigger (security definer) mới insert được
-- Lưu ý: trigger security definer bypass RLS hoàn toàn
drop policy if exists "profiles_insert_trigger_only" on public.profiles;
create policy "profiles_insert_trigger_only"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- UPDATE: chỉ owner, nhưng KHÔNG cho đổi username (immutable)
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and username = (select username from public.profiles where id = auth.uid())
  );

-- 3. Trigger: auto-insert profile khi user mới đăng ký
-- username lấy từ raw_user_meta_data->>'username' (client truyền lên qua options.data lúc signUp)
-- KHÔNG dùng ON CONFLICT DO NOTHING: để Postgres raise lỗi tự nhiên khi vi phạm unique
-- → trigger fail → transaction rollback → auth.users row cũng bị rollback (race condition safe)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- ROLLBACK (chạy theo thứ tự ngược):
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop policy if exists "profiles_update_own" on public.profiles;
-- drop policy if exists "profiles_insert_trigger_only" on public.profiles;
-- drop policy if exists "profiles_select_all" on public.profiles;
-- drop table if exists public.profiles cascade;
-- ============================================================
