-- =====================================================================
-- File 88: SUA LOI "Ban le tai quay" (sach, dong phuc, qua tang) CHUA
-- NOI VAO SO CAI MOI (chi co insert cash_flow_entries — bang log PHANG
-- cu, khong phai bang But toan kep chinh thuc da xay o file 82). Nghia
-- la doanh thu ban le KHONG XUAT HIEN trong Bao cao Ke toan chuan (Sổ
-- cái/Sổ quỹ) dang dung, du van con trong log cu.
-- (chay sau file 87)
-- =====================================================================
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

    insert into inventory_transactions (transaction_type, item_id, size, quantity, center_id, performed_by, transaction_date, note)
    values ('out', v_item.item_id, v_item.size, v_item.quantity, v_sale.center_id, v_sale.performed_by, v_sale.sale_date,
      format('Ban le - phieu %s', v_sale.code));

    v_total := v_total + v_item.net_amount;
  end loop;

  update retail_sales set total_amount = v_total where id = p_sale_id;

  insert into cash_flow_entries (center_id, entry_type, category, amount, entry_date, note, created_by)
  values (v_sale.center_id, 'inflow', 'retail_sale', v_total, v_sale.sale_date,
    format('Ban le tai quay - phieu %s (%s)', v_sale.code, v_sale.reason), v_sale.performed_by);

  -- MOI: ghi vao So cai chinh thuc (but toan kep) — boc rieng, loi o day
  -- KHONG lam hong nghiep vu xuat kho/thu tien chinh (van tra ve binh
  -- thuong neu ghi so that bai vi ly do gi do).
  if v_total > 0 then
    begin
      v_account := case v_sale.payment_method when 'CASH' then '111' else '112' end;
      -- Dung current_date (khong dung sale_date) — nhat quan voi cac ham
      -- ghi so khac, tranh truong hop phieu ban tu ngay cuoi thang truoc
      -- nhung xu ly xong luc ky do da bi khoa so.
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
