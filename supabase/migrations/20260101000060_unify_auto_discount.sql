-- =====================================================================
-- File 60: NOI "Uu dai tu dong dien" (He thong uu dai Ke toan) VAO CA 3
-- hinh thuc thu (Theo khoa/Cap do/Chuong trinh) - truoc day chi ap dung
-- cho "Nhap tay tu do", 3 hinh thuc con lai hoan toan khong duoc huong
-- uu dai nay (chi co payment_plan_discounts rieng, khong lien quan gi
-- toi He thong uu dai cua Ke toan). (chay sau file 59)
-- =====================================================================
create or replace function create_payment_plan_invoice(
  p_student_id uuid, p_plan_type text, p_scope_id uuid
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
  v_result invoices;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Ban khong co quyen tao hoa don.';
  end if;

  select discount_rate into v_plan_discount_rate from payment_plan_discounts where plan_type = p_plan_type;

  -- MOI: quet them "He thong uu dai" (discount_programs) dung nhu ben
  -- luong nhap tay - dung dung lop/trung tam CUA HOC SINH (khong phai
  -- pham vi dang mua), vi day la uu dai ap dung cho HOC SINH DO noi
  -- chung khi thu hoc phi tai cho.
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

  -- Uu dai He thong (Ke toan cau hinh) VA uu dai theo hinh thuc dong CONG
  -- DON, gioi han tran 100% (thuc te se khong bao gio cham nguong nay).
  v_final_price := v_base_price * (1 - least(coalesce(v_plan_discount_rate, 0) + v_auto_discount_rate, 1));

  -- Han dong phi MAC DINH = ngay ket khoa cua lop hoc sinh dang hoc, dung
  -- dac ta "Han dong phi (He thong tu dong mac dinh la Ngay ket khoa)".
  select end_date into v_due_date from classes where id = v_class_id;
  if v_due_date is null then
    v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  end if;

  insert into invoices (student_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason)
  values (
    p_student_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_base_price, v_base_price, v_due_date, 'unpaid',
    case when v_plan_discount_rate > 0 or v_auto_discount_rate > 0 then 'program' else 'none' end,
    v_base_price - v_final_price,
    case when v_plan_discount_rate > 0 or v_auto_discount_rate > 0
      then format('Uu dai he thong %s%% + hinh thuc dong "%s" %s%%', round(v_auto_discount_rate*100,1), p_plan_type, round(coalesce(v_plan_discount_rate,0)*100,1))
      else null end
  )
  returning * into v_result;

  if p_plan_type in ('level', 'program') then
    insert into payment_plan_purchases (student_id, plan_type, level_id, program_id, total_courses, discount_rate_applied, total_amount_vnd, invoice_id)
    values (
      p_student_id, p_plan_type,
      case when p_plan_type = 'level' then p_scope_id else null end,
      case when p_plan_type = 'program' then p_scope_id else null end,
      v_course_count, coalesce(v_plan_discount_rate, 0) + v_auto_discount_rate, v_final_price, v_result.id
    );
  end if;

  return v_result;
end;
$func$;
