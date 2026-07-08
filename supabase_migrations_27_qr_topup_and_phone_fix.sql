-- =====================================================================
-- File 27: SỬA BUG KHỚP SĐT + THÊM XÁC MINH CHUYỂN KHOẢN QUA QR TRƯỚC KHI
-- CỘNG TIỀN VÀO VÍ (chạy sau file 26)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PHẦN 1 — VÁ BUG: claim_parent_account() so khớp SĐT sai định dạng.
-- Supabase lưu SĐT trong phiên đăng nhập KHÔNG có dấu "+" (vd 84912345678),
-- nhưng nhân viên nhập ở ERP theo thói quen Việt Nam (0912345678) — hàm cũ
-- chỉ tạo biến thể "+84..." nên không bao giờ khớp được số "0...". Sửa
-- bằng cách so khớp đúng 9 SỐ CUỐI (bỏ hết ký tự không phải số trước khi
-- so) — chắc chắn khớp bất kể định dạng nhập là gì.
-- ---------------------------------------------------------------------
create or replace function normalize_phone_vn(p_phone text)
returns text
language sql immutable
as $$
  select right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9);
$$;

create or replace function claim_parent_account()
returns parent_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_result parent_accounts;
begin
  v_phone := auth.jwt() ->> 'phone';
  if v_phone is null then
    raise exception 'Phiên đăng nhập hiện tại không có số điện thoại xác thực.';
  end if;

  update parent_accounts
  set auth_user_id = auth.uid()
  where auth_user_id is null and normalize_phone_vn(phone) = normalize_phone_vn(v_phone)
  returning * into v_result;

  return v_result;
end;
$$;

-- RPC tìm phụ huynh theo SĐT — dùng đúng cách so khớp 9 số cuối này ở cả
-- 2 phía (ERP tìm/tạo liên kết, App phụ huynh xác thực) để nhất quán.
create or replace function search_parent_by_phone(p_phone text)
returns parent_accounts
language sql stable
security definer
set search_path = public
as $$
  select * from parent_accounts where normalize_phone_vn(phone) = normalize_phone_vn(p_phone) limit 1;
$$;

-- ---------------------------------------------------------------------
-- PHẦN 2 — Cấu hình tài khoản ngân hàng nhận tiền (để tạo QR chuyển khoản)
-- ---------------------------------------------------------------------
create table if not exists bank_settings (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid references centers(id), -- null = áp dụng chung toàn hệ thống
  bank_bin text not null,      -- mã ngân hàng theo chuẩn VietQR, vd Vietcombank = 970436
  bank_name text not null,     -- tên hiển thị, vd "Vietcombank"
  account_no text not null,
  account_name text not null,  -- tên chủ tài khoản (KHÔNG DẤU, viết hoa theo đúng chuẩn ngân hàng)
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table bank_settings enable row level security;
create policy bank_settings_select on bank_settings for select using (true); -- ai đăng nhập cũng cần xem để tạo QR
create policy bank_settings_write on bank_settings for all
  using (is_executive_or_tech() or (current_department_id() = (select id from departments where code='ACC') and current_role_code() = 'DEPT_HEAD'))
  with check (is_executive_or_tech() or (current_department_id() = (select id from departments where code='ACC') and current_role_code() = 'DEPT_HEAD'));

-- ---------------------------------------------------------------------
-- PHẦN 3 — Yêu cầu nạp ví ĐANG CHỜ XÁC MINH chuyển khoản (KHÔNG cộng tiền
-- ngay) — đúng góp ý: phải có bước xác nhận tiền đã về tài khoản đích
-- trước khi cộng AIScoins, tránh phụ huynh tự gọi thẳng topup_wallet() mà
-- không hề chuyển tiền thật (lỗ hổng đã có từ trước).
-- ---------------------------------------------------------------------
create table if not exists wallet_topup_requests (
  id uuid primary key default uuid_generate_v4(),
  wallet_id uuid not null references wallets(id),
  requested_by uuid not null references parent_accounts(id),
  coin_amount numeric(14,2) not null check (coin_amount > 0),
  transfer_content text not null unique, -- nội dung chuyển khoản duy nhất để đối chiếu, vd "NAP A1B2C3"
  bank_setting_id uuid references bank_settings(id),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  confirmed_by uuid references employees(id),
  confirmed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_topup_requests_status on wallet_topup_requests(status, created_at);

alter table wallet_topup_requests enable row level security;
create policy topup_requests_select on wallet_topup_requests for select
  using (
    requested_by = current_parent_id() or is_executive_or_tech()
    or current_department_id() = (select id from departments where code='ACC')
    or current_role_code() = 'CENTER_MANAGER'
  );
create policy topup_requests_insert on wallet_topup_requests for insert with check (requested_by = current_parent_id());

-- Tạo yêu cầu nạp ví mới — sinh sẵn nội dung chuyển khoản DUY NHẤT để đối
-- chiếu (không cộng tiền ở bước này).
create or replace function create_topup_request(p_student_id uuid, p_coin_amount numeric)
returns wallet_topup_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_bank bank_settings;
  v_content text;
  v_result wallet_topup_requests;
begin
  if not is_linked_to_student(p_student_id) then
    raise exception 'Bạn không có quyền nạp ví cho học sinh này.';
  end if;

  select id into v_wallet_id from wallets where student_id = p_student_id;
  if v_wallet_id is null then
    insert into wallets (student_id) values (p_student_id) returning id into v_wallet_id;
  end if;

  select * into v_bank from bank_settings
  where is_active and (center_id is null or center_id = (select center_id from students where id = p_student_id))
  order by center_id nulls last limit 1;
  if v_bank.id is null then raise exception 'Chưa cấu hình tài khoản ngân hàng nhận tiền — liên hệ trung tâm.'; end if;

  v_content := 'NAP' || upper(substring(replace(uuid_generate_v4()::text, '-', '') from 1 for 8));

  insert into wallet_topup_requests (wallet_id, requested_by, coin_amount, transfer_content, bank_setting_id, status)
  values (v_wallet_id, current_parent_id(), p_coin_amount, v_content, v_bank.id, 'pending')
  returning * into v_result;

  return v_result;
end;
$$;

-- Kế toán/Quản lý trung tâm XÁC NHẬN đã thấy tiền về đúng tài khoản (đối
-- chiếu sao kê thủ công) -> CHỈ LÚC NÀY mới thật sự cộng tiền vào ví qua
-- topup_wallet() (dùng lại đúng logic tính chiết khấu/conversion_rate đã
-- có, không viết lại).
create or replace function confirm_topup_request(p_request_id uuid, p_approver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req wallet_topup_requests%rowtype;
  v_student_id uuid;
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền xác nhận nạp ví.';
  end if;

  select * into v_req from wallet_topup_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Yêu cầu này đã được xử lý rồi.'; end if;

  select student_id into v_student_id from wallets where id = v_req.wallet_id;

  perform topup_wallet(v_student_id, v_req.coin_amount, 'bank_transfer', p_approver_id);

  update wallet_topup_requests set status = 'confirmed', confirmed_by = p_approver_id, confirmed_at = now() where id = p_request_id;
end;
$$;

create or replace function reject_topup_request(p_request_id uuid, p_approver_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    current_department_id() = (select id from departments where code='ACC')
    or current_role_code() = 'CENTER_MANAGER'
    or is_executive_or_tech()
  ) then
    raise exception 'Bạn không có quyền từ chối yêu cầu nạp ví.';
  end if;

  update wallet_topup_requests
  set status = 'rejected', confirmed_by = p_approver_id, confirmed_at = now(), reject_reason = p_reason
  where id = p_request_id and status = 'pending';
end;
$$;
