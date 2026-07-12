-- =====================================================================
-- File 02: MODULE HỌC VỤ - Chương trình học, Lớp, Học viên, Giáo viên, Tư vấn
-- =====================================================================

-- Chương trình học lớn: PRE-SCHOOL, KIDS, PRE A1 STARTERS, A1 MOVERS,
-- A2 FLYERS, A2 KET, B1 PET, B2 FCE, IELTS, COMMUNICATION
create table programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text not null unique,
  name text not null,
  display_order smallint not null default 0
);

-- Cấp độ (Pre-School 1, Kids 1, Movers, Foundation...)
create table program_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  name text not null,
  display_order smallint not null default 0
);

-- Cấp độ con / khoá cụ thể (Pre-School 1.1, Movers 1, Speed Up 1...)
create table program_sublevels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id uuid not null references program_levels(id) on delete cascade,
  name text not null,
  display_order smallint not null default 0
);

-- ---------------------------------------------------------------------
-- LỚP HỌC
-- ---------------------------------------------------------------------
create table classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text not null,
  center_id uuid not null references centers(id),
  program_id uuid not null references programs(id),
  level_id uuid references program_levels(id),
  sublevel_id uuid references program_sublevels(id),
  teacher_id uuid references employees(id),
  schedule_note text,               -- mô tả lịch học (ví dụ: T2-4-6, 18h-19h30)
  student_count int not null default 0, -- tự cập nhật qua trigger khi thêm/xoá học viên
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_classes_center on classes(center_id);
create index idx_classes_teacher on classes(teacher_id);

-- ---------------------------------------------------------------------
-- HỌC VIÊN
-- ---------------------------------------------------------------------
create table students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text not null,
  dob date,
  current_school text,
  entry_level_id uuid references program_levels(id), -- trình độ đầu vào khi test
  class_id uuid references classes(id),               -- tự điền từ phân lớp
  parent_name text,
  phone text,
  backup_phone text,
  email text,
  enrollment_date date not null default current_date,
  status student_status not null default 'studying',
  center_id uuid not null references centers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_students_class on students(class_id);
create index idx_students_center on students(center_id);

-- Trigger: cập nhật sĩ số lớp khi học viên được gán/xoá khỏi lớp
create or replace function trg_update_class_count() returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.class_id is not null) then
    update classes set student_count = student_count + 1 where id = new.class_id;
  elsif (tg_op = 'DELETE' and old.class_id is not null) then
    update classes set student_count = greatest(student_count - 1, 0) where id = old.class_id;
  elsif (tg_op = 'UPDATE' and old.class_id is distinct from new.class_id) then
    if old.class_id is not null then
      update classes set student_count = greatest(student_count - 1, 0) where id = old.class_id;
    end if;
    if new.class_id is not null then
      update classes set student_count = student_count + 1 where id = new.class_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger students_class_count
after insert or update or delete on students
for each row execute function trg_update_class_count();

-- ---------------------------------------------------------------------
-- BẢNG ĐIỂM HỌC VIÊN (điền tự động từ Bảng điểm lớp học của giáo viên)
-- ---------------------------------------------------------------------
create table student_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  class_id uuid not null references classes(id),
  level_id uuid references program_levels(id),
  term text,                          -- kỳ / khoá học
  score numeric(5,2),
  ranking text,                       -- xếp loại
  final_status text check (final_status in ('graduated','not_passed')),
  entered_by uuid references employees(id), -- giáo viên nhập
  created_at timestamptz not null default now()
);
create index idx_grades_student on student_grades(student_id);

-- Điểm danh theo buổi
create table class_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  session_date date not null,
  present boolean not null default true,
  note text,
  taken_by uuid references employees(id),
  created_at timestamptz not null default now(),
  unique (class_id, student_id, session_date)
);

-- ---------------------------------------------------------------------
-- LỊCH TRỰC TRUNG TÂM & PHÂN LỊCH TUẦN GIÁO VIÊN
-- ---------------------------------------------------------------------
create table center_duty_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid not null references centers(id),
  employee_id uuid not null references employees(id),
  duty_date date not null,
  shift text,                         -- sáng/chiều/tối hoặc giờ cụ thể
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index idx_duty_center_date on center_duty_schedules(center_id, duty_date);

create table teacher_weekly_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid not null references employees(id),
  class_id uuid references classes(id),
  center_id uuid not null references centers(id),
  week_start_date date not null,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  start_time time,
  end_time time,
  is_substitute boolean not null default false,
  substitute_for_teacher_id uuid references employees(id), -- dạy thay ai
  note text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index idx_teacher_sched_teacher on teacher_weekly_schedules(teacher_id, week_start_date);

-- Phân lịch làm việc nhân sự hành chính (trừ phòng học vụ), tại các trung tâm
create table work_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid not null references employees(id),
  center_id uuid not null references centers(id),
  work_date date not null,
  shift text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index idx_work_sched_employee on work_schedules(employee_id, work_date);

-- ---------------------------------------------------------------------
-- TƯ VẤN - HỒ SƠ KHÁCH HÀNG (CRM)
-- ---------------------------------------------------------------------
create table crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text not null,
  dob date,
  current_school text,
  parent_name text,
  phone text,
  backup_phone text,
  email text,
  status lead_status not null default 'potential',
  center_id uuid not null references centers(id),
  consultant_id uuid references employees(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_leads_center on crm_leads(center_id);
create index idx_leads_consultant on crm_leads(consultant_id);
