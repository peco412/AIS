-- =====================================================================
-- File 41: BO SUNG TRUONG CON THIEU CHO "Thong ke tai san" - dac ta yeu
-- cau: Ma nganh hang, Ma so hang hoa (de dan barcode), ngay cap, nhan
-- vien duoc cap - bang hien tai hoan toan thieu 4 truong nay
-- (chay sau file 40)
-- =====================================================================
alter table facility_assets add column if not exists asset_code text unique;
alter table facility_assets add column if not exists category_code text check (category_code in ('electronics', 'household', 'other'));
alter table facility_assets add column if not exists assigned_date date;
alter table facility_assets add column if not exists assigned_employee_id uuid references employees(id);

-- Tu sinh ma so hang hoa (barcode) neu chua co, dang FAC-XXXXXXXX (8 ky
-- tu ngau nhien, du ngan de dan nhan vat ly nhung van gan nhu khong trung).
create or replace function generate_asset_code() returns text as $func$
begin
  return 'FAC-' || upper(substring(replace(uuid_generate_v4()::text, '-', '') from 1 for 8));
end;
$func$ language plpgsql;

create or replace function trg_set_asset_code() returns trigger as $func$
begin
  if new.asset_code is null or new.asset_code = '' then
    new.asset_code := generate_asset_code();
  end if;
  return new;
end;
$func$ language plpgsql;

drop trigger if exists facility_assets_set_code on facility_assets;
create trigger facility_assets_set_code before insert on facility_assets
for each row execute function trg_set_asset_code();
