-- =====================================================================
-- File 128: SỬA CHẶN "CHƯA ĐƯỢC TƯ VẤN VIÊN CHỐT" Ở TRANG TẠO HOÁ ĐƠN
-- CHUNG (19/07/2026)
-- =====================================================================
-- Bạn báo đúng: trang "Tạo hoá đơn chung" (general-invoicing) — ĐÂY CHÍNH
-- LÀ trang tự động liệt kê học sinh cần tạo hoá đơn theo danh sách lớp
-- (mục 3.Luồng 1 tài liệu) — vẫn còn chặn cứng theo "Tư vấn chốt" cũ
-- (agreed_payment_plan), trong khi hệ thống đã chuyển sang 4 hình thức
-- mới linh hoạt (file 124) — sót lại từ trước khi làm "big update", chưa
-- kịp cập nhật trang này theo hệ mới.
--
-- SỬA: thêm 1 hàm tạo hoá đơn DÙNG CHUNG cho cả 4 hình thức (không cần
-- biết trước "Tư vấn chốt" gì) + đơn giản hoá lại điều kiện "học sinh nào
-- cần tạo hoá đơn" trong view — kiểm tra thống nhất "chưa có hoá đơn nào
-- trong đúng tháng này", áp dụng như nhau cho mọi học sinh (không còn
-- phân biệt theo agreed_payment_plan cũ nữa).
-- =====================================================================
create or replace function payment_option_label(p_option text) returns text
language sql immutable
as $$
  select case p_option
    when 'BY_MONTH' then 'Theo tháng'
    when 'BY_COURSE' then 'Theo khoá hiện tại'
    when 'COMBO_2_COURSES' then 'Đóng 2 khoá liền'
    when 'FULL_SUB_LEVEL' then 'Trọn cấp độ con'
    else p_option
  end;
$$;

create or replace function create_invoice_for_payment_option(
  p_student_id uuid, p_option text,
  p_manual_discount_rate numeric default 0, p_special_category text default null
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_base_price numeric;
  v_manual_rate numeric;
  v_final_price numeric;
  v_class_id uuid;
  v_due_date date;
  v_result invoices;
  v_existing_invoice_id uuid;
  v_student_name text;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền tạo hoá đơn.';
  end if;

  select id into v_existing_invoice_id from invoices
  where student_id = p_student_id and status <> 'void'
    and period_year = extract(year from current_date)::int
    and period_month = extract(month from current_date)::int;
  if v_existing_invoice_id is not null then
    select full_name into v_student_name from students where id = p_student_id;
    raise exception 'Học sinh "%" đã có hoá đơn cho tháng %/% rồi (mã hoá đơn: %).',
      coalesce(v_student_name, '—'), extract(month from current_date)::int, extract(year from current_date)::int, v_existing_invoice_id;
  end if;

  v_manual_rate := greatest(least(coalesce(p_manual_discount_rate, 0), 1), 0);
  v_base_price := calculate_payment_option_amount(p_student_id, p_option);
  v_final_price := v_base_price * (1 - v_manual_rate);

  select class_id into v_class_id from students where id = p_student_id;
  select end_date into v_due_date from classes where id = v_class_id;
  if v_due_date is null then
    v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  end if;

  insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason, special_category)
  values (
    p_student_id, v_class_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_base_price, v_base_price, v_due_date, 'unpaid',
    case when p_special_category is not null then 'special' when v_manual_rate > 0 then 'case' else 'none' end,
    v_base_price - v_final_price,
    format('%s — Ưu đãi tay %s%%', payment_option_label(p_option), round(v_manual_rate*100,1)),
    p_special_category
  )
  returning * into v_result;

  return v_result;
end;
$func$;

comment on function create_invoice_for_payment_option(uuid, text, numeric, text) is
  'Tạo hoá đơn dùng chung cho 4 hình thức đóng học phí mới — thay thế create_single_course_invoice/create_monthly_invoice/create_payment_plan_invoice cho luồng "Tạo hoá đơn chung". Xem file 128.';

-- =====================================================================
-- Don gian hoa lai dieu kien "hoc sinh nao can tao hoa don" — bo phan
-- biet theo agreed_payment_plan cu, kiem tra THONG NHAT "chua co hoa don
-- nao trong dung thang nay" cho MOI hoc sinh dang hoc va da co lop.
--
-- Dung DROP + CREATE (khong dung CREATE OR REPLACE) — Postgres KHONG cho
-- phep "REPLACE" khi bo bot cot (agreed_payment_plan) hoac doi vi tri cot
-- phia sau, se bao loi "cannot change name of view column". View khong
-- giu du lieu gi nen xoa tao lai an toan, khong mat gi.
-- =====================================================================
drop view if exists v_pending_invoice_students;

create view v_pending_invoice_students with (security_invoker = true) as
select
  s.id as student_id, s.full_name, s.student_code, s.phone, s.parent_name,
  s.class_id, s.center_id, s.source_consultant_id,
  c.name as class_name, c.sublevel_id, c.course_id, c.start_date as class_start_date,
  cen.name as center_name,
  emp.full_name as consultant_name
from students s
join classes c on c.id = s.class_id
left join centers cen on cen.id = s.center_id
left join employees emp on emp.id = s.source_consultant_id
where s.status = 'studying'
  and s.class_id is not null
  and not exists (
    select 1 from invoices i
    where i.student_id = s.id and i.status <> 'void'
      and i.period_year = extract(year from current_date)::int
      and i.period_month = extract(month from current_date)::int
  );
