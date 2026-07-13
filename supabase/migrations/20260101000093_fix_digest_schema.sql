-- =====================================================================
-- File 93: SUA TIEP loi "function digest(text, unknown) does not exist"
-- - da bat pgcrypto o file 92 nhung VAN LOI, nguyen nhan rat co the la:
-- Supabase THEO MAC DINH cai extension pgcrypto vao schema RIENG ten
-- "extensions" (khong phai "public") — trong khi ham append_financial_
-- log() lai chi dinh "set search_path = public" (thoi quen bao mat cho
-- SECURITY DEFINER function), nen du extension DA duoc bat, ham digest()
-- van KHONG TIM THAY duoc vi khong nam trong search_path.
--
-- Sua bang 2 lop, dam bao chac chan hoat dong bat ke pgcrypto nam o
-- schema nao:
--  1) Dam bao chac chan pgcrypto duoc cai (idempotent, khong loi neu da
--     co san o bat ky schema nao).
--  2) Doi search_path cua dung ham can dung digest() de BAO GOM CA
--     "extensions" (thu tu uu tien: public truoc, extensions sau).
-- (chay sau file 92)
-- =====================================================================
create extension if not exists pgcrypto;

alter function append_financial_log(text, numeric, uuid, uuid, uuid, uuid, text)
  set search_path = public, extensions;
