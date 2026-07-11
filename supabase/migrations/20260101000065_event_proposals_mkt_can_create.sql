-- =====================================================================
-- File 65: CHO PHEP Phong Truyen thong tu trinh Ke hoach/su kien (truoc
-- day CHI Quan ly trung tam moi trinh duoc, dung sai voi dac ta ghi ro
-- "BDH, Truong/Pho phong TT, Ky thuat, Quan ly trung tam" deu trinh
-- duoc). RLS insert von da cho phep bat ky ai tu gan minh la nguoi tao,
-- chi can sua giao dien (da sua) + noi long rang buoc center_id vi nhan
-- vien Truyen thong thuong khong gan voi 1 trung tam cu the nao.
-- (chay sau file 64)
-- =====================================================================
alter table event_proposals alter column center_id drop not null;
