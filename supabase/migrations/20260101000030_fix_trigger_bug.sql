-- =====================================================================
-- File 30: VA LOI THAT - auto_create_invoice_on_enrollment() tham chieu
-- OLD ngay ca khi trigger chay do INSERT (them hoc sinh moi), luc do OLD
-- CHUA duoc gan -> loi runtime "record OLD is not assigned yet" moi lan
-- co nhan vien them hoc sinh moi kem san class_id ngay tu dau.
-- (chay sau file 29)
-- =====================================================================
create or replace function auto_create_invoice_on_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program_id uuid;
  v_fee numeric;
  v_due_date date;
  v_old_class_id uuid;
begin
  -- Chi lay OLD.class_id khi trigger chay do UPDATE (tuc la co ban ghi cu
  -- that su) - INSERT thi OLD khong ton tai, phai coi nhu null.
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
$$;
