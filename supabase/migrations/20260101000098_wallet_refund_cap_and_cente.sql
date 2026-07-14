-- =====================================================================
-- File 98: SUA 2 LOI VI RUT VI:
--
-- (A) calculate_wallet_refund() dang tinh tren TONG COIN DA TUNG NAP
--     (v_original_coins = sum(coin_amount) moi lo, ke ca lo da tieu het),
--     roi chi tru phan "coi nhu da tieu cho hoc phi" theo so khoa da
--     hoc. No KHONG tru phan coin da tieu qua mua sam/ban le
--     (wallet_purchase_requests, retail_sales...) vi nhung luong nay
--     tru truc tiep vao coin_remaining ma khong duoc cong thuc biet toi.
--     Hau qua: so tien hoan du kien co the LON HON so coin thuc su con
--     trong vi (da xac nhan qua vi du thuc te: cong thuc ra 2.000 VND
--     trong khi cac lo con lai chi co 1.946 coin). Neu duyet hoan theo
--     dung so nay, trung tam se hoan thua tien that.
--     -> SUA: gioi han (cap) ket qua cong thuc bang dung so tien tu
--     coin_remaining thuc te (theo tung lo, dung ty gia tung lo) - dam
--     bao KHONG BAO GIO hoan vuot qua tien thuc con trong vi.
--
-- (B) Policy withdrawal_select chi cho phu huynh gui yeu cau / ACC /
--     is_executive_or_tech() xem - THIEU CENTER_MANAGER/CONSULTANT dù
--     center_confirm_withdrawal() (file 35) da phan quyen cho ho xac
--     nhan. RLS chan SELECT nen trang refund-requests.js ben trung tam
--     luon ra danh sach rong, du yeu cau van ton tai trong DB.
--     -> SUA: them dieu kien cho CENTER_MANAGER/CONSULTANT, gioi han
--     theo center_id cua hoc sinh (giong cach center_confirm_withdrawal
--     dang kiem tra quyen).
-- (chay sau file 95)
-- =====================================================================

-- ---------------------------------------------------------------------
-- (A) Cap so tien hoan bang so tien thuc con trong vi
-- ---------------------------------------------------------------------
create or replace function calculate_wallet_refund(p_wallet_id uuid)
returns numeric
language plpgsql stable
as $func$
declare
  v_student_id uuid;
  v_course_id uuid;
  v_original_coins numeric := 0;
  v_weighted_discount_rate numeric := 0;
  v_weighted_conversion_rate numeric := 0;
  v_course_price numeric := 0;
  v_courses_completed int := 0;
  v_formula_refund numeric;
  v_actual_remaining_vnd numeric := 0;
begin
  select student_id into v_student_id from wallets where id = p_wallet_id;

  select coalesce(sum(coin_amount), 0) into v_original_coins
  from wallet_topup_batches where wallet_id = p_wallet_id;

  if v_original_coins = 0 then return 0; end if;

  select
    coalesce(sum(discount_rate * coin_amount) / nullif(sum(coin_amount), 0), 0),
    coalesce(sum(conversion_rate * coin_amount) / nullif(sum(coin_amount), 0), 0)
  into v_weighted_discount_rate, v_weighted_conversion_rate
  from wallet_topup_batches where wallet_id = p_wallet_id;

  select c.course_id into v_course_id from students s join classes c on c.id = s.class_id where s.id = v_student_id;

  if v_course_id is not null then
    select price_vnd, display_order into v_course_price, v_courses_completed from program_courses where id = v_course_id;
  end if;

  v_formula_refund := (v_original_coins - (coalesce(v_courses_completed, 0) * coalesce(v_course_price, 0) * v_weighted_discount_rate)) * v_weighted_conversion_rate;
  v_formula_refund := greatest(v_formula_refund, 0);

  -- Tran tren: khong bao gio hoan vuot qua so tien QUY DOI TU COIN CON
  -- THUC SU CON LAI trong vi (dung ty gia tung lo, giong cach hien thi
  -- o "Chi tiet theo tung lo nap" tren app phu huynh) - phan coin da
  -- tieu (hoc phi HOAC mua sam/ban le) deu khong con trong vi nen
  -- khong the hoan.
  select coalesce(sum(coin_remaining * conversion_rate), 0) into v_actual_remaining_vnd
  from wallet_topup_batches where wallet_id = p_wallet_id and coin_remaining > 0;

  return least(v_formula_refund, v_actual_remaining_vnd);
end;
$func$;

-- ---------------------------------------------------------------------
-- (B) Cho phep Quan ly trung tam / Tu van vien xem yeu cau rut vi cua
--     hoc sinh thuoc trung tam minh (can de xac nhan buoc center_confirmed)
-- ---------------------------------------------------------------------
drop policy if exists withdrawal_select on wallet_withdrawal_requests;
create policy withdrawal_select on wallet_withdrawal_requests for select using (
  requested_by = current_parent_id()
  or is_executive_or_tech()
  or current_department_id() = (select id from departments where code='ACC')
  or (
    current_role_code() in ('CENTER_MANAGER', 'CONSULTANT')
    and wallet_id in (
      select w.id from wallets w
      join students s on s.id = w.student_id
      where s.center_id = current_center_id()
    )
  )
);