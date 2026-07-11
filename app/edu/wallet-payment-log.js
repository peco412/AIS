import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

let ALL_ROWS = [];
let PROFILE = null;

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  let query = supabase.from('debt_ledger')
    .select('id, created_at, amount_vnd, amount_coin, conversion_rate_used, invoice_id, invoices(period_year, period_month, student_id, students(full_name, center_id, centers(name)))')
    .eq('source', 'WALLET')
    .order('created_at', { ascending: false })
    .limit(300);

  if (PROFILE.centerId) {
    // Quan ly trung tam/Tu van vien chi xem dung trung tam minh — loc
    // phia client vi debt_ledger khong co san center_id truc tiep.
  }

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

  ALL_ROWS = (data || []).filter((r) => r.invoices?.students);
  if (PROFILE.centerId) {
    ALL_ROWS = ALL_ROWS.filter((r) => r.invoices.students.center_id === PROFILE.centerId);
  }
  render();
}

function render() {
  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;
  const search = document.getElementById('filterSearch').value.trim().toLowerCase();

  const rows = ALL_ROWS.filter((r) => {
    const d = r.created_at.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (search && !r.invoices?.students?.full_name?.toLowerCase().includes(search)) return false;
    return true;
  });

  document.getElementById('resultCount').textContent = `${rows.length} giao dịch`;
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="7" class="empty-cell">Không có giao dịch nào khớp bộ lọc.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td class="cell-muted" style="font-size:12px;">${new Date(r.created_at).toLocaleString('vi-VN')}</td>
        <td>${esc(r.invoices?.students?.full_name || '—')}</td>
        <td class="cell-muted">${esc(r.invoices?.students?.centers?.name || '—')}</td>
        <td class="cell-muted">Tháng ${r.invoices?.period_month || '—'}/${r.invoices?.period_year || '—'}</td>
        <td class="mono" style="color:var(--success); font-weight:600;">${fmtMoney(r.amount_vnd)} đ</td>
        <td class="mono">${fmtMoney(r.amount_coin)} coin</td>
        <td class="cell-muted mono" style="font-size:11.5px;">Tỷ giá ${r.conversion_rate_used || '—'}</td>
      </tr>
    `).join('');
}

document.getElementById('filterFrom').addEventListener('change', render);
document.getElementById('filterTo').addEventListener('change', render);
document.getElementById('filterSearch').addEventListener('input', render);

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('center_id').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id };
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
