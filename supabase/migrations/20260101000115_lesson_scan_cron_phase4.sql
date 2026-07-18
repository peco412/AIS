-- =====================================================================
-- File 115: CRON QUÉT TỰ ĐỘNG + NHẮC HỌC PHÍ (18/07/2026)
-- GIAI ĐOẠN 4 (cuối) của mô hình Ví buổi học.
--
-- KHÔNG làm phần "khoá điểm danh khi nợ quá hạn" theo đúng quyết định
-- của bạn — chỉ còn lại: quét tự động hằng ngày + tạo hoá đơn nháp 3 lựa
-- chọn + nhắc phụ huynh.
-- =====================================================================
-- QUYẾT ĐỊNH TÍCH HỢP quan trọng cần bạn biết: tài liệu gốc mô tả 3 lựa
-- chọn "Tháng - Giá gốc / Khoá nhỏ - Giảm 5% / Trọn khoá - Giảm 10%".
-- Rà lại thấy hệ thống ĐÃ CÓ SẴN đúng cơ chế "3 hình thức đóng học phí
-- với 3 mức giảm giá riêng, chỉnh được" (bảng payment_plan_discounts:
-- sublevel/level/program, đang là 0%/5%/15%) — dùng LẠI đúng cơ chế này
-- thay vì làm mới 1 bộ tỷ lệ khác, để không có 2 nơi cấu hình giảm giá
-- chồng chéo nhau. 3 lựa chọn trong hoá đơn nháp giờ là:
--   - "Theo Khoá/Cấp độ con hiện tại" = giá đúng 1 Khoá (Cấp độ con) đang
--     học, mức giảm theo cấu hình 'sublevel' (mặc định 0%)
--   - "Trọn Cấp độ hiện tại" = giá cả Cấp độ (gồm nhiều Khoá), mức giảm
--     'level' (mặc định 5%)
--   - "Trọn Bậc chương trình" = giá cả chương trình, mức giảm 'program'
--     (mặc định 15%, không phải 10% như tài liệu — dùng đúng số đang cấu
--     hình sẵn, đổi được ở trang Kế toán bất kỳ lúc nào nếu muốn khác)
-- Nếu muốn đúng 3 tầng Bậc/Cấp độ/Khoá nhỏ (4 tầng) thay vì 3 tầng cũ,
-- cần thêm 1 mức 'subcourse' vào payment_plan_discounts — báo mình nếu
-- muốn làm thêm, chưa làm ở đây để không đổi ý nghĩa 2 hình thức đang
-- dùng thật (level/program) mà nhiều phụ huynh có thể đã mua theo.
-- =====================================================================

alter table invoices add column if not exists draft_options jsonb;
comment on column invoices.draft_options is 'Mảng 3 lựa chọn giá khi hoá đơn ở trạng thái draft do cron tự tạo — [{label, plan_type, amount_vnd}]. Xem file 115.';

-- =====================================================================
-- Hàm quét — gọi mỗi ngày lúc 00:00 qua pg_cron (xem hướng dẫn bật ở
-- cuối file, giống đúng mẫu đã dùng cho accrue_monthly_leave()).
-- =====================================================================
create or replace function scan_low_lesson_balance_and_create_draft_invoices()
returns int
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student record;
  v_class_id uuid;
  v_sublevel_id uuid;
  v_level_id uuid;
  v_program_id uuid;
  v_price_sublevel numeric;
  v_price_level numeric;
  v_price_program numeric;
  v_rate_sublevel numeric;
  v_rate_level numeric;
  v_rate_program numeric;
  v_options jsonb;
  v_invoice_id uuid;
  v_created_count int := 0;
  v_already_has_draft boolean;
  v_system_actor_id uuid;
begin
  -- Thong bao he thong van bat buoc phai co "nguoi tao" (created_by NOT
  -- NULL) — lay tam 1 tai khoan Ban dieu hanh/Ky thuat bat ky lam dai
  -- dien, vi day la hanh dong tu dong, khong co nguoi that nao dang bam.
  -- Neu KHONG con ai thuoc 2 vai tro nay (rat hy huu), bo qua phan gui
  -- thong bao (van tao hoa don nhap binh thuong) thay vi lam loi ca luot
  -- quet vi 1 dong thieu du lieu.
  select e.id into v_system_actor_id
  from employees e join system_roles sr on sr.id = e.role_id
  where sr.code in ('EXECUTIVE', 'TECH') and e.status = 'active'
  order by e.created_at asc limit 1;

  for v_student in
    select s.id, s.full_name, s.class_id, s.center_id, s.total_purchased_lessons
    from students s
    where s.total_purchased_lessons <= 4
      and s.class_id is not null
      and s.status = 'studying'
  loop
    -- Bo qua neu hoc sinh nay dang co san 1 hoa don draft chua xu ly —
    -- tranh spam tao trung hoa don/thong bao moi ngay.
    select exists(
      select 1 from invoices where student_id = v_student.id and status = 'draft'
    ) into v_already_has_draft;
    if v_already_has_draft then
      continue;
    end if;

    select sublevel_id into v_sublevel_id from classes where id = v_student.class_id;
    if v_sublevel_id is null then continue; end if;
    select level_id into v_level_id from program_sublevels where id = v_sublevel_id;
    select program_id into v_program_id from program_levels where id = v_level_id;

    select coalesce(sum(price_vnd), 0) into v_price_sublevel from program_courses where sublevel_id = v_sublevel_id;
    select coalesce(sum(pc.price_vnd), 0) into v_price_level
      from program_courses pc join program_sublevels ps on ps.id = pc.sublevel_id where ps.level_id = v_level_id;
    select coalesce(sum(pc.price_vnd), 0) into v_price_program
      from program_courses pc join program_sublevels ps on ps.id = pc.sublevel_id
      join program_levels pl on pl.id = ps.level_id where pl.program_id = v_program_id;

    if v_price_sublevel <= 0 then continue; end if; -- chua cau hinh gia, bo qua hoc sinh nay

    select discount_rate into v_rate_sublevel from payment_plan_discounts where plan_type = 'sublevel';
    select discount_rate into v_rate_level from payment_plan_discounts where plan_type = 'level';
    select discount_rate into v_rate_program from payment_plan_discounts where plan_type = 'program';

    v_options := jsonb_build_array(
      jsonb_build_object('label', 'Theo Khoá hiện tại', 'plan_type', 'sublevel', 'amount_vnd', round(v_price_sublevel * (1 - coalesce(v_rate_sublevel, 0)))),
      jsonb_build_object('label', 'Trọn Cấp độ hiện tại', 'plan_type', 'level', 'amount_vnd', round(v_price_level * (1 - coalesce(v_rate_level, 0)))),
      jsonb_build_object('label', 'Trọn Bậc chương trình', 'plan_type', 'program', 'amount_vnd', round(v_price_program * (1 - coalesce(v_rate_program, 0))))
    );

    insert into invoices (student_id, class_id, period_year, period_month, amount_vnd, amount_aiscoin, status, due_date, draft_options)
    values (
      v_student.id, v_student.class_id, extract(year from current_date)::int, extract(month from current_date)::int,
      v_price_sublevel, v_price_sublevel, 'draft', current_date + 7, v_options
    )
    returning id into v_invoice_id;

    insert into notifications (scope, center_id, title, content, link_url, created_by, notification_type)
    select
      'personal', v_student.center_id,
      format('Bé %s sắp hết buổi học', v_student.full_name),
      format('Học sinh %s chỉ còn %s buổi học trong ví — vui lòng vào Ví AIScoins để chọn gói đóng học phí kỳ mới.', v_student.full_name, v_student.total_purchased_lessons),
      '/edu/wallet-invoices.html',
      v_system_actor_id, 'system'
    where v_system_actor_id is not null;

    v_created_count := v_created_count + 1;
  end loop;

  return v_created_count;
end;
$func$;

comment on function scan_low_lesson_balance_and_create_draft_invoices() is
  'Chạy mỗi ngày 00:00 qua pg_cron. Bật 1 lần: select cron.schedule(''scan-low-lesson-balance'', ''0 0 * * *'', ''select scan_low_lesson_balance_and_create_draft_invoices();''); (cần bật extension pg_cron trước ở Supabase Dashboard -> Database -> Extensions, giống accrue_monthly_leave()).';
