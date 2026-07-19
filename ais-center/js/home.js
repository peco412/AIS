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

  const orParts = ['scope.eq.system', ...centerIds.map((id) => `center_id.eq.${id}`)];
  const { data } = await supabase.from('discount_programs_view')
    .select('name, discount_rate, scope, center_id, valid_from, valid_to')
    .eq('status', 'active')
    .lte('valid_from', now).gte('valid_to', now)
    .or(orParts.join(','));

  const promoBox = document.getElementById('promoList');
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
    await loadPromotions();
  } catch (e) { /* bootParentShell tự điều hướng nếu chưa đăng nhập */ }
})();
