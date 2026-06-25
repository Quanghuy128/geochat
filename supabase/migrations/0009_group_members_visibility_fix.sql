-- Migration 0009: Tighten `group_members_select_ever_member` RLS policy (0007) — fix
-- unbounded ex-member visibility flagged by architect review (NEEDS-WORK item 1).
-- Chạy: copy toàn bộ file này vào Supabase Studio > SQL Editor > Run, SAU 0008.
-- Reversible: phần rollback ở cuối file (khôi phục đúng policy gốc của 0007).
--
-- Vấn đề (architect NEEDS-WORK #1): policy gốc ở 0007 cho viewer SELECT TOÀN BỘ row của
-- group nếu viewer có ÍT NHẤT 1 row ở group đó (active hoặc đã rời), KHÔNG có giới hạn thời
-- gian. Hệ quả: 1 ex-member đã rời group RẤT LÂU vẫn nhìn thấy các member MỚI gia nhập SAU
-- KHI họ đã rời — đây là "live view" liên tục cập nhật, RỘNG HƠN nhiều so với mô tả gốc ở
-- PLAN ("ex-member retains visibility into the member list") — PLAN ngầm ý là snapshot tại
-- thời điểm rời, không phải view sống tiếp tục phình ra theo thời gian.
--
-- Fix: viewer chỉ SELECT được row của member khác nếu member đó `joined_at <= viewer's own
-- left_at` (member đó đã có mặt TRONG LÚC viewer còn active), HOẶC viewer hiện vẫn active
-- (`left_at is null` — thấy toàn bộ member hiện tại, không đổi hành vi cho active member).
-- Viewer LUÔN thấy được row của CHÍNH MÌNH bất kể điều kiện trên (self-row, tách riêng).
--
-- Lưu ý: viewer có thể có NHIỀU lần rời/join lại (left_at được set rồi update lại null khi
-- re-join — xem 0007 mục 2). "left_at của viewer" ở đây lấy từ HÀNG HIỆN TẠI của viewer
-- (self.left_at) — nếu viewer đang active (left_at is null), áp dụng nhánh "thấy toàn bộ
-- hiện tại"; nếu viewer đã rời (left_at not null), chỉ thấy member đã joined_at <= thời điểm
-- viewer rời lần gần nhất (không phục hồi lại "lịch sử join cũ hơn lần rời trước" vì schema
-- chỉ giữ 1 row/cặp — chấp nhận được, nhất quán soft-delete 1-row-per-pair).

drop policy if exists "group_members_select_ever_member" on public.group_members;
create policy "group_members_select_ever_member"
  on public.group_members for select
  to authenticated
  using (
    -- Viewer luôn thấy CHÍNH MÌNH, bất kể trạng thái.
    user_id = auth.uid()
    or exists (
      select 1 from public.group_members self
      where self.group_id = group_members.group_id
        and self.user_id = auth.uid()
        and (
          -- Viewer hiện đang ACTIVE → thấy toàn bộ member hiện tại của group (không đổi
          -- hành vi so với 0007 cho active member).
          self.left_at is null
          -- Viewer đã RỜI → chỉ thấy member đã joined_at <= thời điểm viewer rời (member đó
          -- "có mặt" trong lúc viewer còn ở group) — chặn nhìn thấy member gia nhập SAU khi
          -- viewer đã rời (đây là gap bị architect flag).
          or group_members.joined_at <= self.left_at
        )
    )
  );

-- ============================================================
-- ROLLBACK (chạy thủ công khi cần gỡ — khôi phục ĐÚNG policy gốc của 0007, không có giới
-- hạn thời gian — KHÔNG ảnh hưởng bảng/dữ liệu, chỉ đổi lại policy SELECT):
-- drop policy if exists "group_members_select_ever_member" on public.group_members;
-- create policy "group_members_select_ever_member"
--   on public.group_members for select
--   to authenticated
--   using (
--     exists (
--       select 1 from public.group_members self
--       where self.group_id = group_members.group_id and self.user_id = auth.uid()
--     )
--   );
-- ============================================================
