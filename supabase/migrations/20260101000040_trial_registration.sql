-- =====================================================================
-- File 40: DANG KY HOC THU (chua tung duoc xay dung mac du DB da co san
-- trang thai 'trial' tu lau) - chay sau file 39
-- =====================================================================
alter table students add column if not exists trial_start_date date;
alter table students add column if not exists trial_end_date date;
alter table students add column if not exists trial_sessions_count int;
comment on column students.trial_start_date is 'Chi dung khi status = trial';
comment on column students.trial_end_date is 'Chi dung khi status = trial';
comment on column students.trial_sessions_count is 'So buoi hoc thu du kien - chi dung khi status = trial';

-- Tu van vien can duoc INSERT hoc sinh (dang ky hoc thu) - truoc day chi
-- Quan ly trung tam duoc, thieu Tu van vien du day la nguoi truc tiep lam.
drop policy if exists students_write on students;
create policy students_write on students for insert
  with check (
    (current_role_code() in ('CENTER_MANAGER', 'CONSULTANT') and center_id = current_center_id())
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- PHAT HIEN NGUY HIEM: hoc vien dang ky HOC THU van duoc gan class_id ->
-- kich hoat NHAM trigger auto_create_invoice_on_enrollment() (migration
-- 28), tu tao hoa don that cho hoc vien con dang hoc thu, chua he dong y
-- hoc chinh thuc! Va lai bang cach bo qua han khi status = 'trial'.
-- ---------------------------------------------------------------------
create or replace function auto_create_invoice_on_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_program_id uuid;
  v_fee numeric;
  v_due_date date;
  v_old_class_id uuid;
begin
  if new.status = 'trial' then
    return new; -- hoc thu KHONG tao hoa don
  end if;

  v_old_class_id := case when tg_op = 'UPDATE' then old.class_id else null end;

  if new.class_id is null or new.class_id = coalesce(v_old_class_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    return new;
  end if;

  select program_id, end_date into v_program_id, v_due_date from classes where id = new.class_id;
  if v_program_id is null then return new; end if;

  select monthly_fee_vnd into v_fee from programs where id = v_program_id;
  if v_fee is null or v_fee <= 0 then return new; end if;

  v_due_date := least(
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
    coalesce(v_due_date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date)
  );

  insert into invoices (student_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, class_id)
  values (new.id, extract(year from current_date)::int, extract(month from current_date)::int, v_fee, v_fee, v_due_date, 'unpaid', new.class_id)
  on conflict (student_id, period_year, period_month) do nothing;

  return new;
end;
$func$;

-- Truong hop chuyen tu 'trial' sang chinh thuc (vd 'studying') MA KHONG
-- doi class_id (da hoc thu dung lop do roi, gio dong y hoc that) -> chua
-- co gi kich hoat tao hoa don ca, vi trigger tren chi theo doi cot
-- class_id thay doi. Them 1 trigger rieng theo doi ca cot status.
create or replace function auto_create_invoice_on_trial_conversion()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_program_id uuid;
  v_fee numeric;
  v_due_date date;
begin
  -- Chi xu ly dung truong hop: TU 'trial' CHUYEN SANG khac 'trial', va
  -- da co san lop hoc (khong doi class_id o day, tranh tao trung voi
  -- trigger kia).
  if old.status = 'trial' and new.status <> 'trial' and new.class_id is not null and new.class_id = old.class_id then
    select program_id, end_date into v_program_id, v_due_date from classes where id = new.class_id;
    if v_program_id is null then return new; end if;

    select monthly_fee_vnd into v_fee from programs where id = v_program_id;
    if v_fee is null or v_fee <= 0 then return new; end if;

    v_due_date := least(
      (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
      coalesce(v_due_date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date)
    );

    insert into invoices (student_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, class_id)
    values (new.id, extract(year from current_date)::int, extract(month from current_date)::int, v_fee, v_fee, v_due_date, 'unpaid', new.class_id)
    on conflict (student_id, period_year, period_month) do nothing;
  end if;
  return new;
end;
$func$;

drop trigger if exists trg_trial_conversion_invoice on students;
create trigger trg_trial_conversion_invoice
after update of status on students
for each row execute function auto_create_invoice_on_trial_conversion();
