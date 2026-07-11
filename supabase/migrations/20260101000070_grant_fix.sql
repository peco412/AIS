-- =====================================================================
-- File 70: SUA LOI 403 khi SELECT bang wallets (va co the ca bang khac) -
-- 403 tren SELECT thuong KHONG phai do RLS (RLS chi loc dong, tra ve
-- mang RONG chu khong bao 403) ma do THIEU GRANT quyen bang co ban cho
-- role "authenticated" — buoc bat buoc rieng biet voi RLS trong Postgres/
-- Supabase. Ra soat khong thay grant nay o dau trong cac migration hien
-- co, co the da bi sot tu luc reset database. Cap lai quyen cho TOAN BO
-- bang trong schema public de tranh sot rai rac o cac bang khac tuong tu.
-- RLS van la lop chan chinh quyet dinh AI thay duoc DONG NAO — GRANT chi
-- la "duoc phep hoi bang", khong lam yeu bao mat hien co.
-- (chay sau file 69)
-- =====================================================================
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Dam bao cac bang TAO SAU NAY (migration tiep theo) cung tu dong duoc
-- cap quyen, khong phai nho lap lai buoc nay moi lan.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
