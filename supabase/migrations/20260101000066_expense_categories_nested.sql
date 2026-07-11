-- =====================================================================
-- File 66: THEM parent_code de phu muc chi duoc GAN DUNG vao 1 trong 5
-- muc goc (HDQT/A/B/C/D) - truoc day hoan toan phang, khong biet phu
-- muc thuoc muc goc nao. Ap dung chung cho TOAN HE THONG (khong co
-- center_id tren bang nay tu truoc gio - da dung, khong phai tach rieng
-- theo tung trung tam). (chay sau file 65)
-- =====================================================================
alter table expense_categories add column if not exists parent_code text references expense_categories(code);
