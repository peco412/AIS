import { supabase, esc, fmtMoney, bootParentShell, getSelectedStudentId, setSelectedStudentId } from './parentSupabase.js';

let STUDENTS = [];
let SELECTED_ID = null;

function renderSwitcher() {
  const el = document.getElementById('studentSwitcher');
  if (STUDENTS.length <= 1) { el.style.display = 'none'; return; }
  el.innerHTML = STUDENTS.map((s) => `
    <button class="student-chip ${s.id === SELECTED_ID ? 'active' : ''}" data-id="${s.id}">${esc(s.full_name)}</button>
  `).join('');
  el.querySelectorAll('[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => { setSelectedStudentId(btn.dataset.id); SELECTED_ID = btn.dataset.id; renderSwitcher(); loadBalanceAndDebt(); });
  });
}

async function loadBalanceAndDebt() {
  const { data: wallet } = await supabase.from('wallets').select('id').eq('student_id', SELECTED_ID).maybeSingle();

  if (!wallet) {
    document.getElementById('balanceValue').textContent = '0 AIScoins';
    document.getElementById('balanceValueVnd').textContent = '';
    document.getElementById('debtSummary').innerHTML = '<div class="empty-state">Chưa có ví.</div>';
    return;
  }

  const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining, conversion_rate').eq('wallet_id', wallet.id);
  const total = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);
  const totalVnd = (batches || []).reduce((s, b) => s + Number(b.coin_remaining) * Number(b.conversion_rate), 0);
  document.getElementById('balanceValue').textContent = `${fmtMoney(total)} AIScoins`;
  document.getElementById('balanceValueVnd').textContent = `≈ ${fmtMoney(totalVnd)} VNĐ nếu quy đổi`;

  const { data: invoices } = await supabase.from('invoices').select('id, amount_vnd, period_month, period_year, status')
    .eq('student_id', SELECTED_ID).in('status', ['unpaid', 'partially_paid']).order('due_date', { ascending: true }).limit(3);

  const debtBox = document.getElementById('debtSummary');
  if (!invoices || invoices.length === 0) {
    debtBox.innerHTML = '<div class="empty-state">🎉 Không có công nợ nào.</div>';
  } else {
    debtBox.innerHTML = invoices.map((inv) => `
      <div class="invoice-row">
        <div class="invoice-row__top">
          <span>Học phí ${inv.period_month}/${inv.period_year}</span>
          <span class="badge ${inv.status === 'unpaid' ? 'unpaid' : 'partial'}">${inv.status === 'unpaid' ? 'Chưa đóng' : 'Một phần'}</span>
        </div>
        <div class="invoice-row__sub">${fmtMoney(inv.amount_vnd)} VNĐ</div>
      </div>
    `).join('');
  }
}

(async () => {
  try {
    const { students } = await bootParentShell();
    STUDENTS = students;
    if (STUDENTS.length === 0) return;

    document.getElementById('content').style.display = 'block';
    SELECTED_ID = getSelectedStudentId(STUDENTS);
    renderSwitcher();
    await loadBalanceAndDebt();
  } catch (e) { /* bootParentShell tự điều hướng nếu chưa đăng nhập */ }
})();
