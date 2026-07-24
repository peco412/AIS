-- =====================================================================
-- File 148: SỬA LỖI 500 THẬT — SO SÁNH "=" VỚI TRUY VẤN CON TRẢ NHIỀU
-- DÒNG (19/07/2026)
-- =====================================================================
-- Lỗi thật, khá nghiêm trọng: các policy phân quyền của 2 bảng
-- parent_announcements (file 146) và extracurricular_programs (file 147)
-- đều viết:
--   current_department_id() = (select id from departments where code in ('MKT', 'EDU'))
-- Vế phải trả về 2 dòng (vì "MKT" và "EDU" đều khớp) — dùng "=" với 1
-- truy vấn con trả NHIỀU dòng luôn gây lỗi PostgreSQL thật ("more than
-- one row returned by a subquery"), không chỉ đơn giản là so sánh sai.
--
-- Vì Postgres RLS luôn kiểm tra TẤT CẢ các policy áp dụng được (kể cả
-- policy không liên quan tới người đang gọi), nên dù phụ huynh chỉ cần
-- khớp đúng policy dành cho phụ huynh, hệ thống VẪN chạy luôn cả policy
-- dành cho nhân viên (co loi o tren) — khien CA truy van bi loi 500,
-- ngay ca voi phu huynh dang xem trang chu binh thuong.
--
-- Sua: doi "=" thanh "IN" cho dung voi truy van con nhieu dong.
-- =====================================================================
drop policy if exists parent_announcements_select_staff on parent_announcements;
create policy parent_announcements_select_staff on parent_announcements for select
  using (
    current_department_id() in (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );

drop policy if exists parent_announcements_write on parent_announcements;
create policy parent_announcements_write on parent_announcements for all
  using (
    current_department_id() in (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  )
  with check (
    current_department_id() in (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );

drop policy if exists extracurricular_programs_select_staff on extracurricular_programs;
create policy extracurricular_programs_select_staff on extracurricular_programs for select
  using (
    current_department_id() in (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );

drop policy if exists extracurricular_programs_write on extracurricular_programs;
create policy extracurricular_programs_write on extracurricular_programs for all
  using (
    current_department_id() in (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  )
  with check (
    current_department_id() in (select id from departments where code in ('MKT', 'EDU'))
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  );
