-- =====================================================================
-- File 107: RÀ SOÁT "KÝ SỐ HỒ SƠ" + "PHÂN VIỆC" (17/07/2026)
-- Tiếp tục đợt rà Nhân sự/CSVC sang 2 khu vực còn lại. Ký số hồ sơ tự do
-- (freeSign.js) hoá ra đã được thiết kế đúng — signature_logs có
-- with check (employee_id = current_employee_id()) chặn giả mạo ngay từ
-- đầu, không cần vá. Tìm được 2 vấn đề thật ở archive_files và
-- task_assignments.
-- =====================================================================

-- =====================================================================
-- PHẦN 1 — 🟡 archive_files: cột "người tải lên" giả mạo được
-- Mọi luồng lưu hồ sơ vào Kho lưu trữ (ký tự do, hợp đồng, đề xuất, phiếu
-- thanh toán...) đều insert với uploaded_by lấy thẳng từ client — rà 10
-- nơi gọi insert xác nhận TẤT CẢ đều set = chính người đang thao tác, nên
-- an toàn để ép cứng luôn, không ảnh hưởng bất kỳ luồng hợp lệ nào.
-- =====================================================================
create or replace function enforce_archive_upload_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  new.uploaded_by := current_employee_id();
  return new;
end;
$func$;

drop trigger if exists archive_files_guard_identity on archive_files;
create trigger archive_files_guard_identity
before insert on archive_files
for each row execute function enforce_archive_upload_identity();

-- =====================================================================
-- PHẦN 2 — 🟠 task_assignments (Phân việc): 2 vấn đề cùng lúc
--
-- (a) LỖI CHỨC NĂNG THẬT: giao diện cho người ĐƯỢC GIAO việc (assigned_to)
-- 1 ô chọn trạng thái (Chưa bắt đầu/Đang xử lý/Hoàn thành) để tự cập nhật
-- — nhưng RLS "tasks_manage" hiện tại KHÔNG hề có điều kiện assigned_to,
-- chỉ cho phép assigned_by (người giao) hoặc trưởng/phó phòng/BĐH sửa.
-- Nghĩa là: người được giao việc bấm đổi trạng thái sẽ BỊ LỖI (RLS chặn),
-- trừ khi họ tình cờ cũng là trưởng phòng — tính năng cốt lõi của trang
-- Phân việc không hoạt động đúng cho nhân viên thường.
--
-- (b) LỖ HỔNG: is_dept_head_or_above() không giới hạn theo PHÒNG BAN nào
-- — 1 Trưởng phòng Nhân sự có thể sửa/xoá task của phòng Kế toán, Truyền
-- thông... vì hàm chỉ kiểm tra CHỨC VỤ, không kiểm tra department_id có
-- khớp không. Không có with check nên cũng không chặn được assigned_by
-- giả mạo hay đổi department_id tuỳ ý khi tạo/sửa việc.
--
-- Sửa cả 2: mở đúng quyền cho người được giao (chỉ được đổi trạng thái,
-- không được đổi nội dung/người khác), và giới hạn trưởng/phó phòng chỉ
-- quản được việc của ĐÚNG phòng ban mình.
-- =====================================================================
drop policy if exists tasks_manage on task_assignments;
create policy tasks_manage on task_assignments for all
  using (
    assigned_by = current_employee_id()
    or assigned_to = current_employee_id()
    or (current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY') and department_id = current_department_id())
    or is_executive_or_tech()
  )
  with check (
    assigned_by = current_employee_id()
    or assigned_to = current_employee_id()
    or (current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY') and department_id = current_department_id())
    or is_executive_or_tech()
  );

create or replace function enforce_task_assignment_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if tg_op = 'INSERT' then
    new.assigned_by := current_employee_id(); -- chống giả mạo người giao việc
    return new;
  end if;

  -- UPDATE: nếu người thao tác CHỈ là người được giao việc (không phải
  -- người giao/trưởng phòng đúng ban/BĐH) thì chỉ được đổi status, không
  -- được sửa bất kỳ cột nào khác — đặc biệt không tự "đẩy việc" cho người
  -- khác qua việc đổi assigned_to.
  if not (
    is_executive_or_tech()
    or old.assigned_by = current_employee_id()
    or (current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY') and old.department_id = current_department_id())
  ) then
    if old.assigned_to is distinct from current_employee_id() then
      raise exception 'Bạn không có quyền sửa công việc này.';
    end if;
    if new.assigned_by is distinct from old.assigned_by
      or new.assigned_to is distinct from old.assigned_to
      or new.department_id is distinct from old.department_id
      or new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.due_date is distinct from old.due_date then
      raise exception 'Người được giao việc chỉ được cập nhật trạng thái, không được sửa nội dung khác.';
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists task_assignments_guard on task_assignments;
create trigger task_assignments_guard
before insert or update on task_assignments
for each row execute function enforce_task_assignment_rules();
