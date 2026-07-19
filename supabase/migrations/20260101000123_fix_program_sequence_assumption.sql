-- =====================================================================
-- File 123: SỬA LỖI GIẢ ĐỊNH SAI Ở FILE 122 (19/07/2026)
-- =====================================================================
-- Bạn gửi đúng dữ liệu thật của trang "Chương trình & Bảng giá khoá học"
-- — nhìn vào đó mới biết: hệ thống ĐÃ CÓ SẴN đúng 8 "Chương trình"
-- (Mầm non/Mẫu Giáo/Trẻ em/Thiếu Nhi/Thanh thiếu niên/Học thuật/Giao
-- tiếp/One-on-one) — các tên kiểu Cambridge (PRESCHOOL/STARTERS/MOVERS/
-- FLYERS/KET/PET/FCE/IELTS) mình thấy ở file dữ liệu mẫu (seed data) cũ
-- trong mã nguồn CHỈ LÀ DỮ LIỆU MẪU BAN ĐẦU, không phải dữ liệu thật đang
-- chạy — dữ liệu thật đã đổi khác đi từ lâu (các tên đó giờ là CẤP ĐỘ nằm
-- trong 8 Chương trình mới, không còn là Chương trình riêng nữa).
--
-- Vì vậy KHÔNG cần tầng "Tuyến chương trình" mới như file 122 đã tạo —
-- xoá bỏ, và thêm thẳng 2 cột (Trình tự + Bắt buộc/Tự chọn) vào đúng bảng
-- "programs" đang có, gán cho đúng 8 Chương trình theo TÊN THẬT.
-- =====================================================================

-- Don phan da tao sai o file 122 — chua co du lieu that nao dung (vua tao
-- xong trong cung phien lam viec), xoa ngay khong anh huong gi.
alter table programs drop column if exists track_id;
drop table if exists program_tracks;

-- Them dung 2 cot can thiet THANG vao bang programs dang co san.
alter table programs add column if not exists sequence smallint;
alter table programs add column if not exists is_mandatory boolean not null default false;

comment on column programs.sequence is 'Thứ tự bắt buộc (1-5) cho tuyến chính — null nếu là chương trình tự chọn, không kiểm tra vượt cấp.';
comment on column programs.is_mandatory is 'true = tuyến bắt buộc, kiểm tra không được nhảy cóc; false = tuyến tự chọn, xếp lớp/xuất hoá đơn tự do.';

-- Gan dung theo TEN THAT dang co trong du lieu (khop chinh xac tung chu,
-- xac nhan lai qua ban ghi HTML ban gui).
update programs set sequence = 1, is_mandatory = true where name = 'Tiếng Anh Mầm non';
update programs set sequence = 2, is_mandatory = true where name = 'Tiếng Anh Mẫu Giáo';
update programs set sequence = 3, is_mandatory = true where name = 'Tiếng Anh Trẻ em';
update programs set sequence = 4, is_mandatory = true where name = 'Tiếng Anh Thiếu Nhi';
update programs set sequence = 5, is_mandatory = true where name = 'Tiếng Anh Thanh thiếu niên';
update programs set sequence = null, is_mandatory = false where name = 'Tiếng Anh Học thuật';
update programs set sequence = null, is_mandatory = false where name = 'Tiếng Anh Giao tiếp';
update programs set sequence = null, is_mandatory = false where name = 'Tiếng Anh theo nhu cầu one-on-one';

-- Rang buoc: neu la tuyen bat buoc thi PHAI co sequence tu 1-5; neu tu
-- chon thi KHONG duoc co sequence (tranh nhap nham lam sai logic kiem tra
-- vuot cap sau nay).
alter table programs drop constraint if exists chk_programs_sequence_consistency;
alter table programs add constraint chk_programs_sequence_consistency
  check (
    (is_mandatory = true and sequence between 1 and 5)
    or (is_mandatory = false and sequence is null)
  );
