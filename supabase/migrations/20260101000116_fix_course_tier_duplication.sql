-- =====================================================================
-- File 116: SỬA LỖI TỰ PHÁT HIỆN — "Khoá nhỏ" ĐÃ TỒN TẠI SẴN, không cần
-- bảng mới (18/07/2026)
-- =====================================================================
-- KHI VIẾT FILE 115 (cron quét), rà lại pricing thì phát hiện: hệ thống
-- ĐÃ CÓ SẴN đúng tầng thứ 4 từ trước (migration 50 "true_4tier_programs"),
-- tên là "program_courses" (gọi là "Khoá"), gắn với program_sublevels,
-- CÓ SẴN giá tiền (price_vnd), và classes ĐÃ CÓ SẴN cột course_id liên
-- kết tới đây rồi — nghĩa là "Khoá nhỏ" trong tài liệu KHÔNG PHẢI tầng
-- hoàn toàn mới, mà chính là program_courses đã có, chỉ CÒN THIẾU phần
-- định lượng (số tuần/buổi/tiết).
--
-- Ở file 112 (Giai đoạn 1), mình đã KHÔNG rà đủ sâu và tạo NHẦM 1 bảng
-- hoàn toàn mới "program_subcourses" song song với program_courses —
-- tạo ra 2 cấu trúc chồng chéo cho cùng 1 khái niệm. File 114 sau đó xây
-- tiếp trên nền sai này. Đây là lỗi thật của mình, sửa ngay ở file này
-- trước khi đi tiếp, vì chưa có dữ liệu thật nào dùng bảng sai (mới tạo
-- trong phiên làm việc này), sửa bây giờ là rẻ nhất — để càng lâu càng
-- khó gỡ khi đã có dữ liệu thật tham chiếu vào.
--
-- Sửa: thêm đúng 4 cột định lượng vào program_courses (bảng ĐÃ CÓ SẴN),
-- xoá hẳn program_subcourses + classes.subcourse_id, cập nhật lại 2 hàm
-- ở file 114 để trỏ đúng vào program_courses/classes.course_id.
-- =====================================================================

-- =====================================================================
-- PHẦN 1 — Thêm định lượng vào program_courses (KHÔNG tạo bảng mới).
-- Dùng lại đúng price_vnd đã có sẵn của bảng này làm giá gốc, không thêm
-- cột giá trùng lặp.
-- =====================================================================
alter table program_courses add column if not exists weeks int check (weeks > 0);
alter table program_courses add column if not exists sessions_per_week int check (sessions_per_week > 0);
alter table program_courses add column if not exists periods_per_session int not null default 1 check (periods_per_session > 0);
alter table program_courses add column if not exists total_sessions int generated always as (weeks * sessions_per_week) stored;
comment on column program_courses.total_sessions is 'Tổng số buổi (đơn vị Ví buổi học dùng) — tự tính = weeks * sessions_per_week, xem file 112/116.';

-- =====================================================================
-- PHẦN 2 — Dọn bảng/cột đã tạo nhầm ở file 112.
-- =====================================================================
alter table classes drop column if exists subcourse_id;
drop table if exists program_subcourses;

-- =====================================================================
-- PHẦN 3 — Viết lại 2 hàm ở file 114 để trỏ đúng program_courses/
-- classes.course_id thay vì program_subcourses/classes.subcourse_id.
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
  v_course record;
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

  if v_paid_vnd > 0 and v_invoice.class_id is not null then
    select exists(
      select 1 from student_lesson_transactions
      where invoice_id = p_invoice_id and transaction_type = 'purchase'
    ) into v_already_purchased;

    if not v_already_purchased then
      select pc.id, pc.name, pc.total_sessions into v_course
      from classes c join program_courses pc on pc.id = c.course_id
      where c.id = v_invoice.class_id;

      if v_course.id is not null and v_course.total_sessions is not null then
        insert into student_lesson_transactions (student_id, transaction_type, lesson_delta, class_id, invoice_id, note)
        values (v_invoice.student_id, 'purchase', v_course.total_sessions, v_invoice.class_id, p_invoice_id,
          format('Tự động cộng buổi học từ hoá đơn %s/%s — %s buổi (%s)', v_invoice.period_month, v_invoice.period_year, v_course.total_sessions, v_course.name));

        update students set total_purchased_lessons = total_purchased_lessons + v_course.total_sessions
        where id = v_invoice.student_id;
      end if;
    end if;
  end if;
end;
$func$;

create or replace function enforce_lesson_consumption_on_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_has_course boolean;
  v_old_consumes boolean;
  v_new_consumes boolean;
begin
  select (course_id is not null) into v_has_course from classes where id = new.class_id;
  if not v_has_course then
    return new;
  end if;

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
    insert into student_lesson_transactions (student_id, transaction_type, lesson_delta, class_id, created_by, note)
    values (new.student_id, 'deallocate', 1, new.class_id, new.taken_by, format('Hoàn buổi do sửa điểm danh ngày %s', new.session_date));
    update students set allocated_lessons = allocated_lessons + 1, total_purchased_lessons = total_purchased_lessons + 1
    where id = new.student_id;
  end if;

  return new;
end;
$func$;

create or replace function enforce_lesson_refund_on_attendance_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_has_course boolean;
begin
  if old.attendance_type not in ('present', 'unexcused') then
    return old;
  end if;
  select (course_id is not null) into v_has_course from classes where id = old.class_id;
  if not v_has_course then
    return old;
  end if;

  insert into student_lesson_transactions (student_id, transaction_type, lesson_delta, class_id, created_by, note)
  values (old.student_id, 'deallocate', 1, old.class_id, old.taken_by, format('Hoàn buổi do xoá điểm danh ngày %s', old.session_date));
  update students set allocated_lessons = allocated_lessons + 1, total_purchased_lessons = total_purchased_lessons + 1
  where id = old.student_id;

  return old;
end;
$func$;
