import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { payrollBase } from '/js/attendanceModel.js';
let LOCKED_PERIODS = {};


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

// LÀM LẠI 22/08/2026 — theo yêu cầu chuẩn hoá:
// 1) CHỈ "Nghỉ không lương" (form_code balanceImpact='unpaid') mới bị trừ
//    lương. Nghỉ phép (annual)/Nghỉ bù (compensatory)/Hoán đổi ngày nghỉ
//    (none) đều KHÔNG bị trừ — trước đây gộp chung TẤT CẢ các loại vào 1
//    biến "leaveDays" rồi trừ hết, sai với quy định thực tế.
// 2) "leaveDays" giữ lại CHỈ để hiển thị báo cáo (tổng ngày nghỉ mọi
//    loại), KHÔNG còn dùng để trừ lương — xem unpaidLeaveDays.
async function loadLockedPeriods(year,month){
 const {data,error}=await supabase.from('attendance_summary').select('*').eq('year',year).eq('month',month).eq('status','locked');
 if(error)throw error;LOCKED_PERIODS=Object.fromEntries((data||[]).map(p=>[p.employee_id,p]));return LOCKED_PERIODS;
}
async function loadLeaveDays(year,month){const map=await loadLockedPeriods(year,month);return {leaveDaysMap:Object.fromEntries(Object.entries(map).map(([id,p])=>[id,Number(p.leave_days)])),unpaidLeaveDaysMap:Object.fromEntries(Object.entries(map).map(([id,p])=>[id,Number(p.unpaid_days)]))};}
async function loadAbsentDays(year,month){const map=await loadLockedPeriods(year,month);return {absentDaysMap:Object.fromEntries(Object.entries(map).map(([id,p])=>[id,Number(p.absent_days)])),isEstimated:Object.fromEntries(ALL_EMPLOYEES.map(e=>[e.id,!map[e.id]]))};}

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
  tbody.innerHTML = '<tr><td colspan="18" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const [{ data: configs }, { data: payrolls }, { leaveDaysMap, unpaidLeaveDaysMap }, { absentDaysMap, isEstimated }, advanceMap] = await Promise.all([
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
      attendance: LOCKED_PERIODS[emp.id] || null,
      leaveDays: leaveDaysMap[emp.id] || 0,
      unpaidLeaveDays: unpaidLeaveDaysMap[emp.id] || 0,
      absentDays: absentDaysMap[emp.id] || 0,
      absentDaysEstimated: isEstimated[emp.id] || false,
      // Kế toán đã ghi đè tay chưa — ưu tiên hiển thị/dùng số này thay
      // vì số hệ thống tự tính, theo đúng yêu cầu "cho kế toán thao tác
      // tay trong trường hợp lỗi".
      absentDaysOverride: null,
      advanceTotal: advanceMap[emp.id] || 0,
      performance_bonus: existing?.performance_bonus || 0,
      urgent_bonus: existing?.urgent_bonus || 0,
      penalty_amount: existing?.penalty_amount || 0,
      insurance_deduction: existing?.insurance_deduction ?? 0,
      tax_deduction: existing?.tax_deduction || 0,
      payrollId: existing?.id || null,
      paidAt: existing?.paid_at || null,
    };
  });

  render();
}

function computeNet(row) {
 const paidBase=row.attendance?payrollBase(Number(row.config.base_salary||0),Number(row.attendance.paid_days),Number(row.attendance.standard_days)):0;
 return paidBase+Number(row.config.housing_allowance||0)+Number(row.config.transport_allowance||0)+Number(row.config.other_allowance||0)+Number(row.performance_bonus||0)+Number(row.urgent_bonus||0)-Number(row.penalty_amount||0)-Number(row.advanceTotal||0)-Number(row.insurance_deduction??557550)-Number(row.tax_deduction||0);
}

function render() {
  const tbody = document.getElementById('tableBody');
  const rows = Object.values(ROW_DATA);
  renderStats(rows);

  tbody.innerHTML = rows.map(({ employee, config, leaveDays, unpaidLeaveDays, absentDays, absentDaysEstimated, absentDaysOverride, advanceTotal, performance_bonus, urgent_bonus, penalty_amount, insurance_deduction, tax_deduction, paidAt }) => {
    const net = computeNet(ROW_DATA[employee.id]);
    const absentDisplayValue = absentDaysOverride ?? absentDays;
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
      <td class="mono" style="text-align:center;">${unpaidLeaveDays > 0 ? `<span class="badge badge-rejected">${unpaidLeaveDays}</span>` : '0'}</td>
      <td style="text-align:center;">
        <input type="number" class="absent-input" value="${absentDisplayValue}" disabled style="width:64px; text-align:center;" title="${absentDaysEstimated ? 'Chưa có bảng công đã chốt' : `Hệ thống tự tính: ${absentDays} ngày`}" />
        ${absentDaysEstimated ? '<div style="font-size:10px; color:var(--warning); margin-top:2px;">Chưa chốt bảng công</div>' : ''}
        ${absentDaysOverride !== null && absentDaysOverride !== undefined ? '<div style="font-size:10px; color:var(--accent-deep); margin-top:2px;">✎ đã sửa tay</div>' : ''}
      </td>
      <td><input type="number" class="penalty-input" value="${penalty_amount}" ${CAN_EDIT ? '' : 'disabled'} style="width:90px;" /></td>
      <td class="mono cell-muted">${fmtMoney(advanceTotal)} đ</td>
      <td><input type="number" class="insurance-input" value="${insurance_deduction}" ${CAN_EDIT ? '' : 'disabled'} style="width:100px;" title="Nhập khấu trừ bảo hiểm theo hồ sơ nhân sự" /></td>
      <td><input type="number" class="tax-input" value="${tax_deduction}" ${CAN_EDIT ? '' : 'disabled'} style="width:90px;" placeholder="Nhập tay" /></td>
      <td class="mono net-display" style="font-weight:700;">${ROW_DATA[employee.id].attendance ? fmtMoney(net)+' đ' : 'Chưa có bảng công chốt'}</td>
      <td>${paidAt ? `<span class="badge badge-active" title="${new Date(paidAt).toLocaleString('vi-VN')}">Đã chi</span>` : '<span class="cell-muted" style="font-size:11px;">Chưa chi</span>'}</td>
      <td>${CAN_EDIT ? `<button class="btn btn-accent btn-sm" data-save="${employee.id}">Lưu</button>` : ''}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.perf-input, .urgent-input, .penalty-input, .insurance-input, .tax-input, .absent-input').forEach((input) => {
    input.addEventListener('input', () => {
      const tr = input.closest('tr');
      const empId = tr.dataset.employee;
      ROW_DATA[empId].performance_bonus = Number(tr.querySelector('.perf-input').value) || 0;
      ROW_DATA[empId].urgent_bonus = Number(tr.querySelector('.urgent-input').value) || 0;
      ROW_DATA[empId].penalty_amount = Number(tr.querySelector('.penalty-input').value) || 0;
      ROW_DATA[empId].insurance_deduction = Number(tr.querySelector('.insurance-input').value) || 0;
      ROW_DATA[empId].tax_deduction = Number(tr.querySelector('.tax-input').value) || 0;
      // Ô "Ngày không CC" giờ ghi vào absentDaysOverride (không ghi đè
      // absentDays gốc do hệ thống tự tính) — để vẫn giữ được số liệu
      // hệ thống tính ra làm cơ sở so sánh/kiểm tra sau này. Nếu Kế toán
      // sửa về ĐÚNG BẰNG số hệ thống tự tính (không thực sự override),
      // coi như không ghi đè (null) để không hiện nhãn "đã sửa tay" sai.
      const absentInputVal = Number(tr.querySelector('.absent-input').value) || 0;
      ROW_DATA[empId].absentDaysOverride = absentInputVal === ROW_DATA[empId].absentDays ? null : absentInputVal;
      tr.querySelector('.net-display').textContent = fmtMoney(computeNet(ROW_DATA[empId])) + ' đ';
    });
  });

  tbody.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const [year, month] = document.getElementById('filterMonth').value.split('-').map(Number);
      const empId = btn.dataset.save;
      const row = ROW_DATA[empId];
      if (!row.attendance) { alert('Chưa có bảng công đã chốt. Vào Bảng công nhân sự để hoàn tất trước khi lưu lương.'); return; }
      const payload = {
        attendance_period_id: row.attendance.id,
        standard_working_days: row.attendance.standard_days,
        paid_working_days: row.attendance.paid_days,
        employee_id: empId, year, month,
        base_salary: row.config.base_salary || 0,
        housing_allowance: row.config.housing_allowance || 0,
        transport_allowance: row.config.transport_allowance || 0,
        other_allowance: row.config.other_allowance || 0,
        performance_bonus: row.performance_bonus || 0,
        urgent_bonus: row.urgent_bonus || 0,
        penalty_amount: row.penalty_amount || 0,
        insurance_deduction: row.insurance_deduction ?? 0,
        tax_deduction: row.tax_deduction || 0,
        advance_deduction: row.advanceTotal || 0,
        leave_days: row.leaveDays || 0,
        unpaid_leave_days: row.unpaidLeaveDays || 0,
        absent_days: row.absentDays || 0,
        absent_days_override: null,
        ...(row.absentDaysOverride !== null && row.absentDaysOverride !== undefined
          ? { overridden_by: PROFILE.id, overridden_at: new Date().toISOString() }
          : {}),
        finalized_by: PROFILE.id, finalized_at: new Date().toISOString(),
      };
      btn.disabled = true; btn.textContent = 'Đang lưu...';
      const { error } = await supabase.from('payroll').upsert(payload, { onConflict: 'employee_id,year,month' });
      btn.disabled = false; btn.textContent = 'Lưu';
      if (error) { alert('Lỗi lưu: ' + error.message); return; }
      btn.textContent = 'Đã lưu';
      setTimeout(() => { btn.textContent = 'Lưu'; }, 1500);
    });
  });
}

function renderStats(rows) {
  const totalNet = rows.reduce((s, r) => s + computeNet(ROW_DATA[r.employee.id]), 0);
  const totalLeave = rows.reduce((s, r) => s + Number(r.leaveDays || 0), 0);
  const totalAbsent = rows.reduce((s, r) => s + Number(r.absentDaysOverride ?? r.absentDays ?? 0), 0);
  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Tổng quỹ lương tháng này</div><div class="value mono">${fmtMoney(totalNet)} đ</div></div>
    <div class="stat-card"><div class="label">Tổng ngày nghỉ (toàn công ty)</div><div class="value mono">${totalLeave}</div></div>
    <div class="stat-card"><div class="label">Tổng ngày không chấm công</div><div class="value mono" style="color:var(--danger);">${totalAbsent}</div></div>
  `;
}

document.getElementById('btnRecalc').addEventListener('click', loadTable);
document.getElementById('filterMonth').addEventListener('change', loadTable);

// ============ Xac nhan chi luong -> ghi So cai ============
const confirmPaymentModal = document.getElementById('confirmPaymentModal');
document.getElementById('btnConfirmPayment').addEventListener('click', () => {
  document.getElementById('payrollConfirmError').classList.remove('show');
  confirmPaymentModal.classList.add('show');
});
document.getElementById('closeConfirmPaymentModal').addEventListener('click', () => confirmPaymentModal.classList.remove('show'));
document.getElementById('cancelConfirmPayment').addEventListener('click', () => confirmPaymentModal.classList.remove('show'));

document.getElementById('submitConfirmPayment').addEventListener('click', async () => {
  const errBox = document.getElementById('payrollConfirmError');
  errBox.classList.remove('show');
  const [year, month] = document.getElementById('filterMonth').value.split('-').map(Number);
  const method = document.getElementById('payrollPaymentMethod').value;

  const btn = document.getElementById('submitConfirmPayment');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  const { data, error } = await supabase.rpc('mark_payroll_paid_bulk', { p_year: year, p_month: month, p_actor_id: PROFILE.id, p_method: method });
  btn.disabled = false; btn.textContent = 'Xác nhận & ghi sổ';

  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }

  confirmPaymentModal.classList.remove('show');
  const result = data;
  alert(`Đã xác nhận chi lương cho ${result.success} nhân viên.${result.failed > 0 ? `\n\n${result.failed} người bị lỗi: ${result.errors}` : ''}`);
  await loadTable();
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, departmentCode: emp?.departments?.code };
    // Ma tran: Bang tinh luong chi Ke toan duoc ghi, BDH/Ky thuat/NS chi xem.
    CAN_EDIT = PROFILE.departmentCode === 'ACC';
    if (!CAN_EDIT) document.getElementById('btnConfirmPayment').style.display = 'none';

    monthOptions();
    const { data: employees } = await supabase.from('employees').select('id, employee_code, full_name, center_id, positions(name), departments(code)').eq('status', 'active').order('full_name');
    ALL_EMPLOYEES = employees || [];

    await loadTable();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
