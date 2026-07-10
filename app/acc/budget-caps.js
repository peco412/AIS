import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let CATEGORIES = [];

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('filterCenter').innerHTML = (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadRows() {
  const centerId = document.getElementById('filterCenter').value;
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data: categories } = await supabase.from('expense_categories').select('id, name').order('display_order');
  CATEGORIES = categories || [];

  const { data: budgets } = await supabase.from('center_expense_budgets').select('expense_category_id, monthly_cap').eq('center_id', centerId);
  const budgetMap = {};
  (budgets || []).forEach((b) => { budgetMap[b.expense_category_id] = b.monthly_cap; });

  tbody.innerHTML = CATEGORIES.map((cat) => `
    <tr data-category="${cat.id}">
      <td>${esc(cat.name)}</td>
      <td><input type="number" class="cap-input" min="0" value="${budgetMap[cat.id] || 0}" style="width:160px;" /></td>
      <td><button class="btn btn-accent btn-sm" data-save="${cat.id}">Lưu</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const cap = Number(tr.querySelector('.cap-input').value) || 0;
      btn.disabled = true; btn.textContent = 'Đang lưu...';
      const { error } = await supabase.from('center_expense_budgets').upsert({
        center_id: centerId, expense_category_id: btn.dataset.save, monthly_cap: cap, updated_by: PROFILE.id, updated_at: new Date().toISOString(),
      }, { onConflict: 'center_id,expense_category_id' });
      btn.disabled = false; btn.textContent = 'Lưu';
      if (error) { alert('Lỗi: ' + error.message); return; }
      btn.textContent = '✓ Đã lưu';
      setTimeout(() => { btn.textContent = 'Lưu'; }, 1500);
    });
  });
}

document.getElementById('filterCenter').addEventListener('change', loadRows);

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentCode: emp?.departments?.code };

    const canUse = PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kế toán/Ban điều hành mới dùng được trang này.</div>';
      return;
    }
    await loadCenters();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
