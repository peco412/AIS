import { bootShell } from '/js/shell.js';
import { supabase, esc, notifyDepartmentHeads } from '/js/supabase.js';

let PROFILE = null;
let chartInstance = null;
let ALL_ROWS = [];

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

function isHead() { return PROFILE.departmentCode === 'MKT' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode); }
function isAcc() { return PROFILE.departmentCode === 'ACC'; }
function isExec() { return ['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode); }

const STATUS_LABEL = { draft: 'Chờ Trưởng phòng MKT duyệt', approved_1: 'Chờ Kế toán duyệt', approved_2: 'Chờ Ban điều hành duyệt', approved_3: 'Đã duyệt & ghi sổ', rejected: 'Đã từ chối' };
const STATUS_BADGE = { draft: 'submitted', approved_1: 'submitted', approved_2: 'submitted', approved_3: 'active', rejected: 'rejected' };

function last6Months() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `T${d.getMonth() + 1}/${d.getFullYear()}` });
  }
  return months;
}

async function loadChart() {
  const months = last6Months();
  const startDate = `${months[0].year}-${String(months[0].month).padStart(2, '0')}-01`;

  // Bieu do CHI tinh cac khoan DA DUYET XONG (approved_3) — khoan con
  // dang cho duyet chua phai chi phi that su, khong nen tinh vao thong
  // ke nhu truoc day (truoc day tinh TAT CA, ke ca chua duyet).
  const { data } = await supabase.from('mkt_ad_expenses').select('platform, amount, spend_date').eq('status', 'approved_3').gte('spend_date', startDate);

  const byMonth = {};
  months.forEach((m) => { byMonth[m.label] = 0; });
  const byPlatform = {};

  (data || []).forEach((e) => {
    const d = new Date(e.spend_date);
    const label = `T${d.getMonth() + 1}/${d.getFullYear()}`;
    if (label in byMonth) byMonth[label] += Number(e.amount);
    byPlatform[e.platform] = (byPlatform[e.platform] || 0) + Number(e.amount);
  });

  const total = Object.values(byMonth).reduce((a, b) => a + b, 0);
  const topPlatform = Object.entries(byPlatform).sort((a, b) => b[1] - a[1])[0];

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Tổng chi phí ĐÃ DUYỆT (6 tháng)</div><div class="value mono" style="font-size:20px;">${fmtMoney(total)} đ</div></div>
    <div class="stat-card"><div class="label">Nền tảng chi nhiều nhất</div><div class="value" style="font-size:18px;">${topPlatform ? esc(topPlatform[0]) : '—'}</div></div>
    <div class="stat-card"><div class="label">Trung bình / tháng</div><div class="value mono" style="font-size:20px;">${fmtMoney(total / 6)} đ</div></div>
  `;

  const labels = months.map((m) => m.label);
  const ctx = document.getElementById('expenseChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Chi phí quảng cáo (đã duyệt)', data: labels.map((l) => byMonth[l]), backgroundColor: '#0094D9' }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
}

function actionFor(row) {
  if (row.status === 'draft' && (isHead() || isExec())) return { label: 'Duyệt (Trưởng phòng)', next: 'approved_1', signedByField: 'dept_head_signed_by', signedAtField: 'dept_head_signed_at' };
  if (row.status === 'approved_1' && (isAcc() || isExec())) return { label: 'Duyệt (Kế toán)', next: 'approved_2', signedByField: 'accountant_signed_by', signedAtField: 'accountant_signed_at' };
  if (row.status === 'approved_2' && isExec()) return { label: 'Duyệt (Ban điều hành)', next: 'approved_3', isFinal: true };
  return null;
}

async function loadTable() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase
    .from('mkt_ad_expenses')
    .select('id, code, platform, amount, spend_date, note, status, created_by, centers(name), expense_categories(name)')
    .order('spend_date', { ascending: false })
    .limit(50);

  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Chưa có chi phí nào được ghi nhận.</td></tr>'; return; }

  tbody.innerHTML = ALL_ROWS.map((e) => {
    const action = actionFor(e);
    return `
      <tr>
        <td class="cell-code mono">${esc(e.code || '—')}</td>
        <td class="cell-muted">${fmtDate(e.spend_date)}</td>
        <td>${esc(e.platform)}<div class="cell-muted" style="font-size:11px;">${esc(e.expense_categories?.name || '')}</div></td>
        <td class="cell-muted">${esc(e.centers?.name || '—')}</td>
        <td class="mono">${fmtMoney(e.amount)} đ</td>
        <td><span class="badge badge-${STATUS_BADGE[e.status]}">${STATUS_LABEL[e.status]}</span></td>
        <td>${action ? `<button class="btn btn-accent btn-sm" data-approve="${e.id}">${action.label}</button>` : ''}
            ${e.status !== 'approved_3' && e.status !== 'rejected' && (isHead() || isAcc() || isExec()) ? `<button class="btn btn-outline btn-sm" data-reject="${e.id}">Từ chối</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => handleApprove(btn.dataset.approve)));
  tbody.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => handleReject(btn.dataset.reject)));
}

let PENDING_FINAL_ID = null;
const paymentModal = document.getElementById('paymentMethodModal');

async function handleApprove(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
  const action = actionFor(row);
  if (!action) return;

  if (action.isFinal) {
    PENDING_FINAL_ID = id;
    paymentModal.classList.add('show');
    return;
  }

  if (!confirm(`Xác nhận "${action.label}" cho khoản chi ${row.code}?`)) return;
  const payload = { status: action.next, [action.signedByField]: PROFILE.id, [action.signedAtField]: new Date().toISOString() };
  const { error } = await supabase.from('mkt_ad_expenses').update(payload).eq('id', id);
  if (error) { alert('Lỗi: ' + error.message); return; }
  await loadTable();
}

document.getElementById('closePaymentMethodModal').addEventListener('click', () => paymentModal.classList.remove('show'));
document.getElementById('cancelPaymentMethodModal').addEventListener('click', () => paymentModal.classList.remove('show'));
document.getElementById('confirmPaymentMethod').addEventListener('click', async () => {
  const method = document.getElementById('finalPaymentMethod').value;
  const { error } = await supabase.rpc('approve_mkt_expense_final', { p_id: PENDING_FINAL_ID, p_approver_id: PROFILE.id, p_method: method });
  if (error) { alert('Lỗi: ' + error.message); return; }
  paymentModal.classList.remove('show');
  alert('Đã duyệt và ghi sổ kế toán thành công.');
  await Promise.all([loadChart(), loadTable()]);
});

async function handleReject(id) {
  const reason = prompt('Lý do từ chối:');
  if (!reason?.trim()) { alert('Bắt buộc ghi lý do từ chối.'); return; }
  const { error } = await supabase.from('mkt_ad_expenses').update({ status: 'rejected', reject_reason: reason }).eq('id', id);
  if (error) { alert('Lỗi: ' + error.message); return; }
  await loadTable();
}

async function loadCenters() {
  const { data } = await supabase.from('centers').select('id, name').order('name');
  document.getElementById('center').innerHTML = '<option value="">— Không áp dụng —</option>' +
    (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadExpenseCategories() {
  const { data } = await supabase.from('expense_categories').select('id, name').order('display_order');
  document.getElementById('expenseCategory').innerHTML = (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

document.getElementById('expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('formError');
  errBox.classList.remove('show');

  const amount = Number(document.getElementById('amount').value);
  const expenseCategoryId = document.getElementById('expenseCategory').value;

  // Canh bao TRAN NGAN SACH (mem) — dung lai dung ham check_budget_cap()
  // giong het da lam ben Phieu mua hang CSVC, ap dung nhat quan.
  if (expenseCategoryId && PROFILE.centerId) {
    const { data: budgetCheck } = await supabase.rpc('check_budget_cap', {
      p_center_id: PROFILE.centerId, p_expense_category_id: expenseCategoryId, p_new_amount: amount,
    });
    const check = budgetCheck?.[0];
    if (check?.would_exceed) {
      const proceed = confirm(`CẢNH BÁO VƯỢT TRẦN NGÂN SÁCH\n\nHạng mục này đã chi ${fmtMoney(check.already_spent)} đ / trần ${fmtMoney(check.monthly_cap)} đ tháng này.\nKhoản này (${fmtMoney(amount)} đ) sẽ làm VƯỢT trần.\n\nVẫn muốn tiếp tục gửi duyệt?`);
      if (!proceed) return;
    }
  }

  const { error } = await supabase.from('mkt_ad_expenses').insert({
    platform: document.getElementById('platform').value.trim(),
    amount, spend_date: document.getElementById('spendDate').value,
    center_id: document.getElementById('center').value || null,
    expense_category_id: expenseCategoryId || null,
    note: document.getElementById('note').value || null,
    created_by: PROFILE.id, status: 'draft',
  });
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }

  notifyDepartmentHeads('MKT', 'Có khoản chi phí quảng cáo mới cần duyệt',
    `${PROFILE.fullName} vừa gửi khoản chi ${fmtMoney(amount)} đ (${document.getElementById('platform').value.trim()}) — cần Trưởng phòng duyệt.`,
    '/mkt/expense-reports.html', PROFILE.id);

  e.target.reset();
  document.getElementById('spendDate').value = new Date().toISOString().slice(0, 10);
  await Promise.all([loadChart(), loadTable()]);
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    document.getElementById('spendDate').value = new Date().toISOString().slice(0, 10);
    await Promise.all([loadCenters(), loadExpenseCategories()]);
    await Promise.all([loadChart(), loadTable()]);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
