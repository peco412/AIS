-- =====================================================================
-- File 92: SUA LOI "function digest(text, unknown) does not exist" -
-- ham nay dung de tao chuoi hash chong gia mao du lieu tai chinh (trong
-- append_financial_log(), goi tu MOI luong tien: hoc phi/vi/SePay tu
-- dong...) — thuoc extension "pgcrypto", hien dang KHONG duoc bat trong
-- database. Bat lai extension nay se sua duoc loi 500 khi webhook SePay
-- goi vao he thong.
-- (chay sau file 91)
-- =====================================================================
create extension if not exists pgcrypto;
