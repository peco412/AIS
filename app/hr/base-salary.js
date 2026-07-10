import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, employee_code, full_name, departments(name), positions(name)')
    .eq('status', 'active')
    .order('full_name');
  if (error) { tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

  const { data: configs } = await supabase.from('employee_base_salary').select('*');
  const configMap = {};
  (configs || []).forEach((c) => { configMap[c.employee_id] = c; });

  ALL_ROWS = employees.map((e) => ({ employee: e, config: configMap[e.id] || { base_salary: 0, housing_allowance: 0, transport_allowance: 0, other_allowance: 0 } }));
  render();
}

function render() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) => !q || r.employee.full_name.toLowerCase().includes(q));
  document.getElementById('resultCount').textContent = `${rows.length} nhân viên`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">Không có nhân viên nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map(({ employee, config }) => `
    <tr data-employee="${employee.id}">
      <td class="cell-code">${esc(employee.employee_code || '—')}</td>
      <td>${esc(employee.full_name)}</td>
      <td class="cell-muted">${esc(employee.departments?.name || '—')}</td>
      <td class="cell-muted">${esc(employee.positions?.name || '—')}</td>
      <td><input type="number" class="base-input" value="${config.base_salary || 0}" style="width:110px;" /></td>
      <td><input type="number" class="housing-input" value="${config.housing_allowance || 0}" style="width:100px;" /></td>
      <td><input type="number" class="transport-input" value="${config.transport_allowance || 0}" style="width:100px;" /></td>
      <td><input type="number" class="other-input" value="${config.other_allowance || 0}" style="width:100px;" /></td>
      <td><button class="btn btn-accent btn-sm" data-save="${employee.id}">Lưu</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const payload = {
        employee_id: btn.dataset.save,
        base_salary: Number(tr.querySelector('.base-input').value) || 0,
        housing_allowance: Number(tr.querySelector('.housing-input').value) || 0,
        transport_allowance: Number(tr.querySelector('.transport-input').value) || 0,
        other_allowance: Number(tr.querySelector('.other-input').value) || 0,
        updated_by: PROFILE.id,
        updated_at: new Date().toISOString(),
      };
      btn.disabled = true; btn.textContent = 'Đang lưu...';
      const { error } = await supabase.from('employee_base_salary').upsert(payload, { onConflict: 'employee_id' });
      btn.disabled = false; btn.textContent = 'Lưu';
      if (error) { alert('Lỗi: ' + error.message); return; }
      btn.textContent = '✓ Đã lưu';
      setTimeout(() => { btn.textContent = 'Lưu'; }, 1500);
    });
  });
}

document.getElementById('searchInput').addEventListener('input', render);

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentCode: emp?.departments?.code };

    const canUse = PROFILE.departmentCode === 'HR' || PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Nhân sự/Kế toán/Ban điều hành mới dùng được trang này.</div>';
      return;
    }
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
