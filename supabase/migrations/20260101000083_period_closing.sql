-- =====================================================================
-- File 83: KHOI 2 - DOI SOAT & KHOA SO (Reconciliation & Period Closing)
-- Muc tieu: sau khi 1 thang da duoc doi soat dung, KHOA lai de KHONG AI
-- (ke ca Ke toan) sua/them but toan cho thang do nua — dam bao Bao cao
-- tai chinh da phat hanh KHONG THE bi thay doi nguoc thoi gian.
--
-- 2 lop bao ve:
--   1. post_journal_entry() TU CHOI ghi neu ky (nam/thang cua ngay chung
--      tu) DA DUOC KHOA — kiem tra ngay trong ham ghi so DUY NHAT, khong
--      co duong nao khac de lach qua.
--   2. Chi TECH/BDH duoc MO KHOA lai (reopen) — bat buoc ghi ro ly do,
--      luu vet day du (ai mo, luc nao, vi sao) — vi day la hanh dong rat
--      nhay cam ve mat kiem toan.
-- (chay sau file 82)
-- =====================================================================

create table if not exists closed_periods (
  id uuid primary key default gen_random_uuid(),
  period_year int not null,
  period_month int not null,
  is_closed boolean not null default true,
  closed_by uuid references employees(id),
  closed_at timestamptz not null default now(),
  reopened_by uuid references employees(id),
  reopened_at timestamptz,
  reopen_reason text,
  unique (period_year, period_month)
);

alter table closed_periods enable row level security;
create policy closed_periods_select on closed_periods for select using (
  current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()
);
-- Khong co policy INSERT/UPDATE truc tiep cho client — chi qua ham
-- close_period()/reopen_period() (SECURITY DEFINER) ben duoi.

-- ---------------------------------------------------------------------
-- SUA post_journal_entry() — THEM lop kiem tra ky da khoa chua, TU CHOI
-- ghi neu da khoa. Day la diem CHAN DUY NHAT, moi but toan trong toan he
-- thong deu phai di qua ham nay nen khong the lach duoc.
-- ---------------------------------------------------------------------
create or replace function post_journal_entry(
  p_entry_date date, p_description text, p_reference_type text, p_reference_id uuid,
  p_lines jsonb, p_created_by uuid
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
  v_period_year int := extract(year from p_entry_date)::int;
  v_period_month int := extract(month from p_entry_date)::int;
begin
  if exists (select 1 from closed_periods where period_year = v_period_year and period_month = v_period_month and is_closed) then
    raise exception 'Kỳ %/% đã được KHOÁ SỔ — không thể ghi thêm bút toán. Nếu cần điều chỉnh, Ban điều hành/Kỹ thuật phải MỞ KHOÁ lại trước.', v_period_month, v_period_year;
  end if;

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

  insert into journal_entries (entry_date, description, reference_type, reference_id, period_year, period_month, created_by)
  values (p_entry_date, p_description, p_reference_type, p_reference_id, v_period_year, v_period_month, p_created_by)
  returning id into v_entry_id;

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
-- KHOA SO — Ke toan/BDH thuc hien sau khi doi soat xong 1 thang.
-- ---------------------------------------------------------------------
create or replace function close_period(p_year int, p_month int, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()) then
    raise exception 'Chỉ Kế toán/Ban điều hành mới được khoá sổ.';
  end if;

  if exists (select 1 from closed_periods where period_year = p_year and period_month = p_month and is_closed) then
    raise exception 'Kỳ %/% đã được khoá từ trước rồi.', p_month, p_year;
  end if;

  -- Neu ky nay tung bi mo khoa lai truoc do, cap nhat lai dong da co
  -- (unique constraint tren nam/thang), khong tao dong trung.
  insert into closed_periods (period_year, period_month, is_closed, closed_by, closed_at)
  values (p_year, p_month, true, p_actor_id, now())
  on conflict (period_year, period_month)
  do update set is_closed = true, closed_by = p_actor_id, closed_at = now(),
    reopened_by = null, reopened_at = null, reopen_reason = null;
end;
$func$;

-- ---------------------------------------------------------------------
-- MO KHOA LAI — CHI TECH/BDH, bat buoc ly do, luu vet day du. Day la
-- hanh dong nhay cam nhat trong toan bo he thong ke toan.
-- ---------------------------------------------------------------------
create or replace function reopen_period(p_year int, p_month int, p_actor_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not is_executive_or_tech() then
    raise exception 'Chỉ Ban điều hành/Kỹ thuật mới được mở khoá kỳ đã đóng — đây là thao tác nhạy cảm cần cấp cao nhất phê duyệt.';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Bắt buộc ghi rõ lý do khi mở khoá lại 1 kỳ đã đóng.';
  end if;

  if not exists (select 1 from closed_periods where period_year = p_year and period_month = p_month and is_closed) then
    raise exception 'Kỳ %/% hiện không ở trạng thái khoá.', p_month, p_year;
  end if;

  update closed_periods
  set is_closed = false, reopened_by = p_actor_id, reopened_at = now(), reopen_reason = p_reason
  where period_year = p_year and period_month = p_month;
end;
$func$;

-- ---------------------------------------------------------------------
-- KIEM TRA DOI SOAT — so sanh so du tinh tu So cai (111/112) voi so
-- tien Ke toan tu kiem dem/doi chieu sao ke ngan hang nhap tay, de biet
-- co chenh lech can xu ly truoc khi khoa so hay khong.
-- ---------------------------------------------------------------------
create table if not exists reconciliation_records (
  id uuid primary key default gen_random_uuid(),
  period_year int not null,
  period_month int not null,
  account_code text not null references chart_of_accounts(code),
  actual_balance numeric(14,2) not null, -- so tien kiem dem/sao ke thuc te
  gl_balance numeric(14,2) not null,     -- so tien he thong tinh duoc tai thoi diem doi soat
  note text,
  reconciled_by uuid references employees(id),
  reconciled_at timestamptz not null default now(),
  unique (period_year, period_month, account_code)
);

alter table reconciliation_records enable row level security;
create policy reconciliation_records_select on reconciliation_records for select using (
  current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech()
);
create policy reconciliation_records_write on reconciliation_records for all
  using (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech())
  with check (current_department_id() = (select id from departments where code='ACC') or is_executive_or_tech());
