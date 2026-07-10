-- =====================================================================
-- File 55: TACH RIENG "Master Data" thanh 1 muc menu doc lap (Phan 6
-- trong dac ta) - xay 2 trang con thieu (Trung tam, Hang muc chi) va sua
-- lai RLS centers cho dung mau Master Data (chi Ky thuat ghi, BDH chi xem)
-- (chay sau file 54)
-- =====================================================================

-- centers_write truoc do (file 49) van dung is_executive_or_tech() - sua
-- lai dung mau Master Data: BDH (EXECUTIVE) chi con quyen xem.
drop policy if exists centers_write on centers;
create policy centers_write on centers for all
  using (current_role_code() = 'TECH')
  with check (current_role_code() = 'TECH');
