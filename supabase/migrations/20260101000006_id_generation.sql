-- =====================================================================
-- File 07: SINH MÃ TỰ ĐỘNG
-- Nhân viên: AIS-0001, AIS-0002, ... (tăng dần, không reset theo năm)
-- Phiếu:     {Mã}-{yyyy}-{mm}-000001 (reset về 000001 mỗi tháng, theo prefix)
--   HR   -> Hợp đồng / đơn nghỉ phép / đơn công tác
--   ACC1 -> Phiếu đề nghị thanh toán
--   ACC2 -> Phiếu tạm ứng
--   MKT  -> Trình sự kiện
--   FAC  -> Phiếu đề nghị mua sắm
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mã nhân viên: dùng 1 sequence toàn cục
-- ---------------------------------------------------------------------
create sequence if not exists employee_code_seq start 1;

create or replace function generate_employee_code() returns text as $$
declare
  n int;
begin
  n := nextval('employee_code_seq');
  return 'AIS-' || lpad(n::text, 4, '0');
end;
$$ language plpgsql;

create or replace function trg_set_employee_code() returns trigger as $$
begin
  if new.employee_code is null or new.employee_code = '' then
    new.employee_code := generate_employee_code();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger employees_set_code
before insert on employees
for each row execute function trg_set_employee_code();

-- ---------------------------------------------------------------------
-- Mã phiếu: bảng đếm riêng theo (prefix, năm, tháng) để đảm bảo reset
-- đúng theo tháng và an toàn khi nhiều người tạo phiếu cùng lúc.
-- ---------------------------------------------------------------------
create table if not exists document_code_counters (
  prefix text not null,
  year int not null,
  month int not null,
  last_number int not null default 0,
  primary key (prefix, year, month)
);

create or replace function generate_document_code(p_prefix text) returns text as $$
declare
  v_year int := extract(year from now());
  v_month int := extract(month from now());
  v_next int;
begin
  insert into document_code_counters (prefix, year, month, last_number)
  values (p_prefix, v_year, v_month, 1)
  on conflict (prefix, year, month)
  do update set last_number = document_code_counters.last_number + 1
  returning last_number into v_next;

  return p_prefix || '-' || v_year::text || '-' || lpad(v_month::text, 2, '0')
         || '-' || lpad(v_next::text, 6, '0');
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- Trigger tự gán mã cho từng bảng phiếu
-- ---------------------------------------------------------------------
create or replace function trg_set_code_hr() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('HR');
  end if;
  return new;
end;
$$ language plpgsql;

create trigger contracts_set_code before insert on contracts
for each row execute function trg_set_code_hr();
create trigger leave_requests_set_code before insert on leave_requests
for each row execute function trg_set_code_hr();
create trigger business_trips_set_code before insert on business_trips
for each row execute function trg_set_code_hr();

create or replace function trg_set_code_acc1() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('ACC1');
  end if;
  return new;
end;
$$ language plpgsql;
create trigger payment_requests_set_code before insert on payment_requests
for each row execute function trg_set_code_acc1();

create or replace function trg_set_code_acc2() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('ACC2');
  end if;
  return new;
end;
$$ language plpgsql;
create trigger advance_requests_set_code before insert on advance_requests
for each row execute function trg_set_code_acc2();

create or replace function trg_set_code_mkt() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('MKT');
  end if;
  return new;
end;
$$ language plpgsql;
create trigger event_proposals_set_code before insert on event_proposals
for each row execute function trg_set_code_mkt();
create trigger communication_requests_set_code before insert on communication_requests
for each row execute function trg_set_code_mkt();

create or replace function trg_set_code_fac() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('FAC');
  end if;
  return new;
end;
$$ language plpgsql;
create trigger purchase_requests_set_code before insert on purchase_requests
for each row execute function trg_set_code_fac();
create trigger facility_requests_set_code before insert on facility_requests
for each row execute function trg_set_code_fac();

-- Đề xuất nội bộ dùng mã riêng theo phòng ban gửi đề xuất, prefix 'DX'
create or replace function trg_set_code_proposal() returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := generate_document_code('DX');
  end if;
  return new;
end;
$$ language plpgsql;
create trigger internal_proposals_set_code before insert on internal_proposals
for each row execute function trg_set_code_proposal();

-- ---------------------------------------------------------------------
-- Trigger updated_at chung (áp dụng cho các bảng có cột updated_at)
-- ---------------------------------------------------------------------
create or replace function trg_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
  tables text[] := array[
    'employees','classes','students','contracts','payment_requests',
    'advance_requests','event_proposals','purchase_requests',
    'communication_requests','facility_requests','internal_proposals',
    'crm_leads','document_templates'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create trigger %I_touch_updated_at before update on %I
       for each row execute function trg_touch_updated_at();', t, t);
  end loop;
end $$;
