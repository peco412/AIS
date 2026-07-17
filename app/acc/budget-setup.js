import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

let PROFILE = null;
let CAN_EDIT = false;
let CATEGORIES = [];
let BUDGETS = {}; // category_id -> { monthly_cap }
let SPENT = {}; // category_id -> so tien da chi thang nay

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  const sel = document.getElementById('filterCenter');
  sel.innerHTML = (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (!CAN_EDIT && PROFILE.centerId) { sel.value = PROFILE.centerId; sel.disabled = true; }
}

async function loadCategories() {
  const { data } = await supabase.from('expense_categories').select('id, code, name, parent_code, display_order').order('display_order');
  CATEGORIES = data || [];
}

async function loadBudgetsAndSpending() {
  const centerId = document.getElementById('filterCenter').value;
  if (!centerId) return;

  const { data: budgets } = await supabase.from('center_expense_budgets').select('expense_category_id, monthly_cap').eq('center_id', centerId);
  BUDGETS = {};
  (budgets || []).forEach((b) => { BUDGETS[b.expense_category_id] = b.monthly_cap; });

  // Tinh da chi trong thang cho tung hang muc — dung lai dung logic
  // check_budget_cap() da co san (chi lay 1 phan ket qua, khong sua ham
  // do), goi rieng cho tung hang muc de hien bang tong hop.
  SPENT = {};
  await Promise.all(CATEGORIES.map(async (cat) => {
    const { data } = await supabase.rpc('check_budget_cap', { p_center_id: centerId, p_expense_category_id: cat.id, p_new_amount: 0 });
    SPENT[cat.id] = data?.[0]?.already_spent || 0;
  }));
}

function render() {
  const tbody = document.getElementById('tableBody');
  const rootCats = CATEGORIES.filter((c) => !c.parent_code);

  let html = '';
  rootCats.forEach((root) => {
    const children = CATEGORIES.filter((c) => c.parent_code === root.code);
    html += renderRow(root, children.length > 0);
    children.forEach((child) => { html += renderRow(child, false); });
  });
  tbody.innerHTML = html || '<tr><td colspan="4" class="empty-cell">Chưa có hạng mục chi nào.</td></tr>';

  tbody.querySelectorAll('[data-save-cap]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const catId = btn.dataset.saveCap;
      const input = tbody.querySelector(`[data-cap-input="${catId}"]`);
      const cap = Number(input.value) || 0;
      const centerId = document.getElementById('filterCenter').value;
      const { error } = await supabase.from('center_expense_budgets').upsert({
        center_id: centerId, expense_category_id: catId, monthly_cap: cap, updated_by: PROFILE.id, updated_at: new Date().toISOString(),
      }, { onConflict: 'center_id,expense_category_id' });
      if (error) { alert('Lỗi: ' + error.message); return; }
      BUDGETS[catId] = cap;
      render();
    });
  });
}

function renderRow(cat, isParentWithChildren) {
  const cap = BUDGETS[cat.id] || 0;
  const spent = SPENT[cat.id] || 0;
  const pct = cap > 0 ? Math.min((spent / cap) * 100, 100) : 0;
  const barColor = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';

  return `
    <tr class="${isParentWithChildren ? 'cat-parent-row' : ''}">
      <td>${isParentWithChildren ? '' : '↳ '}${esc(cat.name)}</td>
      <td>
        ${CAN_EDIT ? `<input type="number" data-cap-input="${cat.id}" value="${cap}" min="0" step="100000" />` : `<span class="mono">${fmtMoney(cap)} đ</span>`}
      </td>
      <td>
        <span class="mono ${cap > 0 && spent > cap ? 'recon-diff-bad' : ''}">${fmtMoney(spent)} đ</span>
        ${cap > 0 ? `<div class="progress-bar"><div class="progress-bar__fill" style="width:${pct}%; background:${barColor};"></div></div>` : ''}
        ${cap > 0 && spent >= cap ? '<div style="color:var(--danger); font-size:11px; font-weight:700;">Đã vượt trần</div>' : cap > 0 && spent >= cap * 0.8 ? '<div style="color:var(--warning); font-size:11px; font-weight:700;">Sắp chạm trần</div>' : ''}
      </td>
      <td>${CAN_EDIT ? `<button class="btn btn-outline btn-sm" data-save-cap="${cat.id}">Lưu</button>` : ''}</td>
    </tr>
  `;
}

document.getElementById('filterCenter').addEventListener('change', async () => {
  await loadBudgetsAndSpending();
  render();
});

(async () => {
  try {
    const { profile } = await bootShell();
    if (profile.roleCode !== 'TECH' && profile.roleCode !== 'EXECUTIVE' && profile.departmentCode !== 'ACC' && !profile.isCenterManager) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Ban điều hành/Kế toán/Kỹ thuật (thiết lập) hoặc Quản lý trung tâm (xem) mới dùng được trang này.</div>';
      return;
    }
    PROFILE = profile;
    CAN_EDIT = profile.roleCode === 'TECH' || profile.roleCode === 'EXECUTIVE' || profile.departmentCode === 'ACC';
    await loadCenters();
    await loadCategories();
    await loadBudgetsAndSpending();
    render();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
