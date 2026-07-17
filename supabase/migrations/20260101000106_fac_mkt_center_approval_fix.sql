-- =====================================================================
-- File 106: RÀ SOÁT WORKFLOW CSVC + TRUYỀN THÔNG (17/07/2026)
-- Tiếp tục đợt rà workflow Nhân sự/CSVC — cùng lớp lỗi phát hiện ở file
-- 105 nhưng cho 2 bảng "Yêu cầu CSVC" và "Yêu cầu Truyền thông": phòng
-- CSVC/Truyền thông có thể tự đặt thẳng status='center_approved' +
-- center_approved_by=chính họ, GIẢ MẠO bước duyệt của Quản lý trung tâm
-- (bước này tồn tại CHÍNH XÁC để Quản lý trung tâm kiểm soát yêu cầu nào
-- từ trung tâm mình được đẩy lên xử lý/mua sắm, xem comment gốc trong
-- code: "trước đây bị bỏ sót bước duyệt này" — nay lại có thể bị bỏ qua
-- theo cách khác). Chỉ chặn đúng bước duyệt trung tâm (điểm kiểm soát
-- thật sự) — không đổi cách phòng CSVC/Truyền thông xử lý/hoàn tất yêu
-- cầu sau khi đã được duyệt (in_progress/done), vì đó chỉ là theo dõi
-- tiến độ công việc, không phải cổng phê duyệt.
-- =====================================================================
create or replace function enforce_center_approval_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  dept_code text;
  is_dept boolean;
begin
  if is_executive_or_tech() then
    return new; -- Ban điều hành/Kỹ thuật toàn quyền, kể cả sửa lại khi cần
  end if;

  if tg_table_name = 'facility_requests' then dept_code := 'FAC';
  elsif tg_table_name = 'communication_requests' then dept_code := 'MKT';
  end if;
  is_dept := (current_department_id() = (select id from departments where code = dept_code));

  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status in ('center_approved', 'rejected') then
      if not (current_role_code() = 'CENTER_MANAGER' and new.center_id = current_center_id()) then
        raise exception 'Chỉ Quản lý trung tâm của đúng trung tâm này mới được duyệt/từ chối yêu cầu ở bước này.';
      end if;
      if new.status = 'center_approved' and new.center_approved_by is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
    elsif old.status in ('center_approved', 'in_progress') and is_dept then
      null; -- ok: phòng CSVC/Truyền thông xử lý/cập nhật tiến độ sau khi đã được trung tâm duyệt
    else
      raise exception 'Không được phép tự chuyển trạng thái % -> % ở bước này.', old.status, new.status;
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists facility_requests_guard_update on facility_requests;
create trigger facility_requests_guard_update
before update on facility_requests
for each row execute function enforce_center_approval_gate();

drop trigger if exists communication_requests_guard_update on communication_requests;
create trigger communication_requests_guard_update
before update on communication_requests
for each row execute function enforce_center_approval_gate();
