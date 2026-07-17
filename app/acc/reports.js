import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { t } from '/js/i18n.js';

let PROFILE = null;
let chartInstance = null;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

function last6Months() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `T${d.getMonth() + 1}/${d.getFullYear()}` });
  }
  return months;
}

// "Thong ke thu hoc phi": phan loai dung 3 nguon theo dac ta (Tien mat,
// Chuyen khoan, Vi) - truoc day chi co Tong thu/chi chung chung, khong
// tach duoc theo tung nguon.
async function loadTuitionBySource() {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);

  const { data } = await supabase.from('cash_flow_entries')
    .select('category, amount')
    .in('category', ['tuition_cash', 'tuition_transfer', 'tuition_wallet'])
    .eq('entry_type', 'inflow')
    .gte('entry_date', monthStart).lt('entry_date', nextMonth);

  const totals = { tuition_cash: 0, tuition_transfer: 0, tuition_wallet: 0 };
  (data || []).forEach((r) => { totals[r.category] = (totals[r.category] || 0) + Number(r.amount); });
  const grandTotal = totals.tuition_cash + totals.tuition_transfer + totals.tuition_wallet;

  document.getElementById('tuitionSourceCards').innerHTML = `
    <div class="stat-card"><div class="label">💵 Tiền mặt</div><div class="value mono" style="font-size:18px;">${fmtMoney(totals.tuition_cash)} đ</div></div>
    <div class="stat-card"><div class="label">🏦 Chuyển khoản</div><div class="value mono" style="font-size:18px;">${fmtMoney(totals.tuition_transfer)} đ</div></div>
    <div class="stat-card"><div class="label">💳 Ví AIScoins</div><div class="value mono" style="font-size:18px;">${fmtMoney(totals.tuition_wallet)} đ</div></div>
    <div class="stat-card"><div class="label">Tổng thu học phí tháng này</div><div class="value mono" style="font-size:18px; font-weight:700;">${fmtMoney(grandTotal)} đ</div></div>
  `;
}

async function loadChart() {
  const months = last6Months();
  const startDate = `${months[0].year}-${String(months[0].month).padStart(2, '0')}-01`;

  const { data } = await supabase.from('cash_flow_entries').select('entry_type, amount, entry_date').gte('entry_date', startDate);

  const inflowByMonth = {};
  const outflowByMonth = {};
  months.forEach((m) => { inflowByMonth[m.label] = 0; outflowByMonth[m.label] = 0; });

  (data || []).forEach((e) => {
    const d = new Date(e.entry_date);
    const label = `T${d.getMonth() + 1}/${d.getFullYear()}`;
    if (!(label in inflowByMonth)) return;
    if (e.entry_type === 'inflow') inflowByMonth[label] += Number(e.amount);
    else outflowByMonth[label] += Number(e.amount);
  });

  const labels = months.map((m) => m.label);
  const totalInflow = Object.values(inflowByMonth).reduce((a, b) => a + b, 0);
  const totalOutflow = Object.values(outflowByMonth).reduce((a, b) => a + b, 0);

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Tổng thu (6 tháng)</div><div class="value mono" style="font-size:20px; color:var(--success);">${fmtMoney(totalInflow)} đ</div></div>
    <div class="stat-card"><div class="label">Tổng chi (6 tháng)</div><div class="value mono" style="font-size:20px; color:var(--danger);">${fmtMoney(totalOutflow)} đ</div></div>
    <div class="stat-card"><div class="label">Chênh lệch</div><div class="value mono" style="font-size:20px;">${fmtMoney(totalInflow - totalOutflow)} đ</div></div>
  `;

  const ctx = document.getElementById('cashFlowChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Thu vào', data: labels.map((l) => inflowByMonth[l]), backgroundColor: '#1e8e5a' },
        { label: 'Chi ra', data: labels.map((l) => outflowByMonth[l]), backgroundColor: '#c1432d' },
      ],
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } },
  });
}

// Nhật ký dòng tiền — cho kế toán biết rõ TỪNG khoản thu/chi phát sinh từ
// đâu (thu học phí tự động, phiếu thanh toán, phiếu tạm ứng, hay ghi tay),
// không chỉ dừng ở biểu đồ tổng hợp theo tháng như trước.
let ALL_CASH_ROWS = [];

function sourceInfo(row) {
  if (row.category === 'tuition' || row.category === 'tuition_cash' || row.category === 'tuition_transfer') return { label: 'Thu học phí tại quầy', key: 'tuition' };
  if (row.category === 'tuition_wallet') return { label: 'Thu học phí qua Ví', key: 'tuition_wallet', href: '/edu/wallet-invoices.html' };
  if (row.related_payment_request_id) return { label: 'Phiếu thanh toán', key: 'payment_request', href: '/acc/payment-requests.html' };
  if (row.related_advance_request_id) return { label: 'Phiếu tạm ứng', key: 'advance_request', href: '/acc/advance-requests.html' };
  return { label: 'Ghi tay', key: 'manual' };
}

async function loadCashLog() {
  const tbody = document.getElementById('cashLogBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data, error } = await supabase
    .from('cash_flow_entries')
    .select('id, entry_type, amount, entry_date, category, note, related_payment_request_id, related_advance_request_id, employees:created_by(full_name)')
    .order('entry_date', { ascending: false })
    .limit(200);

  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_CASH_ROWS = data || [];
  renderCashLog();
}

function renderCashLog() {
  const typeFilter = document.getElementById('logFilterType').value;
  const sourceFilter = document.getElementById('logFilterSource').value;
  const monthFilter = document.getElementById('logFilterMonth').value;

  const rows = ALL_CASH_ROWS.filter((r) => {
    if (typeFilter && r.entry_type !== typeFilter) return false;
    if (sourceFilter && sourceInfo(r).key !== sourceFilter) return false;
    if (monthFilter && r.entry_date.slice(0, 7) !== monthFilter) return false;
    return true;
  });

  document.getElementById('logResultCount').textContent = `${rows.length} dòng`;
  const tbody = document.getElementById('cashLogBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Không có dòng tiền nào khớp bộ lọc.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => {
    const src = sourceInfo(r);
    return `
    <tr>
      <td class="cell-muted">${fmtDate(r.entry_date)}</td>
      <td><span class="badge badge-${r.entry_type === 'inflow' ? 'active' : 'rejected'}">${r.entry_type === 'inflow' ? 'Tiền vào' : 'Tiền ra'}</span></td>
      <td class="mono" style="color:${r.entry_type === 'inflow' ? 'var(--success)' : 'var(--danger)'};">${r.entry_type === 'inflow' ? '+' : '-'}${fmtMoney(r.amount)} đ</td>
      <td class="cell-muted">${r.category || '—'}</td>
      <td>${src.href ? `<a href="${src.href}" style="text-decoration:underline;">${src.label}</a>` : `<span class="cell-muted">${src.label}</span>`}</td>
      <td class="cell-muted">${esc(r.note) || '—'}</td>
      <td class="cell-muted">${esc(r.employees?.full_name) || '—'}</td>
    </tr>
  `;
  }).join('');
}

['logFilterType', 'logFilterSource', 'logFilterMonth'].forEach((id) => {
  document.getElementById(id).addEventListener('change', renderCashLog);
});

async function loadReceivables() {
  const tbody = document.getElementById('receivablesBody');
  const { data, error } = await supabase.from('receivables').select('*').order('due_date', { ascending: true });
  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Không có công nợ nào.</td></tr>'; return; }

  const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.receivable_' + code, code) });
  const STATUS_BADGE = { open: 'submitted', partial: 'approved_1', paid: 'active', overdue: 'rejected' };
  tbody.innerHTML = data.map((r) => `
    <tr>
      <td>${r.partner_name}</td>
      <td class="mono">${fmtMoney(r.amount)} đ</td>
      <td class="cell-muted">${fmtDate(r.due_date)}</td>
      <td><span class="badge badge-${STATUS_BADGE[r.status]}">${STATUS_LABEL[r.status]}</span></td>
    </tr>
  `).join('');
}

const modal = document.getElementById('entryModal');
const formError = document.getElementById('formError');
document.getElementById('btnAddEntry').addEventListener('click', () => {
  formError.classList.remove('show');
  document.getElementById('amount').value = '';
  document.getElementById('entryDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('category').value = '';
  document.getElementById('note').value = '';
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('submitEntry').addEventListener('click', async () => {
  formError.classList.remove('show');
  const amount = document.getElementById('amount').value;
  if (!amount) { formError.textContent = 'Vui lòng nhập số tiền.'; formError.classList.add('show'); return; }

  const btn = document.getElementById('submitEntry');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const { error } = await supabase.from('cash_flow_entries').insert({
    entry_type: document.getElementById('entryType').value,
    amount: Number(amount),
    entry_date: document.getElementById('entryDate').value,
    category: document.getElementById('category').value || null,
    note: document.getElementById('note').value || null,
    created_by: PROFILE.id,
  });
  btn.disabled = false; btn.textContent = 'Lưu';
  if (error) { formError.textContent = error.message; formError.classList.add('show'); return; }
  modal.classList.remove('show');
  await Promise.all([loadChart(), loadCashLog()]);
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    const allowed = profile.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!allowed) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Bạn không có quyền thực hiện thao tác.</div>';
      return;
    }
    await Promise.all([loadChart(), loadTuitionBySource()]);
    await loadCashLog();
    await loadReceivables();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
