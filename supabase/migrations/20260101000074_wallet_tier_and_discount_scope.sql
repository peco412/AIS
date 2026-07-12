-- =====================================================================
-- File 74: 2 VIEC —
-- A) "Chiet khau vi" (bac % theo so tien nap) truoc day la DU LIEU TINH
--    viet cung trong ham SQL (get_default_discount_rate) - chuyen sang
--    bang cau hinh de Ke toan/Ky thuat tu chinh duoc qua giao dien, khong
--    can sua code moi lan doi bac.
-- B) "Chuong trinh uu dai" (discount_programs) truoc day TU DONG ap dung
--    CA 2 noi (Thu hoc phi tai cho VA Nap vi) khong the tach rieng - them
--    truong "Phuong thuc ap dung" (Tai trung tam / Tai vi / Ca hai) de
--    admin tu chon dung pham vi cho tung chuong trinh cu the.
-- (chay sau file 73)
-- =====================================================================

-- --------------------- PHAN A: Bac chiet khau vi cau hinh duoc ---------------------
create table if not exists wallet_tier_discounts (
  id uuid primary key default uuid_generate_v4(),
  min_amount numeric(14,2) not null unique,
  discount_rate numeric(5,4) not null check (discount_rate >= 0 and discount_rate <= 1),
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now()
);

-- Seed dung 4 bac dang dung that (giu nguyen gia tri cu, khong doi hanh
-- vi hien tai, chi chuyen noi luu tru).
insert into wallet_tier_discounts (min_amount, discount_rate) values
  (10000000, 0.10), (20000000, 0.12), (30000000, 0.15), (50000000, 0.20)
on conflict (min_amount) do nothing;

alter table wallet_tier_discounts enable row level security;
create policy wallet_tier_discounts_select on wallet_tier_discounts for select using (true);
create policy wallet_tier_discounts_write on wallet_tier_discounts for all
  using (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='ACC'))
  with check (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='ACC'));

-- Doc tu bang thay vi CASE cung trong code — cung logic (bac cao nhat
-- ma so tien nap >= min_amount), chi doi nguon du lieu.
create or replace function get_default_discount_rate(p_coin_amount numeric)
returns numeric
language sql stable
as $func$
  select coalesce(
    (select discount_rate from wallet_tier_discounts where min_amount <= p_coin_amount order by min_amount desc limit 1),
    0
  );
$func$;

-- --------------------- PHAN B: Phuong thuc ap dung Chuong trinh uu dai ---------------------
alter table discount_programs add column if not exists applies_via text not null default 'both'
  check (applies_via in ('counter', 'wallet', 'both'));
comment on column discount_programs.applies_via is 'counter = chi ap dung Thu hoc phi tai cho; wallet = chi ap dung Nap vi; both = ca hai (mac dinh, giu dung hanh vi cu truoc khi co truong nay)';

-- Wallet-topup: CHI xet chuong trinh co applies_via in ('wallet','both').
create or replace function get_active_discount_program(p_center_id uuid)
returns discount_programs
language sql stable
as $$
  select * from discount_programs
  where status = 'active'
    and valid_range @> now()
    and applies_via in ('wallet', 'both')
    and (scope = 'system' or center_id = p_center_id)
  order by (scope = 'system') desc
  limit 1;
$$;

-- Thu hoc phi tai cho: CHI xet chuong trinh co applies_via in ('counter','both').
create or replace function get_auto_discount_for_class(p_class_id uuid, p_center_id uuid)
returns numeric
language plpgsql stable
as $func$
declare
  v_course_id uuid;
  v_sublevel_id uuid;
  v_program_id uuid;
  v_best_rate numeric := 0;
begin
  select course_id, sublevel_id, program_id into v_course_id, v_sublevel_id, v_program_id
  from classes where id = p_class_id;

  select coalesce(max(discount_rate), 0) into v_best_rate
  from discount_programs
  where status = 'active'
    and now() <@ valid_range
    and applies_via in ('counter', 'both')
    and (scope = 'system' or center_id = p_center_id)
    and (
      applies_to = 'all'
      or (applies_to = 'course' and course_id = v_course_id)
      or (applies_to = 'sublevel' and sublevel_id = v_sublevel_id)
      or (applies_to = 'program' and program_id = v_program_id)
    );

  return v_best_rate;
end;
$func$;
