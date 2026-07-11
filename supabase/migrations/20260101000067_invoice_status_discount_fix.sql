-- =====================================================================
-- File 67: SUA LOI NGHIEM TRONG - refresh_invoice_status() truoc day so
-- sanh so tien da dong voi amount_vnd (gia GOC, CHUA tru uu dai), trong
-- khi hoc sinh chi can dong dung phan CON LAI SAU UU DAI. Hoc sinh duoc
-- giam gia va dong DU dung phan phai dong se KHONG BAO GIO duoc danh
-- dau "Da xong" (mai ket lai "Dong 1 phan"), vi so sanh sai voi gia goc
-- chua tru giam. (chay sau file 66)
-- =====================================================================
create or replace function refresh_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_paid_vnd numeric;
  v_net_owed numeric;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  select coalesce(sum(amount_vnd), 0) into v_paid_vnd from debt_ledger where invoice_id = p_invoice_id;

  -- So tien THUC PHAI DONG = gia goc TRU DI uu dai (neu co), khong phai
  -- nguyen gia goc nhu truoc.
  v_net_owed := v_invoice.amount_vnd - coalesce(v_invoice.manual_discount_vnd, 0);

  update invoices set status = case
    when v_paid_vnd >= v_net_owed then 'paid'
    when v_paid_vnd > 0 then 'partially_paid'
    else 'unpaid'
  end
  where id = p_invoice_id;
end;
$$;

-- PHAT HIEN THEM: debt_ledger da BAT RLS tu truoc nhung CHUA TUNG CO
-- policy INSERT nao ca — moi thao tac ghi nhan tien thu tai cho (CASH/
-- BANK_TRANSFER) deu se bi tu choi. Bo sung cho dung nguoi duoc phep thu
-- tien (Quan ly trung tam/Tu van vien/Ke toan) ghi duoc, rieng nguon VI
-- van chi ghi qua ham SECURITY DEFINER deduct_wallet_fifo (khong can
-- INSERT truc tiep tu client).
create policy debt_ledger_insert_counter on debt_ledger for insert
  with check (
    source in ('CASH', 'BANK_TRANSFER')
    and (
      current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
      or current_department_id() = (select id from departments where code='ACC')
      or is_executive_or_tech()
    )
  );
