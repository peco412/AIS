-- =====================================================================
-- File 114: RPC MUA / BỐC / TIÊU HAO BUỔI HỌC (18/07/2026)
-- GIAI ĐOẠN 3 của mô hình Ví buổi học (sau file 112 sơ đồ dữ liệu, file
-- 113 state machine hoá đơn).
-- =====================================================================
-- 3 việc trong giai đoạn này:
--   A) MUA (purchase) — nối vào refresh_invoice_status() đã chạy khắp hệ
--      thống, không cần sửa từng nơi thanh toán (Ví/tiền mặt/chuyển khoản
--      đều đi qua đúng 1 hàm này).
--   B) BỐC (allocate) — RPC riêng, gọi khi xếp học sinh vào 1 lớp cụ thể.
--   C) TIÊU HAO (consume) — nối vào bảng điểm danh đã có sẵn
--      (class_attendance), KHÔNG cần sửa gì ở trang Điểm danh giáo viên.
--
-- QUYẾT ĐỊNH CHỦ ĐỘNG cần bạn xác nhận lại (tài liệu không nói rõ):
--   - Buổi học bị tính "tiêu hao" khi điểm danh là 'present' HOẶC
--     'unexcused' (có phép cứ tính, vắng không phép vẫn mất buổi — đúng
--     thông lệ phổ biến) — CÒN 'excused' (vắng có phép) thì KHÔNG trừ
--     buổi, coi như còn nguyên để học bù. Nếu chính sách trung tâm khác
--     đi (vd vắng có phép vẫn trừ buổi, chỉ không trừ tiền), báo mình sửa
--     lại điều kiện này ngay, chỉ đổi 1 dòng.
--   - Buổi học được cộng vào Total_Purchased_Lessons ngay khi hoá đơn
--     nhận đồng tiền ĐẦU TIÊN (kể cả đóng một phần) — đúng theo mục
--     IV.Luồng 3 "hệ thống vẫn kích hoạt toàn bộ số buổi học của gói đó
--     ... để đảm bảo việc học không bị gián đoạn". Chỉ cộng ĐÚNG 1 LẦN
--     cho mỗi hoá đơn (chống cộng trùng nếu refresh_invoice_status được
--     gọi lại nhiều lần).
-- =====================================================================

-- =====================================================================
-- PHẦN A — MUA: nối vào refresh_invoice_status() hiện có.
-- =====================================================================
create or replace function refresh_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_invoice invoices%rowtype;
  v_paid_vnd numeric;
  v_net_owed numeric;
  v_subcourse record;
  v_already_purchased boolean;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  select coalesce(sum(amount_vnd), 0) into v_paid_vnd from debt_ledger where invoice_id = p_invoice_id;

  v_net_owed := v_invoice.amount_vnd - coalesce(v_invoice.manual_discount_vnd, 0);

  update invoices set status = case
    when v_paid_vnd >= v_net_owed then 'paid'
    when v_paid_vnd > 0 then 'partially_paid'
    else 'unpaid'
  end
  where id = p_invoice_id;

  -- MOI (Giai doan 3 - Vi buoi hoc): dong tien DAU TIEN cho hoa don gan
  -- voi 1 lop thuoc dung 1 Khoa nho da dinh luong -> tu dong cong DU so
  -- buoi cua khoa nho do vao vi hoc sinh, dung 1 lan duy nhat/hoa don.
  if v_paid_vnd > 0 and v_invoice.class_id is not null then
    select exists(
      select 1 from student_lesson_transactions
      where invoice_id = p_invoice_id and transaction_type = 'purchase'
    ) into v_already_purchased;

    if not v_already_purchased then
      select psc.id, psc.name, psc.total_sessions into v_subcourse
      from classes c join program_subcourses psc on psc.id = c.subcourse_id
      where c.id = v_invoice.class_id;

      if v_subcourse.id is not null then
        insert into student_lesson_transactions (student_id, transaction_type, lesson_delta, class_id, invoice_id, note)
        values (v_invoice.student_id, 'purchase', v_subcourse.total_sessions, v_invoice.class_id, p_invoice_id,
          format('Tự động cộng buổi học từ hoá đơn %s/%s — %s buổi (%s)', v_invoice.period_month, v_invoice.period_year, v_subcourse.total_sessions, v_subcourse.name));

        update students set total_purchased_lessons = total_purchased_lessons + v_subcourse.total_sessions
        where id = v_invoice.student_id;
      end if;
    end if;
  end if;
end;
$func$;

-- =====================================================================
-- PHẦN B — BỐC: gán buổi khả dụng vào 1 lớp cụ thể.
-- =====================================================================
create or replace function allocate_lessons_to_class(p_student_id uuid, p_class_id uuid, p_lesson_count int, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_available int;
begin
  p_actor_id := current_employee_id();

  if not (
    current_department_id() = (select id from departments where code='EDU')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền xếp buổi học cho học sinh.';
  end if;

  if p_lesson_count <= 0 then
    raise exception 'Số buổi cần bốc phải lớn hơn 0.';
  end if;

  select available_lessons into v_available from students where id = p_student_id for update;
  if v_available is null or v_available < p_lesson_count then
    raise exception 'Không đủ buổi khả dụng — còn % buổi, cần bốc %.', coalesce(v_available, 0), p_lesson_count;
  end if;

  insert into student_lesson_transactions (student_id, transaction_type, lesson_delta, class_id, created_by, note)
  values (p_student_id, 'allocate', p_lesson_count, p_class_id, p_actor_id, format('Bốc %s buổi vào lớp', p_lesson_count));

  update students set allocated_lessons = allocated_lessons + p_lesson_count where id = p_student_id;
end;
$func$;

-- Rút buổi đã bốc trả về kho khả dụng (vd đổi lớp, huỷ xếp lớp) — chiều
-- ngược lại của allocate, cùng logic kiểm soát quyền.
create or replace function deallocate_lessons_from_class(p_student_id uuid, p_class_id uuid, p_lesson_count int, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  p_actor_id := current_employee_id();

  if not (
    current_department_id() = (select id from departments where code='EDU')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền rút buổi học của học sinh.';
  end if;

  if p_lesson_count <= 0 then
    raise exception 'Số buổi cần rút phải lớn hơn 0.';
  end if;

  if (select allocated_lessons from students where id = p_student_id) < p_lesson_count then
    raise exception 'Số buổi đang bốc cho lớp này không đủ để rút.';
  end if;

  insert into student_lesson_transactions (student_id, transaction_type, lesson_delta, class_id, created_by, note)
  values (p_student_id, 'deallocate', -p_lesson_count, p_class_id, p_actor_id, format('Rút %s buổi khỏi lớp', p_lesson_count));

  update students set allocated_lessons = allocated_lessons - p_lesson_count where id = p_student_id;
end;
$func$;

-- =====================================================================
-- PHẦN C — TIÊU HAO: nối vào bảng điểm danh có sẵn (class_attendance) —
-- không cần sửa trang Điểm danh giáo viên. Lớp CHƯA gắn Khoá nhỏ (đa số
-- lớp cũ hiện tại) thì bỏ qua hoàn toàn, không ảnh hưởng gì tới điểm danh
-- bình thường như trước.
-- =====================================================================
create or replace function enforce_lesson_consumption_on_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_has_subcourse boolean;
  v_old_consumes boolean;
  v_new_consumes boolean;
begin
  select (subcourse_id is not null) into v_has_subcourse from classes where id = new.class_id;
  if not v_has_subcourse then
    return new; -- lop chua tham gia mo hinh Vi buoi hoc, khong dong gi ca
  end if;

  -- Coi la "tieu hao 1 buoi" khi diem danh 'present' hoac 'unexcused' —
  -- 'excused' (vang co phep) KHONG tru buoi, xem ghi chu dau file de biet
  -- vi sao chon the nay va cach doi neu chinh sach khac.
  v_new_consumes := new.attendance_type in ('present', 'unexcused');
  v_old_consumes := tg_op = 'UPDATE' and old.attendance_type in ('present', 'unexcused');

  if v_new_consumes and not v_old_consumes then
    if (select allocated_lessons from students where id = new.student_id) < 1 then
      raise exception 'Học sinh không còn buổi học đã bốc cho lớp này — không thể điểm danh, cần bốc thêm buổi trước.';
    end if;
    insert into student_lesson_transactions (student_id, transaction_type, lesson_delta, class_id, created_by, note)
    values (new.student_id, 'consume', -1, new.class_id, new.taken_by, format('Học buổi ngày %s', new.session_date));
    update students set allocated_lessons = allocated_lessons - 1, total_purchased_lessons = total_purchased_lessons - 1
    where id = new.student_id;
  elsif v_old_consumes and not v_new_consumes then
    -- Sua lai tu 'present'/'unexcused' sang 'excused' -> hoan buoi da tru.
    insert into student_lesson_transactions (student_id, transaction_type, lesson_delta, class_id, created_by, note)
    values (new.student_id, 'deallocate', 1, new.class_id, new.taken_by, format('Hoàn buổi do sửa điểm danh ngày %s', new.session_date));
    update students set allocated_lessons = allocated_lessons + 1, total_purchased_lessons = total_purchased_lessons + 1
    where id = new.student_id;
  end if;

  return new;
end;
$func$;

drop trigger if exists class_attendance_guard_lesson on class_attendance;
create trigger class_attendance_guard_lesson
after insert or update on class_attendance
for each row execute function enforce_lesson_consumption_on_attendance();

-- Phong truong hop sau nay co code xoa han 1 dong diem danh (hien tai
-- frontend chi dung upsert, chua xoa bao gio) — hoan lai buoi da tru
-- neu dong bi xoa von dang tinh la da tieu hao.
create or replace function enforce_lesson_refund_on_attendance_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_has_subcourse boolean;
begin
  if old.attendance_type not in ('present', 'unexcused') then
    return old;
  end if;
  select (subcourse_id is not null) into v_has_subcourse from classes where id = old.class_id;
  if not v_has_subcourse then
    return old;
  end if;

  insert into student_lesson_transactions (student_id, transaction_type, lesson_delta, class_id, created_by, note)
  values (old.student_id, 'deallocate', 1, old.class_id, old.taken_by, format('Hoàn buổi do xoá điểm danh ngày %s', old.session_date));
  update students set allocated_lessons = allocated_lessons + 1, total_purchased_lessons = total_purchased_lessons + 1
  where id = old.student_id;

  return old;
end;
$func$;

drop trigger if exists class_attendance_guard_lesson_delete on class_attendance;
create trigger class_attendance_guard_lesson_delete
after delete on class_attendance
for each row execute function enforce_lesson_refund_on_attendance_delete();
