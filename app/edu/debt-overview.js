import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data: students } = await supabase.from('students').select('id, full_name').eq('center_id', PROFILE.centerId);
  const studentIds = (students || []).map((s) => s.id);
  const studentMap = {};
  (students || []).forEach((s) => { studentMap[s.id] = s.full_name; });

  if (studentIds.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Trung tâm chưa có học viên.</td></tr>'; return; }

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, student_id, period_year, period_month, amount_vnd, status, due_date')
    .in('student_id', studentIds)
    .in('status', ['unpaid', 'partially_paid'])
    .order('due_date', { ascending: true });

  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!invoices || invoices.length === 0) { ALL_ROWS = []; render(); return; }

  const invoiceIds = invoices.map((i) => i.id);
  const { data: ledgerRows } = await supabase.from('debt_ledger').select('invoice_id, source, amount_vnd').in('invoice_id', invoiceIds);

  ALL_ROWS = invoices.map((inv) => {
    const paidRows = (ledgerRows || []).filter((l) => l.invoice_id === inv.id);
    const paidTotal = paidRows.reduce((s, l) => s + Number(l.amount_vnd), 0);
    const bySource = {};
    paidRows.forEach((l) => { bySource[l.source] = (bySource[l.source] || 0) + Number(l.amount_vnd); });
    return {
      ...inv,
      studentName: studentMap[inv.student_id] || '—',
      paidTotal,
      remaining: Number(inv.amount_vnd) - paidTotal,
      bySource,
    };
  });

  render();
}

function render() {
  const statusFilter = document.getElementById('filterStatus').value;
  const rows = ALL_ROWS.filter((r) => !statusFilter || r.status === statusFilter);

  document.getElementById('resultCount').textContent = `${rows.length} hoá đơn`;
  const totalDebt = rows.reduce((s, r) => s + r.remaining, 0);

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Tổng công nợ còn lại</div><div class="value mono" style="color:var(--danger);">${fmtMoney(totalDebt)} đ</div></div>
    <div class="stat-card"><div class="label">Số hoá đơn đóng thiếu</div><div class="value mono">${rows.length}</div></div>
  `;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">🎉 Không có hoá đơn nào đang nợ.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => {
    const debtBadges = [];
    const remainingBySource = Number(r.amount_vnd) - r.paidTotal;
    // Hiển thị rõ phần CÒN NỢ theo từng nguồn đã dùng để đóng dở (mục 4.3) —
    // nếu chưa đóng đồng nào thì không rõ nguồn, hiện chung "Chưa xác định nguồn".
    if (r.bySource.WALLET) debtBadges.push(`Đã đóng qua Ví: ${fmtMoney(r.bySource.WALLET)} đ`);
    if (r.bySource.CASH) debtBadges.push(`Đã đóng Tiền mặt: ${fmtMoney(r.bySource.CASH)} đ`);
    if (r.bySource.BANK_TRANSFER) debtBadges.push(`Đã đóng CK: ${fmtMoney(r.bySource.BANK_TRANSFER)} đ`);

    return `
    <tr>
      <td>${esc(r.studentName)}</td>
      <td class="cell-muted">${r.period_month}/${r.period_year}</td>
      <td class="mono">${fmtMoney(r.amount_vnd)} đ</td>
      <td class="mono" style="color:var(--success);">${fmtMoney(r.paidTotal)} đ</td>
      <td class="mono" style="color:var(--danger); font-weight:600;">${fmtMoney(remainingBySource)} đ</td>
      <td class="cell-muted" style="font-size:11.5px;">${debtBadges.length ? debtBadges.join('<br>') : 'Chưa đóng đồng nào'}</td>
      <td><span class="badge badge-${r.status === 'unpaid' ? 'rejected' : 'submitted'}">${r.status === 'unpaid' ? 'Chưa thanh toán' : 'Một phần'}</span></td>
    </tr>
  `;
  }).join('');
}

document.getElementById('filterStatus').addEventListener('change', render);

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    if (!PROFILE.centerId) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Trang này dành cho Quản lý trung tâm — tài khoản của bạn chưa gắn với 1 trung tâm cụ thể.</div>';
      return;
    }
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
