-- =====================================================================
-- File 81: SUA LOI "duplicate key value violates unique constraint
-- invoices_student_id_period_year_period_month_key" — truoc day
-- create_payment_plan_invoice() KHONG kiem tra truoc xem hoc sinh DA CO
-- hoa don cho dung nam/thang hien tai chua, cu the la INSERT thang, neu
-- trung thi loi SQL tho van ra thang man hinh (khong than thien), hoac
-- bi nuot am tham boi trigger tu dong xep lop (chi bao "co loi" chung
-- chung khong ro rang).
--
-- Nguyen nhan thuong gap: hoc sinh da duoc tao hoa don thang nay roi (tu
-- tay hoac tu dong khi xep lop lan dau), sau do bi XEP LOP LAI lan nua
-- trong CUNG thang do (sua sai/chuyen lop) — trigger tu dong chay lai,
-- co gang tao THEM 1 hoa don nua cho dung thang do => trung khoa.
-- (chay sau file 80)
-- =====================================================================
create or replace function create_payment_plan_invoice(
  p_student_id uuid, p_plan_type text, p_scope_id uuid,
  p_manual_discount_rate numeric default 0, p_special_category text default null
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_plan_discount_rate numeric;
  v_auto_discount_rate numeric := 0;
  v_class_id uuid;
  v_center_id uuid;
  v_base_price numeric;
  v_course_count int;
  v_final_price numeric;
  v_due_date date;
  v_manual_rate numeric;
  v_result invoices;
  v_existing_invoice_id uuid;
  v_student_name text;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen tao hoa don.';
  end if;

  -- KIEM TRA TRUOC: hoc sinh nay DA CO hoa don cho dung thang/nam hien
  -- tai chua — neu co roi thi bao loi RO RANG, THAN THIEN thay vi de
  -- constraint SQL tho van ra man hinh nguoi dung.
  select id into v_existing_invoice_id from invoices
  where student_id = p_student_id
    and period_year = extract(year from current_date)::int
    and period_month = extract(month from current_date)::int;

  if v_existing_invoice_id is not null then
    select full_name into v_student_name from students where id = p_student_id;
    raise exception 'Học sinh "%" đã có hoá đơn cho tháng %/% rồi (mã hoá đơn: %). Vui lòng kiểm tra lại trong "Công nợ học phí" trước khi tạo hoá đơn mới, tránh thu trùng.',
      coalesce(v_student_name, '—'), extract(month from current_date)::int, extract(year from current_date)::int, v_existing_invoice_id;
  end if;

  v_manual_rate := greatest(least(coalesce(p_manual_discount_rate, 0), 1), 0);

  select discount_rate into v_plan_discount_rate from payment_plan_discounts where plan_type = p_plan_type;

  select class_id, center_id into v_class_id, v_center_id from students where id = p_student_id;
  if v_class_id is not null then
    v_auto_discount_rate := get_auto_discount_for_class(v_class_id, v_center_id);
  end if;

  if p_plan_type = 'sublevel' then
    select coalesce(sum(price_vnd), 0), count(*) into v_base_price, v_course_count
    from program_courses where sublevel_id = p_scope_id;
  elsif p_plan_type = 'level' then
    select coalesce(sum(pc.price_vnd), 0), count(*) into v_base_price, v_course_count
    from program_courses pc join program_sublevels ps on ps.id = pc.sublevel_id
    where ps.level_id = p_scope_id;
  elsif p_plan_type = 'program' then
    select coalesce(sum(pc.price_vnd), 0), count(*) into v_base_price, v_course_count
    from program_courses pc
    join program_sublevels ps on ps.id = pc.sublevel_id
    join program_levels pl on pl.id = ps.level_id
    where pl.program_id = p_scope_id;
  else
    raise exception 'plan_type khong hop le.';
  end if;

  if v_base_price is null or v_base_price <= 0 then
    raise exception 'Chua cau hinh hoc phi cho pham vi nay.';
  end if;

  v_final_price := v_base_price * (1 - least(coalesce(v_plan_discount_rate, 0) + v_auto_discount_rate + v_manual_rate, 1));

  select end_date into v_due_date from classes where id = v_class_id;
  if v_due_date is null then
    v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  end if;

  insert into invoices (student_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason, special_category)
  values (
    p_student_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_base_price, v_base_price, v_due_date, 'unpaid',
    case when p_special_category is not null then 'special' when v_plan_discount_rate > 0 or v_auto_discount_rate > 0 or v_manual_rate > 0 then 'program' else 'none' end,
    v_base_price - v_final_price,
    format('Hinh thuc %s%% + He thong %s%% + Tay %s%%', round(coalesce(v_plan_discount_rate,0)*100,1), round(v_auto_discount_rate*100,1), round(v_manual_rate*100,1)),
    p_special_category
  )
  returning * into v_result;

  if p_plan_type in ('level', 'program') then
    insert into payment_plan_purchases (student_id, plan_type, level_id, program_id, total_courses, discount_rate_applied, total_amount_vnd, invoice_id)
    values (
      p_student_id, p_plan_type,
      case when p_plan_type = 'level' then p_scope_id else null end,
      case when p_plan_type = 'program' then p_scope_id else null end,
      v_course_count, coalesce(v_plan_discount_rate, 0) + v_auto_discount_rate + v_manual_rate, v_final_price, v_result.id
    );
  end if;

  return v_result;
end;
$func$;
