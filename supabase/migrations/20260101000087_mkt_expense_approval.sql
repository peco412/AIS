-- =====================================================================
-- File 87: NANG CAP "Bao cao chi phi" Truyen thong len DUNG CHUAN duyet
-- 3 cap (Truong phong Truyen thong -> Ke toan -> BDH) + noi vao So cai +
-- kiem tra tran ngan sach — giong het "Phieu de nghi thanh toan NCC".
-- Truoc day BAT KY nhan vien MKT nao cung tu do ghi so tien, khong ai
-- duyet, khong vao So cai, khong kiem tra ngan sach.
-- (chay sau file 86)
-- =====================================================================

alter table mkt_ad_expenses add column if not exists code text unique;
alter table mkt_ad_expenses add column if not exists expense_category_id uuid references expense_categories(id);
alter table mkt_ad_expenses add column if not exists status workflow_status not null default 'draft';
alter table mkt_ad_expenses add column if not exists dept_head_signed_by uuid references employees(id);
alter table mkt_ad_expenses add column if not exists dept_head_signed_at timestamptz;
alter table mkt_ad_expenses add column if not exists accountant_signed_by uuid references employees(id);
alter table mkt_ad_expenses add column if not exists accountant_signed_at timestamptz;
alter table mkt_ad_expenses add column if not exists executive_signed_by uuid references employees(id);
alter table mkt_ad_expenses add column if not exists executive_signed_at timestamptz;
alter table mkt_ad_expenses add column if not exists reject_reason text;

-- Ma tu sinh (dung chung khuon mau HD/LEAD/RUT da co) — "MKTCHI-0001"
create sequence if not exists mkt_expense_code_seq start 1;
create or replace function generate_mkt_expense_code() returns text as $$
declare n int;
begin
  n := nextval('mkt_expense_code_seq');
  return 'MKTCHI-' || lpad(n::text, 4, '0');
end;
$$ language plpgsql;

create or replace function trg_set_mkt_expense_code() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_mkt_expense_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists mkt_ad_expenses_set_code on mkt_ad_expenses;
create trigger mkt_ad_expenses_set_code
before insert on mkt_ad_expenses
for each row execute function trg_set_mkt_expense_code();

do $$
declare r record; begin
  for r in select id from mkt_ad_expenses where code is null order by created_at loop
    update mkt_ad_expenses set code = generate_mkt_expense_code() where id = r.id;
  end loop;
end $$;

-- RLS: sua lai theo dung 3 cap (nhan vien tao draft -> Truong phong MKT
-- ky -> Ke toan ky -> BDH ky) — khac han truoc day cho phep ghi/sua tu
-- do khong kiem soat gi ca.
drop policy if exists mkt_ad_expenses_select on mkt_ad_expenses;
drop policy if exists mkt_ad_expenses_write on mkt_ad_expenses;
alter table mkt_ad_expenses enable row level security;

create policy mkt_ad_expenses_select on mkt_ad_expenses for select using (true);

create policy mkt_ad_expenses_insert on mkt_ad_expenses for insert with check (
  created_by = current_employee_id()
  and status = 'draft'
);

create policy mkt_ad_expenses_update on mkt_ad_expenses for update using (
  (current_department_id() = (select id from departments where code='MKT') and current_role_code() in ('DEPT_HEAD', 'DEPT_DEPUTY'))
  or current_department_id() = (select id from departments where code='ACC')
  or is_executive_or_tech()
);

-- ---------------------------------------------------------------------
-- Duyet cap cuoi (BDH) — tu dong GHI SO CAI (No 642 Chi phi / Co 111-112
-- Tien mat-Ngan hang) dung theo hinh thuc da chi (tien mat/CK), giong
-- het nguyen tac cac loai chi phi khac da lam.
-- ---------------------------------------------------------------------
create or replace function approve_mkt_expense_final(p_id uuid, p_approver_id uuid, p_method text default 'BANK_TRANSFER')
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_exp mkt_ad_expenses%rowtype;
  v_account text;
begin
  if not is_executive_or_tech() then
    raise exception 'Chỉ Ban điều hành/Kỹ thuật mới được phê duyệt cấp cuối.';
  end if;

  select * into v_exp from mkt_ad_expenses where id = p_id for update;
  if v_exp.status <> 'approved_2' then
    raise exception 'Khoản chi này chưa qua đủ 2 cấp duyệt trước (Trưởng phòng Truyền thông + Kế toán).';
  end if;

  update mkt_ad_expenses set status = 'approved_3', executive_signed_by = p_approver_id, executive_signed_at = now() where id = p_id;

  v_account := case p_method when 'CASH' then '111' else '112' end;

  -- Dung ngay PHE DUYET (current_date), khong dung spend_date goc — neu
  -- khoan chi phat sinh cuoi thang truoc nhung mai sang thang sau moi
  -- duyet xong, dung spend_date se bi tu choi ghi so vi ky do co the DA
  -- BI KHOA. Nhat quan voi cach trg_post_invoice_creation() da lam.
  perform post_journal_entry(
    current_date, format('Chi phí quảng cáo %s — %s (%s)', v_exp.platform, v_exp.code, coalesce(v_exp.note, '')),
    'mkt_expense', p_id,
    jsonb_build_array(
      jsonb_build_object('account_code', '642', 'debit', v_exp.amount, 'credit', 0),
      jsonb_build_object('account_code', v_account, 'debit', 0, 'credit', v_exp.amount)
    ),
    p_approver_id
  );
end;
$func$;
