-- Migration 0010: Message reactions (DM + group) + reply_to_message_id (DM + group).
-- Chạy: copy toàn bộ file này vào Supabase Studio > SQL Editor > Run, SAU 0006-0009.
-- Reversible: phần rollback ở cuối file.
--
-- Quyết định kiến trúc (xem reactions-replies-STATE.md > THINK #4, xác nhận trực tiếp bởi
-- user — LẦN THỨ 3 câu hỏi unification được đặt ra và lại bị defer, giữ tách bảng):
--   KHÔNG unify message schema. 2 bảng reaction MỚI, tách riêng theo loại chat
--   (`dm_message_reactions` FK -> dm_messages, `group_message_reactions` FK -> group_messages)
--   + cột `reply_to_message_id` thêm vào CẢ `dm_messages` VÀ `group_messages` riêng biệt.
--   Scope = DM + group ONLY (THINK #1) — bảng `messages` (global) KHÔNG bị touch bởi
--   migration này, không ALTER, không thêm bảng reaction cho global.
--
-- Phụ thuộc: 0006_dm_chat.sql VÀ 0007_group_chat.sql PHẢI đã chạy trước (ALTER nhắm đúng
-- `dm_messages`/`group_messages`; FK reaction tables trỏ tới các bảng đó).
--
-- ============================================================
-- EDGE CASE #6 (reply xuyên biên giới conversation/group) — GIẢI PHÁP EXPLICIT:
-- Một self-referencing FK (`reply_to_message_id references dm_messages(id)`) CHỈ đảm bảo
-- row đích TỒN TẠI trong CÙNG BẢNG `dm_messages` — nó KHÔNG đảm bảo row đích có cùng
-- `conversation_id` với row mới. Một FK đơn thuần KHÔNG chặn được:
--   insert vào dm_messages (conversation_id = X, reply_to_message_id = <id của 1 message
--   thuộc conversation Y, miễn message đó tồn tại trong dm_messages>)
-- vì FK chỉ check "row đó CÓ TỒN TẠI trong dm_messages", không check thêm điều kiện nào về
-- conversation_id của row đó.
--
-- Giải pháp: dùng TRIGGER (không phải CHECK constraint thường, vì CHECK không thể subquery
-- bảng khác / chính bảng đó ở Postgres) BEFORE INSERT trên cả `dm_messages` và `group_messages`
-- — verify rằng nếu `reply_to_message_id IS NOT NULL`, message được tham chiếu PHẢI có cùng
-- conversation_id (DM) / group_id (group) với row đang insert. Trigger raise exception nếu
-- không khớp — biến edge case #6 thành KHÔNG THỂ ở DB layer, không chỉ "không nên" ở app layer.
-- ============================================================

-- ============================================================
-- 1. ALTER dm_messages — thêm reply_to_message_id (self-referencing FK).
-- ============================================================
alter table public.dm_messages
  add column if not exists reply_to_message_id uuid null
    references public.dm_messages(id) on delete set null;

-- on delete set null: hiện KHÔNG có delete feature (STATE edge case #5 — MOOT) nên nhánh
-- này không kích hoạt thực tế ở MVP, nhưng chọn SET NULL (không CASCADE/RESTRICT) làm mặc
-- định an toàn nhất nếu delete feature được thêm sau này — 1 reply không tự xóa theo tin
-- gốc, chỉ mất tham chiếu (hiển thị "tin gốc không còn" ở UI tương lai).

create index if not exists dm_messages_reply_to_idx
  on public.dm_messages (reply_to_message_id) where reply_to_message_id is not null;

-- Trigger: reply_to_message_id (nếu có) PHẢI trỏ tới 1 message CÙNG conversation_id.
create or replace function public.dm_messages_check_reply_scope()
returns trigger
language plpgsql
as $$
declare
  v_target_conversation_id uuid;
begin
  if new.reply_to_message_id is null then
    return new;
  end if;

  select conversation_id into v_target_conversation_id
  from public.dm_messages
  where id = new.reply_to_message_id;

  -- Không tìm thấy target (FK đã đảm bảo tồn tại, nhưng phòng hờ race nếu FK chưa kịp check
  -- — Postgres FK check chạy trước trigger BEFORE INSERT của user nên thực tế target luôn
  -- tồn tại tại điểm này; giữ check rõ ràng cho an toàn/đọc hiểu).
  if v_target_conversation_id is null then
    raise exception 'dm_messages: reply_to_message_id khong ton tai';
  end if;

  if v_target_conversation_id <> new.conversation_id then
    raise exception 'dm_messages: reply_to_message_id phai thuoc cung conversation_id (edge case #6)';
  end if;

  return new;
end;
$$;

drop trigger if exists dm_messages_check_reply_scope_before_write on public.dm_messages;
create trigger dm_messages_check_reply_scope_before_write
  before insert on public.dm_messages
  for each row execute procedure public.dm_messages_check_reply_scope();

-- ============================================================
-- 2. ALTER group_messages — thêm reply_to_message_id (self-referencing FK).
-- ============================================================
alter table public.group_messages
  add column if not exists reply_to_message_id uuid null
    references public.group_messages(id) on delete set null;

create index if not exists group_messages_reply_to_idx
  on public.group_messages (reply_to_message_id) where reply_to_message_id is not null;

-- Trigger: cùng pattern dm_messages, scoped theo group_id.
create or replace function public.group_messages_check_reply_scope()
returns trigger
language plpgsql
as $$
declare
  v_target_group_id uuid;
begin
  if new.reply_to_message_id is null then
    return new;
  end if;

  select group_id into v_target_group_id
  from public.group_messages
  where id = new.reply_to_message_id;

  if v_target_group_id is null then
    raise exception 'group_messages: reply_to_message_id khong ton tai';
  end if;

  if v_target_group_id <> new.group_id then
    raise exception 'group_messages: reply_to_message_id phai thuoc cung group_id (edge case #6)';
  end if;

  return new;
end;
$$;

drop trigger if exists group_messages_check_reply_scope_before_write on public.group_messages;
create trigger group_messages_check_reply_scope_before_write
  before insert on public.group_messages
  for each row execute procedure public.group_messages_check_reply_scope();

-- ============================================================
-- 3. Bảng dm_message_reactions — 1 row = 1 user, 1 emoji, trên 1 dm_message.
--    THINK #3: chỉ 1 reaction/tin nhắn/user — unique(message_id, user_id), KHÔNG unique
--    theo (message_id, user_id, emoji). Re-react = UPDATE emoji của row hiện có (REPLACE),
--    không insert thêm row — app layer (hook) implement bằng upsert on conflict
--    (message_id, user_id) do update set emoji = excluded.emoji.
-- ============================================================
create table if not exists public.dm_message_reactions (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.dm_messages(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  emoji         varchar(8) not null check (char_length(emoji) between 1 and 8),
  created_at    timestamptz not null default now(),

  constraint dm_message_reactions_one_per_user unique (message_id, user_id)
);

-- Index lookup "reactions của 1 tin nhắn" (đọc count/danh sách người react).
create index if not exists dm_message_reactions_message_idx
  on public.dm_message_reactions (message_id);

-- REPLICA IDENTITY FULL — BẮT BUỘC cho un-react Realtime DELETE để propagate đúng tới các
-- viewer khác (post-review fix, blocker #1). Mặc định Postgres REPLICA IDENTITY DEFAULT chỉ
-- đưa PRIMARY KEY (`id`) vào payload `old` của WAL/Realtime DELETE event — `use-dm-message-
-- reactions.ts`'s patchDelete() đọc `row.message_id`/`row.user_id`/`row.emoji` từ `payload.old`,
-- nên thiếu REPLICA IDENTITY FULL khiến những field này luôn undefined ở DELETE payload mà
-- người react KHÔNG PHẢI actor nhận được → un-react KHÔNG propagate live cho viewer khác (chỉ
-- actor tự thấy do optimistic local removal, không phải do Realtime). FULL đưa toàn bộ row cũ
-- vào `old`, fix đúng tận gốc.
alter table public.dm_message_reactions replica identity full;

-- ============================================================
-- 4. Bảng group_message_reactions — cùng shape, FK -> group_messages.
-- ============================================================
create table if not exists public.group_message_reactions (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.group_messages(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  emoji         varchar(8) not null check (char_length(emoji) between 1 and 8),
  created_at    timestamptz not null default now(),

  constraint group_message_reactions_one_per_user unique (message_id, user_id)
);

create index if not exists group_message_reactions_message_idx
  on public.group_message_reactions (message_id);

-- REPLICA IDENTITY FULL — cùng lý do dm_message_reactions trên (post-review fix, blocker #1).
alter table public.group_message_reactions replica identity full;

-- ============================================================
-- 5. RLS — dm_message_reactions.
--    Re-check membership HIỆN TẠI (friend status accepted) tại THỜI ĐIỂM react/un-react,
--    nhất quán pattern dm_messages INSERT (0006 mục 4) — KHÔNG dùng trạng thái lúc tin gốc
--    được gửi.
-- ============================================================
alter table public.dm_message_reactions enable row level security;

-- SELECT: chỉ 2 thành viên của conversation chứa message đó (không re-check friend status
-- ở SELECT — nhất quán dm_messages SELECT, lịch sử cũ vẫn xem được sau unfriend).
drop policy if exists "dm_message_reactions_select_member" on public.dm_message_reactions;
create policy "dm_message_reactions_select_member"
  on public.dm_message_reactions for select
  to authenticated
  using (
    exists (
      select 1 from public.dm_messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_id
        and (auth.uid() = c.user_a_id or auth.uid() = c.user_b_id)
    )
  );

-- INSERT: chỉ tự react cho CHÍNH MÌNH (user_id = auth.uid()), VÀ phải đang là bạn hiện tại
-- với đối phương của conversation chứa message_id đó TẠI THỜI ĐIỂM REACT (re-check, không
-- phải lúc tin gốc gửi) — đúng STATE edge case #1.
drop policy if exists "dm_message_reactions_insert_active_friend" on public.dm_message_reactions;
create policy "dm_message_reactions_insert_active_friend"
  on public.dm_message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.dm_messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_id
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

-- UPDATE: re-react (đổi emoji, THINK #3 "replace") — chỉ CHÍNH CHỦ row, cùng re-check
-- friend status hiện tại như INSERT (cùng with check).
drop policy if exists "dm_message_reactions_update_own_active_friend" on public.dm_message_reactions;
create policy "dm_message_reactions_update_own_active_friend"
  on public.dm_message_reactions for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.dm_messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_id
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

-- DELETE: un-react — chỉ CHÍNH CHỦ row của mình. KHÔNG re-check friend status ở DELETE
-- (gỡ reaction của chính mình là hành động "rút lại", không nên bị chặn bởi đã unfriend —
-- nhất quán nguyên tắc "luôn được tự rút hành động của mình", giống leaveGroup không cần
-- friend-gating). Nếu row không tồn tại/không phải của mình → 0 row affected, app-level no-op
-- (STATE edge case #4).
drop policy if exists "dm_message_reactions_delete_own" on public.dm_message_reactions;
create policy "dm_message_reactions_delete_own"
  on public.dm_message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- 6. RLS — group_message_reactions. Cùng pattern, re-check membership ACTIVE
--    (left_at is null) tại thời điểm react/un-react, nhất quán group_messages INSERT.
-- ============================================================
alter table public.group_message_reactions enable row level security;

-- SELECT: user đã/đang từng là member (active hoặc đã rời) của group chứa message đó —
-- nhất quán group_messages SELECT (lịch sử cũ vẫn xem được, bao gồm reaction trên lịch sử cũ).
drop policy if exists "group_message_reactions_select_ever_member" on public.group_message_reactions;
create policy "group_message_reactions_select_ever_member"
  on public.group_message_reactions for select
  to authenticated
  using (
    exists (
      select 1 from public.group_messages gm
      join public.group_members mem on mem.group_id = gm.group_id
      where gm.id = message_id and mem.user_id = auth.uid()
    )
  );

-- INSERT: chỉ tự react (user_id = auth.uid()), VÀ phải đang ACTIVE member (left_at is null)
-- của group chứa message TẠI THỜI ĐIỂM REACT — đúng STATE edge case #1.
drop policy if exists "group_message_reactions_insert_active_member" on public.group_message_reactions;
create policy "group_message_reactions_insert_active_member"
  on public.group_message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.group_messages gm
      join public.group_members mem on mem.group_id = gm.group_id
      where gm.id = message_id and mem.user_id = auth.uid() and mem.left_at is null
    )
  );

-- UPDATE: re-react (đổi emoji) — chỉ chính chủ, re-check active membership hiện tại.
drop policy if exists "group_message_reactions_update_own_active_member" on public.group_message_reactions;
create policy "group_message_reactions_update_own_active_member"
  on public.group_message_reactions for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.group_messages gm
      join public.group_members mem on mem.group_id = gm.group_id
      where gm.id = message_id and mem.user_id = auth.uid() and mem.left_at is null
    )
  );

-- DELETE: un-react — chỉ chính chủ, KHÔNG re-check active membership (cùng lý do dm — luôn
-- được tự rút reaction của mình, kể cả đã rời group; nếu rời group rồi muốn gỡ reaction cũ,
-- không có hại gì khi cho phép — đây CHỈ là xóa metadata của chính họ, không phải hành động
-- mới tương tác với group).
drop policy if exists "group_message_reactions_delete_own" on public.group_message_reactions;
create policy "group_message_reactions_delete_own"
  on public.group_message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- 7. Realtime — thêm 2 bảng reaction mới vào publication supabase_realtime.
--    Risk kế thừa lần thứ 4 (KHÔNG được bỏ qua — xem STATE THINK ghi chú cuối): "Realtime
--    postgres_changes áp RLS của role kết nối" CHƯA verify thật bằng 2+ account ở BẤT KỲ
--    feature nào trước. Reaction count realtime phụ thuộc TRỰC TIẾP giả định này — PHẢI
--    nằm trong QA gate trước khi feature này (và toàn bộ 4 feature chồng lên) coi là ship.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dm_message_reactions'
  ) then
    alter publication supabase_realtime add table public.dm_message_reactions;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_message_reactions'
  ) then
    alter publication supabase_realtime add table public.group_message_reactions;
  end if;
end $$;

-- ============================================================
-- ROLLBACK (chạy thủ công khi cần gỡ, theo thứ tự ngược — KHÔNG ảnh hưởng dữ liệu
-- dm_messages/group_messages hiện có ngoài việc bỏ cột reply_to_message_id):
-- alter publication supabase_realtime drop table public.group_message_reactions;
-- alter publication supabase_realtime drop table public.dm_message_reactions;
-- alter table public.group_message_reactions replica identity default;  -- non-destructive, an toàn re-run
-- alter table public.dm_message_reactions replica identity default;  -- non-destructive, an toàn re-run
-- drop policy if exists "group_message_reactions_delete_own" on public.group_message_reactions;
-- drop policy if exists "group_message_reactions_update_own_active_member" on public.group_message_reactions;
-- drop policy if exists "group_message_reactions_insert_active_member" on public.group_message_reactions;
-- drop policy if exists "group_message_reactions_select_ever_member" on public.group_message_reactions;
-- drop policy if exists "dm_message_reactions_delete_own" on public.dm_message_reactions;
-- drop policy if exists "dm_message_reactions_update_own_active_friend" on public.dm_message_reactions;
-- drop policy if exists "dm_message_reactions_insert_active_friend" on public.dm_message_reactions;
-- drop policy if exists "dm_message_reactions_select_member" on public.dm_message_reactions;
-- drop table if exists public.group_message_reactions cascade;
-- drop table if exists public.dm_message_reactions cascade;
-- drop trigger if exists group_messages_check_reply_scope_before_write on public.group_messages;
-- drop function if exists public.group_messages_check_reply_scope();
-- drop trigger if exists dm_messages_check_reply_scope_before_write on public.dm_messages;
-- drop function if exists public.dm_messages_check_reply_scope();
-- drop index if exists public.group_messages_reply_to_idx;
-- alter table public.group_messages drop column if exists reply_to_message_id;
-- drop index if exists public.dm_messages_reply_to_idx;
-- alter table public.dm_messages drop column if exists reply_to_message_id;  -- mất toàn bộ liên kết reply đã lưu, cần duyệt tay
-- ============================================================
