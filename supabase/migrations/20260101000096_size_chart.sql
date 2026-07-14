-- =====================================================================
-- File 96: BANG CHIEU CAO/CAN NANG -> GOI Y SIZE — dua vao database
-- (co the tu chinh qua giao dien), khong hard-code trong code. Ap dung
-- cho ao thun hoc vien (item co has_size = true) — phu huynh nhap chieu
-- cao/can nang, he thong tu goi y size phu hop.
-- (chay sau file 95)
-- =====================================================================
create table if not exists size_charts (
  id uuid primary key default gen_random_uuid(),
  size_label text not null,             -- 'S', 'M', 'L', '10', '12'...
  min_height_cm numeric(5,1),
  max_height_cm numeric(5,1),
  min_weight_kg numeric(5,1),
  max_weight_kg numeric(5,1),
  display_order smallint not null default 0,
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now()
);

-- Seed 1 bang mac dinh hop ly cho ao thun hoc vien (tham khao chuan pho
-- bien, Ke toan/CSVC co the tu chinh lai sau qua trang cau hinh).
insert into size_charts (size_label, min_height_cm, max_height_cm, min_weight_kg, max_weight_kg, display_order) values
  ('4', 90, 100, 13, 16, 1),
  ('6', 100, 110, 16, 19, 2),
  ('8', 110, 120, 19, 23, 3),
  ('10', 120, 130, 23, 28, 4),
  ('12', 130, 140, 28, 34, 5),
  ('14', 140, 150, 34, 40, 6),
  ('16', 150, 160, 40, 48, 7),
  ('S', 155, 165, 45, 55, 8),
  ('M', 160, 170, 50, 62, 9),
  ('L', 165, 175, 58, 70, 10)
on conflict do nothing;

alter table size_charts enable row level security;
create policy size_charts_select on size_charts for select using (true);
create policy size_charts_write on size_charts for all
  using (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='ACC') or current_department_id() = (select id from departments where code='FAC'))
  with check (current_role_code() = 'TECH' or current_department_id() = (select id from departments where code='ACC') or current_department_id() = (select id from departments where code='FAC'));

-- Ham goi y size — tim dung khoang chieu cao HOAC can nang khop nhat
-- (uu tien chieu cao neu ca 2 deu co du lieu, vi thuong chinh xac hon
-- can nang doi voi ao — nhung neu chi co 1 trong 2 thi dung cai co san).
create or replace function suggest_size(p_height_cm numeric, p_weight_kg numeric)
returns text
language sql stable
as $$
  select size_label from size_charts
  where (p_height_cm is not null and p_height_cm between min_height_cm and max_height_cm)
     or (p_height_cm is null and p_weight_kg is not null and p_weight_kg between min_weight_kg and max_weight_kg)
  order by
    case when p_height_cm is not null and p_height_cm between min_height_cm and max_height_cm then 0 else 1 end,
    display_order
  limit 1;
$$;

grant execute on function suggest_size(numeric, numeric) to authenticated, anon;
