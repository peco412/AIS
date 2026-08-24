-- =======================================================================
-- SỬA LỖI THẬT NGHIÊM TRỌNG: is_direct_manager_of() (24/08/2026)
-- -----------------------------------------------------------------------
-- VẤN ĐỀ: hàm gốc dùng "if v_target_dept is not null then ... elsif
-- v_target_center is not null then ...". Với if/elsif, CHỈ NHÁNH ĐẦU
-- TIÊN thoả điều kiện mới được chạy — nếu nhân sự có CẢ department_id
-- LẪN center_id (đúng trường hợp giáo viên/tư vấn viên/quản lý trung tâm
-- — họ thuộc phòng Học vụ (EDU) NHƯNG làm việc tại 1 trung tâm cụ thể),
-- hàm sẽ CHỈ kiểm tra theo department_id (== false vì Quản lý trung tâm
-- không phải DEPT_HEAD/DEPT_DEPUTY) rồi DỪNG LUÔN — không bao giờ chạy
-- tới nhánh kiểm tra center_id, dù đúng ra Quản lý trung tâm phải được
-- duyệt đơn của nhân sự trung tâm mình.
--
-- Hàm này được dùng trong RLS UPDATE của NHIỀU bảng (leave_requests,
-- payment_requests, advance_requests, business_trips...) — lỗi này khiến
-- Quản lý trung tâm không duyệt/từ chối được các phiếu của nhân sự trung
-- tâm mình ở TẤT CẢ các luồng đó, không chỉ riêng đơn nghỉ phép.
--
-- SỬA: kiểm tra ĐỘC LẬP cả 2 điều kiện bằng OR, không phụ thuộc nhánh
-- nào chạy trước — nhân sự có department_id vẫn được kiểm tra tiếp theo
-- center_id nếu điều kiện phòng ban không khớp.
-- =======================================================================

create or replace function is_direct_manager_of(p_employee_id uuid)
returns boolean
language plpgsql stable
as $func$
declare
  v_target_dept uuid;
  v_target_center uuid;
begin
  select department_id, center_id into v_target_dept, v_target_center from employees where id = p_employee_id;

  return (v_target_dept is not null and current_department_id() = v_target_dept and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'))
      or (v_target_center is not null and current_center_id() = v_target_center and current_role_code() = 'CENTER_MANAGER');
end;
$func$;
