-- =====================================================================
-- File 21: VÍ TÀI CHÍNH ĐA NGUỒN + QUẢN LÝ CÔNG NỢ TẬP TRUNG
-- (chạy sau file 20b)
--
-- ĐÂY LÀ HỆ THỐNG MỚI HOÀN TOÀN, KHÔNG PHỤ THUỘC CÁC BẢNG NGHIỆP VỤ CŨ
-- (tuition_payments vẫn giữ nguyên như log thu cũ; hệ ví/công nợ này độc
-- lập, dùng cho luồng App phụ huynh "AIS Center" mới).
--
-- PHẠM VI ĐÃ LÀM Ở FILE NÀY: schema + ràng buộc + hàm nghiệp vụ lõi
-- (tính chiết khấu, trừ ví FIFO, tính hoàn tiền, hash chain). Đây là phần
-- BẮT BUỘC PHẢI ĐÚNG TUYỆT ĐỐI nên ưu tiên làm kỹ trước.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHẦN 1 — Tài khoản phụ huynh (độc lập hoàn toàn với employees/system_roles)
-- ---------------------------------------------------------------------
create table if not exists parent_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  phone text not null unique,
  email text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create table if not exists parent_student_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_account_id uuid not null references parent_accounts(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  relationship text, -- 'Bố', 'Mẹ', 'Người giám hộ'...
  created_at timestamptz not null default now(),
  unique (parent_account_id, student_id)
);

-- Hàm helper: xác định parent_account đang đăng nhập (giống pattern
-- current_employee_id() đã dùng khắp hệ thống ERP, nhưng cho phía App
-- phụ huynh — dựa vào auth.uid() của Supabase Auth).
create or replace function current_parent_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from parent_accounts where auth_user_id = auth.uid();
$$;

create or replace function is_linked_to_student(p_student_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from parent_student_links
    where parent_account_id = current_parent_id() and student_id = p_student_id
  );
$$;

-- ---------------------------------------------------------------------
-- PHẦN 2 — Chương trình ưu đãi + audit log (mục 2)
-- ---------------------------------------------------------------------
create table if not exists discount_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text not null,
  scope text not null check (scope in ('system', 'center')),
  center_id uuid references centers(id), -- null nếu scope='system'
  discount_rate numeric(5,4) not null check (discount_rate > 0 and discount_rate <= 0.40), -- tối đa 40% ngay từ lúc tạo (mục 2.4)
  valid_range tstzrange not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope = 'system' or center_id is not null) -- center_id bắt buộc nếu scope='center'
);
create index if not exists idx_discount_programs_scope_status on discount_programs(scope, status);

create table if not exists discount_program_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid references discount_programs(id),
  actor_id uuid not null references employees(id),
  action text not null, -- 'create' | 'update' | 'activate' | 'deactivate'
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

-- Loại trừ lẫn nhau giữa "Toàn hệ thống" và "Trung tâm" (mục 2.2) — Postgres
-- không có cách biểu diễn "1 nhóm loại trừ MỌI nhóm khác" bằng 1 EXCLUDE
-- constraint gốc khi 2 phía có center_id khác nhau, nên dùng TRIGGER kiểm
-- tra chồng lấp thời gian tại tầng DB (vẫn là ràng buộc DB thật, không chỉ
-- ở tầng ứng dụng) + advisory lock để chống race condition khi nhiều thao
-- tác tạo/bật đồng thời.
create or replace function check_discount_program_exclusivity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'active' then return new; end if;

  -- Khoá tuần tự mọi thao tác ghi vào bảng này trong transaction hiện tại,
  -- tránh 2 request tạo chương trình cùng lúc đều "thấy" chưa có gì chồng
  -- lấp rồi cùng insert thành công (race condition kinh điển).
  perform pg_advisory_xact_lock(hashtext('discount_programs_exclusivity'));

  if new.scope = 'system' then
    if exists (
      select 1 from discount_programs
      where scope = 'center' and status = 'active' and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and valid_range && new.valid_range
    ) then
      raise exception 'Không thể bật ưu đãi Toàn hệ thống khi đang có ưu đãi riêng cho (các) trung tâm còn hiệu lực trong cùng khoảng thời gian.';
    end if;
  else
    if exists (
      select 1 from discount_programs
      where scope = 'system' and status = 'active' and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and valid_range && new.valid_range
    ) then
      raise exception 'Không thể bật ưu đãi riêng cho trung tâm khi đang có ưu đãi Toàn hệ thống còn hiệu lực trong cùng khoảng thời gian.';
    end if;
    if exists (
      select 1 from discount_programs
      where scope = 'center' and center_id = new.center_id and status = 'active'
        and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and valid_range && new.valid_range
    ) then
      raise exception 'Trung tâm này đã có 1 chương trình ưu đãi khác đang hoạt động trong cùng khoảng thời gian.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_discount_program_exclusivity on discount_programs;
create trigger trg_discount_program_exclusivity
before insert or update on discount_programs
for each row execute function check_discount_program_exclusivity();

-- Ghi audit log tự động mỗi khi tạo/sửa chương trình (mục 2.1)
create or replace function log_discount_program_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into discount_program_audit_log (program_id, actor_id, action, old_value, new_value)
  values (
    coalesce(new.id, old.id),
    coalesce(new.created_by, current_employee_id()),
    case when tg_op = 'INSERT' then 'create' else 'update' end,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists trg_log_discount_program on discount_programs;
create trigger trg_log_discount_program
after insert or update on discount_programs
for each row execute function log_discount_program_change();

-- ---------------------------------------------------------------------
-- PHẦN 3 — Ví, lô nạp, hàm tính chiết khấu (mục 1, 2.3, 2.4)
-- ---------------------------------------------------------------------
create table if not exists wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid not null unique references students(id),
  created_at timestamptz not null default now()
);

create table if not exists wallet_topup_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid not null references wallets(id),
  coin_amount numeric(14,2) not null check (coin_amount > 0),
  coin_remaining numeric(14,2) not null check (coin_remaining >= 0),
  discount_rate numeric(5,4) not null,       -- % áp dụng lúc nạp (đã lồng ghép nếu có)
  conversion_rate numeric(5,4) not null,     -- LƯU CỐ ĐỊNH tại thời điểm nạp — không tính lại sau này (mục 1.1)
  applied_program_id uuid references discount_programs(id), -- chương trình ưu đãi áp dụng lúc đó (nếu có)
  amount_vnd_paid numeric(14,2) not null,    -- số VNĐ thực thu = coin_amount * conversion_rate
  method text not null check (method in ('cash', 'bank_transfer', 'app')),
  created_by uuid references employees(id), -- null nếu phụ huynh tự nạp qua App
  created_at timestamptz not null default now()
);
create index if not exists idx_topup_batches_wallet on wallet_topup_batches(wallet_id, created_at);

-- Bậc chiết khấu mặc định theo khoảng số tiền nạp (mục 1.2)
create or replace function get_default_discount_rate(p_coin_amount numeric)
returns numeric
language sql immutable
as $$
  select case
    when p_coin_amount >= 50000000 then 0.20
    when p_coin_amount >= 30000000 then 0.15
    when p_coin_amount >= 20000000 then 0.12
    when p_coin_amount >= 10000000 then 0.10
    else 0
  end;
$$;

-- Chương trình ưu đãi đang active cho 1 trung tâm cụ thể tại thời điểm hiện
-- tại — ưu tiên chương trình Toàn hệ thống nếu có (2 loại đã loại trừ lẫn
-- nhau nên thực ra chỉ có TỐI ĐA 1 trong 2 loại active tại 1 thời điểm).
create or replace function get_active_discount_program(p_center_id uuid)
returns discount_programs
language sql stable
as $$
  select * from discount_programs
  where status = 'active'
    and valid_range @> now()
    and (scope = 'system' or center_id = p_center_id)
  order by (scope = 'system') desc -- ưu tiên system trước (dù về logic 2 loại không thể cùng active)
  limit 1;
$$;

-- Tính tỷ giá quy đổi thật cho 1 lần nạp — ÁP DỤNG ĐÚNG QUY TẮC KHOÁ TRẦN
-- 40% (mục 2.4): nếu chương trình ưu đãi active có discount_rate > 20%,
-- CHỈ dùng riêng % của chương trình đó, tắt hẳn bậc mặc định theo số tiền.
create or replace function calculate_topup_conversion(p_coin_amount numeric, p_center_id uuid)
returns table (discount_rate numeric, conversion_rate numeric, program_id uuid)
language plpgsql stable
as $$
declare
  v_default_rate numeric;
  v_program discount_programs;
  v_final_rate numeric;
begin
  v_default_rate := get_default_discount_rate(p_coin_amount);
  v_program := get_active_discount_program(p_center_id);

  if v_program.id is not null and v_program.discount_rate > 0.20 then
    -- Ưu đãi lớn (>20%) -> dùng RIÊNG % của ưu đãi, tắt bậc mặc định
    v_final_rate := v_program.discount_rate;
  else
    -- Lồng ghép: mặc định + ưu đãi (nếu có), chặn trần tuyệt đối 40%
    v_final_rate := least(v_default_rate + coalesce(v_program.discount_rate, 0), 0.40);
  end if;

  return query select v_final_rate, (1 - v_final_rate), v_program.id;
end;
$$;

-- Nạp ví — tạo 1 batch mới, LƯU CỐ ĐỊNH conversion_rate tại thời điểm này.
create or replace function topup_wallet(
  p_student_id uuid, p_coin_amount numeric, p_method text, p_created_by uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_center_id uuid;
  v_calc record;
  v_batch_id uuid;
begin
  select id into v_wallet_id from wallets where student_id = p_student_id;
  if v_wallet_id is null then
    insert into wallets (student_id) values (p_student_id) returning id into v_wallet_id;
  end if;

  select center_id into v_center_id from students where id = p_student_id;
  select * into v_calc from calculate_topup_conversion(p_coin_amount, v_center_id);

  insert into wallet_topup_batches (
    wallet_id, coin_amount, coin_remaining, discount_rate, conversion_rate,
    applied_program_id, amount_vnd_paid, method, created_by
  ) values (
    v_wallet_id, p_coin_amount, p_coin_amount, v_calc.discount_rate, v_calc.conversion_rate,
    v_calc.program_id, p_coin_amount * v_calc.conversion_rate, p_method, p_created_by
  ) returning id into v_batch_id;

  perform append_financial_log('WALLET', p_coin_amount * v_calc.conversion_rate, null, p_created_by, v_wallet_id, p_student_id,
    format('Nạp ví %s AIScoins (chiết khấu %s%%)', p_coin_amount, v_calc.discount_rate * 100));

  return v_batch_id;
end;
$$;

-- ---------------------------------------------------------------------
-- PHẦN 4 — Trừ ví FIFO + công nợ song song 2 đơn vị (mục 3.1, 4.1)
-- ---------------------------------------------------------------------
create table if not exists invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid not null references students(id),
  period_year int not null,
  period_month int not null,
  amount_vnd numeric(14,2) not null,     -- học phí gốc quy ra VNĐ
  amount_aiscoin numeric(14,2) not null, -- học phí gốc quy ra AIScoins (theo tỷ giá tại thời điểm phát hành hoá đơn — 1:1 mặc định, tuỳ chính sách)
  status text not null default 'unpaid' check (status in ('unpaid', 'partially_paid', 'paid')),
  due_date date not null,
  created_at timestamptz not null default now(),
  unique (student_id, period_year, period_month)
);

create table if not exists debt_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  source text not null check (source in ('WALLET', 'CASH', 'BANK_TRANSFER')),
  batch_id uuid references wallet_topup_batches(id), -- chỉ có nếu source=WALLET, để biết đúng conversion_rate đã dùng
  amount_coin numeric(14,2),   -- số coin đã trừ (nếu qua ví)
  amount_vnd numeric(14,2) not null, -- quy đổi VNĐ tương ứng của phần đã trừ này
  conversion_rate_used numeric(5,4), -- lưu lại đúng tỷ giá batch lúc trừ, để truy vết weighted sum (mục 4.1 lưu ý kỹ thuật)
  created_at timestamptz not null default now()
);
create index if not exists idx_debt_ledger_invoice on debt_ledger(invoice_id);

-- Trừ ví theo FIFO (batch cũ nạp trước bị trừ trước) cho 1 hoá đơn — ghi
-- lại CHÍNH XÁC từng phần bị trừ từ batch nào + tỷ giá batch đó, để tính
-- đúng "tổng trọng số" (weighted sum) thay vì dùng 1 tỷ giá chung sai lệch.
create or replace function deduct_wallet_fifo(p_invoice_id uuid, p_coin_to_deduct numeric, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_wallet_id uuid;
  v_remaining_to_deduct numeric := p_coin_to_deduct;
  v_batch record;
  v_take numeric;
  v_total_vnd numeric := 0;
begin
  select student_id into v_student_id from invoices where id = p_invoice_id;
  select id into v_wallet_id from wallets where student_id = v_student_id;
  if v_wallet_id is null then raise exception 'Học viên chưa có ví.'; end if;

  for v_batch in
    select * from wallet_topup_batches
    where wallet_id = v_wallet_id and coin_remaining > 0
    order by created_at asc -- FIFO
    for update
  loop
    exit when v_remaining_to_deduct <= 0;
    v_take := least(v_batch.coin_remaining, v_remaining_to_deduct);

    update wallet_topup_batches set coin_remaining = coin_remaining - v_take where id = v_batch.id;

    insert into debt_ledger (invoice_id, source, batch_id, amount_coin, amount_vnd, conversion_rate_used)
    values (p_invoice_id, 'WALLET', v_batch.id, v_take, v_take * v_batch.conversion_rate, v_batch.conversion_rate);

    v_total_vnd := v_total_vnd + (v_take * v_batch.conversion_rate);
    v_remaining_to_deduct := v_remaining_to_deduct - v_take;
  end loop;

  if v_remaining_to_deduct > 0 then
    raise exception 'Số dư ví không đủ — còn thiếu % AIScoins.', v_remaining_to_deduct;
  end if;

  perform append_financial_log('WALLET', v_total_vnd, p_invoice_id, p_actor_id, v_wallet_id, v_student_id,
    format('Thanh toán hoá đơn qua ví: %s AIScoins', p_coin_to_deduct));

  perform refresh_invoice_status(p_invoice_id);
end;
$$;

-- Cập nhật lại trạng thái hoá đơn dựa trên tổng đã trừ (mọi nguồn) so với
-- giá trị gốc — dùng amount_vnd làm đơn vị so sánh chung (đã quy đổi đủ).
create or replace function refresh_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_paid_vnd numeric;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  select coalesce(sum(amount_vnd), 0) into v_paid_vnd from debt_ledger where invoice_id = p_invoice_id;

  update invoices set status = case
    when v_paid_vnd >= v_invoice.amount_vnd then 'paid'
    when v_paid_vnd > 0 then 'partially_paid'
    else 'unpaid'
  end
  where id = p_invoice_id;
end;
$$;

-- Đóng tại quầy (Tiền mặt/Chuyển khoản) — không qua ví, ghi thẳng vào
-- debt_ledger với nguồn tương ứng (mục 3.1, 4.1).
create or replace function record_counter_payment(
  p_invoice_id uuid, p_source text, p_amount_vnd numeric, p_actor_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
begin
  if p_source not in ('CASH', 'BANK_TRANSFER') then
    raise exception 'record_counter_payment chỉ dùng cho CASH hoặc BANK_TRANSFER.';
  end if;
  select student_id into v_student_id from invoices where id = p_invoice_id;

  insert into debt_ledger (invoice_id, source, amount_vnd) values (p_invoice_id, p_source, p_amount_vnd);
  perform append_financial_log(p_source, p_amount_vnd, p_invoice_id, p_actor_id, null, v_student_id, 'Thu học phí tại quầy');
  perform refresh_invoice_status(p_invoice_id);
end;
$$;

-- ---------------------------------------------------------------------
-- PHẦN 5 — Hoàn tiền khi rút ví (mục 4.2, 5.4)
-- ---------------------------------------------------------------------
create table if not exists wallet_withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid not null references wallets(id),
  requested_by uuid not null references parent_accounts(id),
  preview_amount_vnd numeric(14,2) not null, -- số tiền dự kiến hoàn, tính lúc gửi yêu cầu
  actual_amount_vnd numeric(14,2),           -- số tiền thực hoàn lúc duyệt (có thể khác nếu ví biến động giữa lúc gửi và lúc duyệt)
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references employees(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Tính số tiền hoàn dự kiến — tổng theo TỪNG batch còn dư, đúng conversion_rate
-- của batch đó (mục 4.2), KHÔNG dùng 1 tỷ giá chung.
create or replace function calculate_wallet_refund(p_wallet_id uuid)
returns numeric
language sql stable
as $$
  select coalesce(sum(coin_remaining * conversion_rate), 0)
  from wallet_topup_batches
  where wallet_id = p_wallet_id and coin_remaining > 0;
$$;

-- Duyệt yêu cầu rút ví — Kế toán trưởng/Kế toán trung tâm bấm duyệt, TÍNH
-- LẠI số tiền hoàn tại đúng thời điểm duyệt (phòng trường hợp ví biến động
-- giữa lúc phụ huynh gửi yêu cầu và lúc kế toán duyệt), rồi tất toán mọi
-- batch còn dư về 0.
create or replace function approve_wallet_withdrawal(p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req wallet_withdrawal_requests%rowtype;
  v_actual numeric;
  v_student_id uuid;
begin
  select * into v_req from wallet_withdrawal_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Yêu cầu này đã được xử lý rồi.'; end if;

  v_actual := calculate_wallet_refund(v_req.wallet_id);
  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  update wallet_topup_batches set coin_remaining = 0 where wallet_id = v_req.wallet_id and coin_remaining > 0;
  update wallet_withdrawal_requests
  set status = 'approved', actual_amount_vnd = v_actual, approved_by = p_approver_id, approved_at = now()
  where id = p_request_id;

  perform append_financial_log('WALLET', -v_actual, null, p_approver_id, v_req.wallet_id, v_student_id,
    format('Hoàn tiền rút ví: %s VNĐ', v_actual));
end;
$$;

-- ---------------------------------------------------------------------
-- PHẦN 6 — Nhật ký tài chính + Hash Chain (mục 3.2)
-- ---------------------------------------------------------------------
create table if not exists financial_transaction_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text not null check (source in ('WALLET', 'CASH', 'BANK_TRANSFER')),
  amount numeric(14,2) not null,
  invoice_id uuid references invoices(id),
  actor_id uuid references employees(id), -- null nếu phụ huynh tự thao tác qua App
  wallet_id uuid references wallets(id),
  student_id uuid references students(id),
  note text,
  hash text not null,
  prev_hash text,
  created_at timestamptz not null default now()
);
create index if not exists idx_fin_logs_source_date on financial_transaction_logs(source, created_at);

create or replace function append_financial_log(
  p_source text, p_amount numeric, p_invoice_id uuid, p_actor_id uuid,
  p_wallet_id uuid, p_student_id uuid, p_note text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_new_hash text;
  v_id uuid := uuid_generate_v4();
  v_ts timestamptz := now();
begin
  -- Khoá tuần tự để prev_hash luôn lấy đúng bản ghi liền trước CÙNG NGUỒN,
  -- tránh 2 giao dịch cùng nguồn ghi log đồng thời tính sai chuỗi hash.
  perform pg_advisory_xact_lock(hashtext('financial_log_chain_' || p_source));

  select hash into v_prev_hash from financial_transaction_logs
  where source = p_source order by created_at desc limit 1;

  v_new_hash := encode(digest(
    coalesce(v_prev_hash, '') || p_source || p_amount::text || coalesce(p_invoice_id::text, '') ||
    coalesce(p_actor_id::text, '') || v_ts::text, 'sha256'
  ), 'hex');

  insert into financial_transaction_logs (id, source, amount, invoice_id, actor_id, wallet_id, student_id, note, hash, prev_hash, created_at)
  values (v_id, p_source, p_amount, p_invoice_id, p_actor_id, p_wallet_id, p_student_id, p_note, v_new_hash, v_prev_hash, v_ts);

  return v_id;
end;
$$;

-- Verify toàn bộ chuỗi hash: viết bằng Edge Function (xem
-- supabase/functions/verify-hash-chain/index.ts) thay vì PL/pgSQL thuần —
-- vòng lặp so khớp hash tuần tự dễ viết đúng và dễ debug hơn nhiều ở
-- TypeScript so với PL/pgSQL, và cũng dễ log/cảnh báo rõ ràng hơn khi phát
-- hiện đứt chuỗi. Function SQL này CHỈ cung cấp dữ liệu thô theo đúng thứ
-- tự để Edge Function đọc và tự so sánh.
create or replace function get_financial_log_chain(p_source text)
returns table (id uuid, hash text, prev_hash text, created_at timestamptz)
language sql stable
as $$
  select id, hash, prev_hash, created_at
  from financial_transaction_logs
  where source = p_source
  order by created_at asc;
$$;

-- ---------------------------------------------------------------------
-- PHẦN 7 — RLS cho toàn bộ bảng mới
-- ---------------------------------------------------------------------
alter table parent_accounts enable row level security;
create policy parent_accounts_self on parent_accounts for select using (auth_user_id = auth.uid() or is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC'));

alter table parent_student_links enable row level security;
create policy parent_student_links_self on parent_student_links for select using (parent_account_id = current_parent_id() or is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC'));

alter table wallets enable row level security;
create policy wallets_select on wallets for select using (is_linked_to_student(student_id) or is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC') or (current_role_code()='CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id())));

alter table wallet_topup_batches enable row level security;
create policy wallet_topup_batches_select on wallet_topup_batches for select using (
  wallet_id in (select id from wallets w where is_linked_to_student(w.student_id))
  or is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
);

alter table discount_programs enable row level security;
create policy discount_programs_select on discount_programs for select using (true); -- ai đăng nhập cũng xem được (để App tính preview)
create policy discount_programs_write on discount_programs for all
  using (is_executive_or_tech() or (current_department_id() = (select id from departments where code='ACC') and current_role_code() = 'DEPT_HEAD'))
  with check (is_executive_or_tech() or (current_department_id() = (select id from departments where code='ACC') and current_role_code() = 'DEPT_HEAD'));

alter table discount_program_audit_log enable row level security;
create policy discount_audit_select on discount_program_audit_log for select using (is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC'));

alter table invoices enable row level security;
create policy invoices_select on invoices for select using (
  is_linked_to_student(student_id) or is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
  or (current_role_code()='CENTER_MANAGER' and student_id in (select id from students where center_id = current_center_id()))
);
create policy invoices_write on invoices for all
  using (is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC'))
  with check (is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC'));

alter table debt_ledger enable row level security;
create policy debt_ledger_select on debt_ledger for select using (
  invoice_id in (select id from invoices i where is_linked_to_student(i.student_id))
  or is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
);

alter table wallet_withdrawal_requests enable row level security;
create policy withdrawal_select on wallet_withdrawal_requests for select using (
  requested_by = current_parent_id() or is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
);
create policy withdrawal_insert on wallet_withdrawal_requests for insert with check (requested_by = current_parent_id());
create policy withdrawal_update on wallet_withdrawal_requests for update
  using (is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC'));

alter table financial_transaction_logs enable row level security;
create policy fin_logs_select on financial_transaction_logs for select using (
  is_executive_or_tech() or current_department_id() = (select id from departments where code='ACC')
);
-- KHÔNG có policy update/delete cho financial_transaction_logs -> mặc định
-- chặn với TẤT CẢ mọi người kể cả TECH, đúng tinh thần hash-chain (chỉ có
-- thể APPEND, không được sửa/xoá bản ghi đã ghi).
