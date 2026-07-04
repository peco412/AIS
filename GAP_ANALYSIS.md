# So sánh Đề bài gốc ↔ Hiện trạng hệ thống ERP AIS

> **Cập nhật:** các mục ở bảng "Tổng hợp việc còn thiếu" bên dưới đã được xây trong lượt tiếp theo — xem mục **"Đã hoàn thành thêm"** ở cuối file. Phần thân báo cáo bên dưới giữ nguyên như bản gốc để đối chiếu.

Đối chiếu từng mục trong đề bài bạn vừa gửi với schema (`01`→`09`, migration `10`) và các trang `app/*.html` đã có. Ký hiệu: ✅ Đã có & đúng · ⚠️ Có nhưng thiếu/sai · ❌ Chưa có.

## 1. Nền tảng (phân hệ, trung tâm, phòng ban, chức vụ, vai trò, chương trình học)
✅ Khớp chính xác với đề bài: 2 phân hệ, 8 trung tâm đúng tên/đúng phân hệ, 8 phòng ban, đầy đủ chức vụ theo từng phòng, 10 chương trình học + cấp độ + cấp độ con đúng cấu trúc phân cấp (đối chiếu `09_seed_data.sql`).

## 2. Hạ tầng bảo mật (RLS) — mục đề bài yêu cầu rõ "đảm bảo bảo mật"
Đây là phần lệch nhiều nhất so với yêu cầu "đảm bảo bảo mật, chạy thật không testing". Ngoài 5 lỗi mình đã báo ở lượt trước (PII lộ công khai, tự nâng quyền, tự duyệt phiếu tài chính, `contracts_insert` mở toang, thiếu policy duyệt nghỉ phép), rà thêm lần này phát hiện thêm:

| Bảng | Tình trạng RLS | Rủi ro |
|---|---|---|
| `signature_logs` (log ký số — chính là bằng chứng pháp lý ai ký gì) | ❌ Chưa bật RLS | Bất kỳ ai có tài khoản đều đọc/sửa/xoá được log ký số → mất khả năng truy vết, có thể xoá dấu vết. |
| `work_schedules`, `center_duty_schedules`, `teacher_weekly_schedules` | ❌ Chưa bật RLS | Ai cũng sửa được lịch làm việc/lịch trực/lịch giáo viên của người khác. |
| `facility_assets`, `document_templates`, `document_code_counters` | ❌ Chưa bật RLS | Ai cũng sửa được biểu mẫu gốc (04 biểu mẫu ký số) hoặc bộ đếm mã phiếu → có thể làm sai lệch vị trí chữ ký hoặc trùng mã phiếu. |
| `internal_accounts` | ⚠️ Đã bật RLS nhưng **0 policy** | Bị chặn hoàn toàn — trang "Thông tin tài khoản nội bộ" (phòng Truyền thông) không thể hoạt động. |

→ Đã gộp fix cho tất cả các bảng trên vào file `supabase_migrations_11_security_fixes.sql` đính kèm.

## 3. Nghiệp vụ theo module

### Thông báo
✅ 4 phạm vi (hệ thống/trung tâm/phòng ban/cá nhân) đúng đối tượng được ban hành (trưởng/phó phòng, BĐH, kỹ thuật) — đã build ở `exec/broadcast.html`, xem ở `notifications.html`.

### Hồ sơ cá nhân
✅ Đủ mục theo đề bài (`profile.html`): thông tin chung, thông tin hệ thống, chữ ký số, bằng cấp/chứng chỉ/CV nhiều file, đổi mật khẩu.

### Lịch họp
✅ Offline (`kind='offline'`) + Online tích hợp Google Calendar (`kind='online'`, tự sinh Google Meet link) — cả 2 hướng đề bài đều có trong `meetings.html` + `googleCalendar.js`.

### Đề xuất nội bộ
✅ Đúng luồng duyệt 2 cấp (trưởng phòng → BĐH), ký PDF kéo-thả-lưu-đè đúng path cố định, tự gửi thông báo + lưu kho khi duyệt xong cấp 2.

### Kho lưu trữ hệ thống
✅ Chia đúng theo phòng ban × năm/tháng(×trung tâm với ACC/MKT/FAC/EDU theo đề bài), có tab Biểu mẫu, chặn phòng ban không có quyền bằng thông báo ở UI (⚠️ nhưng bảo mật thật phải là RLS — đã đúng theo đề bài "khoá thật ở tầng RLS, UI chỉ hiển thị thông báo").

### Phòng Nhân sự
- ✅ Danh sách nhân viên, Hợp đồng lao động (ký 3 cấp qua `pdfEditor.js`), Đơn nghỉ phép, Đơn công tác, Ngày phép (`leave-balances.html`) — đều đã có trang.
- ⚠️ **Cộng dồn 1 ngày phép/tháng tự động** — đề bài: *"mặc định mỗi tháng sẽ cộng thêm 1 ngày nghỉ phép cho nhân sự"*. Hiện **không có** cron job / trigger nào làm việc này — bảng `leave_balances` chỉ được ghi tay qua `hr/leave-balances.html`. Cần thêm 1 scheduled function chạy đầu mỗi tháng.
- ❌ **Phân lịch làm việc** (`hr/work-schedule.html`) — bảng `work_schedules` đã có sẵn trong schema nhưng chưa có trang, đúng như README tự ghi nhận.
- ❌ **Lịch trực các trung tâm** (điền tự động từ Phân lịch trực trung tâm) — bảng `center_duty_schedules` có sẵn, chưa có trang.
- ⚠️ Đơn công tác: đề bài yêu cầu *"quãng đường tự động đo khi nhập đúng vị trí thông qua map"* — hiện đang nhập tay (README tự ghi nhận, chưa tích hợp Google Maps Distance API).

### Phòng Kế toán
- ✅ Phiếu đề nghị thanh toán (đúng luồng: người điền ký → đính kèm chứng từ gốc → kế toán ký → BĐH ký → lưu kho cùng chứng từ gốc), Phiếu tạm ứng, Bảng lương, Báo cáo/biểu đồ (`acc/reports.html` dùng Chart.js), Công nợ (`receivables`), Dòng tiền (`cash_flow_entries`), Phân việc xử lý yêu cầu (`acc/tasks.html`).
- ⚠️ Ký số hồ sơ dùng chung "từ Đề xuất nội bộ hoặc có thể tự nhập file" — phần "tự nhập file bất kỳ rồi ký" (không gắn với phiếu có sẵn) mình không thấy trang riêng cho việc này ở kế toán/nhân sự/truyền thông/CSVC/học vụ, ngoài `exec/sign.html` (chỉ tổng hợp phiếu có sẵn, không có chức năng tự tải 1 file PDF bất kỳ lên để ký như đề bài mô tả).

### Phòng Truyền thông
- ✅ Yêu cầu truyền thông, Trình sự kiện (đúng luồng duyệt 2 cấp).
- ❌ **Hệ thống báo cáo, biểu đồ chi phí digital marketing** — chưa có trang (khác với báo cáo tài chính của kế toán).
- ❌ **Thông tin tài khoản nội bộ** — bảng `internal_accounts` có schema nhưng đang bị RLS chặn hoàn toàn (mục 2) và chưa có trang `mkt/accounts.html`.

### Phòng Cơ sở vật chất
- ✅ Yêu cầu CSVC, Phiếu đề nghị mua sắm (đúng luồng duyệt).
- ❌ **Hệ thống thống kê** (`fac/stats.html`) — bảng `facility_assets` có sẵn, chưa có trang.

### Quản lý trung tâm / Học vụ
- ✅ Danh sách lớp, danh sách học viên, Bảng điểm (giáo viên nhập → quản lý trung tâm xem tổng hợp).
- ❌ **Tổng quan thống kê toàn hệ thống** (BĐH/trưởng phòng xem, filter theo trung tâm) — chưa có trang riêng.
- ❌ **Tổng quan thống kê trung tâm** (`edu/center-overview.html`) — chưa có.
- ❌ **Phân lịch trực trung tâm**, **Phân lịch tuần giáo viên** (`edu/duty-schedule.html`, `edu/teacher-schedule.html`) — bảng có sẵn, thiếu trang + RLS.
- ❌ **Danh sách giáo viên** riêng (`edu/teachers.html`) — hiện chỉ có giáo viên gắn qua field `classes.teacher_id`, chưa có trang quản lý danh sách/thông tin riêng cho vai trò giáo viên.
- ❌ **Phân lớp học viên tự động gợi ý** theo bảng điểm cũ (đề bài: *"dựa vào bảng điểm học viên có ở trạng thái tốt nghiệp hay không để tự động gợi ý sắp lớp"*) — logic gợi ý chưa được cài, kể cả ở tầng DB lẫn UI.

### Giáo viên
- ✅ Lớp phụ trách, Điểm danh, Bảng điểm.
- ❌ **Lịch giảng dạy dạng calendar** (tự điền từ Phân lịch tuần giáo viên) — phụ thuộc module lịch tuần giáo viên ở trên, hiện chưa có cả 2.
- ❌ **Thông tin liên lạc học viên theo lớp** — trang riêng cho giáo viên xem SĐT phụ huynh/học viên nhanh (khác trang `edu/students.html` của quản lý trung tâm) — chưa có, dù dữ liệu đã có sẵn trong bảng `students`.

### Nhân viên tư vấn
✅ CRM `consultant/leads.html` đúng mẫu + thống kê nhanh.

### Ban điều hành
- ✅ Ký số hồ sơ tổng hợp (`exec/sign.html`), Ban hành thông báo (`exec/broadcast.html`).
- ❌ **Lệnh yêu cầu từ Ban điều hành** (`exec/orders.html`) — đề bài: BĐH tự tạo Phiếu đề nghị thanh toán / Yêu cầu truyền thông / Yêu cầu CSVC thay vì phải dùng đúng trang gốc của từng phòng. Chưa có trang, README cũng tự nhận.
- ❌ **Kho lưu trữ hồ sơ điều hành riêng** (tự upload PDF, tách khỏi kho chung 8 phòng ban) — hiện tạm dùng `archive.html` tab "BDH" nhưng chưa có bảng/luồng "tự upload file PDF" riêng như đề bài mô tả cho BĐH.

---

## Tổng hợp việc còn thiếu (ưu tiên theo mức ảnh hưởng)

| Ưu tiên | Việc cần làm | Loại |
|---|---|---|
| 🔴 | Vá toàn bộ lỗ hổng RLS ở mục 2 (đã có file SQL đính kèm) | Bảo mật |
| 🔴 | Cộng dồn ngày phép tự động mỗi tháng | Logic nghiệp vụ đúng đề bài |
| 🟠 | Phân lịch làm việc + Lịch trực trung tâm + Phân lịch tuần giáo viên (3 trang liên quan nhau, nên làm cùng đợt) | Module thiếu |
| 🟠 | Lệnh yêu cầu Ban điều hành (`exec/orders.html`) | Module thiếu |
| 🟡 | Danh sách giáo viên riêng, Thông tin liên lạc học viên (giáo viên) | Module thiếu |
| 🟡 | Tổng quan thống kê toàn hệ thống + theo trung tâm | Module thiếu |
| 🟡 | Thông tin tài khoản nội bộ (MKT) + báo cáo chi phí digital marketing | Module thiếu |
| 🟡 | Hệ thống thống kê CSVC | Module thiếu |
| 🟢 | Phân lớp học viên tự động gợi ý theo bảng điểm cũ | Logic nâng cao |
| 🟢 | Kho lưu trữ hồ sơ điều hành riêng biệt | Module thiếu |
| 🟢 | Đo quãng đường tự động (Google Maps) cho Đơn công tác | Tích hợp API |
| 🟢 | Trang "tự nhập file PDF bất kỳ rồi ký" độc lập cho HR/ACC/MKT/FAC (ngoài luồng có sẵn) | Module thiếu |

File SQL vá lỗi bảo mật đính kèm bên dưới — nên chạy **ngay**, không phụ thuộc việc build thêm trang mới. Các module còn thiếu ở trên, mình đề xuất làm theo từng đợt (giống cách dự án đã làm theo "giai đoạn") thay vì dồn hết vào 1 lần, để dễ kiểm tra RLS đúng cho từng bảng mới. Bạn muốn bắt đầu đợt tiếp theo với nhóm nào trong bảng trên?

---

## Đã hoàn thành thêm (lượt tiếp theo)

### Lỗi phát hiện thêm & đã sửa
- **`acc/payment-requests.js`, `acc/advance-requests.js`, `acc/payroll.js`, `acc/reports.js` import sai đường dẫn** (`/js/supabaseClient.js` — file không tồn tại, file thật là `/js/supabase.js`). Cả 4 trang phòng Kế toán **hoàn toàn không chạy được** (module 404 ngay khi tải trang). Đã sửa cả 4 file.
- `teacher/classes.js`, `profile.js` avatar, thiếu escape dữ liệu người dùng ở vài chỗ — đã bổ sung `esc()`.

### Module đã xây mới (file HTML + JS đầy đủ, nối RLS đúng theo migration 11 + 12)
| Trang | Chức năng |
|---|---|
| `hr/work-schedule.html` | Phân lịch làm việc nhân sự hành chính (trừ EDU), mọi trung tâm |
| `edu/duty-schedule.html` | Phân lịch trực trung tâm — quản lý trung tâm xếp, HR/MKT/BĐH xem |
| `edu/teacher-schedule.html` | Phân lịch tuần giáo viên, có xử lý dạy thay |
| `teacher/schedule.html` | Giáo viên xem lịch giảng dạy tuần của chính mình (tự điền từ trên) |
| `teacher/classes.js` (cập nhật) | Thêm nút xem "Liên lạc PH" theo từng lớp |
| `edu/teachers.html` | Danh sách giáo viên (is_teacher_eligible, gồm cả nhân sự 2 đầu việc) |
| `edu/center-overview.html` | Dùng chung cho "Tổng quan trung tâm" và "Tổng quan toàn hệ thống + filter trung tâm" |
| `edu/class-assignment.html` | Phân lớp học viên — auto-suggest lớp kế tiếp dựa vào `student_grades.final_status='graduated'` |
| `exec/orders.html` | Lệnh yêu cầu Ban điều hành — tạo nhanh 3 loại phiếu (thanh toán/truyền thông/CSVC) |
| `exec/archive.html` | Kho lưu trữ hồ sơ điều hành riêng (tự tải PDF, scope phòng BĐH) |
| `mkt/accounts.html` | Thông tin tài khoản nội bộ — mật khẩu mã hoá qua RPC (`pgcrypto`), không lưu plaintext |
| `mkt/expense-reports.html` | Báo cáo chi phí Digital Marketing (bảng mới `mkt_ad_expenses`, biểu đồ Chart.js) |
| `fac/stats.html` | Hệ thống thống kê CSVC (CRUD `facility_assets` + số liệu theo tình trạng) |
| `consultant/stats.html` | Thống kê hồ sơ khách hàng theo từng tư vấn viên trong trung tâm |

### SQL bổ sung: `supabase_migrations_12_spec_completion.sql`
Chạy sau file 11. Gồm: thu hẹp lại RLS `center_duty_schedules`/`teacher_weekly_schedules`/`classes`/`students` cho đúng đúng danh sách vai trò nêu trong đề bài (không phải "ai cùng trung tâm cũng xem/sửa được" như bản tạm ở file 11), bảng mới `mkt_ad_expenses` + RLS, 2 RPC mã hoá/giải mã `internal_accounts.secret_encrypted` bằng `pgcrypto` (**cần set `app.settings.mkt_secret_key` trước khi dùng**, xem comment đầu phần 4 trong file SQL).

### navConfig.js
- Xoá 2 link vỡ trỏ tới `acc/receivables.html` / `acc/cash-flow.html` (không tồn tại — 2 chức năng này thật ra đã nằm sẵn trong `acc/reports.html`).
- Mở rộng đúng phạm vi hiển thị cho cả nhóm "Quản lý trung tâm" (Tổng quan, Phân lịch trực, Phân lịch tuần GV, Danh sách GV/lớp/học viên, Phân lớp, Bảng điểm) theo đúng câu đề bài: "quản lý trung tâm, phòng nhân sự, phòng marketing, ban điều hành, kỹ thuật" — bản cũ chỉ cho `isCenterManager` thấy.

### Còn lại (chưa làm, mức độ nhỏ hơn, có thể làm tiếp khi cần)
- Đo quãng đường tự động bằng Google Maps Distance API cho Đơn công tác (đang nhập tay).
- Resize chữ ký/text bằng chuột trong `pdfEditor.js` (hiện chỉ kéo đổi vị trí).
- Trang "tự nhập file PDF bất kỳ rồi ký" độc lập cho từng phòng ban (khác luồng ký gắn với phiếu có sẵn) — hiện `exec/sign.html` mới chỉ tổng hợp+điều hướng, chưa có upload tự do.
- Chuyển Storage bucket `attachments` từ Public sang Private + signed URL (đã nêu ở AUDIT_ERP_AIS.md, vẫn cần làm trước khi vận hành thật).
- Rà `esc()` chống XSS cho toàn bộ ~90 file còn lại (mới áp dụng mẫu ở một số file có mức phơi nhiễm cao).
