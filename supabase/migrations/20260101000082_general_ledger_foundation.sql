-- =====================================================================
-- File 82: NEN MONG SO CAI (General Ledger) - BUT TOAN KEP dung chuan
-- ke toan Viet Nam (Thong tu 133/2016 - danh cho DNNVV, phu hop quy mo
-- trung tam). Day la KHOI 1 trong ke hoach chuan hoa tai chinh - CHI xu
-- ly nhom "Hoc phi + Vi" (WALLET/CASH/BANK_TRANSFER qua append_financial_
-- log). Nhom "Chi phi van hanh/nhan su" (NCC/Tam ung/Luong) se lam o
-- KHOI TIEP THEO, chua dong vao lan nay.
--
-- NGUYEN TAC AN TOAN TUYET DOI: MOI but toan BAT BUOC can bang (Tong No
-- = Tong Co), duoc KIEM TRA CUNG NOI (khong tin tuong code goi vao) bang
-- 1 ham post_journal_entry() duy nhat co validate truoc khi ghi, khong
-- co duong nao khac de ghi truc tiep vao journal_entry_lines.
-- (chay sau file 81)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. HE THONG TAI KHOAN KE TOAN (Chart of Accounts)
-- ---------------------------------------------------------------------
create table if not exists chart_of_accounts (
  code text primary key,          -- '111', '112', '131'...
  name text not null,             -- 'Tiền mặt', 'Tiền gửi ngân hàng'...
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  -- 'asset'/'expense' tang o ben No (debit), 'liability'/'equity'/'revenue' tang o ben Co (credit)
  -- — quy tac chuan ke toan, dung de tinh SO DU dung chieu cho tung loai.
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into chart_of_accounts (code, name, account_type) values
  ('111', 'Tiền mặt', 'asset'),
  ('112', 'Tiền gửi ngân hàng', 'asset'),
  ('131', 'Phải thu của khách hàng (học viên)', 'asset'),
  ('3388', 'Phải trả, phải nộp khác (tiền ví nhận trước của phụ huynh)', 'liability'),
  ('511', 'Doanh thu bán hàng và cung cấp dịch vụ (học phí)', 'revenue'),
  ('521', 'Các khoản giảm trừ doanh thu (hoàn phí, chiết khấu)', 'revenue')
on conflict (code) do nothing;

alter table chart_of_accounts enable row level security;
create policy chart_of_accounts_select on chart_of_accounts for select using (
  current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()
);
create policy chart_of_accounts_write on chart_of_accounts for all
  using (current_role_code() = 'TECH' or is_executive_strict())
  with check (current_role_code() = 'TECH' or is_executive_strict());

-- ---------------------------------------------------------------------
-- 2. CHUNG TU KE TOAN (Journal Entries) — moi "su kien tai chinh" la 1
--    chung tu, ben trong co NHIEU dong (journal_entry_lines).
-- ---------------------------------------------------------------------
create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  description text not null,
  reference_type text, -- 'invoice'/'wallet_topup'/'wallet_refund'/'manual'...
  reference_id uuid,   -- id cua ban ghi goc (invoice.id, wallet_topup_batches.id...)
  period_year int not null,
  period_month int not null,
  is_locked boolean not null default false, -- KHOI TIEP THEO (Khoa so) se dung co nay
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index idx_journal_entries_period on journal_entries(period_year, period_month);
create index idx_journal_entries_reference on journal_entries(reference_type, reference_id);

create table if not exists journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  account_code text not null references chart_of_accounts(code),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  -- 1 dong CHI duoc mang 1 chieu (hoac No hoac Co, khong ca 2 cung luc)
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index idx_journal_lines_entry on journal_entry_lines(journal_entry_id);
create index idx_journal_lines_account on journal_entry_lines(account_code);

alter table journal_entries enable row level security;
alter table journal_entry_lines enable row level security;
create policy journal_entries_select on journal_entries for select using (
  current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()
);
create policy journal_entry_lines_select on journal_entry_lines for select using (
  current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()
);
-- KHONG co policy INSERT/UPDATE/DELETE cho client — moi thao tac ghi chi
-- duoc phep qua ham post_journal_entry() (SECURITY DEFINER) ben duoi,
-- dam bao KHONG BAO GIO co but toan mat can bang lot vao duoc.

-- ---------------------------------------------------------------------
-- 3. HAM GHI SO DUY NHAT — moi but toan trong toan he thong PHAI di qua
--    day, tu dong KIEM TRA CAN BANG truoc khi ghi. Neu khong can bang,
--    TU CHOI GHI (raise exception), khong co ngoai le.
-- ---------------------------------------------------------------------
create or replace function post_journal_entry(
  p_entry_date date, p_description text, p_reference_type text, p_reference_id uuid,
  p_lines jsonb, -- dang [{"account_code": "111", "debit": 1000000, "credit": 0}, ...]
  p_created_by uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_entry_id uuid;
  v_line jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
begin
  -- Buoc 1: tinh tong No/Co truoc — CHUA ghi gi ca, chi kiem tra.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;

  if round(v_total_debit, 2) != round(v_total_credit, 2) then
    raise exception 'Bút toán KHÔNG cân bằng: Tổng Nợ = % nhưng Tổng Có = %. Từ chối ghi sổ.', v_total_debit, v_total_credit;
  end if;

  if v_total_debit = 0 then
    raise exception 'Bút toán rỗng (tổng tiền = 0), từ chối ghi sổ.';
  end if;

  -- Buoc 2: can bang OK, tao chung tu.
  insert into journal_entries (entry_date, description, reference_type, reference_id, period_year, period_month, created_by)
  values (p_entry_date, p_description, p_reference_type, p_reference_id, extract(year from p_entry_date)::int, extract(month from p_entry_date)::int, p_created_by)
  returning id into v_entry_id;

  -- Buoc 3: ghi tung dong.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_entry_lines (journal_entry_id, account_code, debit, credit)
    values (
      v_entry_id, v_line->>'account_code',
      coalesce((v_line->>'debit')::numeric, 0), coalesce((v_line->>'credit')::numeric, 0)
    );
  end loop;

  return v_entry_id;
end;
$func$;

-- ---------------------------------------------------------------------
-- 4. TU DONG GHI SO khi TAO HOA DON (Nợ 131 Phải thu / Có 511 Doanh thu)
--    — dung dung thoi diem hoa don duoc tao (ghi nhan doanh thu + cong
--    no, chua can biet da thu tien chua).
-- ---------------------------------------------------------------------
create or replace function trg_post_invoice_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_student_name text;
  v_net_amount numeric;
begin
  v_net_amount := new.amount_vnd - coalesce(new.manual_discount_vnd, 0);
  if v_net_amount <= 0 then return new; end if; -- hoa don 0 dong (mien phi hoan toan) khong can ghi so

  select full_name into v_student_name from students where id = new.student_id;

  perform post_journal_entry(
    current_date, format('Ghi nhận công nợ học phí — %s (kỳ %s/%s)', coalesce(v_student_name, '—'), new.period_month, new.period_year),
    'invoice', new.id,
    jsonb_build_array(
      jsonb_build_object('account_code', '131', 'debit', v_net_amount, 'credit', 0),
      jsonb_build_object('account_code', '511', 'debit', 0, 'credit', v_net_amount)
    ),
    new.created_by
  );
  return new;
exception when others then
  -- KHONG chan viec tao hoa don neu ghi so that bai (vd chua co tai
  -- khoan ke toan phu hop) — chi bao loi ra log, Ke toan tu doi soat sau
  -- qua trang "Sổ cái" (se xay o phan UI ben duoi).
  raise warning 'Không ghi được sổ cái cho hoá đơn %: %', new.id, SQLERRM;
  return new;
end;
$func$;

-- Luu y: invoices co the khong co cot created_by — kiem tra truoc khi
-- gan trigger, neu thieu se dung null (van ghi so duoc, chi thieu nguoi
-- tao trong nhat ky).
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'invoices' and column_name = 'created_by') then
    alter table invoices add column created_by uuid references employees(id);
  end if;
end $$;

drop trigger if exists post_invoice_creation on invoices;
create trigger post_invoice_creation
after insert on invoices
for each row execute function trg_post_invoice_creation();

-- ---------------------------------------------------------------------
-- 5. MO RONG append_financial_log() — GIU NGUYEN toan bo logic cu (hash
--    chain + cash_flow_entries KHONG DOI GI CA, van chay y het truoc),
--    CHI THEM buoc ghi But toan kep o cuoi. Neu ghi so loi, KHONG anh
--    huong gi den logic cu (van tra ve v_id nhu truoc, chi warning).
--
-- QUY TAC GAN TAI KHOAN (dua theo p_source/p_amount/p_invoice_id):
--   CASH/BANK_TRANSFER, tien vao, co invoice -> No 111/112 / Co 131
--   WALLET, tien vao, CO invoice (dung vi tra hoc phi) -> No 3388/Co 131
--   WALLET, tien vao, KHONG co invoice (nap vi) -> No 112 / Co 3388
--   Bat ky nguon nao, tien ra (hoan tien, so am) -> No 521 hoac No 3388
--     (tuy co phai hoan tu vi hay khong) / Co 111/112
-- ---------------------------------------------------------------------
create or replace function append_financial_log(
  p_source text, p_amount numeric, p_invoice_id uuid, p_actor_id uuid,
  p_wallet_id uuid, p_student_id uuid, p_note text
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_prev_hash text;
  v_new_hash text;
  v_id uuid := gen_random_uuid();
  v_ts timestamptz := now();
  v_center_id uuid;
  v_category text;
  v_cash_account text;
  v_lines jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('financial_log_chain_' || p_source));

  select hash into v_prev_hash from financial_transaction_logs
  where source = p_source order by created_at desc limit 1;

  v_new_hash := encode(digest(
    coalesce(v_prev_hash, '') || p_source || p_amount::text || coalesce(p_invoice_id::text, '') ||
    coalesce(p_actor_id::text, '') || v_ts::text, 'sha256'
  ), 'hex');

  insert into financial_transaction_logs (id, source, amount, invoice_id, actor_id, wallet_id, student_id, note, hash, prev_hash, created_at)
  values (v_id, p_source, p_amount, p_invoice_id, p_actor_id, p_wallet_id, p_student_id, p_note, v_new_hash, v_prev_hash, v_ts);

  if p_student_id is not null then
    select center_id into v_center_id from students where id = p_student_id;
  end if;

  v_category := case p_source
    when 'WALLET' then 'tuition_wallet'
    when 'CASH' then 'tuition_cash'
    when 'BANK_TRANSFER' then 'tuition_transfer'
    else lower(p_source)
  end;

  insert into cash_flow_entries (center_id, entry_type, category, amount, entry_date, note, created_by)
  values (
    v_center_id,
    case when p_amount >= 0 then 'inflow' else 'outflow' end,
    v_category,
    abs(p_amount),
    v_ts::date,
    coalesce(p_note, '') || ' (tu dong tu he thong Vi/hoc phi)',
    p_actor_id
  );

  -- MOI: ghi But toan kep vao So cai — boc trong block rieng, loi o day
  -- KHONG lam hong logic cu ben tren (hash chain + cash_flow_entries).
  begin
    v_cash_account := case p_source when 'CASH' then '111' else '112' end; -- BANK_TRANSFER va WALLET-topup deu qua NH/vi dien tu

    if p_amount >= 0 then
      if p_source = 'WALLET' and p_invoice_id is null then
        -- Nap vi (chua dung) — tien vao nhung la nghia vu tra truoc,
        -- CHUA phai doanh thu.
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', '112', 'debit', p_amount, 'credit', 0),
          jsonb_build_object('account_code', '3388', 'debit', 0, 'credit', p_amount)
        );
      elsif p_source = 'WALLET' and p_invoice_id is not null then
        -- Dung vi co san de tra hoc phi — tat toan tu "nhan truoc" sang
        -- "da thu cong no", KHONG phai tien moi vao.
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', '3388', 'debit', p_amount, 'credit', 0),
          jsonb_build_object('account_code', '131', 'debit', 0, 'credit', p_amount)
        );
      else
        -- CASH/BANK_TRANSFER thu truc tiep tai quay, doi ung 1 hoa don.
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', v_cash_account, 'debit', p_amount, 'credit', 0),
          jsonb_build_object('account_code', '131', 'debit', 0, 'credit', p_amount)
        );
      end if;
    else
      -- So am = hoan tien (bat ke nguon nao).
      if p_source = 'WALLET' then
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', '3388', 'debit', abs(p_amount), 'credit', 0),
          jsonb_build_object('account_code', v_cash_account, 'debit', 0, 'credit', abs(p_amount))
        );
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', '521', 'debit', abs(p_amount), 'credit', 0),
          jsonb_build_object('account_code', v_cash_account, 'debit', 0, 'credit', abs(p_amount))
        );
      end if;
    end if;

    perform post_journal_entry(v_ts::date, coalesce(p_note, format('Giao dịch %s', p_source)), 'financial_log', v_id, v_lines, p_actor_id);
  exception when others then
    raise warning 'Không ghi được sổ cái cho giao dịch %: %', v_id, SQLERRM;
  end;

  return v_id;
end;
$func$;

revoke execute on function append_financial_log(text, numeric, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. CAC "SO" BAO CAO — dua tren journal_entry_lines, dung view (khong
--    luu du lieu rieng, luon khop 100% voi So cai goc).
-- ---------------------------------------------------------------------

-- SO CAI TONG HOP — liet ke moi but toan, co so du luy ke tung tai khoan.
create or replace view v_general_ledger with (security_invoker = true) as
select
  jel.id, je.entry_date, je.description, je.reference_type, je.reference_id,
  jel.account_code, coa.name as account_name, coa.account_type,
  jel.debit, jel.credit,
  sum(
    case when coa.account_type in ('asset', 'expense') then jel.debit - jel.credit
    else jel.credit - jel.debit end
  ) over (partition by jel.account_code order by je.entry_date, jel.id) as running_balance,
  je.created_by, je.created_at
from journal_entry_lines jel
join journal_entries je on je.id = jel.journal_entry_id
join chart_of_accounts coa on coa.code = jel.account_code
order by je.entry_date, jel.id;

-- SO QUY TIEN MAT/NGAN HANG — chi tai khoan 111/112.
create or replace view v_cash_book with (security_invoker = true) as
select * from v_general_ledger where account_code in ('111', '112');

-- SO CONG NO HOC VIEN — chi tai khoan 131, kem ten hoc vien qua invoice.
create or replace view v_receivables_ledger with (security_invoker = true) as
select
  gl.*, inv.student_id, s.full_name as student_name, s.student_code
from v_general_ledger gl
left join invoices inv on inv.id = gl.reference_id and gl.reference_type = 'invoice'
left join students s on s.id = inv.student_id
where gl.account_code = '131';

-- SO DU HIEN TAI tung tai khoan — dung cho Bang can doi thu nhanh.
create or replace view v_account_balances with (security_invoker = true) as
select
  coa.code, coa.name, coa.account_type,
  coalesce(sum(jel.debit), 0) as total_debit,
  coalesce(sum(jel.credit), 0) as total_credit,
  case when coa.account_type in ('asset', 'expense')
    then coalesce(sum(jel.debit), 0) - coalesce(sum(jel.credit), 0)
    else coalesce(sum(jel.credit), 0) - coalesce(sum(jel.debit), 0)
  end as balance
from chart_of_accounts coa
left join journal_entry_lines jel on jel.account_code = coa.code
where coa.is_active
group by coa.code, coa.name, coa.account_type
order by coa.code;
