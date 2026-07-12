-- =====================================================================
-- File 18: ĐIỂM DANH NHÂN VIÊN THEO VỊ TRÍ GPS (bán kính 1km)
-- (chạy sau file 17)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHẦN 1 — Toạ độ thật của 8 trung tâm (lấy từ Google Maps do bạn cung cấp)
-- ---------------------------------------------------------------------
alter table centers add column if not exists latitude numeric(10,7);
alter table centers add column if not exists longitude numeric(10,7);

update centers set latitude = 9.9288093,  longitude = 106.3394652 where code = 'TRAVINH';
update centers set latitude = 9.9801922,  longitude = 106.2046490 where code = 'CANGLONG';
update centers set latitude = 9.8021340,  longitude = 106.4521071 where code = 'CAUNGANG';
update centers set latitude = 9.6442125,  longitude = 106.5002297 where code = 'DUYENHAI';
update centers set latitude = 10.1154238, longitude = 106.3273442 where code = 'MOCAY';
update centers set latitude = 10.2478003, longitude = 106.3787318 where code = 'MEKONG';
update centers set latitude = 9.8782856,  longitude = 106.0611076 where code = 'CAUKE';
update centers set latitude = 9.8152535,  longitude = 106.1890901 where code = 'TIEUCAN';

-- ---------------------------------------------------------------------
-- PHẦN 2 — Lịch sử chấm công theo vị trí GPS
-- ---------------------------------------------------------------------
create table if not exists attendance_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid not null references employees(id),
  center_id uuid not null references centers(id),
  check_type text not null check (check_type in ('in', 'out')),
  checked_at timestamptz not null default now(),
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  distance_m numeric(8,1) not null,        -- khoảng cách thật tới trung tâm lúc chấm công
  created_at timestamptz not null default now()
);
create index if not exists idx_attendance_checkins_employee_date on attendance_checkins(employee_id, checked_at);
create index if not exists idx_attendance_checkins_center_date on attendance_checkins(center_id, checked_at);

alter table attendance_checkins enable row level security;

drop policy if exists attendance_checkins_select on attendance_checkins;
create policy attendance_checkins_select on attendance_checkins for select
  using (
    employee_id = current_employee_id()
    or (current_role_code() = 'CENTER_MANAGER' and center_id = current_center_id())
    or current_department_id() = (select id from departments where code = 'HR')
    or is_executive_or_tech()
  );

drop policy if exists attendance_checkins_insert on attendance_checkins;
create policy attendance_checkins_insert on attendance_checkins for insert
  with check (employee_id = current_employee_id());

-- Không cho sửa/xoá lịch sử chấm công (trừ TECH) — đảm bảo tính toàn vẹn
-- dữ liệu chấm công, giống nguyên tắc đã áp dụng cho thu học phí.
drop policy if exists attendance_checkins_tech_manage on attendance_checkins;
create policy attendance_checkins_tech_manage on attendance_checkins for all
  using (is_tech()) with check (is_tech());
