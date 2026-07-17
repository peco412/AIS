import { supabase, esc, fmtMoney, bootParentShell, getSelectedStudentId, setSelectedStudentId } from './parentSupabase.js';

let STUDENTS = [];
let SELECTED_ID = null;

function renderSwitcher() {
  const el = document.getElementById('studentSwitcher');
  if (STUDENTS.length <= 1) { el.style.display = 'none'; return; }
  el.innerHTML = STUDENTS.map((s) => `
    <button class="student-chip ${s.id === SELECTED_ID ? 'active' : ''}" data-id="${s.id}">${esc(s.full_name)}</button>
  `).join('');
  el.querySelectorAll('[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => { setSelectedStudentId(btn.dataset.id); SELECTED_ID = btn.dataset.id; renderSwitcher(); loadPromotions(); });
  });
}

// "Chương trình ưu đãi" — hiện các chương trình giảm giá đang áp dụng cho
// đúng trung tâm học sinh đang học. Ưu đãi TOT NHAT (giam nhieu nhat)
// cung duoc dua len BANNER dau trang — neu khong co uu dai nao dang
// chay, banner tu dong hien loi chao mung MAC DINH (khong de trong).
async function loadPromotions() {
  const student = STUDENTS.find((s) => s.id === SELECTED_ID);
  const centerId = student?.center_id;
  const now = new Date().toISOString();

  const { data } = await supabase.from('discount_programs_view')
    .select('name, discount_rate, scope, valid_from, valid_to')
    .eq('status', 'active')
    .lte('valid_from', now).gte('valid_to', now)
    .or(`scope.eq.system${centerId ? `,center_id.eq.${centerId}` : ''}`);

  const promoBox = document.getElementById('promoList');
  if (!data || data.length === 0) {
    promoBox.innerHTML = '<div class="empty-state" style="padding:16px 0;">Hiện chưa có chương trình ưu đãi nào.</div>';
    // Khong co uu dai nao dang chay — giu banner MAC DINH (loi chao mung,
    // da dat san trong HTML), khong sua gi them.
    return;
  }

  promoBox.innerHTML = data.map((p) => `
    <div class="invoice-row">
      <div class="invoice-row__top"><span>${esc(p.name)}</span><span style="color:var(--accent-deep); font-weight:700;">-${(p.discount_rate * 100).toFixed(0)}%</span></div>
      <div class="invoice-row__sub">Áp dụng đến ${new Date(p.valid_to).toLocaleDateString('vi-VN')}${p.scope === 'system' ? ' · Toàn hệ thống' : ' · Trung tâm của bạn'}</div>
    </div>
  `).join('');

  // Dua uu dai GIAM NHIEU NHAT len banner dau trang, thay cho loi chao
  // mung mac dinh — chi khi thuc su co uu dai dang chay.
  const best = data.slice().sort((a, b) => b.discount_rate - a.discount_rate)[0];
  document.getElementById('promoBannerTitle').textContent = best.name;
  document.getElementById('promoBannerSub').textContent =
    `Giảm ${(best.discount_rate * 100).toFixed(0)}% — áp dụng đến ${new Date(best.valid_to).toLocaleDateString('vi-VN')}`;
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
    SELECTED_ID = getSelectedStudentId(STUDENTS);
    renderSwitcher();
    await loadPromotions();
  } catch (e) { /* bootParentShell tự điều hướng nếu chưa đăng nhập */ }
})();
