# ERP AIS — Database Schema (Supabase / PostgreSQL)

Đã viết lại để phản ánh đúng **15 file migration** hiện tại (từ 01 đến file 15).

---

## 1. Thứ tự chạy migration

| # | File | Nội dung chính |
|---|---|---|
| 1-9 | `01_core_schema.sql` → `09_seed_data.sql` | Schema gốc + dữ liệu nền (phân hệ, trung tâm, phòng ban, chương trình học...) |
| 10 | `supabase_migrations_10_additional_rls.sql` | Bổ sung UPDATE cho các phiếu ký nhiều cấp, RLS còn thiếu ở phase 1 |
| 11 | `supabase_migrations_11_security_fixes.sql` | Vá lỗ hổng RLS nghiêm trọng (leo quyền, tự duyệt, lộ PII), state-machine duyệt phiếu, RPC trừ phép/atomic |
| 12 | `supabase_migrations_12_spec_completion.sql` | Thu hẹp RLS đúng phạm vi đề bài, bảng `mkt_ad_expenses`, mã hoá tài khoản nội bộ |
| 13 | `supabase_migrations_13_private_storage.sql` | Chuyển bucket `attachments` Public → Private + RLS Storage |
| 14 | `supabase_migrations_14_new_features.sql` | Giờ làm việc cụ thể, Ban chuyên môn/giáo viên linh hoạt, **thu học phí** (`tuition_payments`, tự log vào `cash_flow_entries`), **xin thêm quyền hạn** (`permission_requests`, `granted_permissions`) |
| 15 | `supabase_migrations_15_new_requests.sql` | Kế toán xem được nghỉ phép đã duyệt (tính lương tự động), bảng `push_subscriptions` cho Web Push |
| 16 | `supabase_migrations_16_permission_enforcement.sql` | Nối "xin thêm quyền hạn" xuống RLS thật cho nhóm bảng báo cáo/quản trị từng phòng ban; **phát hiện và vá thêm**: bảng `positions` trước giờ không hề có RLS |

**Trước khi chạy file 12**, set khoá mã hoá tài khoản nội bộ:
```sql
alter database postgres set app.settings.mkt_secret_key = 'CHUOI-BI-MAT-DAI-NGAU-NHIEN';
```

## 2. Điểm quan trọng cần nhớ khi viết thêm migration (rút ra từ các lỗi từng gặp)

1. **Trigger ghi vào bảng khác cần `SECURITY DEFINER`** nếu bảng đích có RLS — bài học từ lỗi khoá `document_code_counters` khiến toàn bộ sinh mã phiếu bị vỡ.
2. **Kiểm tra đúng tên cột thật** trước khi viết policy — bài học từ `signature_logs.signed_by` (cột thật là `employee_id`).
3. **Trigger chặn tự sửa hồ sơ cần xét đúng CHIỀU thay đổi** — bài học từ lỗi chặn cả `temp_password_flag: true→false` (thao tác hợp lệ khi đổi mật khẩu lần đầu) lẫn `false→true` (mới cần chặn), khiến hệ thống bắt đổi mật khẩu lặp vô hạn.
4. **File đính kèm luôn lưu PATH, không lưu public URL** (bucket private từ file 13) — dùng `resolveFileUrl()`/`uploadPrivateFile()` có sẵn trong `app/js/supabase.js`.
5. **Mở rộng quyền xem dữ liệu cho 1 phòng ban mới cần dùng tính năng liên phòng ban** phải kiểm tra kỹ RLS hiện tại — ví dụ ACC cần xem `leave_requests` để tính lương nhưng RLS gốc chỉ cho HR/chính chủ xem (đã vá ở file 15).

## 3. Bảng mới thêm ở file 14-15

| Bảng | Mục đích |
|---|---|
| `tuition_payments` | Thu học phí (tiền mặt/chuyển khoản), tự động tạo 1 dòng `cash_flow_entries` tương ứng qua trigger `log_tuition_to_cash_flow()` — mỗi giao dịch có log riêng, không cho sửa/xoá trực tiếp (chỉ TECH), muốn điều chỉnh phải tạo giao dịch mới |
| `permission_requests` / `granted_permissions` | Xin thêm quyền hạn theo module (= href trang trong `navConfig.js`) — duyệt xong tự ghi vào `granted_permissions` qua trigger `apply_approved_permission()` |
| `push_subscriptions` | Đăng ký nhận Web Push theo từng thiết bị (endpoint + khoá mã hoá), Edge Function `send-push` đọc bảng này bằng service_role (bỏ qua RLS) |

Cột mới trên bảng cũ: `work_schedules.start_time/end_time` (thay `shift` text), `employees.is_academic_board`, `employees.can_teach`, `students.monthly_fee`, `document_templates.field_map` (giờ đã thực sự được dùng — xem mục 6 `APP_README.md`).

## 4. Workflow & phân quyền cốt lõi

Không đổi so với trước — enum `workflow_status` (draft→submitted→approved_1→approved_2→archived) dùng chung cho các phiếu ký nhiều cấp, chuyển trạng thái được `enforce_workflow_transition()` kiểm soát ở tầng DB (không chỉ dựa vào frontend). Ma trận vai trò (`TECH`/`EXECUTIVE`/`DEPT_HEAD`/`DEPT_DEPUTY`/`STAFF`/`CENTER_MANAGER`/`TEACHER`/`CONSULTANT`) giữ nguyên.

**Lưu ý mới:** `employees.can_teach` là cờ độc lập cho phép nhân sự khối văn phòng (department khác EDU) vẫn được tính `isTeacher = true` ở `shell.js` mà không cần đổi `department_id`/`position_id` chính — tương tự `is_academic_board` chỉ là 1 tick thêm, không phải đổi phòng ban.

## 5. Thu học phí — luồng dữ liệu

```
edu/tuition.html (Quản lý trung tâm thu tiền)
  → insert tuition_payments
    → trigger log_tuition_to_cash_flow() TỰ ĐỘNG insert cash_flow_entries (category='tuition')
      → acc/reports.html (Kế toán) thấy ngay trong biểu đồ dòng tiền, không cần thao tác gì thêm
```
Cố tình **không cho sửa/xoá** `tuition_payments` (RLS chỉ TECH mới update/delete) — thu nhầm phải tạo giao dịch điều chỉnh mới, đảm bảo luôn có đủ log cho kế toán đối chiếu, đúng yêu cầu "mỗi dòng tiền mới có 1 log cụ thể".

## 6. Xin thêm quyền hạn — luồng dữ liệu

```
permission-requests.html (trưởng/phó phòng chọn nhân sự + chọn trang cần thêm quyền)
  → insert permission_requests (status='pending')
    → Ban điều hành duyệt (update status='approved')
      → trigger apply_approved_permission() TỰ ĐỘNG insert granted_permissions
        → shell.js nạp granted_permissions vào profile.grantedModules lúc đăng nhập
          → navConfig.js mở đúng menu tương ứng (sidebar + App Hub)
```
**Cập nhật (file 16):** đã nối `granted_permissions` xuống RLS thật cho nhóm bảng: `payroll`, `receivables`, `cash_flow_entries`, `mkt_ad_expenses`, `internal_accounts` (+ 2 RPC mã hoá), `facility_assets`, `work_schedules`, `positions` — thông qua hàm dùng chung `has_module_permission(module_key)`. Cấp quyền cho các trang này giờ mở luôn dữ liệu thật, không chỉ menu.

**Vẫn còn giới hạn:** danh sách trên KHÔNG bao phủ mọi trang trong hệ thống — chỉ nhóm "báo cáo/thống kê/quản trị riêng phòng ban" vì đây là nhóm hợp lý nhất để cấp quyền chéo trong thực tế. Muốn mở thêm cho 1 trang khác chưa có trong danh sách, lặp lại đúng mẫu `or has_module_permission('/duong-dan.html')` vào policy của (các) bảng mà trang đó dùng.

---

Chi tiết lịch sử các lỗi đã phát hiện + cách vá nằm trong `AUDIT_ERP_AIS.md` và `GAP_ANALYSIS.md`.
