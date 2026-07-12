-- =====================================================================
-- File 76: THEM MA RIENG (giong employee_code) cho Hoc sinh, Phu huynh,
-- Lop hoc - de de dang tra cuu/tham chieu, dung theo dung mau da co san
-- cho nhan vien (AIS-0001) o file 07_id_generation.sql:
--   Hoc sinh   -> HS-0001, HS-0002, ...
--   Phu huynh  -> PH-0001, PH-0002, ...
--   Lop hoc    -> LOP-0001, LOP-0002, ...
-- Tu dong sinh cho ban ghi MOI, dong thoi backfill du lieu CU da co san
-- (theo dung thu tu ngay tao, khong lam xao tron du lieu).
-- (chay sau file 75)
-- =====================================================================

-- ---------------------- HOC SINH ----------------------
alter table students add column if not exists student_code text unique;

create sequence if not exists student_code_seq start 1;
create or replace function generate_student_code() returns text as $$
declare n int;
begin
  n := nextval('student_code_seq');
  return 'HS-' || lpad(n::text, 4, '0');
end;
$$ language plpgsql;

create or replace function trg_set_student_code() returns trigger as $$
begin
  if new.student_code is null or new.student_code = '' then
    new.student_code := generate_student_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists students_set_student_code on students;
create trigger students_set_student_code
before insert on students
for each row execute function trg_set_student_code();

-- Backfill hoc sinh da co san truoc do (theo dung thu tu ngay tao)
do $$
declare r record; begin
  for r in select id from students where student_code is null order by created_at loop
    update students set student_code = generate_student_code() where id = r.id;
  end loop;
end $$;

-- ---------------------- PHU HUYNH ----------------------
alter table parent_accounts add column if not exists parent_code text unique;

create sequence if not exists parent_code_seq start 1;
create or replace function generate_parent_code() returns text as $$
declare n int;
begin
  n := nextval('parent_code_seq');
  return 'PH-' || lpad(n::text, 4, '0');
end;
$$ language plpgsql;

create or replace function trg_set_parent_code() returns trigger as $$
begin
  if new.parent_code is null or new.parent_code = '' then
    new.parent_code := generate_parent_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists parent_accounts_set_parent_code on parent_accounts;
create trigger parent_accounts_set_parent_code
before insert on parent_accounts
for each row execute function trg_set_parent_code();

do $$
declare r record; begin
  for r in select id from parent_accounts where parent_code is null order by created_at loop
    update parent_accounts set parent_code = generate_parent_code() where id = r.id;
  end loop;
end $$;

-- ---------------------- LOP HOC ----------------------
alter table classes add column if not exists class_code text unique;

create sequence if not exists class_code_seq start 1;
create or replace function generate_class_code() returns text as $$
declare n int;
begin
  n := nextval('class_code_seq');
  return 'LOP-' || lpad(n::text, 4, '0');
end;
$$ language plpgsql;

create or replace function trg_set_class_code() returns trigger as $$
begin
  if new.class_code is null or new.class_code = '' then
    new.class_code := generate_class_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists classes_set_class_code on classes;
create trigger classes_set_class_code
before insert on classes
for each row execute function trg_set_class_code();

do $$
declare r record; begin
  for r in select id from classes where class_code is null order by created_at loop
    update classes set class_code = generate_class_code() where id = r.id;
  end loop;
end $$;
