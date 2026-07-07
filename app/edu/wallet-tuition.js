import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ACTIVE_INVOICE = null;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

async function walletBalance(studentId) {
  const { data: wallet } = await supabase.from('wallets').select('id').eq('student_id', studentId).maybeSingle();
  if (!wallet) return 0;
  const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining').eq('wallet_id', wallet.id);
  return (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);
}

async function paidCoinForInvoice(invoiceId) {
  const { data: rows } = await supabase.from('debt_ledger').select('amount_coin').eq('invoice_id', invoiceId).eq('source', 'WALLET');
  return (rows || []).reduce((s, r) => s + Number(r.amount_coin || 0), 0);
}

async function search() {
  const q = document.getElementById('searchInput').value.trim();
  const resultsEl = document.getElementById('searchResults');
  if (!q) { resultsEl.innerHTML = ''; return; }

  resultsEl.innerHTML = '<div class="empty-cell">Đang tìm...</div>';

  let query = supabase.from('students').select('id, full_name, phone, parent_name').or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`).limit(10);
  if (PROFILE.centerId) query = query.eq('center_id', PROFILE.centerId);
  const { data: students, error } = await query;

  if (error) { resultsEl.innerHTML = `<div class="empty-cell">Lỗi: ${esc(error.message)}</div>`; return; }
  if (!students || students.length === 0) { resultsEl.innerHTML = '<div class="empty-cell">Không tìm thấy học viên phù hợp.</div>'; return; }

  const blocks = await Promise.all(students.map(async (s) => {
    const [{ data: invoices }, balance] = await Promise.all([
      supabase.from('invoices').select('id, period_year, period_month, amount_vnd, amount_aiscoin, status').eq('student_id', s.id).in('status', ['unpaid', 'partially_paid']).order('due_date'),
      walletBalance(s.id),
    ]);

    const invoiceRows = await Promise.all((invoices || []).map(async (inv) => {
      const paidCoin = await paidCoinForInvoice(inv.id);
      const remainingCoin = Number(inv.amount_aiscoin) - paidCoin;
      return { ...inv, paidCoin, remainingCoin };
    }));

    return `
      <div class="data-table-wrap" style="margin-bottom:16px;">
        <div style="padding:14px 18px; border-bottom:1px solid var(--separator); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong>${esc(s.full_name)}</strong>
            <span class="cell-muted"> — PH: ${esc(s.parent_name || '—')} · ${esc(s.phone || '—')}</span>
          </div>
          <div class="mono" style="font-weight:700; color:var(--accent-deep);">Số dư ví: ${fmtMoney(balance)} AIScoins</div>
        </div>
        ${invoiceRows.length === 0
          ? '<div class="empty-cell">🎉 Không có hoá đơn nào đang nợ (hệ thống Ví).</div>'
          : `<table class="data-table">
              <thead><tr><th>Kỳ học phí</th><th>Số tiền gốc</th><th>Đã trừ qua Ví</th><th>Còn thiếu (coin)</th><th data-i18n="common.status">Trạng thái</th><th></th></tr></thead>
              <tbody>
                ${invoiceRows.map((inv) => `
                  <tr>
                    <td>${inv.period_month}/${inv.period_year}</td>
                    <td class="mono">${fmtMoney(inv.amount_vnd)} đ / ${fmtMoney(inv.amount_aiscoin)} coin</td>
                    <td class="mono cell-muted">${fmtMoney(inv.paidCoin)} coin</td>
                    <td class="mono" style="color:var(--danger); font-weight:600;">${fmtMoney(inv.remainingCoin)} coin</td>
                    <td><span class="badge badge-${inv.status === 'unpaid' ? 'rejected' : 'submitted'}">${inv.status === 'unpaid' ? 'Chưa đóng' : 'Một phần'}</span></td>
                    <td><button class="btn btn-accent btn-sm" data-deduct="${inv.id}" data-remaining="${inv.remainingCoin}" data-balance="${balance}">Thu qua Ví</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`}
      </div>
    `;
  }));

  resultsEl.innerHTML = blocks.join('');
  resultsEl.querySelectorAll('[data-deduct]').forEach((btn) => {
    btn.addEventListener('click', () => openDeductModal(btn.dataset.deduct, Number(btn.dataset.remaining), Number(btn.dataset.balance)));
  });
}

let searchTimer;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 350);
});

const modal = document.getElementById('deductModal');
const formError = document.getElementById('formError');

function openDeductModal(invoiceId, remainingCoin, balance) {
  ACTIVE_INVOICE = invoiceId;
  formError.classList.remove('show');
  document.getElementById('invoiceInfo').textContent = `Còn thiếu ${fmtMoney(remainingCoin)} AIScoins — số dư ví hiện có: ${fmtMoney(balance)} AIScoins`;
  document.getElementById('coinAmount').value = Math.min(remainingCoin, balance);
  document.getElementById('coinAmount').max = balance;
  modal.classList.add('show');
}
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('btnConfirmDeduct').addEventListener('click', async () => {
  formError.classList.remove('show');
  const coin = Number(document.getElementById('coinAmount').value);
  if (!coin || coin <= 0) { formError.textContent = 'Vui lòng nhập số coin hợp lệ.'; formError.classList.add('show'); return; }

  const btn = document.getElementById('btnConfirmDeduct');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    const { error } = await supabase.rpc('deduct_wallet_fifo', {
      p_invoice_id: ACTIVE_INVOICE, p_coin_to_deduct: coin, p_actor_id: PROFILE.id,
    });
    if (error) throw error;
    modal.classList.remove('show');
    alert('Đã trừ ví thành công.');
    await search();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Xác nhận trừ ví';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    if (!profile.centerId && !['EXECUTIVE', 'TECH'].includes(profile.roleCode) && profile.departmentCode !== 'ACC') {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Trang này dành cho Quản lý trung tâm/Kế toán/Ban điều hành.</div>';
    }
  } catch (e) { /* bootShell tự điều hướng */ }
})();
