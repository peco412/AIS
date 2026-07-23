import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const PLAN_LABEL = { COMBO_2_COURSES: 'Đóng 2 khoá liền', FULL_SUB_LEVEL: 'Trọn cấp độ con' };
let PROFILE = null;
let CAN_EDIT = false;

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase.from('bulk_payment_discounts').select('*, employees(full_name)').eq('plan_type', 'FULL_SUB_LEVEL');
  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

  tbody.innerHTML = (data || []).map((r) => `
    <tr data-plan="${r.plan_type}">
      <td>${esc(PLAN_LABEL[r.plan_type] || r.plan_type)}</td>
      <td>${CAN_EDIT
        ? `<input type="number" class="rate-input" min="0" max="90" step="0.5" value="${(r.discount_rate * 100).toFixed(1)}" style="width:90px;" /> %`
        : `<strong class="mono">${(r.discount_rate * 100).toFixed(1)}%</strong>`}
      </td>
      <td class="cell-muted" style="font-size:12px;">${r.updated_at ? new Date(r.updated_at).toLocaleString('vi-VN') : '—'}${r.employees?.full_name ? ` — ${esc(r.employees.full_name)}` : ''}</td>
      <td>${CAN_EDIT ? `<button class="btn btn-accent btn-sm" data-save="${r.plan_type}">Lưu</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const rate = Number(tr.querySelector('.rate-input').value) / 100;
      btn.disabled = true; btn.textContent = 'Đang lưu...';
      const { error: err } = await supabase.from('bulk_payment_discounts')
        .update({ discount_rate: rate, updated_by: PROFILE.id, updated_at: new Date().toISOString() })
        .eq('plan_type', btn.dataset.save);
      btn.disabled = false; btn.textContent = 'Lưu';
      if (err) { alert('Lỗi: ' + err.message); return; }
      await loadRows();
    });
  });
}

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    CAN_EDIT = profile.roleCode === 'TECH' || profile.roleCode === 'EXECUTIVE';
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
