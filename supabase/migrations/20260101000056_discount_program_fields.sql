-- =====================================================================
-- File 56: BO SUNG 2 TRUONG CON THIEU trong "He thong uu dai" / "Chiet
-- khau vi" - da tung phat hien nhung chua quay lai sua: Ma chuong trinh
-- (tu dong sinh) va Hinh thuc uu dai (Theo khoa/Theo cap do/Theo chuong
-- trinh/Tat ca) - dac ta yeu cau ro nhung bang hien tai chi co scope
-- (he thong/trung tam), khong phan biet duoc theo khoa hoc. (chay sau
-- file 55)
-- =====================================================================

alter table discount_programs add column if not exists code text unique;
alter table discount_programs add column if not exists applies_to text not null default 'all'
  check (applies_to in ('course', 'sublevel', 'program', 'all')); -- Theo khoa/Theo cap do/Theo chuong trinh/Tat ca
alter table discount_programs add column if not exists program_id uuid references programs(id);
alter table discount_programs add column if not exists sublevel_id uuid references program_sublevels(id);
alter table discount_programs add column if not exists course_id uuid references program_courses(id);
alter table discount_programs add constraint discount_applies_to_ref_check check (
  (applies_to = 'all')
  or (applies_to = 'program' and program_id is not null)
  or (applies_to = 'sublevel' and sublevel_id is not null)
  or (applies_to = 'course' and course_id is not null)
);

-- Tu sinh Ma chuong trinh dang DISC-0001, DISC-0002... tang dan
create sequence if not exists discount_program_code_seq start 1;
create or replace function trg_set_discount_program_code() returns trigger as $func$
begin
  if new.code is null then
    new.code := 'DISC-' || lpad(nextval('discount_program_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$func$ language plpgsql;

drop trigger if exists discount_programs_set_code on discount_programs;
create trigger discount_programs_set_code before insert on discount_programs
for each row execute function trg_set_discount_program_code();

-- Cap nhat view de tra ve them 2 truong moi cho frontend doc
drop view if exists discount_programs_view;
create view discount_programs_view as
select
  id, code, name, scope, center_id, discount_rate,
  applies_to, program_id, sublevel_id, course_id,
  lower(valid_range) as valid_from, upper(valid_range) as valid_to,
  status, created_by, created_at, updated_at
from discount_programs;

-- View vua DROP + CREATE lai (khong dung CREATE OR REPLACE do doi cau
-- truc cot) nen mat security_invoker cu, phai bat lai - thieu dong nay
-- se lam view chay voi quyen chu so huu thay vi quyen nguoi dang goi,
-- vo hieu hoa RLS.
alter view discount_programs_view set (security_invoker = true);
