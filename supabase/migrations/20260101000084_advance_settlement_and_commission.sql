-- =====================================================================
-- File 84: KHOI 3 - HOAN UNG + HOA HONG
--
-- PHAT HIEN KHI KIEM TRA: "Tam ung" hien tai HOAN TOAN KHONG CO but toan
-- ke toan nao (chi doi trang thai, khong ghi so) — sua luon trong lan
-- nay. Va "Hoa hong" chua ton tai o dau ca, phai xay tu dau, bao gom ca
-- viec THIEU LIEN KET Lead -> Hoc sinh (khong biet tu van vien nao duoc
-- tinh hoa hong cho hoc sinh nao).
-- (chay sau file 83)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHAN A: THEM TAI KHOAN KE TOAN can thiet
-- ---------------------------------------------------------------------
insert into chart_of_accounts (code, name, account_type) values
  ('141', 'Tạm ứng', 'asset'),
  ('334', 'Phải trả người lao động', 'liability'),
  ('642', 'Chi phí quản lý kinh doanh', 'expense')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- PHAN B: TAM UNG — GHI SO khi duyet xong cap cuoi (approved_3), thay vi
-- chi doi trang thai suong nhu truoc.
-- ---------------------------------------------------------------------
create or replace function approve_advance_final(p_request_id uuid, p_approver_id uuid, p_method text default 'BANK_TRANSFER')
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req advance_requests%rowtype;
  v_employee_name text;
  v_account text;
begin
  if not is_executive_or_tech() then
    raise exception 'Chỉ Ban điều hành/Kỹ thuật mới được phê duyệt cấp cuối.';
  end if;

  select * into v_req from advance_requests where id = p_request_id for update;
  if v_req.status <> 'approved_2' then
    raise exception 'Yêu cầu này chưa qua đủ 2 cấp duyệt trước (Quản lý trực tiếp + Kế toán).';
  end if;

  update advance_requests set status = 'approved_3', executive_signed_by = p_approver_id, executive_signed_at = now() where id = p_request_id;

  select full_name into v_employee_name from employees where id = v_req.requester_id;
  v_account := case p_method when 'CASH' then '111' else '112' end;

  perform post_journal_entry(
    current_date, format('Chi tạm ứng — %s (mã %s)', coalesce(v_employee_name, '—'), v_req.code),
    'advance_request', p_request_id,
    jsonb_build_array(
      jsonb_build_object('account_code', '141', 'debit', v_req.amount, 'credit', 0),
      jsonb_build_object('account_code', v_account, 'debit', 0, 'credit', v_req.amount)
    ),
    p_approver_id
  );
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN C: HOAN UNG — nhan vien/Ke toan doi chieu so tien THUC CHI, tu
-- dong tinh chenh lech va ghi so dung theo tinh huong.
-- ---------------------------------------------------------------------
create table if not exists advance_settlements (
  id uuid primary key default gen_random_uuid(),
  advance_request_id uuid not null references advance_requests(id) unique,
  actual_spent_amount numeric(14,2) not null check (actual_spent_amount >= 0),
  receipt_notes text, -- dien giai cac khoan da chi (co the kem link chung tu)
  settled_by uuid references employees(id),
  settled_at timestamptz not null default now()
);

alter table advance_settlements enable row level security;
create policy advance_settlements_select on advance_settlements for select using (
  current_department_id() = (select id from departments where code='ACC')
  or is_executive_or_tech()
  or advance_request_id in (select id from advance_requests where requester_id = current_employee_id())
);
create policy advance_settlements_write on advance_settlements for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

create or replace function settle_advance(p_request_id uuid, p_actual_spent numeric, p_receipt_notes text, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_req advance_requests%rowtype;
  v_diff numeric; -- duong = nhan vien phai tra lai, am = cong ty bu them
  v_employee_name text;
  v_lines jsonb;
begin
  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được xác nhận hoàn ứng.';
  end if;

  select * into v_req from advance_requests where id = p_request_id for update;
  if v_req.status <> 'approved_3' then
    raise exception 'Chỉ hoàn ứng được cho khoản tạm ứng ĐÃ chi tiền (approved_3).';
  end if;
  if exists (select 1 from advance_settlements where advance_request_id = p_request_id) then
    raise exception 'Khoản tạm ứng này đã được hoàn ứng rồi.';
  end if;

  v_diff := v_req.amount - p_actual_spent;
  select full_name into v_employee_name from employees where id = v_req.requester_id;

  insert into advance_settlements (advance_request_id, actual_spent_amount, receipt_notes, settled_by)
  values (p_request_id, p_actual_spent, p_receipt_notes, p_actor_id);

  -- Ghi so: LUON tat toan het 141 (so tien tam ung goc). Chia lam 3
  -- truong hop ro rang (tranh kieu "tinh truoc roi ghi de sau" de code
  -- de doc/de kiem tra dung sai hon):
  if v_diff = 0 then
    -- Chi dung khop 100% so tam ung — don gian nhat, chi 2 dong.
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '642', 'debit', p_actual_spent, 'credit', 0),
      jsonb_build_object('account_code', '141', 'debit', 0, 'credit', v_req.amount)
    );
  elsif v_diff > 0 then
    -- Chi it hon tam ung — nhan vien tra lai phan du bang tien mat.
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '642', 'debit', p_actual_spent, 'credit', 0),
      jsonb_build_object('account_code', '111', 'debit', v_diff, 'credit', 0),
      jsonb_build_object('account_code', '141', 'debit', 0, 'credit', v_req.amount)
    );
  else
    -- Chi vuot tam ung — ghi no phai tra them cho nhan vien (334), se bu
    -- vao luong ky toi hoac chi truc tiep sau.
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '642', 'debit', p_actual_spent, 'credit', 0),
      jsonb_build_object('account_code', '141', 'debit', 0, 'credit', v_req.amount),
      jsonb_build_object('account_code', '334', 'debit', 0, 'credit', abs(v_diff))
    );
  end if;

  perform post_journal_entry(
    current_date, format('Hoàn ứng — %s (mã %s, chênh lệch %s)', coalesce(v_employee_name, '—'), v_req.code, v_diff),
    'advance_settlement', p_request_id, v_lines, p_actor_id
  );

  return jsonb_build_object('difference', v_diff, 'status', case when v_diff > 0 then 'refund_due' when v_diff < 0 then 'company_owes' else 'exact_match' end);
end;
$func$;

-- ---------------------------------------------------------------------
-- PHAN D: LIEN KET LEAD -> HOC SINH (thieu tu truoc gio) — de biet
-- dung tu van vien nao dươc tinh hoa hong khi lead nay tro thanh hoc
-- sinh dang hoc that.
-- ---------------------------------------------------------------------
alter table students add column if not exists source_lead_id uuid references crm_leads(id);
alter table students add column if not exists source_consultant_id uuid references employees(id);
comment on column students.source_consultant_id is 'Tu van vien duoc tinh hoa hong cho hoc sinh nay - co the khac source_lead_id.consultant_id neu doi tay giua chung';

-- ---------------------------------------------------------------------
-- PHAN E: HOA HONG — cau hinh ty le + bang ghi nhan.
-- ---------------------------------------------------------------------
create table if not exists commission_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rate numeric(5,4) not null check (rate >= 0 and rate <= 1), -- % tren hoa don DAU TIEN cua hoc sinh
  is_active boolean not null default true,
  center_id uuid references centers(id), -- null = ap dung toan he thong
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
alter table commission_rules enable row level security;
create policy commission_rules_select on commission_rules for select using (true);
create policy commission_rules_write on commission_rules for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());

create table if not exists commissions (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid not null references employees(id),
  student_id uuid not null references students(id),
  invoice_id uuid not null references invoices(id),
  rule_id uuid references commission_rules(id),
  base_amount numeric(14,2) not null, -- so tien hoa don duoc tinh hoa hong tren do
  rate_applied numeric(5,4) not null,
  commission_amount numeric(14,2) not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  period_year int,
  period_month int,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (student_id, invoice_id) -- 1 hoa don chi tinh hoa hong 1 lan
);
create index idx_commissions_consultant on commissions(consultant_id, status);
alter table commissions enable row level security;
create policy commissions_select on commissions for select using (
  consultant_id = current_employee_id()
  or current_department_id() = (select id from departments where code='ACC')
  or is_executive_or_tech()
);

-- Tu dong tinh hoa hong khi hoa don DAU TIEN cua 1 hoc sinh duoc tao (co
-- source_consultant_id) — chi tinh 1 LAN DUY NHAT cho hoc sinh do (nho
-- unique constraint tren + kiem tra khong co hoa don nao truoc do).
create or replace function trg_calculate_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_consultant_id uuid;
  v_center_id uuid;
  v_rule commission_rules%rowtype;
  v_net_amount numeric;
  v_prior_invoice_count int;
begin
  select source_consultant_id, center_id into v_consultant_id, v_center_id from students where id = new.student_id;
  if v_consultant_id is null then return new; end if; -- hoc sinh khong qua tu van vien nao (walk-in truc tiep), khong tinh hoa hong

  -- Chi tinh cho HOA DON DAU TIEN cua hoc sinh nay (dem cac hoa don khac
  -- da co truoc do, KHONG tinh chinh dong dang xu ly).
  select count(*) into v_prior_invoice_count from invoices where student_id = new.student_id and id != new.id;
  if v_prior_invoice_count > 0 then return new; end if;

  select * into v_rule from commission_rules
  where is_active and (center_id is null or center_id = v_center_id)
  order by (center_id is not null) desc limit 1; -- uu tien quy tac rieng trung tam neu co
  if v_rule.id is null then return new; end if; -- chua cau hinh ty le hoa hong, bo qua

  v_net_amount := new.amount_vnd - coalesce(new.manual_discount_vnd, 0);
  if v_net_amount <= 0 then return new; end if;

  insert into commissions (consultant_id, student_id, invoice_id, rule_id, base_amount, rate_applied, commission_amount, period_year, period_month)
  values (v_consultant_id, new.student_id, new.id, v_rule.id, v_net_amount, v_rule.rate, round(v_net_amount * v_rule.rate, 0), new.period_year, new.period_month);

  return new;
exception when others then
  raise warning 'Không tính được hoa hồng cho hoá đơn %: %', new.id, SQLERRM;
  return new;
end;
$func$;

drop trigger if exists calculate_commission on invoices;
create trigger calculate_commission
after insert on invoices
for each row execute function trg_calculate_commission();

-- Xac nhan da tra hoa hong (thuong tich hop vao luong cuoi thang) — ghi
-- so Ne 642 (chi phi hoa hong) / Co 334 (phai tra nguoi lao dong).
create or replace function mark_commissions_paid(p_consultant_id uuid, p_year int, p_month int, p_actor_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_total numeric;
  v_name text;
begin
  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được xác nhận trả hoa hồng.';
  end if;

  select coalesce(sum(commission_amount), 0) into v_total from commissions
  where consultant_id = p_consultant_id and period_year = p_year and period_month = p_month and status = 'pending';

  if v_total = 0 then return 0; end if;

  select full_name into v_name from employees where id = p_consultant_id;

  perform post_journal_entry(
    current_date, format('Ghi nhận hoa hồng — %s (kỳ %s/%s)', coalesce(v_name, '—'), p_month, p_year),
    'commission', p_consultant_id,
    jsonb_build_array(
      jsonb_build_object('account_code', '642', 'debit', v_total, 'credit', 0),
      jsonb_build_object('account_code', '334', 'debit', 0, 'credit', v_total)
    ),
    p_actor_id
  );

  update commissions set status = 'paid', paid_at = now()
  where consultant_id = p_consultant_id and period_year = p_year and period_month = p_month and status = 'pending';

  return v_total;
end;
$func$;
