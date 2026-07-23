import { supabase, esc, fmtMoney, bootParentShell } from './parentSupabase.js';

let STUDENTS = [];

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
    const { students } = await bootParentShell();
    STUDENTS = students;
    if (STUDENTS.length === 0) {
      document.getElementById('noStudentNotice').style.display = 'block';
      return;
    }

    document.getElementById('content').style.display = 'block';
    renderSwitcher();
    await Promise.all([loadExtracurricularPrograms(), loadAnnouncements()]);
  } catch (e) { /* bootParentShell tự điều hướng nếu chưa đăng nhập */ }
})();
