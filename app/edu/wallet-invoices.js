import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ACTIVE_STUDENT = null;
let ACTIVE_WALLET_ID = null;
let ACTIVE_INVOICE = null;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

let searchTimer;
document.getElementById('searchStudent').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchAndPick, 350);
});

async function searchAndPick() {
  const q = document.getElementById('searchStudent').value.trim();
  if (!q) return;

  let query = supabase.from('students').select('id, full_name, center_id').ilike('full_name', `%${q}%`).limit(5);
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('center_id', PROFILE.centerId);
  }
  const { data } = await query;
  if (!data || data.length === 0) return;

  // Đơn giản hoá: tự chọn kết quả đầu tiên khớp — nếu cần chọn chính xác
  // hơn giữa nhiều học sinh trùng tên, có thể mở rộng thành danh sách sau.
  await selectStudent(data[0]);
}

async function selectStudent(student) {
  ACTIVE_STUDENT = student;
  document.getElementById('studentPanel').style.display = 'block';

  let { data: wallet } = await supabase.from('wallets').select('id').eq('student_id', student.id).maybeSingle();
  if (!wallet) {
    const { data: created } = await supabase.from('wallets').insert({ student_id: student.id }).select('id').single();
    wallet = created;
  }
  ACTIVE_WALLET_ID = wallet.id;

  const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining').eq('wallet_id', wallet.id);
  const balance = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="label">Học sinh</div><div class="value" style="font-size:16px;">${esc(student.full_name)}</div></div>
    <div class="stat-card"><div class="label">Số dư ví AIScoins</div><div class="value mono" style="color:var(--success);">${fmtMoney(balance)}</div></div>
  `;

  await loadInvoices();
}

async function loadInvoices() {
  const tbody = document.getElementById('invoiceBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải...</td></tr>';

  const { data: invoices, error } = await supabase.from('invoices').select('*').eq('student_id', ACTIVE_STUDENT.id).order('due_date', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!invoices || invoices.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có hoá đơn nào — bấm "Tạo hoá đơn mới".</td></tr>'; return; }

  const invoiceIds = invoices.map((i) => i.id);
  const { data: ledgerRows } = await supabase.from('debt_ledger').select('invoice_id, amount_vnd').in('invoice_id', invoiceIds);

  tbody.innerHTML = invoices.map((inv) => {
    const paid = (ledgerRows || []).filter((l) => l.invoice_id === inv.id).reduce((s, l) => s + Number(l.amount_vnd), 0);
    const remaining = Number(inv.amount_vnd) - paid;
    const statusLabel = { unpaid: 'Chưa đóng', partially_paid: 'Một phần', paid: 'Đã đóng đủ' }[inv.status];
    const statusBadge = { unpaid: 'rejected', partially_paid: 'submitted', paid: 'active' }[inv.status];

    return `
      <tr>
        <td>${inv.period_month}/${inv.period_year} <span class="cell-muted">(hạn ${fmtDate(inv.due_date)})</span></td>
        <td class="mono">${fmtMoney(inv.amount_vnd)} đ</td>
        <td class="mono" style="color:var(--success);">${fmtMoney(paid)} đ</td>
        <td class="mono" style="color:var(--danger); font-weight:600;">${fmtMoney(remaining)} đ</td>
        <td><span class="badge badge-${statusBadge}">${statusLabel}</span></td>
        <td>${inv.status !== 'paid' ? `<button class="btn btn-accent btn-sm" data-collect="${inv.id}" data-amount-coin="${inv.amount_aiscoin}" data-remaining="${remaining}">Thu tiền</button>` : ''}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-collect]').forEach((btn) => {
    btn.addEventListener('click', () => openCollectModal(invoices.find((i) => i.id === btn.dataset.collect), Number(btn.dataset.remaining)));
  });
}

// ---------------------------------------------------------------------
// Tạo hoá đơn mới
// ---------------------------------------------------------------------
const createModal = document.getElementById('createInvoiceModal');
document.getElementById('btnNewInvoice').addEventListener('click', () => {
  document.getElementById('createError').classList.remove('show');
  const now = new Date();
  document.getElementById('invYear').value = now.getFullYear();
  document.getElementById('invMonth').value = now.getMonth() + 1;
  document.getElementById('invAmountVnd').value = '';
  document.getElementById('invAmountCoin').value = '';
  document.getElementById('invDueDate').value = '';
  createModal.classList.add('show');
});
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreateModal').addEventListener('click', () => createModal.classList.remove('show'));

// Tiện lợi: tự điền số AIScoins = số VNĐ (quy ước 1:1 mặc định lúc phát
// hành hoá đơn — có thể sửa tay nếu trung tâm áp dụng quy đổi khác).
document.getElementById('invAmountVnd').addEventListener('input', (e) => {
  if (!document.getElementById('invAmountCoin').value) document.getElementById('invAmountCoin').value = e.target.value;
});

document.getElementById('btnSubmitInvoice').addEventListener('click', async () => {
  const errBox = document.getElementById('createError');
  errBox.classList.remove('show');
  const payload = {
    student_id: ACTIVE_STUDENT.id,
    period_year: Number(document.getElementById('invYear').value),
    period_month: Number(document.getElementById('invMonth').value),
    amount_vnd: Number(document.getElementById('invAmountVnd').value),
    amount_aiscoin: Number(document.getElementById('invAmountCoin').value),
    due_date: document.getElementById('invDueDate').value,
    status: 'unpaid',
  };
  if (!payload.amount_vnd || !payload.due_date) { errBox.textContent = 'Vui lòng nhập đủ số tiền và hạn chót.'; errBox.classList.add('show'); return; }

  const { error } = await supabase.from('invoices').insert(payload);
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }
  createModal.classList.remove('show');
  await selectStudent(ACTIVE_STUDENT);
});

// ---------------------------------------------------------------------
// Thu tiền — qua Ví (FIFO thật) hoặc tại quầy
// ---------------------------------------------------------------------
const collectModal = document.getElementById('collectModal');
const collectError = document.getElementById('collectError');

async function openCollectModal(invoice, remaining) {
  ACTIVE_INVOICE = invoice;
  collectError.classList.remove('show');
  document.getElementById('collectInfo').textContent = `Hoá đơn ${invoice.period_month}/${invoice.period_year} — còn nợ ${fmtMoney(remaining)} đ`;

  const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining').eq('wallet_id', ACTIVE_WALLET_ID);
  const balance = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);

  const walletBox = document.getElementById('walletCollectBox');
  if (balance > 0) {
    walletBox.style.display = 'block';
    document.getElementById('walletBalanceDisplay').textContent = `${fmtMoney(balance)} AIScoins`;
    document.getElementById('collectCoin').value = Math.min(balance, invoice.amount_aiscoin);
    document.getElementById('collectCoin').max = balance;
  } else {
    walletBox.style.display = 'none';
  }

  document.getElementById('collectVndCounter').value = remaining;
  collectModal.classList.add('show');
}
document.getElementById('closeCollectModal').addEventListener('click', () => collectModal.classList.remove('show'));

document.getElementById('btnCollectWallet').addEventListener('click', async () => {
  collectError.classList.remove('show');
  const coin = Number(document.getElementById('collectCoin').value);
  if (!coin || coin <= 0) { collectError.textContent = 'Vui lòng nhập số AIScoins hợp lệ.'; collectError.classList.add('show'); return; }

  const btn = document.getElementById('btnCollectWallet');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    const { error } = await supabase.rpc('deduct_wallet_fifo', {
      p_invoice_id: ACTIVE_INVOICE.id, p_coin_to_deduct: coin, p_actor_id: PROFILE.id,
    });
    if (error) throw error;
    alert(`Đã thu ${coin.toLocaleString('vi-VN')} AIScoins qua Ví (đã trừ đúng FIFO, tự ghi Nhật ký dòng tiền).`);
    collectModal.classList.remove('show');
    await selectStudent(ACTIVE_STUDENT);
  } catch (err) {
    collectError.textContent = err.message || 'Có lỗi xảy ra.';
    collectError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = '💳 Thu qua Ví (trừ FIFO)';
  }
});

document.getElementById('btnCollectCounter').addEventListener('click', async () => {
  collectError.classList.remove('show');
  const amount = Number(document.getElementById('collectVndCounter').value);
  const method = document.getElementById('collectMethod').value;
  if (!amount || amount <= 0) { collectError.textContent = 'Vui lòng nhập số tiền hợp lệ.'; collectError.classList.add('show'); return; }

  const btn = document.getElementById('btnCollectCounter');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    const { error } = await supabase.rpc('record_counter_payment', {
      p_invoice_id: ACTIVE_INVOICE.id, p_source: method, p_amount_vnd: amount, p_actor_id: PROFILE.id,
    });
    if (error) throw error;
    alert('Đã ghi nhận thu tiền tại quầy.');
    collectModal.classList.remove('show');
    await selectStudent(ACTIVE_STUDENT);
  } catch (err) {
    collectError.textContent = err.message || 'Có lỗi xảy ra.';
    collectError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = '🧾 Thu tại quầy';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id, departmentCode: emp?.departments?.code };

    const canUse = PROFILE.isCenterManager || PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Quản lý trung tâm/Kế toán/Ban điều hành mới dùng được trang này.</div>';
    }
  } catch (e) { /* bootShell tự điều hướng */ }
})();
