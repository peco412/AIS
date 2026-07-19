-- =====================================================================
-- File 129: TỰ ĐỘNG TẠO HOÁ ĐƠN NGAY KHI XẾP LỚP — KHÔNG CẦN THAO TÁC GÌ
-- (19/07/2026)
-- =====================================================================
-- Theo đúng yêu cầu: "khi đã xếp vào lớp đó thì nó tự động tạo hoá đơn
-- luôn không cần phải thao tác gì cả". Trước đây (file 128) vẫn cần nhân
-- viên vào trang "Tạo hoá đơn chung" bấm "Tạo hoá đơn" thủ công cho từng
-- học sinh — giờ chuyển hẳn sang TRIGGER tự động: xếp lớp xong là có hoá
-- đơn NHÁP ngay lập tức, không cần bấm gì thêm.
--
-- Hoá đơn tạo tự động sẽ ở dạng NHÁP với đủ 4 lựa chọn giá (giống hệt cơ
-- chế đã xây cho cron quét buổi học sắp hết — dùng LẠI đúng logic đó) —
-- PHỤ HUYNH vào app Ví tự chọn hình thức phù hợp (đúng yêu cầu trước đó:
-- "Phụ huynh có quyền chọn hình thức đóng trong app ví"), không phải
-- nhân viên chọn thay.
--
-- Đổi lớp (học sinh ĐÃ có lớp, chuyển sang lớp khác) KHÔNG đi qua trigger
-- này — vẫn dùng đúng nút "Đổi lớp" + hàm transfer_student_class() đã
-- xây (file 125/126), vì đổi lớp cần đối soát tiền đã đóng ở lớp cũ,
-- không đơn giản là "tạo hoá đơn nháp mới" như lần xếp lớp đầu tiên.
--
-- Trang "Tạo hoá đơn chung" (file 128) vẫn giữ lại làm phương án DỰ PHÒNG
-- (vd học sinh xếp lớp trước khi có tính năng này, hoặc trigger bỏ qua vì
-- khoá chưa cấu hình giá) — không xoá, chỉ không còn là đường DUY NHẤT.
-- =====================================================================
create or replace function auto_create_draft_invoice_on_class_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_options jsonb := '[]'::jsonb;
  v_amount numeric;
  v_already_has_invoice boolean;
  v_invoice_id uuid;
  v_system_actor_id uuid;
begin
  -- Chi xu ly dung 1 truong hop: XEP LOP LAN DAU (tu null -> co gia tri).
  -- Doi lop (da co lop, chuyen sang lop khac) khong qua day — dung nut
  -- "Doi lop" rieng, co doi soat tien.
  if tg_op = 'UPDATE' and (old.class_id is not null or new.class_id is null) then
    return new;
  end if;
  if tg_op = 'INSERT' and new.class_id is null then
    return new;
  end if;

  select exists(select 1 from invoices where student_id = new.id and status <> 'void') into v_already_has_invoice;
  if v_already_has_invoice then
    return new;
  end if;

  begin
    v_amount := calculate_payment_option_amount(new.id, 'BY_MONTH');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('BY_MONTH'), 'plan_type', 'BY_MONTH', 'amount_vnd', v_amount));
  exception when others then null;
  end;
  begin
    v_amount := calculate_payment_option_amount(new.id, 'BY_COURSE');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('BY_COURSE'), 'plan_type', 'BY_COURSE', 'amount_vnd', v_amount));
  exception when others then null;
  end;
  begin
    v_amount := calculate_payment_option_amount(new.id, 'COMBO_2_COURSES');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('COMBO_2_COURSES'), 'plan_type', 'COMBO_2_COURSES', 'amount_vnd', v_amount));
  exception when others then null;
  end;
  begin
    v_amount := calculate_payment_option_amount(new.id, 'FULL_SUB_LEVEL');
    v_options := v_options || jsonb_build_array(jsonb_build_object('label', payment_option_label('FULL_SUB_LEVEL'), 'plan_type', 'FULL_SUB_LEVEL', 'amount_vnd', v_amount));
  exception when others then null;
  end;

  if jsonb_array_length(v_options) = 0 then
    return new; -- chua tinh duoc gia nao (vd lop chua gan Khoa hoc/gia) -> bo qua, khong tao hoa don rong
  end if;

  insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, status, due_date, draft_options)
  values (
    new.id, new.class_id, extract(year from current_date)::int, extract(month from current_date)::int,
    (v_options->0->>'amount_vnd')::numeric, (v_options->0->>'amount_vnd')::numeric, 'draft', current_date + 7, v_options
  )
  returning id into v_invoice_id;

  select e.id into v_system_actor_id
  from employees e join system_roles sr on sr.id = e.role_id
  where sr.code in ('EXECUTIVE', 'TECH') and e.status = 'active'
  order by e.created_at asc limit 1;

  insert into notifications (scope, center_id, title, content, link_url, created_by, notification_type)
  select
    'personal', new.center_id,
    format('Bé %s đã được xếp lớp — cần chọn hình thức đóng học phí', new.full_name),
    format('Học sinh %s vừa được xếp vào lớp mới — vui lòng vào Ví AIScoins để chọn hình thức đóng học phí phù hợp.', new.full_name),
    '/edu/wallet-invoices.html',
    v_system_actor_id, 'system'
  where v_system_actor_id is not null;

  return new;
end;
$func$;

drop trigger if exists students_auto_invoice_on_assignment on students;
create trigger students_auto_invoice_on_assignment
after insert or update on students
for each row execute function auto_create_draft_invoice_on_class_assignment();

comment on function auto_create_draft_invoice_on_class_assignment() is
  'Tự động tạo hoá đơn nháp (4 lựa chọn) ngay khi học sinh được xếp lớp lần đầu — không cần nhân viên thao tác gì. Xem file 129.';
