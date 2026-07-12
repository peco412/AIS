-- =====================================================================
-- File 77: RA SOAT them cac bang co "logic nhieu ban ghi" con thieu ma
-- rieng de de quan ly/khop chinh xac (nguoi dung yeu cau ra soat toan
-- he thong). Da co san: employees, students, parent_accounts, classes,
-- suppliers, purchase_orders, refund_requests, retail_sales (co trigger
-- roi). Con thieu / co cot nhung CHUA CO trigger:
--   - crm_leads (Ho so khach hang)          -> LEAD-0001
--   - wallet_purchase_requests (Mua qua Vi) -> MH-0001 (co san cot,
--     thieu trigger, code luon NULL tu truoc gio)
--   - wallet_withdrawal_requests (Rut vi)   -> RUT-0001
-- (chay sau file 76)
-- =====================================================================

-- ---------------------- HO SO KHACH HANG (crm_leads) ----------------------
alter table crm_leads add column if not exists code text unique;

create sequence if not exists lead_code_seq start 1;
create or replace function generate_lead_code() returns text as $$
declare n int;
begin
  n := nextval('lead_code_seq');
  return 'LEAD-' || lpad(n::text, 4, '0');
end;
$$ language plpgsql;

create or replace function trg_set_lead_code() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_lead_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists crm_leads_set_code on crm_leads;
create trigger crm_leads_set_code
before insert on crm_leads
for each row execute function trg_set_lead_code();

do $$
declare r record; begin
  for r in select id from crm_leads where code is null order by created_at loop
    update crm_leads set code = generate_lead_code() where id = r.id;
  end loop;
end $$;

-- ---------------------- MUA HANG QUA VI (wallet_purchase_requests) ----------------------
-- Cot "code" DA CO SAN tu file 45 nhung CHUA TUNG CO trigger tu sinh,
-- nen tu truoc gio luon la NULL het.
create sequence if not exists wallet_purchase_code_seq start 1;
create or replace function generate_wallet_purchase_code() returns text as $$
declare n int;
begin
  n := nextval('wallet_purchase_code_seq');
  return 'MH-' || lpad(n::text, 4, '0');
end;
$$ language plpgsql;

create or replace function trg_set_wallet_purchase_code() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_wallet_purchase_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists wallet_purchase_requests_set_code on wallet_purchase_requests;
create trigger wallet_purchase_requests_set_code
before insert on wallet_purchase_requests
for each row execute function trg_set_wallet_purchase_code();

do $$
declare r record; begin
  for r in select id from wallet_purchase_requests where code is null order by created_at loop
    update wallet_purchase_requests set code = generate_wallet_purchase_code() where id = r.id;
  end loop;
end $$;

-- ---------------------- RUT VI (wallet_withdrawal_requests) ----------------------
alter table wallet_withdrawal_requests add column if not exists code text unique;

create sequence if not exists withdrawal_code_seq start 1;
create or replace function generate_withdrawal_code() returns text as $$
declare n int;
begin
  n := nextval('withdrawal_code_seq');
  return 'RUT-' || lpad(n::text, 4, '0');
end;
$$ language plpgsql;

create or replace function trg_set_withdrawal_code() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_withdrawal_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists wallet_withdrawal_requests_set_code on wallet_withdrawal_requests;
create trigger wallet_withdrawal_requests_set_code
before insert on wallet_withdrawal_requests
for each row execute function trg_set_withdrawal_code();

do $$
declare r record; begin
  for r in select id from wallet_withdrawal_requests where code is null order by created_at loop
    update wallet_withdrawal_requests set code = generate_withdrawal_code() where id = r.id;
  end loop;
end $$;
