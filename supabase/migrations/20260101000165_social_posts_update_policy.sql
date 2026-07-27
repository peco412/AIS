-- =====================================================================
-- File 165: THEM QUYEN SUA BAI DANG (27/07/2026)
-- =====================================================================
-- Truoc day bang social_posts chi co chinh sach SELECT/INSERT/DELETE —
-- CHUA CO UPDATE — nen neu co giao dien cho sua chu thich bai dang, se
-- bi chan boi RLS (khong co policy nao cho phep UPDATE ca). Them chinh
-- sach UPDATE: chi tac gia bai dang duoc sua chinh bai cua minh.
-- =====================================================================

create policy social_posts_update on social_posts for update
  using (
    (author_parent_id is not null and author_parent_id = current_parent_id())
    or (author_employee_id is not null and author_employee_id = current_employee_id())
  )
  with check (
    (author_parent_id is not null and author_parent_id = current_parent_id())
    or (author_employee_id is not null and author_employee_id = current_employee_id())
  );
