-- =====================================================================
-- File 25: RPC LIÊN KẾT HỒ SƠ PHỤ HUYNH TẠO SẴN + MỞ QUYỀN CHO QUẢN LÝ
-- TRUNG TÂM QUẢN LÝ LIÊN KẾT PHỤ HUYNH-HỌC SINH (chạy sau file 24)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHẦN 1 — Nhân viên có thể tạo TRƯỚC hồ sơ parent_accounts (chưa có
-- auth_user_id) khi liên kết phụ huynh với học sinh trước khi phụ huynh
-- dùng App lần đầu. Khi phụ huynh đó THẬT SỰ đăng nhập OTP lần đầu, RPC
-- này tự liên kết vào đúng hồ sơ có sẵn theo SĐT của phiên đăng nhập —
-- tránh tạo hồ sơ trùng lặp.
-- ---------------------------------------------------------------------
create or replace function claim_parent_account()
returns parent_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_normalized text;
  v_result parent_accounts;
begin
  v_phone := auth.jwt() ->> 'phone';
  if v_phone is null then
    raise exception 'Phiên đăng nhập hiện tại không có số điện thoại xác thực.';
  end if;
  -- Chuẩn hoá 2 dạng số phổ biến: +84xxxxxxxxx và 0xxxxxxxxx
  v_normalized := case when v_phone like '+84%' then '0' || substring(v_phone from 4) else v_phone end;

  update parent_accounts
  set auth_user_id = auth.uid()
  where auth_user_id is null and phone in (v_phone, v_normalized, '+84' || substring(v_normalized from 2))
  returning * into v_result;

  return v_result; -- null nếu không có hồ sơ nào khớp -> phía app tự tạo mới
end;
$$;

-- ---------------------------------------------------------------------
-- PHẦN 2 — Mở quyền cho Quản lý trung tâm (không chỉ ACC/exec/tech) được
-- tìm kiếm/tạo hồ sơ phụ huynh và quản lý liên kết — vì thực tế lễ tân/
-- Quản lý trung tâm là người trực tiếp làm việc này tại quầy, không chỉ
-- Kế toán.
-- ---------------------------------------------------------------------
drop policy if exists parent_accounts_self on parent_accounts;
create policy parent_accounts_self on parent_accounts for select
  using (
    auth_user_id = auth.uid() or is_executive_or_tech()
    or current_department_id() = (select id from departments where code='ACC')
    or current_role_code() = 'CENTER_MANAGER'
  );

create policy parent_accounts_staff_insert on parent_accounts for insert
  with check (
    is_executive_or_tech()
    or current_department_id() = (select id from departments where code='ACC')
    or current_role_code() = 'CENTER_MANAGER'
  );

drop policy if exists parent_student_links_self on parent_student_links;
create policy parent_student_links_self on parent_student_links for select
  using (
    parent_account_id = current_parent_id() or is_executive_or_tech()
    or current_department_id() = (select id from departments where code='ACC')
    or (current_role_code() = 'CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id()))
  );

create policy parent_student_links_staff_write on parent_student_links for all
  using (
    is_executive_or_tech()
    or current_department_id() = (select id from departments where code='ACC')
    or (current_role_code() = 'CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id()))
  )
  with check (
    is_executive_or_tech()
    or current_department_id() = (select id from departments where code='ACC')
    or (current_role_code() = 'CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id()))
  );
