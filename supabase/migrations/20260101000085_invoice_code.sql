-- =====================================================================
-- File 85: THEM MA HOA DON (giong pattern HS-0001/PH-0001 da co) — de
-- co the tra cuu/chon dung 1 hoa don cu the qua trang chi tiet moi, thay
-- vi chi thay danh sach chung chung nhu truoc.
-- (chay sau file 84)
-- =====================================================================
alter table invoices add column if not exists invoice_code text unique;

create sequence if not exists invoice_code_seq start 1;
create or replace function generate_invoice_code() returns text as $$
declare n int;
begin
  n := nextval('invoice_code_seq');
  return 'HD-' || lpad(n::text, 5, '0');
end;
$$ language plpgsql;

create or replace function trg_set_invoice_code() returns trigger as $$
begin
  if new.invoice_code is null or new.invoice_code = '' then
    new.invoice_code := generate_invoice_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists invoices_set_invoice_code on invoices;
create trigger invoices_set_invoice_code
before insert on invoices
for each row execute function trg_set_invoice_code();

do $$
declare r record; begin
  for r in select id from invoices where invoice_code is null order by created_at loop
    update invoices set invoice_code = generate_invoice_code() where id = r.id;
  end loop;
end $$;
