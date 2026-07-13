import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN') + ' đ'; }

let PROFILE = null;
let ACTIVE_INVOICE = null;
let WALLET_BALANCE = 0;

const STATUS_LABEL = { unpaid: 'Chưa đóng', partially_paid: 'Đóng một phần', paid: 'Đã đóng đủ' };

async function searchInvoice(code) {
  const feedback = document.getElementById('searchFeedback');
  const content = document.getElementById('invoiceContent');
  content.style.display = 'none';
  if (!code.trim()) { feedback.textContent = ''; return; }

  feedback.textContent = 'Đang tìm...';
  const { data, error } = await supabase
    .from('invoices')
    .select('*, students(full_name, student_code, class_id, classes(name))')
    .eq('invoice_code', code.trim().toUpperCase())
    .maybeSingle();

  if (error) { feedback.textContent = `Lỗi: ${error.message}`; return; }
  if (!data) { feedback.textContent = `Không tìm thấy hoá đơn với mã "${code.trim()}". Kiểm tra lại chính tả (VD: HD-00001).`; return; }

  feedback.textContent = '';
  ACTIVE_INVOICE = data;
  await renderInvoice();
}

async function renderInvoice() {
  const inv = ACTIVE_INVOICE;
  const { data: ledgerRows } = await supabase.from('debt_ledger').select('amount_vnd').eq('invoice_id', inv.id);
  const paid = (ledgerRows || []).reduce((s, r) => s + Number(r.amount_vnd), 0);
  const gross = Number(inv.amount_vnd);
  const discount = Number(inv.manual_discount_vnd || 0);
  const net = gross - discount;
  const remaining = Math.max(net - paid, 0);

  document.getElementById('invCode').textContent = inv.invoice_code;
  document.getElementById('invStudentName').textContent = inv.students?.full_name || '—';
  document.getElementById('invClass').textContent = inv.students?.classes?.name || 'Chưa xếp lớp';
  document.getElementById('invPeriod').textContent = `Tháng ${inv.period_month}/${inv.period_year}`;
  document.getElementById('invDueDate').textContent = new Date(inv.due_date).toLocaleDateString('vi-VN');
  document.getElementById('invStatus').textContent = STATUS_LABEL[inv.status] || inv.status;

  document.getElementById('amtGross').textContent = fmtMoney(gross);
  document.getElementById('amtDiscount').textContent = `- ${fmtMoney(discount)}`;
  document.getElementById('amtPaid').textContent = fmtMoney(paid);
  document.getElementById('amtRemaining').textContent = fmtMoney(remaining);

  document.getElementById('invoiceContent').style.display = 'block';

  if (remaining <= 0) {
    document.getElementById('paymentSection').style.display = 'none';
    document.getElementById('paidNotice').style.display = 'block';
    return;
  }
  document.getElementById('paymentSection').style.display = 'block';
  document.getElementById('paidNotice').style.display = 'none';

  // Hien so du vi (chi DOC, khong tu tao vi — dung bai hoc rut ra tu lan
  // sua loi truoc, trang thanh toan khong duoc phep tu y ghi vao wallets).
  const { data: wallet } = await supabase.from('wallets').select('id').eq('student_id', inv.student_id).maybeSingle();
  if (wallet) {
    const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining').eq('wallet_id', wallet.id);
    WALLET_BALANCE = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);
    document.getElementById('walletBalanceHint').textContent = `Số dư hiện có: ${fmtMoney(WALLET_BALANCE)}`;
  } else {
    WALLET_BALANCE = 0;
    document.getElementById('walletBalanceHint').textContent = 'Học sinh chưa có ví.';
  }
}

document.getElementById('searchCode').addEventListener('input', (e) => {
  clearTimeout(window.__searchTimer);
  window.__searchTimer = setTimeout(() => searchInvoice(e.target.value), 350);
});

// ============ Thanh toan Tien mat/CK ============
const cashModal = document.getElementById('cashModal');
document.getElementById('payCash').addEventListener('click', () => {
  document.getElementById('cashError').classList.remove('show');
  document.getElementById('cashAmount').value = '';
  cashModal.classList.add('show');
});
document.getElementById('closeCashModal').addEventListener('click', () => cashModal.classList.remove('show'));
document.getElementById('cancelCashModal').addEventListener('click', () => cashModal.classList.remove('show'));

document.getElementById('submitCash').addEventListener('click', async () => {
  const errBox = document.getElementById('cashError');
  errBox.classList.remove('show');
  const amount = Number(document.getElementById('cashAmount').value);
  const method = document.getElementById('cashMethod').value;
  if (!amount || amount <= 0) { errBox.textContent = 'Vui lòng nhập đúng số tiền.'; errBox.classList.add('show'); return; }

  const btn = document.getElementById('submitCash');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  const { error } = await supabase.rpc('record_counter_payment', {
    p_invoice_id: ACTIVE_INVOICE.id, p_source: method, p_amount_vnd: amount, p_actor_id: PROFILE.id,
  });
  btn.disabled = false; btn.textContent = 'Xác nhận thu tiền';
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }

  cashModal.classList.remove('show');
  await searchInvoice(ACTIVE_INVOICE.invoice_code); // tai lai — TU DONG doi trang thai theo dung so tien vua thu
});

// ============ Thanh toan qua Vi — TU DONG doi trang thai ============
document.getElementById('payWallet').addEventListener('click', async () => {
  if (WALLET_BALANCE <= 0) { alert('Học sinh chưa có số dư trong ví.'); return; }

  const { data: ledgerRows } = await supabase.from('debt_ledger').select('amount_vnd').eq('invoice_id', ACTIVE_INVOICE.id);
  const paid = (ledgerRows || []).reduce((s, r) => s + Number(r.amount_vnd), 0);
  const net = Number(ACTIVE_INVOICE.amount_vnd) - Number(ACTIVE_INVOICE.manual_discount_vnd || 0);
  const remainingVnd = Math.max(net - paid, 0);

  const coinToDeduct = Math.min(WALLET_BALANCE, remainingVnd); // gia dinh ty le quy doi 1:1 AIScoin:VND theo dung quy uoc he thong dang dung
  if (!confirm(`Xác nhận trừ ${fmtMoney(coinToDeduct)} từ Ví để thanh toán hoá đơn ${ACTIVE_INVOICE.invoice_code}?\n\nTrạng thái hoá đơn sẽ TỰ ĐỘNG cập nhật ngay sau khi trừ.`)) return;

  const { error } = await supabase.rpc('deduct_wallet_fifo', {
    p_invoice_id: ACTIVE_INVOICE.id, p_coin_to_deduct: coinToDeduct, p_actor_id: PROFILE.id,
  });
  if (error) { alert('Lỗi: ' + error.message); return; }

  alert('Đã thanh toán qua Ví thành công — trạng thái hoá đơn đã tự động cập nhật.');
  await searchInvoice(ACTIVE_INVOICE.invoice_code);
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    // Neu duoc dieu huong toi tu trang khac kem san ?code=HD-xxxxx, tu
    // dong dien va tim luon, khong bat go lai tu dau.
    const params = new URLSearchParams(location.search);
    const preCode = params.get('code');
    if (preCode) { document.getElementById('searchCode').value = preCode; await searchInvoice(preCode); }
  } catch (e) { /* bootShell tự điều hướng */ }
})();
