-- Migration 0001: bảng messages cho chat realtime
-- Chạy: copy toàn bộ file này vào Supabase Studio > SQL Editor > Run.
-- Reversible: phần rollback ở cuối (comment lại, chạy khi cần gỡ).

-- 1. Bảng messages
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,            -- tạm dùng text (chưa có auth); sau đổi sang uuid references auth.users
  user_name  text not null,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- Index cho query theo thời gian (lấy tin mới nhất)
create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

-- 2. Bật Row Level Security
alter table public.messages enable row level security;

-- 3. Policies (giai đoạn demo CHƯA có auth → mở cho anon đọc/ghi).
--    KHI THÊM AUTH: siết lại — chỉ user đăng nhập mới insert, user_id phải = auth.uid().
drop policy if exists "messages_select_all" on public.messages;
create policy "messages_select_all"
  on public.messages for select
  to anon, authenticated
  using (true);

drop policy if exists "messages_insert_all" on public.messages;
create policy "messages_insert_all"
  on public.messages for insert
  to anon, authenticated
  with check (char_length(body) between 1 and 2000);

-- 4. Bật Realtime: thêm bảng vào publication supabase_realtime
--    (idempotent — bỏ qua nếu đã có)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ============================================================
-- ROLLBACK (chạy thủ công khi cần gỡ):
-- alter publication supabase_realtime drop table public.messages;
-- drop table if exists public.messages cascade;
-- ============================================================
