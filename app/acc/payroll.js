import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { ALL_FORMS } from '/js/leaveFormFlow.js';

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

// LÀM LẠI 22/08/2026 — theo yêu cầu chuẩn hoá:
// 1) CHỈ "Nghỉ không lương" (form_code balanceImpact='unpaid') mới bị trừ
//    lương. Nghỉ phép (annual)/Nghỉ bù (compensatory)/Hoán đổi ngày nghỉ
//    (none) đều KHÔNG bị trừ — trước đây gộp chung TẤT CẢ các loại vào 1
//    biến "leaveDays" rồi trừ hết, sai với quy định thực tế.
// 2) "leaveDays" giữ lại CHỈ để hiển thị báo cáo (tổng ngày nghỉ mọi
//    loại), KHÔNG còn dùng để trừ lương — xem unpaidLeaveDays.
async function loadLeaveDays(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(year, month, 1).toISOString().slice(0, 10);
  const { data } = await supabase.from('leave_requests').select('employee_id, days, form_code')
    .eq('status', 'approved_3').gte('start_date', from).lt('start_date', to);
  const leaveDaysMap = {};      // tổng mọi loại — chỉ để báo cáo
  const unpaidLeaveDaysMap = {}; // CHỈ "Nghỉ không lương" — dùng để trừ lương
  (data || []).forEach((r) => {
    leaveDaysMap[r.employee_id] = (leaveDaysMap[r.employee_id] || 0) + Number(r.days || 0);
    const impact = ALL_FORMS.find((f) => f.code === r.form_code)?.balanceImpact;
    if (impact === 'unpaid') {
      unpaidLeaveDaysMap[r.employee_id] = (unpaidLeaveDaysMap[r.employee_id] || 0) + Number(r.days || 0);
    }
  });
  return { leaveDaysMap, unpaidLeaveDaysMap };
}

// MỚI — xác định ĐÚNG những ngày nhân sự thực sự phải chấm công trong
// tháng, dựa vào lịch làm việc THẬT thay vì áp cứng "nghỉ Chủ nhật, làm
// Thứ 2-Thứ 7" (sai vì nhiều trung tâm/giáo viên làm việc cả Chủ nhật
// theo ca thực tế). Gộp từ 3 nguồn lịch khác nhau tuỳ loại nhân sự:
// - Văn phòng (HR/ACC/MKT/FAC...): work_schedules
// - Trực trung tâm (Quản lý TT/Tư vấn viên...): center_duty_schedules
// - Giáo viên: teacher_weekly_schedules (lặp theo tuần, quy đổi ra ngày
//   cụ thể từ week_start_date + day_of_week)
// Nếu 1 nhân sự KHÔNG có bất kỳ dữ liệu lịch nào trong tháng (chưa ai
// nhập lịch cho họ) — dùng tạm quy tắc cũ (Thứ 2-7) làm phương án dự
// phòng, để không bỏ sót hoàn toàn, và đánh dấu rõ "ước tính" trên giao
// diện để Kế toán biết mà kiểm tra/ghi đè tay nếu cần.
async function getRequiredWorkDatesMap(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(year, month, 1).toISOString().slice(0, 10);
  const daysInMonth = new Date(year, month, 0).getDate();
  // Lấy rộng hơn 7 ngày về trước để không sót tuần bắt đầu từ tháng
  // trước nhưng có ngày rơi vào tháng đang tính (teacher_weekly_schedules
  // quy đổi theo week_start_date + day_of_week).
  const weekFrom = new Date(new Date(from).getTime() - 7 * 86400000).toISOString().slice(0, 10);

  const [{ data: workSched }, { data: dutySched }, { data: teacherSched }] = await Promise.all([
    supabase.from('work_schedules').select('employee_id, work_date').gte('work_date', from).lt('work_date', to),
    supabase.from('center_duty_schedules').select('employee_id, duty_date').gte('duty_date', from).lt('duty_date', to),
    supabase.from('teacher_weekly_schedules').select('teacher_id, week_start_date, day_of_week').gte('week_start_date', weekFrom).lt('week_start_date', to),
  ]);

  const datesByEmp = {};
  const hasRealSchedule = new Set();
  function addDate(empId, dateStr) {
    if (!datesByEmp[empId]) datesByEmp[empId] = new Set();
    datesByEmp[empId].add(dateStr);
    hasRealSchedule.add(empId);
  }
  (workSched || []).forEach((r) => addDate(r.employee_id, r.work_date));
  (dutySched || []).forEach((r) => addDate(r.employee_id, r.duty_date));
  (teacherSched || []).forEach((r) => {
    const d = new Date(r.week_start_date + 'T00:00:00');
    d.setDate(d.getDate() + (Number(r.day_of_week) - 1)); // day_of_week: 1=Thứ 2 ... 7=Chủ nhật
    const dateStr = d.toISOString().slice(0, 10);
    if (dateStr >= from && dateStr < to) addDate(r.teacher_id, dateStr);
  });

  const fallbackDates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    if (dt.getDay() !== 0) fallbackDates.push(dt.toISOString().slice(0, 10));
  }

  return { datesByEmp, hasRealSchedule, fallbackDates };
}

async function loadAbsentDays(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01T00:00:00`;
  const to = new Date(year, month, 1).toISOString();
  const dateFrom = from.slice(0, 10), dateTo = to.slice(0, 10);

  const [{ datesByEmp, hasRealSchedule, fallbackDates }, { data: checkins }, { data: excused }, { data: approvedLeaves }] = await Promise.all([
    getRequiredWorkDatesMap(year, month),
    supabase.from('attendance_checkins').select('employee_id, checked_at').eq('check_type', 'in').gte('checked_at', from).lt('checked_at', to),
    supabase.from('late_clockin_requests').select('employee_id, late_date').eq('status', 'approved').gte('late_date', dateFrom).lt('late_date', dateTo),
    // Lấy CẢ 4 loại đơn đã duyệt (Nghỉ phép/Nghỉ bù/Hoán đổi/Không lương)
    // — TẤT CẢ đều là lý do chính đáng KHÔNG PHẢI chấm công ngày đó, dù
    // chỉ "Nghỉ không lương" mới thực sự bị trừ lương (xem loadLeaveDays).
    // Đây chính là "liên kết với phiếu nghỉ/phiếu hoán đổi" theo yêu cầu:
    // ngày đã có đơn hoán đổi/nghỉ bù/nghỉ phép được duyệt sẽ KHÔNG bị
    // tính nhầm là "vắng không lý do".
    supabase.from('leave_requests').select('employee_id, start_date, days').eq('status', 'approved_3'),
  ]);

  const checkedByEmp = {};
  (checkins || []).forEach((c) => {
    checkedByEmp[c.employee_id] = checkedByEmp[c.employee_id] || new Set();
    checkedByEmp[c.employee_id].add(c.checked_at.slice(0, 10));
  });
  const excusedByEmp = {};
  (excused || []).forEach((e) => {
    excusedByEmp[e.employee_id] = excusedByEmp[e.employee_id] || new Set();
    excusedByEmp[e.employee_id].add(e.late_date);
  });
  const leaveDatesByEmp = {};
  (approvedLeaves || []).forEach((lv) => {
    const start = new Date(lv.start_date + 'T00:00:00');
    const numDays = Math.ceil(Number(lv.days) || 0);
    for (let i = 0; i < numDays; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      if (key >= dateFrom && key < dateTo) {
        leaveDatesByEmp[lv.employee_id] = leaveDatesByEmp[lv.employee_id] || new Set();
        leaveDatesByEmp[lv.employee_id].add(key);
      }
    }
  });

  const result = {};
  const isEstimated = {}; // nhân sự nào đang dùng lịch dự phòng (chưa có lịch làm việc thật)
  ALL_EMPLOYEES.forEach((emp) => {
    const workDates = hasRealSchedule.has(emp.id) ? [...datesByEmp[emp.id]] : fallbackDates;
    isEstimated[emp.id] = !hasRealSchedule.has(emp.id);
    const checkedDates = checkedByEmp[emp.id] || new Set();
    const excusedDates = excusedByEmp[emp.id] || new Set();
    const leaveDates = leaveDatesByEmp[emp.id] || new Set();
    result[emp.id] = workDates.filter((d) => !checkedDates.has(d) && !excusedDates.has(d) && !leaveDates.has(d)).length;
  });
  return { absentDaysMap: result, isEstimated };
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
      leaveDays: leaveDaysMap[emp.id] || 0,
      unpaidLeaveDays: unpaidLeaveDaysMap[emp.id] || 0,
      absentDays: absentDaysMap[emp.id] || 0,
      absentDaysEstimated: isEstimated[emp.id] || false,
      // Kế toán đã ghi đè tay chưa — ưu tiên hiển thị/dùng số này thay
      // vì số hệ thống tự tính, theo đúng yêu cầu "cho kế toán thao tác
      // tay trong trường hợp lỗi".
      absentDaysOverride: existing?.absent_days_override ?? null,
      advanceTotal: advanceMap[emp.id] || 0,
      performance_bonus: existing?.performance_bonus || 0,
      urgent_bonus: existing?.urgent_bonus || 0,
      penalty_amount: existing?.penalty_amount || 0,
      insurance_deduction: existing?.insurance_deduction ?? 557550,
      tax_deduction: existing?.tax_deduction || 0,
      payrollId: existing?.id || null,
      paidAt: existing?.paid_at || null,
    };
  });

  render();
}

function computeNet(row) {
  const base = Number(row.config.base_salary || 0);
  const allowances = Number(row.config.housing_allowance || 0) + Number(row.config.transport_allowance || 0) + Number(row.config.other_allowance || 0);
  const bonuses = Number(row.performance_bonus || 0) + Number(row.urgent_bonus || 0);
  // CHỈ (số ngày vắng thật + số ngày Nghỉ KHÔNG LƯƠNG) mới bị trừ — Nghỉ
  // phép/Nghỉ bù/Hoán đổi ngày nghỉ KHÔNG bị trừ (đã tách riêng ở
  // loadLeaveDays, xem row.unpaidLeaveDays). Ưu tiên dùng số Kế toán đã
  // ghi đè tay (absentDaysOverride) nếu có — khớp đúng công thức
  // generated column net_salary trong database (migration
  // 20260101000168), không được để 2 nơi tính lệch nhau.
  const effectiveAbsentDays = row.absentDaysOverride ?? Number(row.absentDays || 0);
  const leaveDeduction = (effectiveAbsentDays + Number(row.unpaidLeaveDays || 0)) * (base / STANDARD_WORKING_DAYS);
  return base + bonuses + allowances - leaveDeduction - Number(row.penalty_amount || 0) - Number(row.advanceTotal || 0)
    - Number(row.insurance_deduction || 0) - Number(row.tax_deduction || 0);
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
        <input type="number" class="absent-input" value="${absentDisplayValue}" ${CAN_EDIT ? '' : 'disabled'} style="width:64px; text-align:center;" title="${absentDaysEstimated ? 'Ước tính (chưa có lịch làm việc thật cho tháng này) — kiểm tra kỹ trước khi lưu' : `Hệ thống tự tính: ${absentDays} ngày`}" />
        ${absentDaysEstimated ? '<div style="font-size:10px; color:var(--warning); margin-top:2px;">⚠️ ước tính</div>' : ''}
        ${absentDaysOverride !== null && absentDaysOverride !== undefined ? '<div style="font-size:10px; color:var(--accent-deep); margin-top:2px;">✎ đã sửa tay</div>' : ''}
      </td>
      <td><input type="number" class="penalty-input" value="${penalty_amount}" ${CAN_EDIT ? '' : 'disabled'} style="width:90px;" /></td>
      <td class="mono cell-muted">${fmtMoney(advanceTotal)} đ</td>
      <td><input type="number" class="insurance-input" value="${insurance_deduction}" ${CAN_EDIT ? '' : 'disabled'} style="width:100px;" title="Mặc định 10.5% x 5.310.000, sửa được nếu mức tham chiếu thay đổi" /></td>
      <td><input type="number" class="tax-input" value="${tax_deduction}" ${CAN_EDIT ? '' : 'disabled'} style="width:90px;" placeholder="Nhập tay" /></td>
      <td class="mono net-display" style="font-weight:700;">${fmtMoney(net)} đ</td>
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
      const payload = {
        employee_id: empId, year, month,
        base_salary: row.config.base_salary || 0,
        housing_allowance: row.config.housing_allowance || 0,
        transport_allowance: row.config.transport_allowance || 0,
        other_allowance: row.config.other_allowance || 0,
        performance_bonus: row.performance_bonus || 0,
        urgent_bonus: row.urgent_bonus || 0,
        penalty_amount: row.penalty_amount || 0,
        insurance_deduction: row.insurance_deduction ?? 557550,
        tax_deduction: row.tax_deduction || 0,
        advance_deduction: row.advanceTotal || 0,
        leave_days: row.leaveDays || 0,
        unpaid_leave_days: row.unpaidLeaveDays || 0,
        absent_days: row.absentDays || 0,
        absent_days_override: row.absentDaysOverride,
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
