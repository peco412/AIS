import { supabase, esc, fmtMoney, bootParentShell } from './parentSupabase.js';

let WALLET_ID = null;
let WALLET_BALANCE = 0;
let ALL_INVOICES = [];
let ACTIVE_INVOICE = null;
let STUDENT_NAMES = {};

const STATUS_LABEL = { unpaid: 'Chưa đóng', partially_paid: 'Đã đóng một phần', paid: 'Đã đóng đủ' };
const STATUS_BADGE_CLASS = { unpaid: 'unpaid', partially_paid: 'partial', paid: 'paid' };
const PLAN_LABEL = { none: 'Theo tháng', case: 'Theo trường hợp', program: 'Ưu đãi chương trình', special: 'Diện đặc biệt' };

async function loadInvoices(studentIds) {
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, student_id, period_year, period_month, amount_vnd, manual_discount_vnd, discount_type, status, due_date, draft_options')
    .in('student_id', studentIds)
    .in('status', ['draft', 'unpaid', 'partially_paid'])
    .order('due_date', { ascending: true });

  ALL_INVOICES = invoices || [];
  if (ALL_INVOICES.length === 0) {
    document.getElementById('noInvoiceNotice').style.display = 'block';
    document.getElementById('content').style.display = 'none';
    return;
  }
  document.getElementById('content').style.display = 'block';

  // Gộp hoá đơn của TẤT CẢ con vào 1 danh sách chọn, ghi rõ tên con trên
  // mỗi dòng — phụ huynh không cần rời trang để đổi "con đang chọn" nữa,
  // vì dù chọn hoá đơn của con nào, tiền đóng cũng trừ từ đúng 1 ví chung.
  document.getElementById('invoiceSelect').innerHTML = ALL_INVOICES.map((inv) =>
    `<option value="${inv.id}">${esc(STUDENT_NAMES[inv.student_id] || '')} — Học phí ${inv.period_month}/${inv.period_year}${inv.status === 'draft' ? ' — cần chọn hình thức đóng' : ` — hạn ${new Date(inv.due_date).toLocaleDateString('vi-VN')}`}</option>`
  ).join('');

  await selectInvoice(ALL_INVOICES[0].id);
}

async function selectInvoice(invoiceId) {
  ACTIVE_INVOICE = ALL_INVOICES.find((i) => i.id === invoiceId);
  if (!ACTIVE_INVOICE) return;

  const planCard = document.getElementById('planChoiceCard');
  const detailCard = document.getElementById('paymentDetailCard');
  const actionCard = document.getElementById('paymentActionCard');

  // MOI — hoa don dang 'draft' (cron tu dong tao khi sap het buoi) CHUA
  // co gia cu the, phai chon 1 trong so cac hinh thuc dong hoc phi truoc
  // — đúng yêu cầu "phụ huynh có quyền chọn hình thức đóng", không còn bị
  // co cung theo dung 1 hinh thuc tu van vien da chon luc dau.
  if (ACTIVE_INVOICE.status === 'draft') {
    planCard.style.display = 'block';
    detailCard.style.display = 'none';
    actionCard.style.display = 'none';
    renderPlanOptions();
    return;
  }
  planCard.style.display = 'none';
  detailCard.style.display = 'block';
  actionCard.style.display = 'block';

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

function renderPlanOptions() {
  const box = document.getElementById('planOptionsList');
  const options = ACTIVE_INVOICE.draft_options || [];
  if (options.length === 0) {
    box.innerHTML = '<div class="empty-state">Chưa có lựa chọn nào, vui lòng liên hệ trung tâm.</div>';
    return;
  }
  box.innerHTML = options.map((opt) => `
    <label class="plan-option-card" data-plan="${esc(opt.plan_type)}">
      <div class="plan-option-card__top">
        <span class="plan-option-card__label">${esc(opt.label)}</span>
        <span class="plan-option-card__price">${fmtMoney(opt.amount_vnd)} đ</span>
      </div>
      ${opt.gets_program_rate && opt.program_name ? `<div class="plan-option-card__note">Áp dụng: ${esc(opt.program_name)}${opt.gift_item_name ? ` — kèm quà: ${esc(opt.gift_item_name)}` : ''}</div>` : (opt.gift_item_name ? `<div class="plan-option-card__note">Kèm quà: ${esc(opt.gift_item_name)}</div>` : '<div class="plan-option-card__note">Bấm để chọn hình thức này</div>')}
    </label>
  `).join('');

  box.querySelectorAll('[data-plan]').forEach((card) => {
    card.addEventListener('click', () => choosePlan(card.dataset.plan, card));
  });
}

async function choosePlan(planType, cardEl) {
  const errBox = document.getElementById('planChoiceError');
  errBox.classList.remove('show');
  document.querySelectorAll('.plan-option-card').forEach((c) => c.classList.remove('is-chosen'));
  cardEl.classList.add('is-chosen');

  try {
    const { data, error } = await supabase.rpc('choose_draft_invoice_plan', {
      p_invoice_id: ACTIVE_INVOICE.id, p_plan_type: planType,
    });
    if (error) throw error;
    // Cap nhat lai dung hoa don trong danh sach dang giu o bo nho, roi
    // chuyen thang sang man thanh toan binh thuong — khong can tai lai
    // ca trang.
    const idx = ALL_INVOICES.findIndex((i) => i.id === ACTIVE_INVOICE.id);
    if (idx >= 0) ALL_INVOICES[idx] = data;
    await selectInvoice(ACTIVE_INVOICE.id);
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra, vui lòng thử lại.';
    errBox.classList.add('show');
  }
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
    btn.disabled = false; btn.textContent = 'Thanh toán ngay';
  }
});

(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length === 0) return;
    const studentIds = students.map((s) => s.id);
    STUDENT_NAMES = Object.fromEntries(students.map((s) => [s.id, s.full_name]));

    // Ví đã là ví CHUNG của cả gia đình — lấy qua con bất kỳ cũng ra đúng
    // 1 ví, dùng con đầu tiên là đủ.
    const { data: wallet } = await supabase.from('wallet_students').select('wallet_id').eq('student_id', studentIds[0]).maybeSingle();
    if (wallet) {
      WALLET_ID = wallet.wallet_id;
      const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining').eq('wallet_id', wallet.wallet_id);
      WALLET_BALANCE = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);
    }
    document.getElementById('walletBalanceDisplay').textContent = `${fmtMoney(WALLET_BALANCE)} AIScoins`;

    await loadInvoices(studentIds);
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();