-- =====================================================================
-- File 63: SUA DUNG "Chi Truong phong VA Quan ly Trung tam" (khong tinh
-- Pho phong) cho 2 chuc nang thuoc "Quyen mo rong" trong Portal - migration
-- 54 truoc day lo cho ca DEPT_DEPUTY gui duoc "Xin them quyen han", sai
-- voi dung chu trong dac ta chi ghi "Truong phong". (chay sau file 62)
-- =====================================================================
drop policy if exists permission_requests_insert on permission_requests;
create policy permission_requests_insert on permission_requests for insert
  with check (
    requested_by = current_employee_id()
    and (current_role_code() = 'DEPT_HEAD' or current_role_code() = 'CENTER_MANAGER')
  );
