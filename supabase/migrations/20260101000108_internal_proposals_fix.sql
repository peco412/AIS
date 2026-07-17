-- =====================================================================
-- File 108: internal_proposals (Đề xuất nội bộ) — cùng lớp lỗi K.1/K.2
-- =====================================================================
-- RLS "proposals_update" cho phép Trưởng/phó phòng chạm vào phiếu đề
-- xuất của phòng mình khi đang ở bước 'submitted', nhưng không có
-- with check/trigger nào chặn việc họ tự set thẳng status='approved_2'
-- kèm level2_approver_id=chính họ — nhảy qua bước Ban điều hành duyệt
-- cuối cùng hoàn toàn.
-- =====================================================================
create or replace function enforce_internal_proposal_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  is_dept_head boolean;
begin
  if is_executive_strict() then
    return new; -- Ban điều hành toàn quyền, kể cả sửa lại khi cần
  end if;

  is_dept_head := (
    old.department_id = current_department_id()
    and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY')
  );

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'submitted' and old.employee_id = current_employee_id() then
      if new.level1_approver_id is not null or new.level2_approver_id is not null then
        raise exception 'Không được tự ghi chữ ký duyệt khi mới gửi đề xuất.';
      end if;
    elsif old.status = 'submitted' and new.status = 'approved_1' and is_dept_head then
      if new.level1_approver_id is distinct from current_employee_id() then
        raise exception 'Chữ ký duyệt phải là chính người đang thao tác.';
      end if;
      if new.level2_approver_id is distinct from old.level2_approver_id then
        raise exception 'Không được tự ghi chữ ký của cấp duyệt khác.';
      end if;
    elsif new.status = 'rejected' and old.status in ('submitted', 'approved_1') and is_dept_head then
      null; -- ok: từ chối được phép ở bước trung gian
    else
      raise exception 'Không được phép tự chuyển trạng thái % -> % ở bước này.', old.status, new.status;
    end if;
  else
    if old.employee_id is distinct from current_employee_id() then
      raise exception 'Không có quyền chỉnh sửa trực tiếp đề xuất này ở trạng thái hiện tại.';
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists internal_proposals_guard_update on internal_proposals;
create trigger internal_proposals_guard_update
before update on internal_proposals
for each row execute function enforce_internal_proposal_transition();
