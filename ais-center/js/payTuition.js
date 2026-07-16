import { supabase, esc, fmtMoney, bootParentShell, getSelectedStudentId } from './parentSupabase.js';

let STUDENT_ID = null;
let WALLET_ID = null;
let WALLET_BALANCE = 0;
let ALL_INVOICES = [];
let ACTIVE_INVOICE = null;

const STATUS_LABEL = { unpaid: 'Chưa đóng', partially_paid: 'Đã đóng một phần', paid: 'Đã đóng đủ' };
const STATUS_BADGE_CLASS = { unpaid: 'unpaid', partially_paid: 'partial', paid: 'paid' };
const PLAN_LABEL = { none: 'Theo tháng', case: 'Theo trường hợp', program: 'Ưu đãi chương trình', special: 'Diện đặc biệt' };

async function loadInvoices() {
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, period_year, period_month, amount_vnd, manual_discount_vnd, discount_type, status, due_date')
    .eq('student_id', STUDENT_ID)
    .in('status', ['unpaid', 'partially_paid'])
    .order('due_date', { ascending: true });

  ALL_INVOICES = invoices || [];
  if (ALL_INVOICES.length === 0) {
    document.getElementById('noInvoiceNotice').style.display = 'block';
    document.getElementById('content').style.display = 'none';
    return;
  }
  document.getElementById('content').style.display = 'block';

  document.getElementById('invoiceSelect').innerHTML = ALL_INVOICES.map((inv) =>
    `<option value="${inv.id}">Học phí ${inv.period_month}/${inv.period_year} — hạn ${new Date(inv.due_date).toLocaleDateString('vi-VN')}</option>`
  ).join('');

  await selectInvoice(ALL_INVOICES[0].id);
}

async function selectInvoice(invoiceId) {
  ACTIVE_INVOICE = ALL_INVOICES.find((i) => i.id === invoiceId);
  if (!ACTIVE_INVOICE) return;

  const { data: ledgerRows } = await supabase.from('debt_ledger').select('amount_vnd').eq('invoice_id', invoiceId);
  const paid = (ledgerRows || []).reduce((s, l) => s + Number(l.amount_vnd), 0);
  const netAmount = Number(ACTIVE_INVOICE.amount_vnd) - Number(ACTIVE_INVOICE.manual_discount_vnd || 0);
  const remaining = netAmount - paid;

  document.getElementById('planTypeDisplay').textContent = PLAN_LABEL[ACTIVE_INVOICE.discount_type] || 'Theo tháng';
  document.getElementById('totalAmount').textContent = `${fmtMoney(ACTIVE_INVOICE.amount_vnd)} đ`;
  document.getElementById('discountDisplay').textContent = ACTIVE_INVOICE.manual_discount_vnd > 0 ? `- ${fmtMoney(ACTIVE_INVOICE.manual_discount_vnd)} đ` : 'Không có';
  document.getElementById('paidAmount').textContent = `${fmtMoney(paid)} đ`;
  document.getElementById('remainingAmount').textContent = `${fmtMoney(remaining)} đ`;
  document.getElementById('statusBadge').textContent = STATUS_LABEL[ACTIVE_INVOICE.status];
  document.getElementById('statusBadge').className = 'badge ' + STATUS_BADGE_CLASS[ACTIVE_INVOICE.status];
  document.getElementById('payAmount').value = Math.min(remaining, WALLET_BALANCE);
  document.getElementById('payAmount').max = remaining;
}

document.getElementById('invoiceSelect').addEventListener('change', (e) => selectInvoice(e.target.value));

document.getElementById('btnPay').addEventListener('click', async () => {
  const errBox = document.getElementById('payError');
  errBox.classList.remove('show');
  const amount = Number(document.getElementById('payAmount').value);
  if (!amount || amount <= 0) { errBox.textContent = 'Vui lòng nhập số tiền hợp lệ.'; errBox.classList.add('show'); return; }
  if (amount > WALLET_BALANCE) { errBox.textContent = 'Số dư ví không đủ. Vui lòng nạp thêm.'; errBox.classList.add('show'); return; }

  const btn = document.getElementById('btnPay');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    const { error } = await supabase.rpc('pay_invoice_via_wallet', { p_invoice_id: ACTIVE_INVOICE.id, p_coin_amount: amount });
    if (error) throw error;
    alert('Thanh toán thành công!');
    window.location.href = 'wallet.html';
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = '💳 Thanh toán ngay';
  }
});

(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length === 0) return;
    STUDENT_ID = getSelectedStudentId(students);

    const { data: wallet } = await supabase.from('wallet_students').select('wallet_id').eq('student_id', STUDENT_ID).maybeSingle();
    if (wallet) {
      WALLET_ID = wallet.wallet_id;
      const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining').eq('wallet_id', wallet.wallet_id);
      WALLET_BALANCE = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);
    }
    document.getElementById('walletBalanceDisplay').textContent = `${fmtMoney(WALLET_BALANCE)} AIScoins`;

    await loadInvoices();
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();