# ERP AIS — Database Schema (Supabase / PostgreSQL)

Thiết kế nền tảng dữ liệu cho toàn bộ hệ thống ERP AIS (2 phân hệ ALOHA/iLingo, 8 trung tâm, 8 phòng ban, workflow ký số nhiều cấp). Tài liệu này đã viết lại toàn bộ sau đợt rà soát bảo mật + hoàn thiện theo đề bài — phản ánh đúng cấu trúc **13 file migration** hiện tại.

---

## 1. Thứ tự chạy migration (BẮT BUỘC đúng thứ tự)

| # | File | Nội dung |
|---|---|---|
| 1 | `01_core_schema.sql` | Phân hệ, trung tâm, phòng ban, chức vụ, vai trò, nhân viên |
| 2 | `02_academic_schema.sql` | Chương trình học, lớp, học viên, giáo viên, lịch trực/lịch tuần, CRM tư vấn |
| 3 | `03_hr_schema.sql` | Biểu mẫu, hợp đồng lao động, ngày phép, đơn nghỉ phép, đơn công tác |
| 4 | `04_accounting_schema.sql` | Thanh toán, tạm ứng, công nợ, dòng tiền, lương, phân việc |
| 5 | `05_mkt_facilities_schema.sql` | Yêu cầu truyền thông, trình sự kiện, tài khoản nội bộ, yêu cầu CSVC, mua sắm, kiểm kê tài sản |
| 6 | `06_common_modules_schema.sql` | Đề xuất nội bộ, kho lưu trữ, ký số (log), thông báo, lịch họp, log hoạt động |
| 7 | `07_id_generation.sql` | Hàm sinh mã `AIS-0001` và `Mã-yyyy-mm-000001` + trigger tự gán |
| 8 | `08_rls_policies.sql` | Hàm helper phân quyền + RLS bản đầu (nhiều lỗ hổng — đã vá ở file 11) |
| 9 | `09_seed_data.sql` | Dữ liệu nền: phân hệ, trung tâm, phòng ban, chức vụ, vai trò, chương trình học, biểu mẫu |
| 10 | `supabase_migrations_10_additional_rls.sql` | Bổ sung UPDATE cho các phiếu ký nhiều cấp, RLS cho `leave_balances`/`class_attendance`/`student_grades`/`employee_documents`/`meeting_participants`/`payroll`/`receivables`/`cash_flow_entries` |
| 11 | `supabase_migrations_11_security_fixes.sql` | **Vá bảo mật** — xem mục 3 |
| 12 | `supabase_migrations_12_spec_completion.sql` | **Hoàn thiện theo đề bài** — xem mục 4 |
| 13 | `supabase_migrations_13_private_storage.sql` | Chuyển bucket `attachments` sang Private + RLS Storage |

**Trước khi chạy file 12**, phải set khoá mã hoá dùng cho tài khoản nội bộ (mục 5):
```sql
alter database postgres set app.settings.mkt_secret_key = 'CHUOI-BI-MAT-DAI-NGAU-NHIEN-KHAC-NHAU-MOI-MOI-TRUONG';
```

Sau file 13, kiểm tra Dashboard → Storage → bucket `attachments` phải hiện **Private**.

## 2. Logic sinh mã tự động

- **Nhân viên**: sequence toàn cục `employee_code_seq` → `AIS-0001`, `AIS-0002`... (không reset).
- **Phiếu**: bảng đếm `document_code_counters(prefix, year, month)` → `{Mã}-{yyyy}-{mm}-000001`, reset `000001` mỗi tháng theo từng prefix (`HR`, `ACC1`, `ACC2`, `MKT`, `FAC`, `DX`).
- Cả 2 hàm `generate_employee_code()` và `generate_document_code()` đã được đổi sang **`SECURITY DEFINER`** ở file 11 — bắt buộc, vì bảng `document_code_counters` đã bị khoá RLS chỉ cho TECH ở cùng file; nếu không đổi, mọi nhân viên khác sẽ **không insert được bất kỳ phiếu nào** (trigger chạy với quyền người gọi, bị RLS chặn ngay bước sinh mã).

## 3. `supabase_migrations_11_security_fixes.sql` — vá gì

| Vấn đề gốc | Cách vá |
|---|---|
| `employees_select_all using (true)` — lộ PII (CCCD, SĐT, địa chỉ...) cho cả người chưa đăng nhập | Giới hạn `to authenticated` |
| `employees_update_self` không giới hạn cột — tự nâng quyền lên EXECUTIVE/TECH | Trigger `prevent_self_privilege_escalation()` chặn tự đổi `role_id/department_id/center_id/status/employee_code/temp_password_flag` trừ khi là HR quản trị hoặc Executive/Tech |
| `contracts_insert with check (true)` — ai cũng chèn được hợp đồng cho người khác | Giới hạn `employee_id = self` hoặc HR dept_head/deputy hoặc exec/tech |
| Policy UPDATE của `contracts/payment_requests/advance_requests/event_proposals/purchase_requests` không có `with check` riêng — tự duyệt được phiếu của chính mình | Trigger `enforce_workflow_transition()` — state machine kiểm tra đúng người ở đúng bước mới được đổi `status` |
| `leave_requests`/`business_trips` thiếu hẳn policy UPDATE — nút "Duyệt" không làm gì cả | Thêm `leave_update`/`trips_update` |
| Trừ ngày phép không atomic (2 request rời rạc ở frontend) | RPC `approve_leave_request(p_leave_id)` — 1 transaction |
| Đếm thông báo chưa đọc sai công thức (trừ 2 count rời rạc) | RPC `unread_notification_count()` |
| `signature_logs`, `work_schedules`, `center_duty_schedules`, `teacher_weekly_schedules`, `facility_assets`, `document_templates`, `document_code_counters` — hoàn toàn chưa bật RLS (mở toang) | Bật RLS + policy đúng vai trò cho từng bảng |
| `internal_accounts` — bật RLS nhưng 0 policy (bị chặn hoàn toàn) | Thêm policy select/write cho MKT + exec/tech |
| Thiếu index trên các cột hay dùng để lọc/join trong RLS | Thêm ~15 index |
| Cộng ngày phép hằng tháng — đề bài yêu cầu nhưng chưa có cơ chế | Hàm `accrue_monthly_leave()` — cần bật `pg_cron` và lên lịch `select cron.schedule(...)` |

## 4. `supabase_migrations_12_spec_completion.sql` — hoàn thiện gì

- Thu hẹp lại RLS `center_duty_schedules`/`teacher_weekly_schedules`/`classes`/`students` cho đúng danh sách vai trò nêu trong đề bài (bản file 11 tạm thời cho phép rộng hơn cần thiết).
- Bảng mới `mkt_ad_expenses` (báo cáo chi phí Digital Marketing — đề bài yêu cầu nhưng schema gốc chưa có).
- RPC `set_internal_account_secret()` / `reveal_internal_account_secret()` — mã hoá `internal_accounts.secret_encrypted` bằng `pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`), không lưu plaintext.

## 5. `supabase_migrations_13_private_storage.sql` — Storage

Chuyển bucket `attachments` từ Public sang Private, thêm RLS cho `storage.objects`:
- `to authenticated` mới được đọc/ghi (không phải public tuyệt đối).
- Frontend từ nay lưu **path** vào các cột `*_url` (không lưu public URL), và xin **signed URL có hạn** ngay lúc cần xem (xem `resolveFileUrl()` trong `app/js/supabase.js`).
- Có ghi chú sẵn trong file SQL cho phương án chặt hơn (giới hạn theo prefix path/phòng ban) nếu cần nâng cấp sau.

## 6. Workflow chung: Draft → Submitted → Approved 1 → Approved 2 → Archived

Enum `workflow_status` dùng chung cho: `contracts`, `leave_requests`, `business_trips`, `payment_requests`, `advance_requests`, `event_proposals`, `purchase_requests`, `internal_proposals`. Mỗi bảng có cột `*_signed_at`/`*_signed_by` riêng theo đúng thứ tự người ký.

**Quan trọng:** từ file 11, việc chuyển trạng thái **không còn chỉ dựa vào frontend** — trigger `enforce_workflow_transition()` (áp dụng cho 5 bảng phiếu chính) kiểm tra đúng người + đúng bước mới cho phép đổi `status`, kể cả khi ai đó gọi thẳng API bằng DevTools thay vì qua giao diện.

## 7. Ma trận phân quyền cốt lõi (áp dụng qua RLS + trigger)

| Vai trò (`system_roles.code`) | Phạm vi |
|---|---|
| `TECH` | Toàn quyền hệ thống + duy nhất xem `activity_logs` |
| `EXECUTIVE` | Xem/duyệt cấp 2 mọi phòng ban, mọi trung tâm |
| `DEPT_HEAD` / `DEPT_DEPUTY` | Duyệt cấp 1, quản lý dữ liệu phòng ban mình, ký số hồ sơ phòng ban |
| `STAFF` | Chỉ thấy/thao tác dữ liệu của chính mình (và không tự nâng quyền/tự duyệt — xem mục 3) |
| `CENTER_MANAGER` | Dữ liệu học vụ trong phạm vi trung tâm mình quản lý |
| `TEACHER` | Lớp phụ trách, điểm danh, bảng điểm của lớp mình |
| `CONSULTANT` | Hồ sơ khách hàng do mình phụ trách + xem theo trung tâm |

## 8. Kho lưu trữ hệ thống

`archive_files` là metadata tập trung, phân loại bằng `category` (enum `doc_category`) + `department_id` + `year` + `month` + tuỳ chọn `center_id`. File PDF thật lưu ở Supabase Storage (path, không phải URL — xem mục 5), `file_url` trỏ tới path đó. Phòng ban khác truy cập bị RLS chặn ở tầng DB; tầng UI hiển thị "bạn không có quyền thực hiện thao tác".

Cột `related_table = 'free_sign'` dùng để đánh dấu các file được lưu qua tính năng "Ký số hồ sơ tự do" (`app/js/freeSign.js`) — phân biệt với file gắn theo phiếu có sẵn (`related_table = 'contracts'`, `'payment_requests'`...).

## 9. Ký số PDF (client-side, PDF.js + pdf-lib)

- `employees.signature_url`: **path** (không phải public URL) trỏ tới ảnh chữ ký PNG trong bucket private, dùng lại cho mọi lần ký.
- `document_templates.field_map` (jsonb): toạ độ/loại field trên từng trang PDF mẫu — hiện chưa được dùng để tự động định vị trường (người dùng tự đặt vị trí thủ công mỗi lần), có thể nâng cấp sau.
- `signature_logs`: log từng lần ký (cột thật là `employee_id`, không phải `signed_by`) — bao gồm cả lượt "ký tự do". Chỉ INSERT được (append-only), không ai ngoài TECH được UPDATE/DELETE — bảo toàn giá trị truy vết.

## 10. Lịch họp / Google Calendar

Bảng `meetings` hỗ trợ `kind='offline'` (dùng `location`, nay có Google Places Autocomplete ở frontend) và `kind='online'` (lưu `google_meet_link` + `google_event_id`, tích hợp Google Calendar API thật).

## 11. Đơn công tác / Google Maps

`business_trips.distance_km` từ nay có thể tự tính qua Google Maps Distance Matrix (qua Maps JavaScript SDK ở frontend, xem `app/js/googleMaps.js`) thay vì chỉ nhập tay.

## 12. Những điểm cần lưu ý khi tự viết thêm migration mới

- Bất kỳ hàm nào được gọi từ **trigger** trên bảng có RLS mà cần ghi vào 1 bảng KHÁC (ví dụ bảng đếm mã, bảng tổng hợp...) đều phải cân nhắc `SECURITY DEFINER` — bài học từ lỗi `document_code_counters` ở mục 2.
- Luôn đối chiếu **đúng tên cột thật** trong file schema gốc trước khi viết policy mới — bài học từ lỗi `signature_logs.signed_by` (cột thật là `employee_id`) từng lọt vào bản vá đầu tiên của file 11.
- Khi thêm bảng lưu file mới, nhớ **lưu path, không lưu public URL** (bucket đã private từ file 13) và dùng `resolveFileUrl()`/`openFile()` có sẵn trong `app/js/supabase.js` để hiển thị.

---

Chi tiết đầy đủ từng lỗi phát hiện + lý do vá nằm trong `AUDIT_ERP_AIS.md` và `GAP_ANALYSIS.md` (ở thư mục gốc dự án khi bàn giao).
