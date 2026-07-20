-- =====================================================================
-- File 133: HIỆN RÕ TÊN CHƯƠNG TRÌNH ƯU ĐÃI TRÊN HOÁ ĐƠN (19/07/2026)
-- =====================================================================
-- Theo đúng góp ý: "phần ưu đãi khi thanh toán qua ví và thu học phí còn
-- nhập nhằng — nếu có chương trình mới trừ và hiện tên chương trình tự
-- động". Rà lại thấy: bên NẠP VÍ đã làm đúng từ trước (wallet_topup_batches
-- có sẵn cột applied_program_id, biết chính xác chương trình nào đã áp
-- dụng) — CHỈ CÓ bên HOÁ ĐƠN/THU HỌC PHÍ là chưa có, chỉ lưu % giảm,
-- không lưu ĐÚNG chương trình nào — nên khi hiện ra chỉ thấy nhãn chung
-- chung "ưu đãi chương trình", không biết chương trình nào, dễ nhầm.
--
-- Xác nhận lại đúng lưu ý bạn nhấn mạnh: 2 luồng (Nạp ví / Thu học phí)
-- ĐÃ tách biệt hoàn toàn ở tầng dữ liệu từ trước (2 cột applied_program_id
-- khác nhau, trên 2 bảng khác nhau: wallet_topup_batches vs invoices) —
-- không đụng chạm gì tới nhau. Đợt này chỉ bổ sung cho hoá đơn ĐÚNG BẰNG
-- mức chi tiết bên nạp ví đã có, không gộp 2 luồng lại.
-- =====================================================================
alter table invoices add column if not exists applied_discount_program_id uuid references discount_programs(id);
comment on column invoices.applied_discount_program_id is 'Chương trình ưu đãi CỤ THỂ đã áp dụng tự động cho hoá đơn này (nếu có) — để hiện đúng tên, không chỉ hiện % chung chung. Xem file 133.';

-- =====================================================================
-- Hàm phụ — tìm ĐÚNG 1 chương trình ưu đãi (kèm tên) đang áp dụng tốt
-- nhất cho 1 lớp, thay vì chỉ trả về con số % như get_auto_discount_for_class
-- cũ (vẫn giữ nguyên hàm cũ cho chỗ khác đang dùng, không đụng vào).
-- =====================================================================
create or replace function get_auto_discount_program_for_class(p_class_id uuid, p_center_id uuid)
returns table(program_id uuid, program_name text, discount_rate numeric)
language plpgsql
stable
as $func$
declare
  v_course_id uuid;
  v_sublevel_id uuid;
  v_program_id uuid;
begin
  select course_id, sublevel_id, program_id into v_course_id, v_sublevel_id, v_program_id
  from classes where id = p_class_id;

  return query
  select dp.id, dp.name, dp.discount_rate
  from discount_programs dp
  where dp.status = 'active'
    and now() <@ dp.valid_range
    and dp.applies_via in ('counter', 'both')
    and (dp.scope = 'system' or dp.center_id = p_center_id)
    and (
      dp.applies_to = 'all'
      or (dp.applies_to = 'course' and dp.course_id = v_course_id)
      or (dp.applies_to = 'sublevel' and dp.sublevel_id = v_sublevel_id)
      or (dp.applies_to = 'program' and dp.program_id = v_program_id)
    )
  order by dp.discount_rate desc
  limit 1;
end;
$func$;

-- =====================================================================
-- Noi vao create_invoice_for_payment_option() (file 128) — ghi lai DUNG
-- chuong trinh da ap dung, khong chi ghi % chung chung nua.
-- =====================================================================
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
  v_center_id uuid;
  v_due_date date;
  v_result invoices;
  v_existing_invoice_id uuid;
  v_student_name text;
  v_auto_program record;
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

  select class_id, center_id into v_class_id, v_center_id from students where id = p_student_id;
  select * into v_auto_program from get_auto_discount_program_for_class(v_class_id, v_center_id);

  v_manual_rate := greatest(least(coalesce(p_manual_discount_rate, 0), 1), 0);
  v_base_price := calculate_payment_option_amount(p_student_id, p_option);
  v_final_price := v_base_price * (1 - v_manual_rate) * (1 - coalesce(v_auto_program.discount_rate, 0));

  select end_date into v_due_date from classes where id = v_class_id;
  if v_due_date is null then
    v_due_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  end if;

  insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, due_date, status, discount_type, manual_discount_vnd, manual_discount_reason, special_category, applied_discount_program_id)
  values (
    p_student_id, v_class_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_base_price, v_base_price, v_due_date, 'unpaid',
    case when p_special_category is not null then 'special' when v_auto_program.program_id is not null then 'program' when v_manual_rate > 0 then 'case' else 'none' end,
    v_base_price - v_final_price,
    case when v_auto_program.program_id is not null
      then format('%s — %s (-%s%%)%s', payment_option_label(p_option), v_auto_program.program_name, round(v_auto_program.discount_rate*100,1),
        case when v_manual_rate > 0 then format(' + Tay %s%%', round(v_manual_rate*100,1)) else '' end)
      else format('%s — Ưu đãi tay %s%%', payment_option_label(p_option), round(v_manual_rate*100,1))
    end,
    p_special_category, v_auto_program.program_id
  )
  returning * into v_result;

  return v_result;
end;
$func$;

-- =====================================================================
-- Them ten chuong trinh vao invoices_health_view.
--
-- LUU Y: dung DROP + CREATE, KHONG dung CREATE OR REPLACE — tuong la chi
-- "them cot vao cuoi" (an toan) nhung THUC RA khong phai: applied_discount_program_id
-- la cot MOI tren bang invoices, i.* tu dong lay theo dung THU TU COT
-- CUA BANG invoices — nghia la cot moi nay chen vao GIUA i.* va
-- health_status (cot health_status von la cot CUOI CUNG cua view cu) —
-- Postgres van tinh la "doi vi tri cot" va chan lai, dung y het loi da
-- gap o file 128. Ap dung lai dung bai hoc da rut ra: bat ky thay doi
-- nao lien quan toi i.* deu nen dung DROP + CREATE cho chac, khong con
-- suy doan "chi them vao cuoi la an toan" nua.
--
-- CON CO 1 VIEW KHAC (v_debt_with_start_date_flag, file 94) xay TREN
-- invoices_health_view qua ihv.* — phai xoa view nay TRUOC (Postgres
-- khong cho xoa 1 view dang co view khac phu thuoc vao), roi tao lai ca
-- 2 theo dung thu tu.
-- =====================================================================
drop view if exists v_debt_with_start_date_flag;
drop view if exists invoices_health_view;

create view invoices_health_view as
select
  i.*,
  case
    when i.status = 'paid' then 'good'
    when i.due_date < current_date and i.status = 'partially_paid' then 'fair'
    when i.due_date < current_date and i.status = 'unpaid' then 'poor'
    else null
  end as health_status,
  dp.name as applied_discount_program_name
from invoices i
left join discount_programs dp on dp.id = i.applied_discount_program_id
where i.cancelled = false;

alter view invoices_health_view set (security_invoker = true);

create view v_debt_with_start_date_flag with (security_invoker = true) as
select
  ihv.*,
  c.start_date as class_start_date,
  (c.start_date is not null and c.start_date + interval '30 days' < current_date and ihv.status <> 'paid') as is_overdue_30d_from_start
from invoices_health_view ihv
join students s on s.id = ihv.student_id
left join classes c on c.id = s.class_id;
