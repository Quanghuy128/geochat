-- Migration 0003: bảng locations cho vị trí cuối (offline) của user
-- Chạy: copy toàn bộ file này vào Supabase Studio > SQL Editor > Run.
-- Reversible: phần rollback ở cuối (comment lại, chạy khi cần gỡ).
--
-- Mục tiêu:
--   - Lưu vị trí mới nhất của mỗi user (1 row/user, upsert theo user_id).
--   - Live realtime dùng Supabase Presence (KHÔNG cần thêm bảng này vào publication).
--   - Bảng chỉ giữ "vị trí cuối" để hiện marker mờ khi user offline.
--
-- RLS:
--   - SELECT mở cho anon + authenticated (ai cũng xem được vị trí).
--   - INSERT/UPDATE chỉ authenticated, và user_id phải = auth.uid().
-- Idempotent: create if not exists + drop policy if exists.

-- 1. Bảng locations (1 row/user)
create table if not exists public.locations (
  user_id    text primary key,        -- = auth.uid()::text của owner
  user_name  text not null,
  lat        float8 not null,
  lng        float8 not null,
  updated_at timestamptz not null default now()
);

-- 2. Bật Row Level Security
alter table public.locations enable row level security;

-- 3. Policies
-- SELECT: mở cho anon + authenticated.
drop policy if exists "locations_select_all" on public.locations;
create policy "locations_select_all"
  on public.locations for select
  to anon, authenticated
  using (true);

-- INSERT: chỉ authenticated, user_id = auth.uid().
drop policy if exists "locations_insert_authenticated" on public.locations;
create policy "locations_insert_authenticated"
  on public.locations for insert
  to authenticated
  with check (auth.uid()::text = user_id);

-- UPDATE: chỉ authenticated, owner (cả using cho row hiện tại lẫn with check cho row mới).
drop policy if exists "locations_update_authenticated" on public.locations;
create policy "locations_update_authenticated"
  on public.locations for update
  to authenticated
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

-- Lưu ý: KHÔNG thêm public.locations vào publication supabase_realtime —
-- live position đã dùng Presence; bảng này chỉ đọc 1 lần lúc mount.

-- ============================================================
-- ROLLBACK (chạy thủ công khi cần gỡ):
-- drop policy if exists "locations_update_authenticated" on public.locations;
-- drop policy if exists "locations_insert_authenticated" on public.locations;
-- drop policy if exists "locations_select_all" on public.locations;
-- drop table if exists public.locations cascade;
-- ============================================================
