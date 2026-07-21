-- =====================================================================
-- File 136: TÁCH RIÊNG "ĐỔI LỚP" VÀ "CHỌN HÌNH THỨC ĐÓNG" — SỬA LỖI
-- THIẾT KẾ THẬT (19/07/2026)
-- =====================================================================
-- Bạn chỉ ra đúng: "Đổi lớp" (transfer_student_class, file 125/126) đang
-- BẮT nhân viên chọn LUÔN hình thức đóng học phí cho lớp mới ngay tại
-- bước đổi lớp — gộp nhầm 2 việc khác bản chất vào 1 bước:
--   - Đổi lớp: hành động HỌC VỤ (nhân viên Giáo vụ/Quản lý làm)
--   - Chọn hình thức đóng + đối soát tiền: hành động TÀI CHÍNH, nên để
--     PHỤ HUYNH tự chọn qua app (đúng yêu cầu trước đó), hoặc NHÂN VIÊN
--     QUẦY chọn giúp lúc phụ huynh tới đóng tiền thật — không nên bắt
--     người đang thao tác đổi lớp phải quyết định thay.
--
-- SỬA: "Đổi lớp" giờ CHỈ đổi lớp + huỷ hoá đơn cũ + tạo hoá đơn NHÁP mới
-- (đủ 4 lựa chọn giá, y hệt luồng xếp lớp lần đầu) — KHÔNG chốt hình thức
-- ngay. Số tiền đã đóng ở lớp cũ (A) được "mang theo" trên hoá đơn nháp
-- mới (cột carried_over_credit_vnd), và chỉ THỰC SỰ đối soát (dư thì
-- cộng ví, thiếu thì lên đúng số còn lại) vào ĐÚNG LÚC hình thức đóng
-- được chọn (dù là phụ huynh tự chọn qua app, hay nhân viên chọn giúp
-- tại quầy) — không còn ép chọn ngay lúc đổi lớp nữa.
-- =====================================================================
alter table invoices add column if not exists carried_over_credit_vnd numeric default 0;
comment on column invoices.carried_over_credit_vnd is 'Số tiền đã đóng ở hoá đơn/lớp CŨ, mang theo sang hoá đơn nháp này khi đổi lớp — chỉ thực sự đối soát khi hình thức đóng được chọn (xem choose_draft_invoice_plan). Xem file 136.';

-- =====================================================================
-- PHẦN 1 — transfer_student_class(): bỏ tham số hình thức đóng, chỉ đổi
-- lớp + tạo hoá đơn nháp mang theo số tiền đã đóng.
-- =====================================================================
create or replace function transfer_student_class(
  p_student_id uuid, p_new_class_id uuid,
  p_actor_id uuid default null, p_override_sequence boolean default false
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_old_invoice invoices%rowtype;
  v_paid_a numeric := 0;
  v_new_invoice invoices%rowtype;
  v_center_id uuid;
  v_old_course_id uuid;
  v_new_course_id uuid;
  v_is_valid boolean;
  v_can_override boolean;
  v_student_name text;
  v_options jsonb := '[]'::jsonb;
  v_amount numeric;
  v_system_actor_id uuid;
begin
  p_actor_id := current_employee_id();

  if not (
    current_department_id() = (select id from departments where code = 'EDU')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền thực hiện đổi lớp.';
  end if;

  v_can_override := is_executive_or_tech() or current_role_code() = 'CENTER_MANAGER';
  select course_id into v_old_course_id from classes where id = (select class_id from students where id = p_student_id);
  select course_id into v_new_course_id from classes where id = p_new_class_id;

  v_is_valid := is_valid_class_progression(v_old_course_id, v_new_course_id);
  if not v_is_valid then
    if p_override_sequence and v_can_override then
      null;
    else
      raise exception 'Lộ trình học không hợp lệ - Vượt cấp bắt buộc.';
    end if;
  end if;

  -- Buoc 1+2: huy hoa don cu, tinh so tien THUC TE da dong (A) — GIU
  -- NGUYEN, chua doi soat gi ca, chi mang theo sang hoa don moi.
  select * into v_old_invoice from invoices
  where student_id = p_student_id and status <> 'void'
  order by created_at desc limit 1
  for update;

  if v_old_invoice.id is not null then
    select coalesce(sum(amount_vnd), 0) into v_paid_a from debt_ledger where invoice_id = v_old_invoice.id;
    update invoices set status = 'void' where id = v_old_invoice.id;
  end if;

  update students set class_id = p_new_class_id where id = p_student_id;
  select center_id into v_center_id from students where id = p_student_id;

  -- Buoc 3: tao hoa don NHAP moi voi du 4 lua chon gia (y het luong xep
  -- lop lan dau) — KHONG chot hinh thuc ngay, mang theo A de doi soat
  -- sau khi hinh thuc duoc chon.
  begin
    v_amount := calculate_payment_option_amount(p_student_id, 'BY_MONTH');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('BY_MONTH'), 'plan_type', 'BY_MONTH', 'amount_vnd', v_amount));
  exception when others then null;
  end;
  begin
    v_amount := calculate_payment_option_amount(p_student_id, 'BY_COURSE');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('BY_COURSE'), 'plan_type', 'BY_COURSE', 'amount_vnd', v_amount));
  exception when others then null;
  end;
  begin
    v_amount := calculate_payment_option_amount(p_student_id, 'COMBO_2_COURSES');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('COMBO_2_COURSES'), 'plan_type', 'COMBO_2_COURSES', 'amount_vnd', v_amount));
  exception when others then null;
  end;
  begin
    v_amount := calculate_payment_option_amount(p_student_id, 'FULL_SUB_LEVEL');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('FULL_SUB_LEVEL'), 'plan_type', 'FULL_SUB_LEVEL', 'amount_vnd', v_amount));
  exception when others then null;
  end;

  if jsonb_array_length(v_options) = 0 then
    raise exception 'Lớp mới chưa cấu hình đủ dữ liệu giá — không tạo được hoá đơn. Kiểm tra lại Khoá học/giá của lớp.';
  end if;

  insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, status, due_date, draft_options, carried_over_credit_vnd)
  values (
    p_student_id, p_new_class_id, extract(year from current_date)::int, extract(month from current_date)::int,
    (v_options->0->>'amount_vnd')::numeric, (v_options->0->>'amount_vnd')::numeric, 'draft', current_date + 7, v_options, v_paid_a
  )
  returning * into v_new_invoice;

  select full_name into v_student_name from students where id = p_student_id;
  select e.id into v_system_actor_id from employees e join system_roles sr on sr.id = e.role_id
  where sr.code in ('EXECUTIVE', 'TECH') and e.status = 'active' order by e.created_at asc limit 1;

  insert into notifications (scope, center_id, title, content, link_url, created_by, notification_type)
  select
    'personal', v_center_id,
    format('Bé %s đã đổi lớp — cần chọn hình thức đóng học phí', v_student_name),
    case when v_paid_a > 0
      then format('Học sinh %s vừa đổi sang lớp mới — số tiền %s đ đã đóng ở lớp cũ sẽ được cộng bù khi chọn hình thức đóng học phí lớp mới.', v_student_name, to_char(v_paid_a, 'FM999,999,999'))
      else format('Học sinh %s vừa đổi sang lớp mới — vui lòng vào Ví AIScoins để chọn hình thức đóng học phí.', v_student_name)
    end,
    '/edu/wallet-invoices.html', v_system_actor_id, 'system'
  where v_system_actor_id is not null;

  return v_new_invoice;
end;
$func$;

-- =====================================================================
-- PHẦN 2 — choose_draft_invoice_plan(): ÁP DỤNG đối soát carried_over_credit_vnd
-- (nếu có) ĐÚNG LÚC hình thức được chọn — dù phụ huynh tự chọn qua app
-- hay nhân viên chọn giúp tại quầy.
-- =====================================================================
create or replace function choose_draft_invoice_plan(p_invoice_id uuid, p_plan_type text)
returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_invoice invoices%rowtype;
  v_chosen_option jsonb;
  v_chosen_amount numeric;
  v_applied numeric;
  v_excess numeric;
  v_wallet_id uuid;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'Không tìm thấy hoá đơn.';
  end if;

  if not (
    is_linked_to_student(v_invoice.student_id)
    or current_department_id() = (select id from departments where code = 'ACC')
    or current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền thao tác với hoá đơn này.';
  end if;

  if v_invoice.status <> 'draft' then
    raise exception 'Hoá đơn này không còn ở trạng thái chờ chọn hình thức đóng.';
  end if;

  select opt into v_chosen_option
  from jsonb_array_elements(coalesce(v_invoice.draft_options, '[]'::jsonb)) opt
  where opt->>'plan_type' = p_plan_type
  limit 1;

  if v_chosen_option is null then
    raise exception 'Hình thức đóng học phí này không có trong danh sách lựa chọn của hoá đơn.';
  end if;

  v_chosen_amount := (v_chosen_option->>'amount_vnd')::numeric;

  update invoices set
    amount_vnd = v_chosen_amount,
    manual_discount_vnd = 0,
    discount_type = 'none',
    status = 'unpaid'
  where id = p_invoice_id
  returning * into v_invoice;

  -- MOI — doi soat dung luc nay: neu hoa don nay mang theo tien tu lop
  -- cu (doi lop), ap dung vao dung so tien vua chon — du thi cong vi,
  -- thieu thi giu nguyen phan con lai tren hoa don.
  if coalesce(v_invoice.carried_over_credit_vnd, 0) > 0 then
    v_applied := least(v_invoice.carried_over_credit_vnd, v_chosen_amount);
    v_excess := greatest(v_invoice.carried_over_credit_vnd - v_chosen_amount, 0);

    if v_applied > 0 then
      insert into debt_ledger (invoice_id, source, amount_vnd) values (p_invoice_id, 'CLASS_TRANSFER', v_applied);
    end if;
    if v_excess > 0 then
      v_wallet_id := get_or_create_family_wallet(v_invoice.student_id);
      insert into wallet_topup_batches (wallet_id, coin_amount, coin_remaining, discount_rate, conversion_rate, amount_vnd_paid, method, created_by)
      values (v_wallet_id, v_excess, v_excess, 0, 1.0, v_excess, 'class_transfer_credit', current_employee_id());
    end if;

    update invoices set carried_over_credit_vnd = 0 where id = p_invoice_id;
    perform refresh_invoice_status(p_invoice_id);
    select * into v_invoice from invoices where id = p_invoice_id;
  end if;

  return v_invoice;
end;
$func$;
