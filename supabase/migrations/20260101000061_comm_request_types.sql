-- =====================================================================
-- File 61: SUA DUNG 6 loai "Cong viec yeu cau" cho Yeu cau truyen thong
-- - truoc day dung SAI: co "Quang cao"/"To chuc su kien" (khong co trong
-- dac ta, "su kien" da co rieng modun "Trinh ke hoach/su kien" khac roi),
-- thieu han "Edit video" va "Ho tro truyen thong", va gop chung "Quay
-- phim/chup anh" thanh 1 muc trong khi dac ta tach rieng 2 muc.
-- (chay sau file 60)
-- =====================================================================
alter type comm_request_type add value if not exists 'photo';
alter type comm_request_type add value if not exists 'video';
alter type comm_request_type add value if not exists 'edit_video';
alter type comm_request_type add value if not exists 'support';

-- Them cot gio cu the (truoc day chi co ngay, thieu han "Thoi gian cu
-- the" ma dac ta yeu cau tach rieng voi "Ngay cu the").
alter table communication_requests add column if not exists deadline_time time;
