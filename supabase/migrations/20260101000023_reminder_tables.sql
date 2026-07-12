-- =====================================================================
-- File 23: BẢNG HỖ TRỢ CHO CRON NHẮC NỢ + VERIFY HASH CHAIN
-- (chạy sau file 22)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHẦN 1 — Token thiết bị của phụ huynh để gửi Push (FCM/APNs) — khác
-- push_subscriptions (Web Push cho nhân viên ERP) vì App phụ huynh là
-- app di động thật, dùng FCM/APNs token chứ không phải Web Push subscription.
-- ---------------------------------------------------------------------
create table if not exists parent_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_account_id uuid not null references parent_accounts(id) on delete cascade,
  device_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);
create index if not exists idx_parent_push_tokens_parent on parent_push_tokens(parent_account_id);

alter table parent_push_tokens enable row level security;
create policy parent_push_tokens_own on parent_push_tokens for all
  using (parent_account_id = current_parent_id())
  with check (parent_account_id = current_parent_id());

-- ---------------------------------------------------------------------
-- PHẦN 2 — Nhật ký nhắc nợ (mục 4.4) — theo dõi từng lượt nhắc để: (a)
-- không nhắc trùng lặp trong 1 ngày, (b) biết đã mở thông báo hay chưa
-- để quyết định có cần fallback SMS sau 6 giờ hay không.
-- ---------------------------------------------------------------------
create table if not exists debt_reminder_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  channel text not null check (channel in ('push', 'sms')),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  failure_reason text,
  sent_at timestamptz not null default now(),
  opened_at timestamptz -- chỉ áp dụng cho channel='push'; App gọi RPC mark_reminder_opened() khi phụ huynh mở thông báo
);
create index if not exists idx_debt_reminder_logs_invoice_date on debt_reminder_logs(invoice_id, sent_at);

alter table debt_reminder_logs enable row level security;
create policy debt_reminder_logs_select on debt_reminder_logs for select
  using (
    invoice_id in (select id from invoices i where is_linked_to_student(i.student_id))
    or is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
  );
-- Chỉ Edge Function (service_role, bỏ qua RLS) mới ghi được -> không cần
-- thêm policy insert cho người dùng thường.

-- ---------------------------------------------------------------------
-- PHẦN 3 — BỔ SUNG: cho phép phụ huynh TỰ TẠO hồ sơ parent_accounts của
-- chính mình ở lần đầu xác thực OTP thành công (trước đây chỉ có policy
-- SELECT, thiếu INSERT khiến App phụ huynh không tự đăng ký được).
-- ---------------------------------------------------------------------
create policy parent_accounts_self_insert on parent_accounts for insert
  with check (auth_user_id = auth.uid());

create policy parent_accounts_self_update on parent_accounts for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- Phụ huynh gọi hàm này khi mở thông báo trên App — dừng luôn việc gửi SMS
-- fallback cho lượt nhắc đó (mục 4.4 Tầng 2: chỉ gửi SMS nếu SAU 6 GIỜ vẫn
-- chưa mở).
create or replace function mark_reminder_opened(p_reminder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update debt_reminder_logs
  set opened_at = now()
  where id = p_reminder_id
    and invoice_id in (select id from invoices i where is_linked_to_student(i.student_id));
end;
$$;
