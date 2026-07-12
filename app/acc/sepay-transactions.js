import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ROWS = [];

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  const { data, error } = await supabase.from('sepay_transactions').select('*').order('received_at', { ascending: false }).limit(200);
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const statusFilter = document.getElementById('filterStatus').value;
  const rows = ALL_ROWS.filter((r) => !statusFilter || r.status === statusFilter);
  document.getElementById('resultCount').textContent = `${rows.length} giao dịch`;

  const STATUS_LABEL = { matched: 'Đã khớp', unmatched: 'Chưa khớp', duplicate: 'Trùng lặp' };
  const STATUS_BADGE = { matched: 'active', unmatched: 'rejected', duplicate: 'submitted' };

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="6" class="empty-cell">Chưa có giao dịch nào.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td class="cell-muted" style="font-size:12px;">${new Date(r.received_at).toLocaleString('vi-VN')}</td>
        <td class="mono" style="font-weight:600;">${Number(r.amount_vnd).toLocaleString('vi-VN')} đ</td>
        <td class="cell-muted" style="font-size:12px; max-width:220px;">${esc(r.raw_content || '—')}</td>
        <td class="mono cell-code">${esc(r.extracted_content || '—')}</td>
        <td><span class="badge badge-${STATUS_BADGE[r.status]}">${STATUS_LABEL[r.status]}</span></td>
        <td>${r.status === 'unmatched' ? `<button class="btn btn-accent btn-sm" data-reconcile="${r.id}">Đối chiếu</button>` : ''}</td>
      </tr>
    `).join('');

  tbody.querySelectorAll('[data-reconcile]').forEach((btn) => btn.addEventListener('click', () => openReconcile(btn.dataset.reconcile)));
}

document.getElementById('filterStatus').addEventListener('change', render);

const modal = document.getElementById('reconcileModal');
const errBox = document.getElementById('reconcileError');
let ACTIVE_TX = null;

async function openReconcile(txId) {
  ACTIVE_TX = ALL_ROWS.find((r) => r.id === txId);
  if (!ACTIVE_TX) return;
  errBox.classList.remove('show');

  document.getElementById('reconcileTxInfo').textContent =
    `Giao dịch ${Number(ACTIVE_TX.amount_vnd).toLocaleString('vi-VN')} đ — nội dung gốc: "${ACTIVE_TX.raw_content || '—'}"`;

  const { data: pending } = await supabase
    .from('wallet_topup_requests')
    .select('id, transfer_content, coin_amount, wallets(students(full_name))')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  const sel = document.getElementById('reconcileRequestSelect');
  sel.innerHTML = (pending || []).map((r) => `
    <option value="${r.id}">${esc(r.transfer_content)} — ${esc(r.wallets?.students?.full_name || '—')} — ${Number(r.coin_amount).toLocaleString('vi-VN')} coin</option>
  `).join('') || '<option value="">Không có yêu cầu nào đang chờ</option>';

  modal.classList.add('show');
}
document.getElementById('closeReconcileModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelReconcile').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('submitReconcile').addEventListener('click', async () => {
  errBox.classList.remove('show');
  const requestId = document.getElementById('reconcileRequestSelect').value;
  if (!requestId) { errBox.textContent = 'Vui lòng chọn 1 yêu cầu.'; errBox.classList.add('show'); return; }
  if (!confirm('Xác nhận khớp lệnh này với đúng yêu cầu đã chọn? Thao tác này sẽ cộng Coin ngay và không thể hoàn tác.')) return;

  const btn = document.getElementById('submitReconcile');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  const { error } = await supabase.rpc('reconcile_sepay_transaction', {
    p_transaction_id: ACTIVE_TX.id, p_request_id: requestId, p_approver_id: PROFILE.id,
  });
  btn.disabled = false; btn.textContent = 'Xác nhận khớp lệnh';
  if (error) { errBox.textContent = error.message; errBox.classList.add('show'); return; }

  modal.classList.remove('show');
  await loadRows();
});

(async () => {
  try {
    const { profile } = await bootShell();
    if (profile.roleCode !== 'TECH' && profile.roleCode !== 'EXECUTIVE' && profile.departmentCode !== 'ACC') {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Kế toán/Ban điều hành/Kỹ thuật mới dùng được trang này.</div>';
      return;
    }
    PROFILE = profile;
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
