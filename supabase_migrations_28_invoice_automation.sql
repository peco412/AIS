-- =====================================================================
-- File 28: NHIEU CAP NHAT LON (chay sau file 27)
-- - Tach rieng chiet khau bac mac dinh vs uu dai chuong trinh de hien UI
-- - Hoc phi chuong trinh hoc + tu tao hoa don khi them hoc vien vao lop
-- - Trang thai suc khoe cong no (Tot/Trung binh/Xau)
-- - Doi lop / rut ho so anh huong hoa don
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN 1 - Tach rieng 2 loai chiet khau trong ket qua tra ve, de giao
-- dien nap vi hien dung tung muc rieng (Chiet khau theo muc nap / Uu dai
-- chuong trinh dang co) thay vi chi co 1 con so da gop san.
-- ---------------------------------------------------------------------
drop function if exists calculate_topup_conversion(numeric, uuid);
create or replace function calculate_topup_conversion(p_coin_amount numeric, p_center_id uuid)
returns table (
  discount_rate numeric,
  conversion_rate numeric,
  program_id uuid,
  tier_rate numeric,
  program_rate numeric,
  program_name text
)
language plpgsql stable
as $func$
declare
  v_default_rate numeric;
  v_program discount_programs;
  v_final_rate numeric;
begin
  v_default_rate := get_default_discount_rate(p_coin_amount);
  v_program := get_active_discount_program(p_center_id);

  if v_program.id is not null and v_program.discount_rate > 0.20 then
    v_final_rate := v_program.discount_rate;
  else
    v_final_rate := least(v_default_rate + coalesce(v_program.discount_rate, 0), 0.40);
  end if;

  return query select
    v_final_rate, (1 - v_final_rate), v_program.id,
    v_default_rate, coalesce(v_program.discount_rate, 0), v_program.name;
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN 2 - Hoc phi theo chuong trinh hoc (de tu tinh hoa don khi them
-- hoc vien vao lop) - them cot gia vao programs, KHONG doi gi cau truc cu.
-- ---------------------------------------------------------------------
alter table programs add column if not exists monthly_fee_vnd numeric(14,2);
comment on column programs.monthly_fee_vnd is 'Hoc phi/thang mac dinh cua chuong trinh - dung de tu tinh hoa don khi ghi danh, co the dieu chinh tay tung hoa don';

-- ---------------------------------------------------------------------
-- PHAN 3 - Hoa don: them cho ghi uu dai nhap tay + ly do, va lien ket lop
-- ---------------------------------------------------------------------
alter table invoices add column if not exists class_id uuid references classes(id);
alter table invoices add column if not exists manual_discount_vnd numeric(14,2) not null default 0;
alter table invoices add column if not exists manual_discount_reason text;
alter table invoices add column if not exists cancelled boolean not null default false;

-- ---------------------------------------------------------------------
-- PHAN 4 - Tu tao hoa don khi them hoc vien vao lop
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
begin
  if new.class_id is null or new.class_id = coalesce(old.class_id, '00000000-0000-0000-0000-000000000000'::uuid) then
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

drop trigger if exists trg_auto_invoice_enrollment on students;
create trigger trg_auto_invoice_enrollment
after insert or update of class_id on students
for each row execute function auto_create_invoice_on_enrollment();

-- ---------------------------------------------------------------------
-- PHAN 5 - Doi lop / rut ho so: huy cac hoa don TUONG LAI CHUA DONG cua
-- lop cu (giu nguyen hoa don da dong/dang dong do de khong mat lich su).
-- ---------------------------------------------------------------------
create or replace function handle_class_change_or_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if old.class_id is not null and new.class_id is distinct from old.class_id then
    update invoices set cancelled = true
    where student_id = new.id and class_id = old.class_id and status = 'unpaid'
      and (period_year, period_month) >= (extract(year from current_date)::int, extract(month from current_date)::int);
  end if;

  if new.status = 'withdrawn' and old.status is distinct from 'withdrawn' then
    update invoices set cancelled = true where student_id = new.id and status = 'unpaid';
  end if;

  return new;
end;
$func$;

drop trigger if exists trg_class_change_withdrawal on students;
create trigger trg_class_change_withdrawal
after update of class_id, status on students
for each row execute function handle_class_change_or_withdrawal();

-- ---------------------------------------------------------------------
-- PHAN 6 - View tinh "suc khoe cong no" (Tot/Trung binh/Xau)
-- ---------------------------------------------------------------------
create or replace view invoices_health_view as
select
  i.*,
  case
    when i.status = 'paid' then 'good'
    when i.due_date < current_date and i.status = 'partially_paid' then 'fair'
    when i.due_date < current_date and i.status = 'unpaid' then 'poor'
    else null
  end as health_status
from invoices i
where i.cancelled = false;

alter view invoices_health_view set (security_invoker = true);
