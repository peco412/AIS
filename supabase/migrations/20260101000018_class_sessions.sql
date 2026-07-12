-- =====================================================================
-- File 19: TỰ SINH LỊCH ĐIỂM DANH + LỊCH GIÁO VIÊN KHI TẠO LỚP
-- (chạy sau file 18)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHẦN 1 — Lớp học: lưu thêm giờ học cụ thể (trước đây chỉ có "ghi chú
-- lịch học" dạng chữ tự do, không tách được để tự sinh lịch)
-- ---------------------------------------------------------------------
alter table classes add column if not exists start_time time;
alter table classes add column if not exists end_time time;
alter table classes add column if not exists days_of_week smallint[]; -- [1,3,5] = Thứ 2/4/6 (1=T2...7=CN)

-- ---------------------------------------------------------------------
-- PHẦN 2 — "Phiên học" — chỉ đánh dấu NGÀY nào có buổi học thật (tách khỏi
-- điểm danh) để: (a) giáo viên chỉ điểm danh được đúng ngày có lịch,
-- (b) biết chính xác lớp còn bao nhiêu buổi tới hết khoá.
-- ---------------------------------------------------------------------
create table if not exists class_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  session_date date not null,
  created_at timestamptz not null default now(),
  unique (class_id, session_date)
);
create index if not exists idx_class_sessions_class_date on class_sessions(class_id, session_date);

alter table class_sessions enable row level security;

drop policy if exists class_sessions_select on class_sessions;
create policy class_sessions_select on class_sessions for select
  using (
    exists (select 1 from classes c where c.id = class_sessions.class_id
            and (c.teacher_id = current_employee_id() or c.center_id = current_center_id()))
    or is_executive_or_tech()
  );

drop policy if exists class_sessions_write on class_sessions;
create policy class_sessions_write on class_sessions for all
  using (
    exists (select 1 from classes c where c.id = class_sessions.class_id and c.center_id = current_center_id())
    or is_executive_or_tech()
  )
  with check (
    exists (select 1 from classes c where c.id = class_sessions.class_id and c.center_id = current_center_id())
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- PHẦN 3 — Điểm danh: thêm 2 trạng thái P (vắng có phép) / KP (vắng không
-- phép) thay vì chỉ có true/false present, và chặn điểm danh SAI NGÀY
-- (chỉ điểm danh được đúng ngày hôm đó, quá ngày cần quyền đặc biệt).
-- ---------------------------------------------------------------------
alter table class_attendance add column if not exists attendance_type text
  check (attendance_type in ('present', 'excused', 'unexcused'));
-- Chuyển dữ liệu cũ (present=true/false) sang attendance_type tương ứng,
-- giữ cột "present" lại để không phá các câu query cũ (present = có mặt).
update class_attendance set attendance_type = case when present then 'present' else 'unexcused' end
  where attendance_type is null;

-- Chặn điểm danh lùi ngày trừ khi có quyền đặc biệt (theo đúng yêu cầu:
-- Trưởng phòng Kế toán được phép điểm danh bù ngày cũ — dùng lại đúng cơ
-- chế has_module_permission đã có, module_key '/teacher/attendance.html').
create or replace function enforce_attendance_date_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.session_date < current_date and not (
    (current_department_id() = (select id from departments where code = 'ACC') and current_role_code() in ('DEPT_HEAD','DEPT_DEPUTY'))
    or has_module_permission('/teacher/attendance.html')
    or is_executive_or_tech()
  ) then
    raise exception 'Chỉ điểm danh được trong đúng ngày diễn ra buổi học. Điểm danh bù ngày cũ cần được Trưởng phòng Kế toán cấp quyền.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_attendance_date on class_attendance;
create trigger trg_enforce_attendance_date
before insert on class_attendance
for each row execute function enforce_attendance_date_rule();
