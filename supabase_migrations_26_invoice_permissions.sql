-- =====================================================================
-- File 26: MỞ QUYỀN TẠO/THU HOÁ ĐƠN CHO QUẢN LÝ TRUNG TÂM (chạy sau file 25)
-- Trước đây invoices chỉ ACC/exec/tech quản lý được — thực tế Quản lý
-- trung tâm mới là người trực tiếp tạo hoá đơn học phí & thu tiền hàng
-- ngày (giống cách tuition_payments/debt-overview đã áp dụng).
-- =====================================================================
drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices for all
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
