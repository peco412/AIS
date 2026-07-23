import { supabase, esc, fmtMoney, bootParentShell } from './parentSupabase.js';

let STUDENTS = [];

// SUA: bo nut chuyen doi con — khac voi Vi (dung chung 1 vi nen chuyen
// qua lai khong doi gi), uu dai co the khac nhau THAT theo tung trung
// tam neu cac con hoc o trung tam khac nhau — nen thay vi bat chuyen tung
// con, GOP LUON uu dai cua TAT CA trung tam cac con dang hoc vao 1 danh
// sach, ghi ro ten con/trung tam o moi dong khi có từ 2 trung tâm trở lên.
async function loadPromotions() {
  const centerIds = [...new Set(STUDENTS.map((s) => s.center_id).filter(Boolean))];
  const now = new Date().toISOString();
  const promoBox = document.getElementById('promoList');

  const orParts = ['scope.eq.system', ...centerIds.map((id) => `center_id.eq.${id}`)];
  const { data, error } = await supabase.from('discount_programs_view')
    .select('name, discount_rate, scope, center_id, valid_from, valid_to')
    .eq('status', 'active')
    .lte('valid_from', now).gte('valid_to', now)
    .or(orParts.join(','));

  // SUA: truoc day chi lay "data", loi truy van (neu co) bi NUOT AM
  // THAM — o hien trong nhu khong co gi ca, khong biet la "khong co uu
  // dai" hay "co loi" — gio kiem tra ro rang, bao loi neu that su co loi.
  if (error) {
    promoBox.innerHTML = `<div class="empty-state" style="padding:16px 0; color:var(--danger);">Không tải được chương trình ưu đãi — thử tải lại trang. (${esc(error.message)})</div>`;
    return;
  }
  if (!data || data.length === 0) {
    promoBox.innerHTML = '<div class="empty-state" style="padding:16px 0;">Hiện chưa có chương trình ưu đãi nào.</div>';
    // Khong co uu dai nao dang chay — giu banner MAC DINH (loi chao mung,
    // da dat san trong HTML), khong sua gi them.
    return;
  }

  const centerNameOf = (centerId) => STUDENTS.find((s) => s.center_id === centerId)?.centers?.name || 'Trung tâm của bạn';
  promoBox.innerHTML = data.map((p) => `
    <div class="invoice-row">
      <div class="invoice-row__top"><span>${esc(p.name)}</span><span style="color:var(--accent-deep); font-weight:700;">-${(p.discount_rate * 100).toFixed(0)}%</span></div>
      <div class="invoice-row__sub">Áp dụng đến ${new Date(p.valid_to).toLocaleDateString('vi-VN')}${p.scope === 'system' ? ' · Toàn hệ thống' : ` · ${esc(centerNameOf(p.center_id))}`}</div>
    </div>
  `).join('');

  // Dua uu dai GIAM NHIEU NHAT len banner dau trang, thay cho loi chao
  // mung mac dinh — chi khi thuc su co uu dai dang chay.
  const best = data.slice().sort((a, b) => b.discount_rate - a.discount_rate)[0];
  document.getElementById('promoBannerTitle').textContent = best.name;
  document.getElementById('promoBannerSub').textContent =
    `Giảm ${(best.discount_rate * 100).toFixed(0)}% — áp dụng đến ${new Date(best.valid_to).toLocaleDateString('vi-VN')}`;
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
    await Promise.all([loadPromotions(), loadAnnouncements()]);
  } catch (e) { /* bootParentShell tự điều hướng nếu chưa đăng nhập */ }
})();
