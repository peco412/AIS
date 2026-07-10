-- =====================================================================
-- File 58: THEM "Phieu de nghi sua chua" - truoc day CHUA TUNG TON TAI,
-- dac ta yeu cau 2 loai phieu rieng (Mua sam + Sua chua) nhung he thong
-- chi co dung 1 loai. Dung chung ha tang purchase_requests, phan biet
-- qua cot request_type thay vi xay han 1 bang/template song song.
-- (chay sau file 57)
-- =====================================================================
alter table purchase_requests add column if not exists request_type text not null default 'purchase'
  check (request_type in ('purchase', 'repair'));
