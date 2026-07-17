-- =====================================================================
-- File 105: RÀ SOÁT WORKFLOW NHÂN SỰ (17/07/2026)
-- Theo yêu cầu rà tiếp workflow Nhân sự/CSVC. Tìm thấy đúng lớp lỗi đã
-- vá cho mkt_ad_expenses (file 102) — "nhảy cóc cấp duyệt" — nhưng ở 2
-- bảng ẢNH HƯỞNG TRỰC TIẾP ĐẾN LƯƠNG: leave_requests (đơn nghỉ — trừ
-- ngày phép) và business_trips (đơn công tác). Xem giải thích chi tiết
-- trong báo cáo kèm theo.
-- =====================================================================

-- =====================================================================
-- PHẦN 1 — 🔴 leave_requests: RLS UPDATE (`leave_update`) cho phép Quản
-- lý trực tiếp (cấp 1) HOẶC Nhân sự (cấp 2) ghi BẤT KỲ CỘT NÀO khi họ
-- được phép chạm vào dòng đó — không có with check/trigger nào chặn
-- việc 1 Quản lý trực tiếp tự ý set thẳng status='approved_2' kèm
-- level2_approver_id=chính họ, NHẢY QUA bước Nhân sự hoàn toàn. Vì đơn
-- nghỉ phép ảnh hưởng trực tiếp tới trừ ngày phép (và sau này là lương
-- nếu nghỉ không lương), đây là lỗ hổng có thể ảnh hưởng tới lương thực
-- tế nếu bị lợi dụng.
-- =====================================================================
create or replace function enforce_leave_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  is_hr boolean;
begin
  if is_executive_or_tech() then
    return new; -- Ban điều hành/Kỹ thuật toàn quyền, kể cả sửa lại khi cần
  end if;

  is_hr := (current_department_id() = (select id from departments where code = 'HR'));

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'submitted' and old.employee_id = current_employee_id() then
      if new.level1_approver_id is not null or new.level2_approver_id is not null or new.level3_approver_id is not null then
        raise exception 'Không được tự ghi chữ ký duyệt khi mới nộp đơn.';
      end if;
    elsif old.status = 'submitted' and new.status = 'approved_1' and is_direct_manager_of(old.employee_id) then
      if new.level1_approver_id is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
      if new.level2_approver_id is distinct from old.level2_approver_id
        or new.level3_approver_id is distinct from old.level3_approver_id then
        raise exception 'Không được tự ghi chữ ký của cấp duyệt khác.';
      end if;
    elsif old.status = 'approved_1' and new.status = 'approved_2' and is_hr then
      if new.level2_approver_id is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
      if new.level1_approver_id is distinct from old.level1_approver_id
        or new.level3_approver_id is distinct from old.level3_approver_id then
        raise exception 'Không được tự ghi chữ ký của cấp duyệt khác.';
      end if;
    elsif new.status = 'rejected' and old.status in ('submitted', 'approved_1', 'approved_2')
      and (is_direct_manager_of(old.employee_id) or is_hr) then
      null; -- ok: từ chối được phép ở các bước trung gian
    else
      raise exception 'Không được phép tự chuyển trạng thái % -> % ở bước này.', old.status, new.status;
    end if;
  else
    if old.employee_id is distinct from current_employee_id() then
      raise exception 'Không có quyền chỉnh sửa trực tiếp đơn này ở trạng thái hiện tại.';
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists leave_requests_guard_update on leave_requests;
create trigger leave_requests_guard_update
before update on leave_requests
for each row execute function enforce_leave_request_transition();

-- =====================================================================
-- PHẦN 2 — 🔴 business_trips: CÙNG LỖI nhưng NẶNG HƠN — kể cả bước cuối
-- (Ban điều hành duyệt, approved_3) cũng đi qua update() trực tiếp từ
-- frontend (không có RPC nào bảo vệ như finalize_leave_request_v2 bên
-- đơn nghỉ) — nghĩa là 1 Quản lý trực tiếp có thể tự duyệt trọn vẹn 1
-- đơn công tác qua CẢ 3 CẤP chỉ bằng 1 lệnh update(), không cần Nhân sự
-- hay Ban điều hành động vào.
-- =====================================================================
create or replace function enforce_business_trip_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  is_hr boolean;
begin
  if is_executive_strict() then
    return new; -- Ban điều hành (Executive) toàn quyền, kể cả sửa lại khi cần
  end if;

  is_hr := (current_department_id() = (select id from departments where code = 'HR'));

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'submitted' and old.employee_id = current_employee_id() then
      if new.manager_signed_by is not null or new.hr_signed_by is not null or new.approved_by is not null then
        raise exception 'Không được tự ghi chữ ký duyệt khi mới nộp đơn.';
      end if;
    elsif old.status = 'submitted' and new.status = 'approved_1' and is_direct_manager_of(old.employee_id) then
      if new.manager_signed_by is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
      if new.hr_signed_by is distinct from old.hr_signed_by or new.approved_by is distinct from old.approved_by then
        raise exception 'Không được tự ghi chữ ký của cấp duyệt khác.';
      end if;
    elsif old.status = 'approved_1' and new.status = 'approved_2' and is_hr then
      if new.hr_signed_by is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
      if new.manager_signed_by is distinct from old.manager_signed_by or new.approved_by is distinct from old.approved_by then
        raise exception 'Không được tự ghi chữ ký của cấp duyệt khác.';
      end if;
    elsif new.status = 'rejected' and old.status in ('submitted', 'approved_1', 'approved_2')
      and (is_direct_manager_of(old.employee_id) or is_hr) then
      null; -- ok: từ chối được phép ở các bước trung gian
    else
      raise exception 'Không được phép tự chuyển trạng thái % -> % ở bước này.', old.status, new.status;
    end if;
  else
    if old.employee_id is distinct from current_employee_id() then
      raise exception 'Không có quyền chỉnh sửa trực tiếp đơn này ở trạng thái hiện tại.';
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists business_trips_guard_update on business_trips;
create trigger business_trips_guard_update
before update on business_trips
for each row execute function enforce_business_trip_transition();
