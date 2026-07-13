-- =====================================================================
-- File 86: SUA LOI NGHIEM TRONG VA LAN RONG - ham dung chung
-- notifyDepartmentHeads() (goi tu 9 cho khac nhau: HR/FAC/ACC/MKT/BDH)
-- dang INSERT SAI CAU TRUC bang notifications:
--   1) Dung cot "url" - KHONG TON TAI (chi co "attachment_url", von danh
--      cho FILE dinh kem, khong phai link dieu huong).
--   2) THIEU cot "created_by" - BAT BUOC (NOT NULL) nhung khong duoc
--      truyen vao.
-- Loi nay bi NUOT AM THAM (boc trong try/catch, chi console.warn) suot
-- tu dau — nghia la TRUONG PHONG cac phong ban KHONG BAO GIO nhan duoc
-- thong bao "co yeu cau moi can xu ly" qua toan bo he thong, o CA 9
-- luong nghiep vu khac nhau.
-- (chay sau file 85)
-- =====================================================================

-- Them cot rieng cho "link dieu huong" (khac han "attachment_url" von
-- danh cho file dinh kem) — dung dung y nghia ban dau cua tham so "url".
alter table notifications add column if not exists link_url text;
