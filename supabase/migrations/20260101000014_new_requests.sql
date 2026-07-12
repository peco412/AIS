-- =====================================================================
-- File 15: BỔ SUNG THEO YÊU CẦU MỚI (chạy sau file 14)
-- - Kế toán được xem đơn nghỉ phép đã duyệt (phục vụ tự tính khấu trừ lương)
-- - Bảng push_subscriptions cho thông báo đẩy thật (Web Push)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHẦN 1 — Kế toán cần xem đơn nghỉ phép ĐÃ DUYỆT của mọi nhân viên để
-- tính khấu trừ lương tự động (trước đây leave_select chỉ cho HR + chính
-- chủ + exec/tech xem, khiến tính năng "Tự tính khấu trừ theo nghỉ phép"
-- ở acc/payroll.html trống trơn với đúng người cần dùng nó).
-- ---------------------------------------------------------------------
drop policy if exists leave_select on leave_requests;
create policy leave_select on leave_requests for select
  using (
    employee_id = current_employee_id()
    or current_department_id() = (select id from departments where code='HR')
    or (current_department_id() = (select id from departments where code='ACC') and status = 'approved_2')
    or is_executive_or_tech()
  );

-- ---------------------------------------------------------------------
-- PHẦN 2 — Đăng ký nhận thông báo đẩy (Web Push) trên từng thiết bị
-- ---------------------------------------------------------------------
create table if not exists push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_employee on push_subscriptions(employee_id);

alter table push_subscriptions enable row level security;

create policy push_subscriptions_select on push_subscriptions for select
  using (employee_id = current_employee_id() or is_tech());

create policy push_subscriptions_insert on push_subscriptions for insert
  with check (employee_id = current_employee_id());

create policy push_subscriptions_delete on push_subscriptions for delete
  using (employee_id = current_employee_id() or is_tech());

-- Edge Function "send-push" cần đọc TOÀN BỘ subscriptions để gửi thông báo
-- cho đúng người nhận (theo phạm vi thông báo: hệ thống/trung tâm/phòng
-- ban/cá nhân) — Edge Function dùng service_role key nên tự bỏ qua RLS,
-- không cần thêm policy riêng cho việc này.
