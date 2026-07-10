import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let CAN_EDIT = false;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

async function loadPricing() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('program_sublevels')
    .select('id, name, price_vnd, display_order, program_levels(id, name, display_order, programs(id, name, display_order))')
    .order('display_order');

  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Chưa có dữ liệu chương trình học.</td></tr>'; return; }

  // Tính tổng học phí trọn cấp độ (cộng tất cả cấp độ con trong cùng 1 cấp độ)
  const levelTotals = {};
  data.forEach((s) => {
    const levelId = s.program_levels?.id;
    if (!levelId) return;
    levelTotals[levelId] = (levelTotals[levelId] || 0) + Number(s.price_vnd || 0);
  });

  tbody.innerHTML = data.map((s) => `
    <tr data-sublevel="${s.id}">
      <td class="cell-muted">${esc(s.program_levels?.programs?.name || '—')}</td>
      <td class="cell-muted">${esc(s.program_levels?.name || '—')}</td>
      <td>${esc(s.name)}</td>
      <td>${CAN_EDIT ? `<input type="number" class="price-input" value="${s.price_vnd || 0}" style="width:130px;" />` : `<span class="mono">${fmtMoney(s.price_vnd)} đ</span>`}</td>
      <td class="mono" style="text-align:right;">${fmtMoney(levelTotals[s.program_levels?.id])} đ</td>
    </tr>
  `).join('');

  if (CAN_EDIT) {
    tbody.querySelectorAll('.price-input').forEach((input) => {
      input.addEventListener('change', async () => {
        const tr = input.closest('tr');
        const { error: err } = await supabase.from('program_sublevels').update({ price_vnd: Number(input.value) || 0 }).eq('id', tr.dataset.sublevel);
        if (err) { alert('Lỗi: ' + err.message); return; }
        await loadPricing(); // tải lại để cập nhật đúng tổng cấp độ
      });
    });
  }

  // Bảng tổng chương trình
  const programTotals = {};
  data.forEach((s) => {
    const prog = s.program_levels?.programs;
    if (!prog) return;
    if (!programTotals[prog.id]) programTotals[prog.id] = { name: prog.name, total: 0, count: 0 };
    programTotals[prog.id].total += Number(s.price_vnd || 0);
    programTotals[prog.id].count += 1;
  });
  document.getElementById('programTotalsBody').innerHTML = Object.values(programTotals).map((p) => `
    <tr><td>${esc(p.name)}</td><td class="cell-muted">${p.count} cấp độ con</td><td class="mono" style="text-align:right; font-weight:700;">${fmtMoney(p.total)} đ</td></tr>
  `).join('') || '<tr><td colspan="3" class="empty-cell">—</td></tr>';
}

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentCode: emp?.departments?.code };
    CAN_EDIT = PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    await loadPricing();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
