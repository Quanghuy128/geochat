-- Migration 0002: siết RLS bảng messages khi đã có Auth (email magic link)
-- Chạy: copy toàn bộ file này vào Supabase Studio > SQL Editor > Run.
-- Reversible: phần rollback ở cuối (comment lại, chạy khi cần gỡ).
--
-- Mục tiêu:
--   - INSERT chỉ cho user đã đăng nhập (authenticated), và user_id phải = auth.uid().
--   - SELECT giữ nguyên (mở cho anon + authenticated đọc) — không đổi.
-- Idempotent: drop policy if exists trước khi create.

-- 1. Bỏ policy insert cũ (cho anon ghi tự do từ migration 0001).
drop policy if exists "messages_insert_all" on public.messages;

-- 2. Policy INSERT mới: chỉ authenticated, user_id = auth.uid().
--    user_id là cột text → so sánh auth.uid()::text.
--    Giữ ràng buộc độ dài body như cũ.
drop policy if exists "messages_insert_authenticated" on public.messages;
create policy "messages_insert_authenticated"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid()::text = user_id
    and char_length(body) between 1 and 2000
  );

-- 3. SELECT giữ nguyên (policy "messages_select_all" từ 0001 vẫn còn hiệu lực).
--    Không thay đổi ở đây.

-- ============================================================
-- ROLLBACK (chạy thủ công khi cần gỡ — khôi phục trạng thái 0001):
-- drop policy if exists "messages_insert_authenticated" on public.messages;
-- create policy "messages_insert_all"
--   on public.messages for insert
--   to anon, authenticated
--   with check (char_length(body) between 1 and 2000);
-- ============================================================
