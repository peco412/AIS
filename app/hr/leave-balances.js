import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_EMPLOYEES = [];

function monthOptions() {
  const sel = document.getElementById('filterMonth');
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const opt = document.createElement('option');
    opt.value = `${d.getFullYear()}-${d.getMonth() + 1}`;
    opt.textContent = `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
    sel.appendChild(opt);
  }
}

async function ensureBalanceRows(year, month) {
  // Đảm bảo mỗi nhân viên có 1 dòng leave_balances cho tháng đang xem;
  // nếu chưa có thì tạo với annual_leave_accrued mặc định = 1.
  const { data: existing } = await supabase
    .from('leave_balances').select('employee_id').eq('year', year).eq('month', month);
  const existingIds = new Set((existing || []).map((r) => r.employee_id));
  const missing = ALL_EMPLOYEES.filter((e) => !existingIds.has(e.id));
  if (missing.length > 0) {
    await supabase.from('leave_balances').insert(
      missing.map((e) => ({ employee_id: e.id, year, month, annual_leave_accrued: 1 }))
    );
  }
}

async function loadTable() {
  const [year, month] = document.getElementById('filterMonth').value.split('-').map(Number);
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  await ensureBalanceRows(year, month);

  const { data, error } = await supabase
    .from('leave_balances')
    .select('id, annual_leave_accrued, annual_leave_used, compensatory_leave, employee_id, employees(employee_code, full_name)')
    .eq('year', year).eq('month', month)
    .order('employees(employee_code)');

  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }

  tbody.innerHTML = data.map((r) => {
    const remain = (Number(r.annual_leave_accrued) - Number(r.annual_leave_used) + Number(r.compensatory_leave)).toFixed(1);
    return `
      <tr>
        <td class="cell-code">${esc(r.employees?.employee_code || '')}</td>
        <td>${esc(r.employees?.full_name || '')}</td>
        <td>${r.annual_leave_accrued}</td>
        <td>${r.annual_leave_used}</td>
        <td>
          <input type="number" step="0.5" value="${r.compensatory_leave}" data-comp="${r.id}"
            style="width:70px;padding:5px 8px;border:1px solid var(--border-strong);border-radius:6px;" />
        </td>
        <td class="mono">${remain}</td>
        <td><button class="btn btn-outline btn-sm" data-save="${r.id}">Lưu</button></td>
      </tr>`;
  }).join('') || '<tr><td colspan="7" class="empty-cell">Không có dữ liệu.</td></tr>';

  tbody.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.save;
      const input = tbody.querySelector(`[data-comp="${id}"]`);
      const { error: updErr } = await supabase
        .from('leave_balances')
        .update({ compensatory_leave: Number(input.value), adjusted_by: PROFILE.id })
        .eq('id', id);
      if (updErr) { alert('Lỗi lưu: ' + updErr.message); return; }
      await loadTable();
    });
  });
}

document.getElementById('filterMonth').addEventListener('change', loadTable);
document.getElementById('searchInput').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#tableBody tr').forEach((tr) => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    const allowed = (profile.departmentCode === 'HR') || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!allowed) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Bạn không có quyền thực hiện thao tác.</div>';
      return;
    }
    const { data: employees } = await supabase.from('employees').select('id, employee_code, full_name').order('employee_code');
    ALL_EMPLOYEES = employees || [];
    monthOptions();
    await loadTable();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
