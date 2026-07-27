-- =====================================================================
-- File 155: SUA LOI THAT "duplicate key value... parent_accounts_phone_key"
-- (27/07/2026)
-- =====================================================================
-- Trieu chung: phu huynh dang nhap (xac thuc OTP thanh cong that, co
-- session hop le) nhung app bao loi 409 khi tao ho so — vi da co san 1
-- dong parent_accounts voi DUNG so dien thoai nay roi, nhung ham
-- claim_parent_account() (chuyen de "nhan lai" dong cu) lai KHONG TIM
-- THAY de gan, khien app roi xuong nhanh "tao moi" va va phai rang
-- buoc UNIQUE tren cot phone.
--
-- Nguyen nhan goc: claim_parent_account() CHI update duoc dong nao
-- dang co auth_user_id = NULL. Neu dong do VI LY DO GI DO da co san 1
-- auth_user_id (vi du: tung xac thuc truoc do roi nhung boi mot phien
-- auth.users khac, hoac du lieu cu con sot) — ham se KHONG TIM THAY
-- dong nao, tra ve rong, va phia JS roi xuong nhanh tao moi -> loi.
--
-- Sua: neu buoc 1 (chi nhan dong con trong) khong tim thay, THU LAI
-- LAN 2 — nhan LUON dong co san DUNG SO DIEN THOAI NAY bat ke
-- auth_user_id dang la gi, gan sang auth.uid() cua PHIEN HIEN TAI.
-- An toan vi nguoi goi vua XAC THUC OTP THANH CONG toi CHINH SO DIEN
-- THOAI DO — day la bang chung hop le rang ho la chu that cua so may,
-- nen "chuyen quyen so huu" dong ho so ve dung phien hien tai la dung.
-- =====================================================================
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

  -- Buoc 1 — uu tien nhan dong CHUA gan cho ai (truong hop pho bien
  -- nhat: nhan vien tao ho so hoc sinh + phu huynh truoc, chua gan
  -- auth_user_id).
  update parent_accounts
  set auth_user_id = auth.uid()
  where auth_user_id is null and normalize_phone_vn(phone) = normalize_phone_vn(v_phone)
  returning * into v_result;

  if v_result.id is not null then
    return v_result;
  end if;

  -- Buoc 2 — khong tim thay dong trong de nhan, nhung VAN CO dong voi
  -- dung so dien thoai nay (co the dang gan 1 auth_user_id cu/le) — gio
  -- CHUYEN LAI ve dung phien hien tai, vi nguoi goi vua chung minh
  -- duoc quyen so huu so dien thoai qua OTP.
  update parent_accounts
  set auth_user_id = auth.uid()
  where normalize_phone_vn(phone) = normalize_phone_vn(v_phone)
  returning * into v_result;

  return v_result;
end;
$$;
