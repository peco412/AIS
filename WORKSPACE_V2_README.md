# AIS Workspace — phiên bản giao diện mới

Bản sao mã nguồn ERP và cổng phụ huynh; chưa triển khai lên hệ thống đang hoạt động. Tài liệu này thay thế các nhận xét UI của phiên bản trước.

## Trải nghiệm

Giao diện xanh navy, trắng ngà, điểm nhấn vàng trầm; menu bên trái theo phòng ban, tìm kiếm không dấu, trang chủ tập trung vào tác vụ. Menu thu gọn trên điện thoại. Giữ các module nhân sự, kế toán, cơ sở vật chất, marketing, đào tạo, quản lý trung tâm, kho và cổng phụ huynh hiện hữu. Quyền truy cập vẫn được kiểm tra; giao diện không thay thế RLS.

Khu thư giãn riêng có tử vi giải trí theo ngày sinh và game 2D thu thập sao. Không gửi ngày sinh lên máy chủ; điểm game lưu trên thiết bị. Game dừng khi chuyển tab.

## Bảng công và lương

Loại bỏ giao diện GPS, đơn chấm công trễ và cách tính lương bằng lượt check-in. Các URL cũ chuyển đến bảng công. Giữ dữ liệu lịch sử trong cơ sở dữ liệu; migration chặn ghi check-in GPS mới.

HR nhập công theo tháng và nhân sự: ngày làm, nghỉ hưởng lương, lễ, nghỉ không lương, vắng, nghỉ theo lịch. Ngày chưa nhập được đánh dấu riêng. Quy trình: HR lưu nháp → gửi kế toán → kế toán trả lại có lý do hoặc chốt. Người gửi không tự chốt. Bảng đã chốt không sửa trực tiếp; có lịch sử thay đổi và kiểm tra phiên bản khi hai người thao tác đồng thời.

Lương mới bắt buộc liên kết bảng công đã chốt. Lương cơ bản theo ngày hưởng lương/ngày chuẩn, cộng phụ cấp và thưởng, trừ các khoản khấu trừ được nhập. Không trừ nghỉ lần thứ hai. Bảo hiểm không còn tự điền một mức cố định; kế toán nhập theo hồ sơ thực tế. Migration giữ công thức cũ với dữ liệu lịch sử trước tháng chuyển đổi.

## Đơn và PDF

`documents.html` cung cấp 10 mẫu: tám mẫu nghỉ phép hiện có (06–13), công tác và đề nghị hành chính. Điền thông tin tạo bản xem trước PDF tự động, có tiếng Việt và phân trang. Bốn người ký riêng biệt: người làm đơn → quản lý → HCNS → Giám đốc. Nội dung đóng băng sau tạo; mỗi bước lưu PDF, ảnh chữ ký, người ký, thời gian và hash. Đơn nghỉ/công tác liên kết hồ sơ nghiệp vụ cũ; không tạo luồng duyệt trùng trong trung tâm duyệt. Hồ sơ cũ tiếp tục xem và duyệt ở các trang lịch sử.

Chữ ký hiện tại là ảnh chữ ký trong hồ sơ có dấu vết kiểm toán, **chưa phải chữ ký số dùng chứng thư PKI**. Muốn ký số pháp lý cần tích hợp nhà cung cấp chứng thư và kiểm tra chữ ký PDF phía máy chủ. Không coi hash do client cung cấp là xác minh chứng thư.

Phiếu thanh toán, tạm ứng, mua sắm và đề xuất sự kiện tự tạo PDF từ thông tin điền, có bốn ô ký. Các bước kiểm soát tài chính hiện hữu vẫn được giữ; bốn phiếu này chưa chuyển sang luồng bốn người ký của `employee_documents`. Hợp đồng và các biểu mẫu PDF chuyên biệt còn dùng công cụ cũ. Chứng từ gốc/hóa đơn vẫn cần đính kèm khi nghiệp vụ yêu cầu.

## Cài đặt và chuyển đổi

1. Sao lưu DB và thử trên staging. Không chạy trực tiếp trên production chưa kiểm tra.
2. Giữ cấu hình `app/env.js` và cấu hình cổng phụ huynh phù hợp môi trường; không đưa service-role key vào frontend.
3. Sau các migration cũ, chạy theo thứ tự:
   - `supabase/migrations/20261006000001_manual_timesheets.sql`
   - `supabase/migrations/20261006000002_document_workflow.sql`
4. Kiểm tra `manual_payroll_from` trong settings: mặc định tháng chạy migration. Chọn tháng chuyển đổi phù hợp và nhập/chốt bảng công trước khi tạo lương tháng đó.
5. Kiểm tra storage bucket `attachments`, quyền nhân sự, quản lý, HCNS và Giám đốc, chữ ký hồ sơ; dùng ít nhất bốn tài khoản riêng để kiểm thử.
6. Phục vụ `app` tại gốc website như hệ thống cũ, ví dụ `python3 -m http.server 8000 --directory app`. Cổng phụ huynh phục vụ riêng theo cấu hình hiện có.

Chạy migration trước khi phát hành frontend mới. PDF dùng thư viện và font cục bộ; phần Supabase và các công cụ cũ vẫn giữ các phụ thuộc CDN sẵn có. File upload chưa gắn vào giao dịch do lỗi mạng có thể thành file mồ côi; cần tác vụ dọn bằng service role sau khi kiểm tra tham chiếu, không xóa file đã ký.

## Kiểm chứng

`tests/README.md` hướng dẫn chạy. Đã kiểm tra đường dẫn nội bộ, import và cú pháp JS; kiểm thử DOM với jsdom; mô hình ngày công, game, mẫu đơn và PDF thực; kiểm thử hai migration và luồng nghiệp vụ trên PostgreSQL WASM (PGlite).

Các thử nghiệm DB dùng schema cũ rút gọn và giả lập hàm chốt phép; không chứng minh toàn bộ 175 migration cũ hoặc RLS trên Supabase thật. Chưa chạy trình duyệt thật, chưa kiểm thử dữ liệu production, nhà cung cấp ký số hay thanh toán thực. Cần kiểm tra staging trên desktop/mobile, quyền từng vai trò, storage và đối chiếu lương trước khi phát hành.
