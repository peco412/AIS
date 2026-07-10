-- =====================================================================
-- File 13: CHUYỂN STORAGE BUCKET "attachments" SANG PRIVATE
-- Bắt buộc trước khi lên production thật — hiện bucket đang Public,
-- nghĩa là bất kỳ ai có URL (dễ đoán / lộ qua log, share nhầm) đều tải
-- được hồ sơ nghỉ phép, hợp đồng lao động, phiếu lương... mà không cần
-- đăng nhập vào hệ thống.
--
-- Sau khi chạy file này:
-- - File cũ (đã lưu public URL đầy đủ trong DB) vẫn xem được bình thường
--   (frontend tự nhận diện qua resolveFileUrl() trong /js/supabase.js).
-- - File mới upload từ nay chỉ lưu PATH vào DB, xem qua signed URL có hạn.
-- =====================================================================

-- Nếu bucket "attachments" chưa tồn tại, tạo mới ở chế độ private luôn.
-- Nếu đã tồn tại (đang public), câu update bên dưới sẽ chuyển sang private.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do update set public = false;

-- Dọn policy cũ nếu có (phòng trường hợp Dashboard đã tạo sẵn policy mặc định
-- kiểu "public read" khi bật Public bucket trước đây).
drop policy if exists "Public Access" on storage.objects;
drop policy if exists attachments_authenticated_read on storage.objects;
drop policy if exists attachments_authenticated_upload on storage.objects;
drop policy if exists attachments_authenticated_update on storage.objects;
drop policy if exists attachments_authenticated_delete on storage.objects;

-- Cho phép người dùng ĐÃ ĐĂNG NHẬP đọc/ghi file trong bucket "attachments".
-- Đây là mức bảo vệ "phải có tài khoản hợp lệ trong hệ thống mới xin được
-- signed URL" — việc đúng người có được xem đúng file cụ thể hay không vẫn
-- do RLS ở bảng nghiệp vụ (archive_files, leave_requests, contracts...)
-- quyết định TRƯỚC KHI người dùng biết đến path đó (họ chỉ thấy path khi
-- SELECT được dòng dữ liệu tương ứng).
create policy attachments_authenticated_read on storage.objects for select
  to authenticated using (bucket_id = 'attachments');

create policy attachments_authenticated_upload on storage.objects for insert
  to authenticated with check (bucket_id = 'attachments');

create policy attachments_authenticated_update on storage.objects for update
  to authenticated using (bucket_id = 'attachments');

create policy attachments_authenticated_delete on storage.objects for delete
  to authenticated using (bucket_id = 'attachments');

-- LƯU Ý NÂNG CAO (không bắt buộc để go-live, làm sau nếu cần chặt hơn):
-- Policy trên cho phép MỌI nhân viên đăng nhập đọc được MỌI file trong bucket
-- nếu họ đoán đúng path (path random theo Date.now() + tên file nên khó đoán,
-- nhưng không phải bất khả thi). Muốn chặt hơn nữa, có thể thêm điều kiện
-- theo prefix path, ví dụ chỉ HR đọc được path bắt đầu bằng 'archive/HR/':
--
--   create policy attachments_hr_only on storage.objects for select
--     to authenticated using (
--       bucket_id = 'attachments' and (
--         name not like 'archive/HR/%'
--         or current_department_id() = (select id from departments where code='HR')
--         or is_executive_or_tech()
--       )
--     );
--
-- Cân nhắc độ phức tạp thêm này so với lợi ích thực tế trước khi áp dụng.
