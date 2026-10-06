# Kiểm tra bản chỉnh UI/UX

Từ thư mục tests:

```sh
python3 static-audit.py
npm install
npm test
```

Các test DOM dùng dữ liệu Supabase giả lập; không gửi yêu cầu đến dữ liệu thật. Không thay thế kiểm thử trình duyệt, RLS, thanh toán hoặc ký số trên staging. jsdom chỉ là công cụ kiểm thử, không thêm phụ thuộc vào frontend sản xuất.
