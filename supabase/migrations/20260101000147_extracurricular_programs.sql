-- =====================================================================
-- File 147: CHƯƠNG TRÌNH NGOẠI KHOÁ (thay "Chương trình ưu đãi" trên
-- app phụ huynh) (19/07/2026)
-- =====================================================================
-- Theo đúng yêu cầu: bỏ hiển thị "Chương trình ưu đãi" (giảm giá học phí
-- — vẫn CHẠY NGẦM để tính tiền hoá đơn, chỉ không hiện nổi bật ở trang
-- chủ nữa) trên app phụ huynh, thay bằng "Chương trình ngoại khoá" — mỗi
-- chương trình có nút "Đăng ký" mở đúng link Google Form. Có công cụ
-- nhập riêng cho Phòng truyền thông (MKT).
-- =====================================================================
create table if not exists extracurricular_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  google_form_url text not null,
  center_id uuid references centers(id), -- null = hien cho TOAN HE THONG
  is_active boolean not null default true,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_extracurricular_programs_active on extracurricular_programs(is_active, center_id);

alter table extracurricular_programs enable row level security;

create policy extracurricular_programs_select_parent on extracurricular_programs for select
  using (
    is_active = true
    and (
      center_id is null
      or exists (
        select 1 from parent_student_links psl
        join students s on s.id = psl.student_id
        where psl.parent_account_id = current_parent_id() and s.center_id = extracurricular_programs.center_id
      )
    )
  );

create policy extracurricular_programs_select_staff on extracurricular_programs for select
  using (
    current_department_id() = (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );

create policy extracurricular_programs_write on extracurricular_programs for all
  using (
    current_department_id() = (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  )
  with check (
    current_department_id() = (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );

comment on table extracurricular_programs is 'Chương trình ngoại khoá hiện cho phụ huynh trong app AISCenter, kèm link đăng ký Google Form — thay thế phần hiển thị Chương trình ưu đãi ở trang chủ. Xem file 147.';

create or replace function extracurricular_programs_guard_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  new.created_by := current_employee_id();
  new.updated_at := now();
  return new;
end;
$func$;

drop trigger if exists extracurricular_programs_guard_identity on extracurricular_programs;
create trigger extracurricular_programs_guard_identity
before insert or update on extracurricular_programs
for each row execute function extracurricular_programs_guard_identity();
