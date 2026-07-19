-- =====================================================================
-- File 126: QUY TẮC CHẶN VƯỢT CẤP + CƠ CHẾ NHẬP TAY NGOẠI LỆ (19/07/2026)
-- GIAI ĐOẠN 4 (cuối) của "big update".
-- =====================================================================
-- Theo mục 5 tài liệu:
--   - Tuyến TỰ CHỌN (Học thuật/Giao tiếp/One-on-one): KHÔNG kiểm tra gì,
--     tự do hoàn toàn.
--   - Tuyến BẮT BUỘC: trong CÙNG 1 Chương trình được di chuyển tự do
--     (cùng/khác Cấp độ con, cùng/khác Cấp độ) — chỉ CHẶN khi nhảy SANG
--     Chương trình khác mà không đúng Sequence liền kề (+1) và không phải
--     khoá đầu tiên của chương trình đó.
--   - Vi phạm -> chặn tiến trình tự động, báo lỗi "Lộ trình học không hợp
--     lệ - Vượt cấp bắt buộc" — TRỪ KHI bật cờ "Xử lý ngoại lệ", CHỈ dành
--     cho Ban điều hành/Kỹ thuật/Quản lý trung tâm (đúng vai trò
--     ROLE_ADMIN/ROLE_BRANCH_MANAGER của tài liệu, ánh xạ theo đúng vai
--     trò hệ thống đang có).
-- =====================================================================
create or replace function is_valid_class_progression(p_old_course_id uuid, p_new_course_id uuid)
returns boolean
language plpgsql
stable
as $func$
declare
  v_old record;
  v_new record;
begin
  if p_old_course_id is null then
    return true; -- hoc sinh chua tung hoc khoa nao truoc do (lan dau xep lop) -> khong co gi de so sanh
  end if;

  select p.is_mandatory, p.sequence, p.id as program_id
  into v_old
  from program_courses pc
  join program_sublevels ps on ps.id = pc.sublevel_id
  join program_levels pl on pl.id = ps.level_id
  join programs p on p.id = pl.program_id
  where pc.id = p_old_course_id;

  select p.id as program_id, p.sequence, pc.display_order as course_order, pc.sublevel_id,
         ps.display_order as sublevel_order, ps.level_id
  into v_new
  from program_courses pc
  join program_sublevels ps on ps.id = pc.sublevel_id
  join program_levels pl on pl.id = ps.level_id
  join programs p on p.id = pl.program_id
  where pc.id = p_new_course_id;

  -- Tuyen TU CHON (hoac chua gan tuyen) -> khong kiem tra gi ca.
  if v_old.is_mandatory is distinct from true then
    return true;
  end if;

  -- Cung 1 Chuong trinh -> di chuyen tu do (cung/khac Cap do con, cung/
  -- khac Cap do) — day la pham vi BINH THUONG, khong tinh la "vuot cap".
  if v_new.program_id = v_old.program_id then
    return true;
  end if;

  -- Khac Chuong trinh -> CHI hop le neu Sequence lien ke (+1) VA la dung
  -- khoa hoc DAU TIEN cua Cap do con DAU TIEN cua chuong trinh moi.
  if v_new.sequence = v_old.sequence + 1
    and v_new.course_order = (select min(display_order) from program_courses where sublevel_id = v_new.sublevel_id)
    and v_new.sublevel_order = (select min(display_order) from program_sublevels where level_id = v_new.level_id)
  then
    return true;
  end if;

  return false;
end;
$func$;

comment on function is_valid_class_progression(uuid, uuid) is
  'Kiểm tra lớp mới có đúng lộ trình (không vượt cấp) so với khoá đang học — xem file 126.';

-- =====================================================================
-- Nối vào transfer_student_class() (file 125) — thêm tham số ngoại lệ.
-- =====================================================================
create or replace function transfer_student_class(
  p_student_id uuid, p_new_class_id uuid, p_new_payment_option text,
  p_actor_id uuid default null, p_override_sequence boolean default false
) returns invoices
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_old_invoice invoices%rowtype;
  v_paid_a numeric := 0;
  v_amount_b numeric;
  v_new_invoice invoices%rowtype;
  v_applied numeric;
  v_excess numeric;
  v_wallet_id uuid;
  v_center_id uuid;
  v_old_course_id uuid;
  v_new_course_id uuid;
  v_is_valid boolean;
  v_can_override boolean;
begin
  p_actor_id := current_employee_id();

  if not (
    current_department_id() = (select id from departments where code = 'EDU')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền thực hiện đổi lớp.';
  end if;

  -- MOI — Quy tac chan vuot cap (muc 5 tai lieu). Chi Ban dieu hanh/Ky
  -- thuat/Quan ly trung tam moi duoc BAT co ngoai le (dung vai tro
  -- ROLE_ADMIN/ROLE_BRANCH_MANAGER cua tai lieu).
  v_can_override := is_executive_or_tech() or current_role_code() = 'CENTER_MANAGER';
  select course_id into v_old_course_id from classes where id = (select class_id from students where id = p_student_id);
  select course_id into v_new_course_id from classes where id = p_new_class_id;

  v_is_valid := is_valid_class_progression(v_old_course_id, v_new_course_id);
  if not v_is_valid then
    if p_override_sequence and v_can_override then
      null; -- co quyen va da chon "Xu ly ngoai le" -> cho qua
    else
      raise exception 'Lộ trình học không hợp lệ - Vượt cấp bắt buộc.';
    end if;
  end if;

  -- Buoc 1+2: tim hoa don GAN NHAT cua lop CU (chua VOID), vo hieu hoa va
  -- tinh so tien THUC TE da dong (A).
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

  v_amount_b := calculate_payment_option_amount(p_student_id, p_new_payment_option);

  insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, status, due_date)
  values (
    p_student_id, p_new_class_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_amount_b, v_amount_b, 'unpaid', (date_trunc('month', current_date) + interval '1 month - 1 day')::date
  )
  returning * into v_new_invoice;

  v_applied := least(v_paid_a, v_amount_b);
  v_excess := greatest(v_paid_a - v_amount_b, 0);

  if v_applied > 0 then
    insert into debt_ledger (invoice_id, source, amount_vnd)
    values (v_new_invoice.id, 'CLASS_TRANSFER', v_applied);
  end if;

  if v_excess > 0 then
    v_wallet_id := get_or_create_family_wallet(p_student_id);
    insert into wallet_topup_batches (wallet_id, coin_amount, coin_remaining, discount_rate, conversion_rate, amount_vnd_paid, method, created_by)
    values (v_wallet_id, v_excess, v_excess, 0, 1.0, v_excess, 'class_transfer_credit', p_actor_id);
  end if;

  perform refresh_invoice_status(v_new_invoice.id);
  select * into v_new_invoice from invoices where id = v_new_invoice.id;

  return v_new_invoice;
end;
$func$;
