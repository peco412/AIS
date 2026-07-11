-- =====================================================================
-- File 62: SUA DUNG CONG THUC HOAN TIEN VI theo dac ta - truoc day chi
-- cong don so du con lai chua dung (KHONG tinh so khoa da hoc), gio sua
-- dung dung cong thuc:
--   [So tien vi goc luc nap - (So khoa da hoc x Hoc phi don khoa GOC x
--   Ty le khuyen mai)] x Ty le quy doi tien mat
--
-- Da xac nhan voi nguoi dung 2 diem con mo ho:
-- - "Hoc phi don khoa" = gia KHOA HIEN TAI hoc sinh dang hoc (price_vnd)
-- - "So khoa da hoc" = VI TRI cua khoa hien tai trong day cac khoa cua
--   dung 1 Cap do con (vd cap do con co 3 khoa, dang o khoa thu 2 -> tinh
--   la 2 khoa da hoc)
-- (chay sau file 61)
-- =====================================================================
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
  v_refund numeric;
begin
  select student_id into v_student_id from wallets where id = p_wallet_id;

  -- "So tien vi goc luc nap" doc dung nghia la SO COIN nhan duoc luc nap
  -- (khong phai VND da tra) - vi cong thuc con nhan them "Ty le quy doi
  -- tien mat" o BUOC CUOI CUNG de doi tu coin sang VND. Neu hieu la VND
  -- ngay tu dau se bi quy doi 2 lan, sai don vi.
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

  v_refund := (v_original_coins - (coalesce(v_courses_completed, 0) * coalesce(v_course_price, 0) * v_weighted_discount_rate)) * v_weighted_conversion_rate;
  return greatest(v_refund, 0);
end;
$func$;
