-- Migration 0008: RPC `create_group` — tạo group + N member rows ATOMIC trong 1 transaction.
-- Chạy: copy toàn bộ file này vào Supabase Studio > SQL Editor > Run, SAU 0007_group_chat.sql.
-- Reversible: phần rollback ở cuối file.
--
-- Lý do bắt buộc (xem group-chat-STATE.md > PLAN > mục 6, testplan > mục 3.1):
--   Supabase JS client KHÔNG expose multi-statement transaction qua nhiều .insert() tuần
--   tự — nếu dùng sequential insert ở client (insert group_conversations rồi N insert
--   group_members), 1 member fail friend-gating giữa chừng sẽ để lại group "mồ côi"
--   (đã tạo nhưng thiếu vài member, không atomic, không rollback được từ client).
--   RPC Postgres function wraps toàn bộ trong 1 transaction — bất kỳ exception nào trong
--   loop (RLS reject 1 member) → toàn bộ rollback, group_conversations KHÔNG persist.
--
-- security invoker (KHÔNG dùng security definer) là BẮT BUỘC — hàm chạy với quyền của
-- NGƯỜI GỌI, RLS trên group_conversations/group_members vẫn áp dụng bên trong hàm này.
-- Nếu dùng security definer, hàm sẽ chạy với quyền owner (thường là superuser/postgres)
-- và BYPASS toàn bộ RLS — friend-gating sẽ bị vô hiệu hoàn toàn, đây sẽ là lỗ hổng bảo
-- mật nghiêm trọng, không phải tiện ích.
--
-- U7/testplan mục 3.2: hành vi all-or-nothing (transaction rollback) — nếu 1 member fail
-- friend-gating, TOÀN BỘ group creation thất bại (không group, không member nào được tạo).

create or replace function public.create_group(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security invoker
as $$
declare
  v_group_id uuid;
  v_member_id uuid;
begin
  insert into public.group_conversations (name, creator_id)
  values (p_name, auth.uid())
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, left_at)
  values (v_group_id, auth.uid(), null);

  -- PHỤ THUỘC NGẦM BẮT BUỘC PHẢI BIẾT (architect NEEDS-WORK #2 — ghi rõ ở đây để không bị
  -- quên/hiểu sai khi đọc riêng file này): hàm này KHÔNG tự kiểm tra giới hạn 50 thành
  -- viên/group — việc enforce cap 50 hoàn toàn dựa vào trigger `group_members_cap_before_write`
  -- (định nghĩa ở 0007_group_chat.sql, BEFORE INSERT OR UPDATE trên group_members) TỰ ĐỘNG
  -- fire trên MỖI LẦN insert ở vòng loop dưới đây (kể cả insert dòng creator phía trên) —
  -- trigger này chạy TRONG CÙNG transaction của RPC này (Postgres function = 1 transaction
  -- ngầm định), nên nếu tạo group với p_member_ids khiến tổng > 50 thành viên active, trigger
  -- sẽ raise exception ngay tại insert thứ 51 → toàn bộ transaction rollback (group_conversations
  -- và mọi group_members đã insert trước đó trong cùng lần gọi đều KHÔNG persist) — đúng hành
  -- vi all-or-nothing mong đợi (ví dụ tạo group 60 member ban đầu phải bị reject toàn bộ).
  -- Nếu sau này 0007's trigger bị đổi/gỡ mà không cập nhật hàm này, cap 50 sẽ KHÔNG còn được
  -- enforce ở đường tạo group qua RPC — đây là một cross-migration dependency cần giữ đồng bộ.
  foreach v_member_id in array p_member_ids loop
    -- Bỏ qua nếu member_id trùng chính creator (UI không nên gửi creator trong
    -- p_member_ids, nhưng phòng hờ double-insert vi phạm primary key).
    if v_member_id <> auth.uid() then
      insert into public.group_members (group_id, user_id, left_at)
      values (v_group_id, v_member_id, null);
    end if;
  end loop;

  return v_group_id;
end;
$$;

-- Không cần GRANT EXECUTE riêng — Postgres mặc định cho PUBLIC execute trên function mới
-- tạo trừ khi REVOKE; Supabase role `authenticated`/`anon` đã có quyền gọi RPC theo mặc
-- định của schema `public`. security invoker đảm bảo RLS vẫn là lưới an toàn thật.

-- ============================================================
-- ROLLBACK (chạy thủ công khi cần gỡ — KHÔNG ảnh hưởng bảng/dữ liệu group đã tạo trước đó,
-- chỉ gỡ function, các group/member đã tồn tại không bị xóa):
-- drop function if exists public.create_group(text, uuid[]);
-- ============================================================
