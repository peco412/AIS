-- =====================================================================
-- File 125: LUỒNG ĐỔI LỚP TỰ ĐỘNG (19/07/2026)
-- GIAI ĐOẠN 3 của "big update" (sau file 122/123 sơ đồ + 124 4 công thức
-- thanh toán).
-- =====================================================================
-- Theo đúng mục 3.Luồng 2 tài liệu:
--   1) Vô hiệu hoá hoá đơn cũ (status -> void)
--   2) Tính số tiền THỰC TẾ đã đóng ở hoá đơn cũ (A)
--   3) Tạo hoá đơn mới theo biểu phí lớp mới, dùng 1 trong 4 công thức
--      (file 124) — nhân viên chọn hình thức cho lớp mới khi thao tác.
--   4) So sánh A với học phí lớp mới (B):
--        A = B -> hoá đơn mới PAID ngay, không cần đóng thêm gì.
--        A > B -> hoá đơn mới PAID, phần dư (A-B) cộng vào Ví AIScoins
--                 (dùng LẠI ví hiện có, không tạo ví thứ 2 song song).
--        A < B -> hoá đơn mới còn thiếu (B-A), trạng thái phản ánh đúng
--                 phần đã có (dùng "partially_paid" cho đúng ý nghĩa kế
--                 toán, thay vì "unpaid" như tài liệu viết tắt — số tiền
--                 còn phải đóng vẫn đúng là B-A, chỉ khác tên trạng thái
--                 để khớp với hệ thống Đã có sẵn).
-- =====================================================================

alter table debt_ledger drop constraint if exists debt_ledger_source_check;
alter table debt_ledger add constraint debt_ledger_source_check
  check (source in ('WALLET', 'CASH', 'BANK_TRANSFER', 'CLASS_TRANSFER'));
comment on constraint debt_ledger_source_check on debt_ledger is 'Thêm CLASS_TRANSFER (19/07/2026) — ghi nhận phần tiền đã đóng ở lớp cũ được chuyển sang hoá đơn lớp mới, xem file 125.';

alter table wallet_topup_batches drop constraint if exists wallet_topup_batches_method_check;
alter table wallet_topup_batches add constraint wallet_topup_batches_method_check
  check (method in ('cash', 'bank_transfer', 'app', 'class_transfer_credit'));
comment on constraint wallet_topup_batches_method_check on wallet_topup_batches is 'Thêm class_transfer_credit (19/07/2026) — số dư dư ra khi đổi lớp được cộng vào ví, không phải nạp thật, xem file 125.';

create or replace function transfer_student_class(
  p_student_id uuid, p_new_class_id uuid, p_new_payment_option text, p_actor_id uuid default null
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
begin
  p_actor_id := current_employee_id();

  if not (
    current_department_id() = (select id from departments where code = 'EDU')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền thực hiện đổi lớp.';
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

  -- Buoc 3: chuyen sang lop moi, tinh hoc phi (B) theo dung 1 trong 4
  -- cong thuc da xay (file 124) — TINH TRUOC khi doi lop vi ham tinh gia
  -- dua vao classes.course_id CUA LOP HIEN TAI cua hoc sinh.
  update students set class_id = p_new_class_id where id = p_student_id;
  select center_id into v_center_id from students where id = p_student_id;

  v_amount_b := calculate_payment_option_amount(p_student_id, p_new_payment_option);

  insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, status, due_date)
  values (
    p_student_id, p_new_class_id, extract(year from current_date)::int, extract(month from current_date)::int,
    v_amount_b, v_amount_b, 'unpaid', (date_trunc('month', current_date) + interval '1 month - 1 day')::date
  )
  returning * into v_new_invoice;

  -- Buoc 4: doi soat A voi B.
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

comment on function transfer_student_class(uuid, uuid, text, uuid) is
  'Luồng đổi lớp tự động: huỷ hoá đơn cũ (void), đối soát số tiền đã đóng (A) với học phí lớp mới (B) — dư thì cộng ví, thiếu thì lên hoá đơn mới. Xem file 125.';
