-- =====================================================================
-- File 97: SUA LOI THAT - "Log xuat kho" dang hien MOI DONG SAN PHAM la
-- 1 ma rieng, dung ra 1 hoa don/phieu (nhap hoac xuat) co the co NHIEU
-- mat hang, phai gop chung 1 ma. Truoc day inventory_transactions tu
-- dong sinh ma (trg_set_code_hr) cho TUNG DONG rieng le, khong biet
-- dong nao thuoc chung 1 phieu.
--
-- Cach sua: them cot "receipt_code" — MA PHIEU CHUNG, dung CHO TAT CA
-- cac dong cung 1 lan xuat/nhap/ban. Voi phieu Ban le, dung LAI DUNG
-- ma cua retail_sales (da co san, khong sinh them ma moi trung lap).
-- Voi phieu Nhap/Xuat kho thuong, sinh 1 ma dung chung cho ca phieu.
-- (chay sau file 96)
-- =====================================================================

alter table inventory_transactions add column if not exists receipt_code text;

-- Dien lai du lieu CU: nhung dong tu Ban le (note co dang "Ban le - phieu
-- XXX") suy ra dung lai ma XXX do lam receipt_code; nhung dong con lai
-- (nhap/xuat thuong, tao truoc khi co receipt_code) coi moi dong la 1
-- phieu rieng (dung luon "code" cua chinh no, giu nguyen hien trang).
update inventory_transactions
set receipt_code = substring(note from 'Ban le - phieu (\S+)')
where note like 'Ban le - phieu %' and receipt_code is null;

update inventory_transactions
set receipt_code = code
where receipt_code is null;

create index if not exists idx_inventory_tx_receipt on inventory_transactions(receipt_code);

-- Sua finalize_retail_sale() — dung LAI dung ma retail_sales.code cho
-- TAT CA cac dong cung 1 phieu ban, khong de trigger tu sinh ma rieng
-- moi dong nua.
create or replace function finalize_retail_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_sale retail_sales%rowtype;
  v_item retail_sale_items%rowtype;
  v_total numeric := 0;
  v_current_stock numeric;
  v_account text;
begin
  select * into v_sale from retail_sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'Khong tim thay phieu xuat nay.'; end if;

  for v_item in select * from retail_sale_items where sale_id = p_sale_id loop
    select stock_quantity into v_current_stock from inventory_stock_view
    where center_id = v_sale.center_id and item_id = v_item.item_id and size = coalesce(v_item.size, '');
    if coalesce(v_current_stock, 0) < v_item.quantity then
      raise exception 'Khong du ton kho cho 1 mat hang trong don (con % , can %).', coalesce(v_current_stock,0), v_item.quantity;
    end if;

    -- MOI: gan receipt_code = dung ma cua phieu ban le (v_sale.code) cho
    -- MOI dong — de "Log xuat kho" gop dung 1 phieu, khong tach le nua.
    insert into inventory_transactions (transaction_type, item_id, size, quantity, center_id, performed_by, transaction_date, note, receipt_code)
    values ('out', v_item.item_id, v_item.size, v_item.quantity, v_sale.center_id, v_sale.performed_by, v_sale.sale_date,
      format('Ban le - phieu %s', v_sale.code), v_sale.code);

    v_total := v_total + v_item.net_amount;
  end loop;

  update retail_sales set total_amount = v_total where id = p_sale_id;

  insert into cash_flow_entries (center_id, entry_type, category, amount, entry_date, note, created_by)
  values (v_sale.center_id, 'inflow', 'retail_sale', v_total, v_sale.sale_date,
    format('Ban le tai quay - phieu %s (%s)', v_sale.code, v_sale.reason), v_sale.performed_by);

  if v_total > 0 then
    begin
      v_account := case v_sale.payment_method when 'CASH' then '111' else '112' end;
      perform post_journal_entry(
        current_date, format('Bán lẻ tại quầy — phiếu %s (%s)', v_sale.code, coalesce(v_sale.reason, '')),
        'retail_sale', p_sale_id,
        jsonb_build_array(
          jsonb_build_object('account_code', v_account, 'debit', v_total, 'credit', 0),
          jsonb_build_object('account_code', '511', 'debit', 0, 'credit', v_total)
        ),
        v_sale.performed_by
      );
    exception when others then
      raise warning 'Không ghi được sổ cái cho phiếu bán lẻ %: %', v_sale.code, SQLERRM;
    end;
  end if;
end;
$func$;

-- Ma phieu chung cho Nhap/Xuat kho thuong (khong phai Ban le) — sinh 1
-- LAN cho ca phieu (nhieu dong), dung chung "prefix" theo loai giao dich.
create sequence if not exists inventory_receipt_seq start 1;
create or replace function generate_inventory_receipt_code(p_type text) returns text as $$
declare n int;
begin
  n := nextval('inventory_receipt_seq');
  return (case when p_type = 'in' then 'PN-' else 'PX-' end) || lpad(n::text, 5, '0');
end;
$$ language plpgsql;

grant execute on function generate_inventory_receipt_code(text) to authenticated;
