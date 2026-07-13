-- =====================================================================
-- File 90: SUA LOI "function uuid_generate_v4() does not exist" - loi
-- nay KHONG chi anh huong 3 cho da tung sua truoc do (migration 74/75/
-- 79), ma anh huong RAT RONG: 24 file migration khac nhau (tu luc tao
-- he thong ban dau) dung uuid_generate_v4() lam GIA TRI MAC DINH cho
-- cot "id" cua HANG CHUC bang du lieu. Khi extension uuid-ossp bi go bo
-- (hoac ham bi xoa) khoi database that, MOI bang chua duoc sua se GAY
-- ngay khi INSERT ma khong tu truyen id (dua vao gia tri mac dinh).
--
-- CACH SUA AN TOAN NHAT: KHONG di sua tung bang (rui ro sot, ton cong) —
-- thay vao do TAO LAI chinh ham "uuid_generate_v4()" nhu 1 LOP TUONG
-- THICH, chi don gian chuyen tiep sang gen_random_uuid() (ham chuan moi
-- dang dung, co san trong Postgres qua pgcrypto). Lam vay, TOAN BO cac
-- cot dang tham chieu ten ham cu se tu dong hoat dong lai binh thuong,
-- khong can dung mot bang nao ca — an toan tuyet doi, khong lam thay
-- doi bat ky du lieu hay cau truc bang nao.
-- (chay sau file 89)
-- =====================================================================
create or replace function uuid_generate_v4()
returns uuid
language sql
volatile
as $$
  select gen_random_uuid();
$$;

comment on function uuid_generate_v4() is 'Lop tuong thich - chuyen tiep sang gen_random_uuid(). Giu lai ten ham cu de KHONG PHAI sua lai gia tri mac dinh cua hang chuc cot "id" da tao tu truoc, dang tham chieu dung ten ham nay.';
