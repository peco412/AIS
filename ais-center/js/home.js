import { supabase, esc, fmtMoney, bootParentShell } from './parentSupabase.js';

let STUDENTS = [];

function initials(name) { return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase(); }

// LÀM LẠI — SỬA LỖI THẬT: hàm THẬT thay cho renderSwitcher() bị gọi mà
// chưa từng tồn tại (xem ghi chú trong home.html). Ban đầu định làm kiểu
// "chọn 1 con, ẩn con khác" — nhưng rà lại các trang khác (Bảng điểm,
// Công nợ, Đóng học phí) thì thấy triết lý UX đã CHỦ ĐỘNG từ chối kiểu
// đó từ trước (xem chú thích trong grades.js: "nhóm theo tên con... để
// dễ phân biệt mà KHÔNG CẦN bấm chuyển qua lại" — ít thao tác hơn, xem
// được hết ngay). Đổi lại cho ĐÚNG NHẤT QUÁN: chỉ hiện tên tất cả con
// dạng thẻ tĩnh (không bấm chuyển đổi gì) — Trang chủ hiện chưa có nội
// dung nào thật sự riêng theo từng con để mà cần chọn.
function renderSwitcher() {
  const box = document.getElementById('studentSwitcher');
  if (STUDENTS.length <= 1) { box.style.display = 'none'; return; }
  box.style.display = 'flex';
  box.innerHTML = STUDENTS.map((s) => `
    <div class="student-chip is-active">
      <span class="student-chip__avatar">${esc(initials(s.full_name))}</span>
      <span>
        <div class="student-chip__name">${esc(s.full_name)}</div>
        <div class="student-chip__sub">${esc(s.centers?.name || '')}</div>
      </span>
    </div>
  `).join('');
}

// SUA — theo yeu cau: bo hien "Chuong trinh uu dai" (giam gia hoc phi —
// van CHAY NGAM de tinh tien hoa don, chi khong con la noi dung noi bat
// tren trang chu nua) — thay bang "Chuong trinh ngoai khoa", moi chuong
// trinh co nut "Dang ky" mo dung link Google Form. Banner dau trang gio
// LUON la loi chao mac dinh, khong con doi theo uu dai dang chay nua.
async function loadExtracurricularPrograms() {
  const { data, error } = await supabase
    .from('extracurricular_programs')
    .select('name, description, google_form_url')
    .order('created_at', { ascending: false });

  const box = document.getElementById('extracurricularList');
  if (error) { box.innerHTML = `<div class="empty-state" style="padding:16px 0; color:var(--danger);">Không tải được chương trình ngoại khoá. (${esc(error.message)})</div>`; return; }
  if (!data || data.length === 0) { box.innerHTML = '<div class="empty-state" style="padding:16px 0;">Hiện chưa có chương trình ngoại khoá nào.</div>'; return; }

  box.innerHTML = data.map((p) => `
    <div class="invoice-row">
      <div class="invoice-row__top"><span>${esc(p.name)}</span></div>
      ${p.description ? `<div class="invoice-row__sub">${esc(p.description)}</div>` : ''}
      <a href="${esc(p.google_form_url)}" target="_blank" class="btn-primary" style="display:inline-block; margin-top:8px; padding:8px 16px; font-size:13px;">Đăng ký</a>
    </div>
  `).join('');
}

// MOI — thong bao chung tu trung tam (nghi le, su kien, luu y...) — khac
// voi Chuong trinh uu dai (chi ve giam gia hoc phi). RLS tu loc dung
// thong bao toan he thong + dung trung tam cua con minh, khong can loc
// them o day.
async function loadAnnouncements() {
  const { data, error } = await supabase
    .from('parent_announcements')
    .select('title, content, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const card = document.getElementById('announcementsCard');
  const list = document.getElementById('announcementsList');
  if (error || !data || data.length === 0) { card.style.display = 'none'; return; }

  card.style.display = 'block';
  list.innerHTML = data.map((a) => `
    <div class="invoice-row">
      <div class="invoice-row__top"><span>${esc(a.title)}</span></div>
      <div class="invoice-row__sub" style="white-space:pre-wrap;">${esc(a.content)}</div>
      <div class="invoice-row__sub" style="font-size:11px; margin-top:2px;">${new Date(a.created_at).toLocaleDateString('vi-VN')}</div>
    </div>
  `).join('');
}

(async () => {
  try {
    const { parent, students } = await bootParentShell();
    STUDENTS = students;

    // MỚI — cá nhân hoá lời chào bằng tên thật + thời điểm trong ngày,
    // thay vì câu chào chung chung cố định — bootParentShell() vốn đã
    // trả về "parent" từ trước nhưng chưa từng được dùng tới ở đây.
    const hour = new Date().getHours();
    const timeGreeting = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
    const firstParentName = (parent?.full_name || '').trim().split(/\s+/).slice(-1)[0];
    document.getElementById('promoBannerTitle').textContent = firstParentName ? `${timeGreeting}, ${firstParentName}!` : 'Chào mừng đến với ALOHA/iLingo';

    // MỚI — SỬA LỖI THẬT: tải thông báo TRƯỚC bước kiểm tra "chưa liên
    // kết học sinh" — trước đây nếu chưa có học sinh nào, hàm return
    // sớm ở dưới, khiến thông báo "Toàn hệ thống" (đáng lẽ ai đăng nhập
    // cũng xem được, không cần đã liên kết học sinh) không bao giờ được
    // tải, dù đã đăng và đang ở trạng thái "Đang hiện".
    await loadAnnouncements();

    if (STUDENTS.length === 0) {
      document.getElementById('noStudentNotice').style.display = 'block';
      return;
    }

    document.getElementById('content').style.display = 'block';
    renderSwitcher();
    await loadExtracurricularPrograms();
  } catch (e) {
    // SỬA — trước đây bắt lỗi HOÀN TOÀN im lặng (chỉ có comment, không
    // làm gì cả) — đây chính là lý do lỗi "renderSwitcher không tồn
    // tại" phá vỡ toàn bộ trang trong âm thầm suốt thời gian qua mà
    // không ai phát hiện ra. bootParentShell() tự điều hướng khi chưa
    // đăng nhập (ném lỗi NO_SESSION/EMPLOYEE_SESSION) — những lỗi đó bỏ
    // qua là đúng, nhưng lỗi NGOÀI 2 trường hợp đó cần được ghi lại.
    if (e.message !== 'NO_SESSION' && e.message !== 'EMPLOYEE_SESSION') {
      console.error('Lỗi khi tải Trang chủ:', e);
    }
  }
})();
