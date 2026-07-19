-- =====================================================================
-- File 119: THÊM CÔNG CỤ XOÁ Ở CÁC NƠI CÒN THIẾU (18/07/2026)
-- Theo yêu cầu rà soát nơi cần công cụ xoá. meetings hiện KHÔNG hề có
-- policy update/delete nào — người tạo cuộc họp không tự sửa/xoá được
-- cuộc họp do chính mình tạo nhầm, phải nhờ Kỹ thuật can thiệp thẳng vào
-- database. Thêm quyền xoá/sửa cho đúng người tạo + Ban điều hành/Kỹ
-- thuật.
-- =====================================================================
create policy meetings_update on meetings for update
  using (created_by = current_employee_id() or is_executive_or_tech());

create policy meetings_delete on meetings for delete
  using (created_by = current_employee_id() or is_executive_or_tech());
