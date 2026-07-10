import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const STANDARD_WORKING_DAYS = 26;
let PROFILE = null;
let ALL_EMPLOYEES = [];
let CAN_EDIT = false;
let ROW_DATA = {}; // employee_id -> { config, payroll, leaveDays, absentDays, advanceTotal }

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

// Số ngày nghỉ đã duyệt xong (approved_3) có ngày bắt đầu rơi vào tháng
// đang xem, cho TỪNG nhân viên.
async function loadLeaveDays(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(year, month, 1).toISOString().slice(0, 10);
  const { data } = await supabase.from('leave_requests').select('employee_id, days')
    .eq('status', 'approved_3').gte('start_date', from).lt('start_date', to);
  const map = {};
  (data || []).forEach((r) => { map[r.employee_id] = (map[r.employee_id] || 0) + Number(r.days || 0); });
  return map;
}

// Số ngày KHÔNG chấm công (không có GPS check-in "vào") trong các ngày
// làm việc (loại Chủ nhật) của tháng, TRỪ những ngày đã có đơn xin chấm
// công trễ được duyệt (được tính là đúng giờ, không bị trừ).
async function loadAbsentDays(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const workDates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    if (dt.getDay() !== 0) workDates.push(dt.toISOString().slice(0, 10)); // bỏ Chủ nhật
  }
  const from = `${year}-${String(month).padStart(2, '0')}-01T00:00:00`;
  const to = new Date(year, month, 1).toISOString();

  const [{ data: checkins }, { data: excused }] = await Promise.all([
    supabase.from('attendance_checkins').select('employee_id, checked_at').eq('check_type', 'in').gte('checked_at', from).lt('checked_at', to),
    supabase.from('late_clockin_requests').select('employee_id, late_date').eq('status', 'approved').gte('late_date', `${year}-${String(month).padStart(2, '0')}-01`).lt('late_date', to.slice(0, 10)),
  ]);

  const checkedByEmp = {}; // employee_id -> Set(dateStr)
  (checkins || []).forEach((c) => {
    checkedByEmp[c.employee_id] = checkedByEmp[c.employee_id] || new Set();
    checkedByEmp[c.employee_id].add(c.checked_at.slice(0, 10));
  });
  const excusedByEmp = {};
  (excused || []).forEach((e) => {
    excusedByEmp[e.employee_id] = excusedByEmp[e.employee_id] || new Set();
    excusedByEmp[e.employee_id].add(e.late_date);
  });

  const result = {};
  ALL_EMPLOYEES.forEach((emp) => {
    const checkedDates = checkedByEmp[emp.id] || new Set();
    const excusedDates = excusedByEmp[emp.id] || new Set();
    result[emp.id] = workDates.filter((d) => !checkedDates.has(d) && !excusedDates.has(d)).length;
  });
  return result;
}

// Tổng tiền tạm ứng đã duyệt xong (approved_2 = duyệt cấp cuối của phiếu
// tạm ứng), phát sinh trong đúng tháng đang tính lương.
async function loadAdvanceTotals(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(year, month, 1).toISOString().slice(0, 10);
  const { data } = await supabase.from('advance_requests').select('requester_id, amount')
    .eq('status', 'approved_3').gte('created_at', from).lt('created_at', to);
  const map = {};
  (data || []).forEach((r) => { map[r.requester_id] = (map[r.requester_id] || 0) + Number(r.amount || 0); });
  return map;
}

async function loadTable() {
  const [year, month] = document.getElementById('filterMonth').value.split('-').map(Number);
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="14" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const [{ data: configs }, { data: payrolls }, leaveDaysMap, absentDaysMap, advanceMap] = await Promise.all([
    supabase.from('employee_base_salary').select('*'),
    supabase.from('payroll').select('*').eq('year', year).eq('month', month),
    loadLeaveDays(year, month),
    loadAbsentDays(year, month),
    loadAdvanceTotals(year, month),
  ]);

  const configMap = {}; (configs || []).forEach((c) => { configMap[c.employee_id] = c; });
  const payrollMap = {}; (payrolls || []).forEach((p) => { payrollMap[p.employee_id] = p; });

  ROW_DATA = {};
  ALL_EMPLOYEES.forEach((emp) => {
    const config = configMap[emp.id] || { base_salary: 0, housing_allowance: 0, transport_allowance: 0, other_allowance: 0 };
    const existing = payrollMap[emp.id];
    ROW_DATA[emp.id] = {
      employee: emp,
      config,
      leaveDays: leaveDaysMap[emp.id] || 0,
      absentDays: absentDaysMap[emp.id] || 0,
      advanceTotal: advanceMap[emp.id] || 0,
      performance_bonus: existing?.performance_bonus || 0,
      urgent_bonus: existing?.urgent_bonus || 0,
      penalty_amount: existing?.penalty_amount || 0,
    };
  });

  render();
}

function computeNet(row) {
  const base = Number(row.config.base_salary || 0);
  const allowances = Number(row.config.housing_allowance || 0) + Number(row.config.transport_allowance || 0) + Number(row.config.other_allowance || 0);
  const bonuses = Number(row.performance_bonus || 0) + Number(row.urgent_bonus || 0);
  const leaveDeduction = (Number(row.leaveDays || 0) + Number(row.absentDays || 0)) * (base / STANDARD_WORKING_DAYS);
  return base + bonuses + allowances - leaveDeduction - Number(row.penalty_amount || 0) - Number(row.advanceTotal || 0);
}

function render() {
  const tbody = document.getElementById('tableBody');
  const rows = Object.values(ROW_DATA);
  renderStats(rows);

  tbody.innerHTML = rows.map(({ employee, config, leaveDays, absentDays, advanceTotal, performance_bonus, urgent_bonus, penalty_amount }) => {
    const net = computeNet(ROW_DATA[employee.id]);
    return `
    <tr data-employee="${employee.id}">
      <td class="cell-code">${esc(employee.employee_code)}</td>
      <td>${esc(employee.full_name)}</td>
      <td class="mono cell-muted">${fmtMoney(config.base_salary)} đ</td>
      <td><input type="number" class="perf-input" value="${performance_bonus}" ${CAN_EDIT ? '' : 'disabled'} style="width:90px;" /></td>
      <td><input type="number" class="urgent-input" value="${urgent_bonus}" ${CAN_EDIT ? '' : 'disabled'} style="width:90px;" /></td>
      <td class="mono cell-muted">${fmtMoney(config.housing_allowance)} đ</td>
      <td class="mono cell-muted">${fmtMoney(config.transport_allowance)} đ</td>
      <td class="mono cell-muted">${fmtMoney(config.other_allowance)} đ</td>
      <td class="mono" style="text-align:center;">${leaveDays > 0 ? `<span class="badge badge-submitted">${leaveDays}</span>` : '0'}</td>
      <td class="mono" style="text-align:center;">${absentDays > 0 ? `<span class="badge badge-rejected">${absentDays}</span>` : '0'}</td>
      <td><input type="number" class="penalty-input" value="${penalty_amount}" ${CAN_EDIT ? '' : 'disabled'} style="width:90px;" /></td>
      <td class="mono cell-muted">${fmtMoney(advanceTotal)} đ</td>
      <td class="mono net-display" style="font-weight:700;">${fmtMoney(net)} đ</td>
      <td>${CAN_EDIT ? `<button class="btn btn-accent btn-sm" data-save="${employee.id}">Lưu</button>` : ''}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.perf-input, .urgent-input, .penalty-input').forEach((input) => {
    input.addEventListener('input', () => {
      const tr = input.closest('tr');
      const empId = tr.dataset.employee;
      ROW_DATA[empId].performance_bonus = Number(tr.querySelector('.perf-input').value) || 0;
      ROW_DATA[empId].urgent_bonus = Number(tr.querySelector('.urgent-input').value) || 0;
      ROW_DATA[empId].penalty_amount = Number(tr.querySelector('.penalty-input').value) || 0;
      tr.querySelector('.net-display').textContent = fmtMoney(computeNet(ROW_DATA[empId])) + ' đ';
    });
  });

  tbody.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const [year, month] = document.getElementById('filterMonth').value.split('-').map(Number);
      const empId = btn.dataset.save;
      const row = ROW_DATA[empId];
      const payload = {
        employee_id: empId, year, month,
        base_salary: row.config.base_salary || 0,
        housing_allowance: row.config.housing_allowance || 0,
        transport_allowance: row.config.transport_allowance || 0,
        other_allowance: row.config.other_allowance || 0,
        performance_bonus: row.performance_bonus || 0,
        urgent_bonus: row.urgent_bonus || 0,
        penalty_amount: row.penalty_amount || 0,
        advance_deduction: row.advanceTotal || 0,
        leave_days: row.leaveDays || 0,
        absent_days: row.absentDays || 0,
        finalized_by: PROFILE.id, finalized_at: new Date().toISOString(),
      };
      btn.disabled = true; btn.textContent = 'Đang lưu...';
      const { error } = await supabase.from('payroll').upsert(payload, { onConflict: 'employee_id,year,month' });
      btn.disabled = false; btn.textContent = 'Lưu';
      if (error) { alert('Lỗi lưu: ' + error.message); return; }
      btn.textContent = '✓ Đã lưu';
      setTimeout(() => { btn.textContent = 'Lưu'; }, 1500);
    });
  });
}

function renderStats(rows) {
  const totalNet = rows.reduce((s, r) => s + computeNet(ROW_DATA[r.employee.id]), 0);
  const totalLeave = rows.reduce((s, r) => s + Number(r.leaveDays || 0), 0);
  const totalAbsent = rows.reduce((s, r) => s + Number(r.absentDays || 0), 0);
  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Tổng quỹ lương tháng này</div><div class="value mono">${fmtMoney(totalNet)} đ</div></div>
    <div class="stat-card"><div class="label">Tổng ngày nghỉ (toàn công ty)</div><div class="value mono">${totalLeave}</div></div>
    <div class="stat-card"><div class="label">Tổng ngày không chấm công</div><div class="value mono" style="color:var(--danger);">${totalAbsent}</div></div>
  `;
}

document.getElementById('btnRecalc').addEventListener('click', loadTable);
document.getElementById('filterMonth').addEventListener('change', loadTable);

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentCode: emp?.departments?.code };
    // Ma tran: Bang tinh luong chi Ke toan duoc ghi, BDH/Ky thuat/NS chi xem.
    CAN_EDIT = PROFILE.departmentCode === 'ACC';

    monthOptions();
    const { data: employees } = await supabase.from('employees').select('id, employee_code, full_name').eq('status', 'active').order('full_name');
    ALL_EMPLOYEES = employees || [];

    await loadTable();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
