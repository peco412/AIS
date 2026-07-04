# Checklist trước khi lên Production thật — ERP AIS

Đây là danh sách các việc **bắt buộc / rất nên làm** trước khi cho nhân viên thật dùng hệ thống, chia theo nhóm. Phần code đã làm được trong các lượt trước sẽ đánh dấu ✅, phần cần người vận hành quyết định/thao tác tay đánh dấu 🔧.

---

## 1. Chạy đúng thứ tự migration SQL

```
01_core_schema.sql
02_academic_schema.sql
03_hr_schema.sql
04_accounting_schema.sql
05_mkt_facilities_schema.sql
06_common_modules_schema.sql
07_id_generation.sql
08_rls_policies.sql
09_seed_data.sql
supabase_migrations_10_additional_rls.sql
supabase_migrations_11_security_fixes.sql
supabase_migrations_12_spec_completion.sql
supabase_migrations_13_private_storage.sql
```

**Trước khi chạy file 12**, cần set 1 config bí mật cho việc mã hoá tài khoản nội bộ:
```sql
alter database postgres set app.settings.mkt_secret_key = 'CHUOI-BI-MAT-DAI-NGAU-NHIEN-KHAC-NHAU-MOI-MOI-TRUONG';
```
(Trên Supabase Cloud: Dashboard → Database → Custom Postgres Config, hoặc dùng Supabase Vault nếu muốn quản lý khoá bài bản hơn.)

Sau khi chạy file 13, kiểm tra lại trong Dashboard → Storage → bucket `attachments` phải hiện **Private**, không còn "Public".

---

## 2. Tách môi trường Dev/Staging/Production ✅ (đã có sẵn cơ chế) 🔧 (cần bạn tạo project)

`app/js/supabase.js` đã hỗ trợ đọc `window.__ENV__` trước khi fallback về giá trị hard-code:
```js
const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || '...';
```
**Việc cần làm (không thể code thay được):**
- Tạo **2 project Supabase riêng biệt**: 1 cho staging/thử nghiệm, 1 cho production thật. Không dùng chung 1 project — nếu không, mọi thao tác test (kể cả của chính bạn) đều ghi đè dữ liệu thật.
- Ở Vercel, tạo file `app/env.js` (không commit lên git, thêm vào `.gitignore`) build lúc deploy, gán `window.__ENV__ = { SUPABASE_URL: '...', SUPABASE_ANON_KEY: '...', GOOGLE_CLIENT_ID: '...', GOOGLE_MAPS_API_KEY: '...' }`, và include script này trước `js/supabase.js` trong mọi trang HTML.
- Google Maps API key và Google OAuth Client ID: nhớ giới hạn (restrict) theo đúng domain deploy thật trong Google Cloud Console, tránh bị người khác lấy dùng ké gây phát sinh phí.

---

## 3. Bảo mật dữ liệu — đã vá, cần xác nhận lại sau khi chạy migration

Chạy thử các kịch bản sau bằng 2-3 tài khoản test có vai trò khác nhau (STAFF thường, DEPT_HEAD, EXECUTIVE) **sau khi** đã chạy hết migration 11-13:

- [ ] Tài khoản STAFF thường **không tự đổi được** `role_id`/`department_id`/`status` của chính mình (thử gọi trực tiếp qua DevTools Console: `supabase.from('employees').update({role_id: '...'}).eq('id', myId)` — phải bị RLS/trigger chặn).
- [ ] Tài khoản STAFF **không tự duyệt được** phiếu thanh toán/tạm ứng/hợp đồng của chính mình (thử update thẳng `status` qua console).
- [ ] Đơn nghỉ phép/công tác: bấm "Duyệt" ở `hr/leave-requests.html` phải đổi trạng thái thật + trừ ngày phép (RPC `approve_leave_request`).
- [ ] Mở 1 link file cũ (nếu có dữ liệu demo) và 1 file mới upload — cả 2 phải xem được (test cơ chế tương thích ngược `resolveFileUrl`).
- [ ] Đăng xuất, thử mở thẳng URL file (path) lấy được từ Network tab — phải bị từ chối vì thiếu chữ ký hợp lệ (bucket đã private).
- [ ] Test hết 4 trang Kế toán (`payment-requests`, `advance-requests`, `payroll`, `reports`) — trước đây bị vỡ hoàn toàn do sai đường dẫn import, giờ phải chạy được bình thường.

---

## 4. Sao lưu & khôi phục dữ liệu 🔧

Supabase tự động backup hằng ngày ở gói Pro trở lên (gói Free **không có** point-in-time recovery). Vì hệ thống lưu dữ liệu nhạy cảm của cả công ty (lương, hợp đồng, hồ sơ học viên có cả trẻ vị thành niên), khuyến nghị:
- Nâng gói Supabase lên **Pro** trở lên trước khi go-live thật (có backup hằng ngày + point-in-time recovery).
- Định kỳ (hàng tuần) tự `pg_dump` thêm 1 bản tải về lưu ngoài Supabase, phòng trường hợp mất quyền truy cập tài khoản Supabase.
- Với Storage (file PDF hợp đồng, chứng từ...), bật thêm sao lưu định kỳ sang nơi khác (Google Drive/S3) nếu ngân sách cho phép — Supabase Storage không có "recycle bin" mặc định, xoá nhầm là mất luôn.

## 5. Giám sát & cảnh báo lỗi 🔧

Hiện tại không có công cụ theo dõi lỗi runtime phía frontend (mọi lỗi chỉ hiện `alert()` cho đúng người dùng đó, không ai khác biết). Khuyến nghị trước khi go-live:
- Gắn 1 công cụ theo dõi lỗi miễn phí/giá rẻ cho frontend (ví dụ Sentry free tier) vào các file JS chính, ít nhất là bắt lỗi toàn cục (`window.onerror`, `unhandledrejection`).
- Bật Supabase Dashboard → Logs, theo dõi định kỳ lỗi RLS bị từ chối bất thường (dấu hiệu ai đó đang dò quyền truy cập).
- Theo dõi Database → Usage để biết trước khi hết hạn mức gói đang dùng.

## 6. Giới hạn tốc độ / chống lạm dụng (rate limiting) 🔧

- Supabase Auth mặc định đã có giới hạn tốc độ đăng nhập sai (chống brute-force mật khẩu) — kiểm tra lại cấu hình ở Dashboard → Authentication → Rate Limits, tăng nếu quá chặt gây khó cho nhân viên thật.
- Edge Function `create-employee-account` nên thêm giới hạn số lần gọi/phút nếu lo ngại bị lạm dụng tạo hàng loạt tài khoản — hiện chưa có, mức độ ưu tiên thấp vì chỉ HR/Executive gọi được (đã kiểm tra quyền trong function).

## 7. Pháp lý & quyền riêng tư — QUAN TRỌNG vì có dữ liệu học viên (có thể có trẻ vị thành niên) 🔧

Đây là hạng mục **không thể code thay**, cần người có trách nhiệm pháp lý của công ty xác nhận:
- Soạn **Chính sách bảo mật thông tin nội bộ** (ai được xem dữ liệu gì, giữ trong bao lâu, quy trình khi có yêu cầu xoá dữ liệu) — đặc biệt với dữ liệu học viên là trẻ em (`students`, `crm_leads` có ngày sinh, tên phụ huynh, SĐT).
- Xác nhận việc thu thập CCCD/CMND nhân viên (`employees.id_card_number`) tuân thủ đúng quy định pháp luật hiện hành về bảo vệ dữ liệu cá nhân tại Việt Nam (Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân) — có thể cần thêm điều khoản đồng ý thu thập dữ liệu khi tạo tài khoản nhân viên mới.
- Quy định rõ ai (chức danh gì) được cấp quyền EXECUTIVE/TECH — đây là 2 vai trò gần như toàn quyền hệ thống, càng ít người càng an toàn.

## 8. Vận hành & đào tạo người dùng 🔧

- Đổi mật khẩu tài khoản mẫu `VMTDTP / 123456` ngay khi có dữ liệu thật, hoặc xoá hẳn tài khoản này.
- Hướng dẫn nhanh cho HR về việc tạo nhân viên mới (qua Edge Function, không insert thẳng bằng SQL) để mật khẩu tạm được sinh đúng cách và tài khoản `auth.users` được tạo đồng bộ.
- Với Google Calendar & Google Maps: cần đăng nhập Google Cloud Console, bật đúng API, cấu hình OAuth consent screen ở chế độ "In production" (không phải "Testing", vì Testing giới hạn 100 người dùng thử và token hết hạn sau 7 ngày).

---

## 9. Còn lại chưa làm (mức độ nhỏ, không chặn go-live nhưng nên biết)

- Resize chữ ký/text bằng chuột trong `pdfEditor.js` — hiện chỉ kéo đổi vị trí, kích thước cố định.
- Trang "tự nhập file PDF bất kỳ rồi ký" độc lập (ngoài luồng gắn sẵn với từng loại phiếu) cho HR/ACC/MKT/FAC — hiện `exec/sign.html` chỉ tổng hợp + điều hướng.
- Google Places Autocomplete cho ô "Địa điểm" ở `meetings.html` (offline) — hiện chỉ có ở Đơn công tác.
- Rà lại toàn bộ danh sách trang trong `navConfig.js` một lần nữa sau khi có phản hồi thật từ người dùng, vì đây là danh sách được suy ra từ đề bài — có thể còn khác biệt nhỏ so với nhu cầu thực tế vận hành.

---

## Tóm tắt: thứ tự làm việc đề xuất

1. Tạo Supabase project **production** riêng (khác project demo/dev).
2. Chạy đủ 13 file migration theo đúng thứ tự ở mục 1.
3. Set `app.settings.mkt_secret_key`.
4. Cấu hình `window.__ENV__` khi deploy Vercel (không hard-code key môi trường thật vào git).
5. Kiểm tra thủ công theo checklist mục 3.
6. Nâng gói Supabase lên Pro (backup) trước khi nhập dữ liệu thật.
7. Hoàn tất mục 7 (pháp lý) trước khi thu thập dữ liệu học viên thật.
8. Go-live với 1 nhóm nhỏ trước (ví dụ 1 phòng ban) 1-2 tuần để phát hiện lỗi thực tế, rồi mới mở rộng toàn công ty.
