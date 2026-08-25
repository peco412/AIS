-- =======================================================================
-- CHO PHÉP QUẢN LÝ TRUNG TÂM TỰ QUẢN LÝ NHÀ CUNG CẤP (24/08/2026)
-- -----------------------------------------------------------------------
-- VẤN ĐỀ ĐANG SỬA: trước đây CHỈ Kế toán/Kỹ thuật mới thêm/sửa được nhà
-- cung cấp — Quản lý trung tâm không có cách nào tự thêm 1 nhà cung cấp
-- mới, dù họ mới là người thực sự làm việc/mua hàng trực tiếp với các
-- nhà cung cấp địa phương. Hậu quả thực tế: khi cần tạo Phiếu mua hàng
-- cho 1 nhà cung cấp CHƯA có sẵn trong danh sách, Quản lý trung tâm bị
-- "kẹt" — phải nhờ Kế toán thêm hộ trước mới mua được, đúng như phản ánh
-- "center manager bị block mua hàng".
--
-- SỬA: cho phép CENTER_MANAGER cũng ghi được (thêm/sửa) — GIỮ NGUYÊN
-- quyền của Kế toán/Kỹ thuật (không thu hẹp, chỉ mở rộng thêm), vì Kế
-- toán vẫn cần đối chiếu/chuẩn hoá dữ liệu nhà cung cấp cho công tác sổ
-- sách.
-- =======================================================================

drop policy if exists suppliers_write on suppliers;
create policy suppliers_write on suppliers for all
  using (current_role_code() in ('TECH', 'CENTER_MANAGER') or current_department_id() = (select id from departments where code='ACC'))
  with check (current_role_code() in ('TECH', 'CENTER_MANAGER') or current_department_id() = (select id from departments where code='ACC'));
