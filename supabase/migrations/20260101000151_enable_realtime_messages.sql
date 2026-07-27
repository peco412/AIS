-- =====================================================================
-- File 151: BAT REALTIME CHO TIN NHAN (27/07/2026)
-- =====================================================================
-- Can thiet de kenh "postgres_changes" (dang dung trong
-- ais-center/js/messages.js — subscribeRealtimeMessages) THUC SU nhan
-- duoc su kien INSERT theo thoi gian thuc — neu khong bat publication
-- nay, dang ky kenh van thanh cong nhung KHONG BAO GIO nhan duoc su
-- kien nao ca (loi rat de bi bo sot vi khong bao lo ra ngoai).
-- =====================================================================
alter publication supabase_realtime add table social_messages;
