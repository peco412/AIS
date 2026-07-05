import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

function statCard(label, value, valueColor) {
  return `<div class="stat-card"><div class="label">${esc(label)}</div><div class="value mono"${valueColor ? ` style="color:${valueColor};"` : ''}>${value}</div></div>`;
}

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('filterCenter').innerHTML = '<option value="">Tất cả trung tâm</option>' +
    (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadHR() {
  const [{ count: total }, { count: active }, { count: pendingLeave }, { count: pendingContracts }] = await Promise.all([
    supabase.from('employees').select('id', { count: 'exact', head: true }),
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    supabase.from('contracts').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'approved_1']),
  ]);
  document.getElementById('statsHR').innerHTML = [
    statCard('Tổng nhân viên', total ?? 0),
    statCard('Đang làm việc', active ?? 0),
    statCard('Đơn nghỉ phép chờ duyệt', pendingLeave ?? 0, pendingLeave ? 'var(--warning)' : null),
    statCard('Hợp đồng chờ ký', pendingContracts ?? 0, pendingContracts ? 'var(--warning)' : null),
  ].join('');
  return (pendingLeave ?? 0) + (pendingContracts ?? 0);
}

async function loadACC(centerId) {
  let payQuery = supabase.from('payment_requests').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'approved_1']);
  let advQuery = supabase.from('advance_requests').select('id', { count: 'exact', head: true }).in('status', ['draft', 'approved_1']);
  let recvQuery = supabase.from('receivables').select('amount').in('status', ['open', 'partial', 'overdue']);
  let cashQuery = supabase.from('cash_flow_entries').select('entry_type, amount').gte('entry_date', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  if (centerId) { payQuery = payQuery.eq('center_id', centerId); recvQuery = recvQuery.eq('center_id', centerId); cashQuery = cashQuery.eq('center_id', centerId); }

  const [{ count: pendingPay }, { count: pendingAdv }, { data: recvRows }, { data: cashRows }] = await Promise.all([payQuery, advQuery, recvQuery, cashQuery]);

  const totalReceivable = (recvRows || []).reduce((s, r) => s + Number(r.amount), 0);
  const inflow = (cashRows || []).filter((r) => r.entry_type === 'inflow').reduce((s, r) => s + Number(r.amount), 0);
  const outflow = (cashRows || []).filter((r) => r.entry_type === 'outflow').reduce((s, r) => s + Number(r.amount), 0);

  document.getElementById('statsACC').innerHTML = [
    statCard('Phiếu thanh toán chờ ký', pendingPay ?? 0, pendingPay ? 'var(--warning)' : null),
    statCard('Phiếu tạm ứng chờ ký', pendingAdv ?? 0, pendingAdv ? 'var(--warning)' : null),
    statCard('Công nợ phải thu', fmtMoney(totalReceivable) + ' đ'),
    statCard('Dòng tiền tháng này', fmtMoney(inflow - outflow) + ' đ', (inflow - outflow) < 0 ? 'var(--danger)' : 'var(--success)'),
  ].join('');
  return { pending: (pendingPay ?? 0) + (pendingAdv ?? 0), inflow, outflow };
}

async function loadMKT(centerId) {
  let commQuery = supabase.from('communication_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']);
  let eventQuery = supabase.from('event_proposals').select('id', { count: 'exact', head: true }).in('status', ['draft', 'approved_1']);
  let expenseQuery = supabase.from('mkt_ad_expenses').select('amount').gte('spend_date', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  if (centerId) { eventQuery = eventQuery.eq('center_id', centerId); expenseQuery = expenseQuery.eq('center_id', centerId); }

  const [{ count: pendingComm }, { count: pendingEvent }, { data: expenseRows }] = await Promise.all([commQuery, eventQuery, expenseQuery]);
  const totalExpense = (expenseRows || []).reduce((s, r) => s + Number(r.amount), 0);

  document.getElementById('statsMKT').innerHTML = [
    statCard('Yêu cầu truyền thông đang xử lý', pendingComm ?? 0, pendingComm ? 'var(--warning)' : null),
    statCard('Trình sự kiện chờ duyệt', pendingEvent ?? 0, pendingEvent ? 'var(--warning)' : null),
    statCard('Chi phí quảng cáo tháng này', fmtMoney(totalExpense) + ' đ'),
  ].join('');
  return (pendingComm ?? 0) + (pendingEvent ?? 0);
}

async function loadFAC(centerId) {
  let facReqQuery = supabase.from('facility_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']);
  let purchaseQuery = supabase.from('purchase_requests').select('id', { count: 'exact', head: true }).in('status', ['draft', 'approved_1']);
  let assetQuery = supabase.from('facility_assets').select('quantity, condition');
  if (centerId) { assetQuery = assetQuery.eq('center_id', centerId); }

  const [{ count: pendingReq }, { count: pendingPurchase }, { data: assetRows }] = await Promise.all([facReqQuery, purchaseQuery, assetQuery]);
  const needsRepair = (assetRows || []).filter((a) => a.condition === 'needs_repair' || a.condition === 'broken').reduce((s, a) => s + a.quantity, 0);

  document.getElementById('statsFAC').innerHTML = [
    statCard('Yêu cầu CSVC đang xử lý', pendingReq ?? 0, pendingReq ? 'var(--warning)' : null),
    statCard('Phiếu mua sắm chờ duyệt', pendingPurchase ?? 0, pendingPurchase ? 'var(--warning)' : null),
    statCard('Tài sản cần sửa chữa/hỏng', needsRepair, needsRepair ? 'var(--danger)' : null),
  ].join('');
  return (pendingReq ?? 0) + (pendingPurchase ?? 0);
}

async function loadEDU(centerId) {
  let classQuery = supabase.from('classes').select('id, student_count, status').eq('status', 'active');
  let studentQuery = supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'studying');
  let leadQuery = supabase.from('crm_leads').select('id', { count: 'exact', head: true }).eq('status', 'potential');
  if (centerId) { classQuery = classQuery.eq('center_id', centerId); studentQuery = studentQuery.eq('center_id', centerId); leadQuery = leadQuery.eq('center_id', centerId); }

  const [{ data: classRows }, { count: studentCount }, { count: leadCount }] = await Promise.all([classQuery, studentQuery, leadQuery]);
  const totalSeats = (classRows || []).reduce((s, c) => s + (c.student_count || 0), 0);

  document.getElementById('statsEDU').innerHTML = [
    statCard('Lớp đang hoạt động', (classRows || []).length),
    statCard('Tổng sĩ số đang học', totalSeats),
    statCard('Học viên đang học', studentCount ?? 0),
    statCard('Hồ sơ tiềm năng (CRM)', leadCount ?? 0),
  ].join('');
}

let pendingChart = null;
let cashChart = null;

async function loadAll() {
  const centerId = document.getElementById('filterCenter').value;
  const [hrPending, accData, mktPending, facPending] = await Promise.all([
    loadHR(), loadACC(centerId), loadMKT(centerId), loadFAC(centerId), loadEDU(centerId),
  ]);

  renderPendingChart({ 'Nhân sự': hrPending, 'Kế toán': accData.pending, 'Truyền thông': mktPending, 'CSVC': facPending });
  renderCashFlowChart(accData.inflow, accData.outflow);
}

function renderPendingChart(byDept) {
  const ctx = document.getElementById('pendingByDeptChart').getContext('2d');
  if (pendingChart) pendingChart.destroy();
  pendingChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(byDept),
      datasets: [{
        label: 'Đang chờ xử lý',
        data: Object.values(byDept),
        backgroundColor: ['#ff8a00', '#059669', '#2563eb', '#0891b2'],
        borderRadius: 8,
        maxBarThickness: 46,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderCashFlowChart(inflow, outflow) {
  const ctx = document.getElementById('cashFlowChart').getContext('2d');
  if (cashChart) cashChart.destroy();
  cashChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Thu vào', 'Chi ra'],
      datasets: [{ data: [inflow, outflow], backgroundColor: ['#22c55e', '#ef4444'], borderWidth: 0 }],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11.5 } } } },
      cutout: '68%',
    },
  });
}

document.getElementById('filterCenter').addEventListener('change', loadAll);

(async () => {
  try {
    await bootShell();
    await loadCenters();
    await loadAll();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
