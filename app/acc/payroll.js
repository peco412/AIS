import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const STANDARD_WORKING_DAYS = 26; // quy ước phổ biến để tính lương/ngày công

let PROFILE = null;
let ALL_EMPLOYEES = [];
let CAN_EDIT = false;
let UNPAID_DAYS_MAP = {}; // employee_id -> số ngày nghỉ không lương trong tháng đang xem

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

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

// Lấy số ngày nghỉ KHÔNG LƯƠNG đã duyệt, có ngày bắt đầu rơi vào đúng tháng
// đang xem — dùng để gợi ý khấu trừ tự động (kế toán vẫn có thể sửa tay).
async function loadUnpaidLeaveDays(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(year, month, 1).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('leave_requests')
    .select('employee_id, days')
    .eq('leave_type', 'unpaid')
    .eq('status', 'approved_3')
    .gte('start_date', from)
    .lt('start_date', to);

  UNPAID_DAYS_MAP = {};
  if (error) { console.warn('Không tải được dữ liệu nghỉ không lương:', error.message); return; }
  (data || []).forEach((r) => {
    UNPAID_DAYS_MAP[r.employee_id] = (UNPAID_DAYS_MAP[r.employee_id] || 0) + Number(r.days || 0);
  });
}

async function loadTable() {
  const [year, month] = document.getElementById('filterMonth').value.split('-').map(Number);
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const [{ data: payrolls }] = await Promise.all([
    supabase.from('payroll').select('*').eq('year', year).eq('month', month),
    loadUnpaidLeaveDays(year, month),
  ]);
  const payrollMap = {};
  (payrolls || []).forEach((p) => { payrollMap[p.employee_id] = p; });

  const rows = ALL_EMPLOYEES.map((e) => ({
    employee: e,
    payroll: payrollMap[e.id] || { base_salary: 0, bonus: 0, deduction: 0 },
    unpaidDays: UNPAID_DAYS_MAP[e.id] || 0,
  }));

  renderStats(rows);

  tbody.innerHTML = rows.map(({ employee, payroll, unpaidDays }) => {
    const net = Number(payroll.base_salary || 0) + Number(payroll.bonus || 0) - Number(payroll.deduction || 0);
    return `
    <tr data-employee="${employee.id}">
      <td class="cell-code">${esc(employee.employee_code)}</td>
      <td>${esc(employee.full_name)}</td>
      <td><input type="number" class="base-input" value="${payroll.base_salary || 0}" ${CAN_EDIT ? '' : 'disabled'} /></td>
      <td class="cell-muted" style="text-align:center;">
        ${unpaidDays > 0 ? `<span class="badge badge-rejected">${unpaidDays} ngày</span>` : '—'}
      </td>
      <td><input type="number" class="bonus-input" value="${payroll.bonus || 0}" ${CAN_EDIT ? '' : 'disabled'} /></td>
      <td><input type="number" class="deduction-input" value="${payroll.deduction || 0}" data-unpaid-days="${unpaidDays}" data-base="${payroll.base_salary || 0}" ${CAN_EDIT ? '' : 'disabled'} /></td>
      <td class="mono net-display">${fmtMoney(net)} đ</td>
      <td>${CAN_EDIT ? `<button class="btn btn-accent btn-sm" data-save="${employee.id}">Lưu</button>` : ''}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.base-input, .bonus-input, .deduction-input').forEach((input) => {
    input.addEventListener('input', () => {
      const tr = input.closest('tr');
      const base = Number(tr.querySelector('.base-input').value) || 0;
      const bonus = Number(tr.querySelector('.bonus-input').value) || 0;
      const deduction = Number(tr.querySelector('.deduction-input').value) || 0;
      tr.querySelector('.net-display').textContent = fmtMoney(base + bonus - deduction) + ' đ';
      tr.querySelector('.deduction-input').dataset.base = base;
    });
  });

  tbody.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const employeeId = btn.dataset.save;
      const payload = {
        employee_id: employeeId, year, month,
        base_salary: Number(tr.querySelector('.base-input').value) || 0,
        bonus: Number(tr.querySelector('.bonus-input').value) || 0,
        deduction: Number(tr.querySelector('.deduction-input').value) || 0,
        finalized_by: PROFILE.id, finalized_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('payroll').upsert(payload, { onConflict: 'employee_id,year,month' });
      if (error) { alert('Lỗi lưu: ' + error.message); return; }
      await loadTable();
    });
  });
}

// Tự tính khấu trừ theo số ngày nghỉ không lương trong tháng — công thức
// phổ biến: khấu trừ = (lương cơ bản / 26 ngày công chuẩn) × số ngày nghỉ
// không lương. Chỉ ĐIỀN GỢI Ý vào ô, kế toán vẫn xem lại và có thể sửa tay
// trước khi bấm Lưu — không tự động ghi thẳng vào database.
function applyAutoDeduction() {
  document.querySelectorAll('#tableBody tr').forEach((tr) => {
    const deductionInput = tr.querySelector('.deduction-input');
    if (!deductionInput) return;
    const unpaidDays = Number(deductionInput.dataset.unpaidDays || 0);
    const base = Number(deductionInput.dataset.base || 0);
    if (unpaidDays > 0 && base > 0) {
      const suggested = Math.round((base / STANDARD_WORKING_DAYS) * unpaidDays);
      deductionInput.value = suggested;
      deductionInput.dispatchEvent(new Event('input'));
    }
  });
}
document.getElementById('btnAutoDeduction').addEventListener('click', applyAutoDeduction);

function renderStats(rows) {
  const total = rows.reduce((sum, r) => sum + Number(r.payroll.base_salary || 0) + Number(r.payroll.bonus || 0) - Number(r.payroll.deduction || 0), 0);
  const totalBase = rows.reduce((sum, r) => sum + Number(r.payroll.base_salary || 0), 0);
  const totalBonus = rows.reduce((sum, r) => sum + Number(r.payroll.bonus || 0), 0);

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Tổng chi lương tháng</div><div class="value mono" style="font-size:20px;">${fmtMoney(total)} đ</div></div>
    <div class="stat-card"><div class="label">Tổng lương cơ bản</div><div class="value mono" style="font-size:20px;">${fmtMoney(totalBase)} đ</div></div>
    <div class="stat-card"><div class="label">Tổng thưởng</div><div class="value mono" style="font-size:20px;">${fmtMoney(totalBonus)} đ</div></div>
    <div class="stat-card"><div class="label">Số nhân viên</div><div class="value mono" style="font-size:20px;">${rows.length}</div></div>
  `;
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
    CAN_EDIT = profile.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);

    if (!CAN_EDIT) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Bạn không có quyền thực hiện thao tác.</div>';
      return;
    }

    const { data: employees } = await supabase.from('employees').select('id, employee_code, full_name').eq('status', 'active').order('employee_code');
    ALL_EMPLOYEES = employees || [];
    monthOptions();
    await loadTable();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
