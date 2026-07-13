-- =====================================================================
-- File 89: XAC NHAN CHI LUONG -> GHI SO CAI. Truoc day "finalized_by/at"
-- chi la CHOT SO LIEU tinh toan, KHONG PHAI da thuc chi tien — luong
-- (1 trong nhung khoan chi lon nhat) chua tung vao So cai.
--
-- Nguyen tac ke toan: chi phi luong THAT SU (Nợ 642) = phan da CHI TRA
-- + phan da GIU LAI de nop thay cho nguoi lao dong (tam ung/BHXH/thue) —
-- KHONG bao gom phan giam vi nghi/phat (nhung phan do khong con la chi
-- phi nua). Chia lam nhieu dong doi ung, tranh gop het vao 1 tai khoan.
-- (chay sau file 88)
-- =====================================================================

insert into chart_of_accounts (code, name, account_type) values
  ('3383', 'Bảo hiểm xã hội phải nộp', 'liability'),
  ('3335', 'Thuế thu nhập cá nhân phải nộp', 'liability')
on conflict (code) do nothing;

alter table payroll add column if not exists paid_by uuid references employees(id);
alter table payroll add column if not exists paid_at timestamptz;

create or replace function mark_payroll_paid(p_payroll_id uuid, p_actor_id uuid, p_method text default 'BANK_TRANSFER')
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pr payroll%rowtype;
  v_emp_name text;
  v_cash_account text;
  v_gross_expense numeric;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được xác nhận chi lương.';
  end if;

  select * into v_pr from payroll where id = p_payroll_id for update;
  if v_pr.id is null then raise exception 'Không tìm thấy bảng lương này.'; end if;
  if v_pr.paid_at is not null then raise exception 'Khoản lương này đã được xác nhận chi trả rồi (lúc %).', v_pr.paid_at; end if;
  if v_pr.finalized_by is null then raise exception 'Bảng lương chưa được chốt số liệu — vui lòng lưu/chốt trước khi xác nhận chi.'; end if;

  select full_name into v_emp_name from employees where id = v_pr.employee_id;
  v_cash_account := case p_method when 'CASH' then '111' else '112' end;

  -- Chi phi luong THAT SU = so tien thuc tra + phan giu lai ho (tam ung/
  -- BHXH/thue) — KHONG gom phan tru vi nghi/phat (da khong con la chi
  -- phi nua vi khong phat sinh cong viec/bi phat).
  v_gross_expense := v_pr.net_salary + coalesce(v_pr.advance_deduction, 0) + coalesce(v_pr.insurance_deduction, 0) + coalesce(v_pr.tax_deduction, 0);
  if v_gross_expense <= 0 then raise exception 'Không có khoản lương thực nhận nào > 0 để ghi sổ.'; end if;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '642', 'debit', v_gross_expense, 'credit', 0));

  if v_pr.net_salary > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', v_cash_account, 'debit', 0, 'credit', v_pr.net_salary));
  end if;
  if coalesce(v_pr.advance_deduction, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '141', 'debit', 0, 'credit', v_pr.advance_deduction));
  end if;
  if coalesce(v_pr.insurance_deduction, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '3383', 'debit', 0, 'credit', v_pr.insurance_deduction));
  end if;
  if coalesce(v_pr.tax_deduction, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '3335', 'debit', 0, 'credit', v_pr.tax_deduction));
  end if;

  perform post_journal_entry(
    current_date, format('Chi lương tháng %s/%s — %s', v_pr.month, v_pr.year, coalesce(v_emp_name, '—')),
    'payroll', p_payroll_id, v_lines, p_actor_id
  );

  update payroll set paid_by = p_actor_id, paid_at = now() where id = p_payroll_id;
end;
$func$;

-- Xac nhan HANG LOAT cho ca thang (goi lap lai ham tren cho tung nhan
-- vien chua chi, an toan vi moi lan goi deu tu kiem tra rieng — 1 nguoi
-- loi khong lam hong ca loat, chi bao qua nguoi do).
create or replace function mark_payroll_paid_bulk(p_year int, p_month int, p_actor_id uuid, p_method text default 'BANK_TRANSFER')
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row record;
  v_success int := 0;
  v_failed int := 0;
  v_errors text := '';
begin
  for v_row in select id from payroll where year = p_year and month = p_month and paid_at is null and finalized_by is not null loop
    begin
      perform mark_payroll_paid(v_row.id, p_actor_id, p_method);
      v_success := v_success + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || SQLERRM || '; ';
    end;
  end loop;
  return jsonb_build_object('success', v_success, 'failed', v_failed, 'errors', v_errors);
end;
$func$;
