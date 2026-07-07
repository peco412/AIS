import { supabase, esc, fmtMoney, fmtDate, bootParentShell, getSelectedStudentId } from './parentSupabase.js';

let PARENT_ID = null;
let WALLET_ID = null;

async function loadPreview() {
  const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining, conversion_rate, created_at').eq('wallet_id', WALLET_ID).gt('coin_remaining', 0).order('created_at');

  const total = (batches || []).reduce((s, b) => s + Number(b.coin_remaining) * Number(b.conversion_rate), 0);
  document.getElementById('previewRefund').textContent = `${fmtMoney(total)} VNĐ`;

  const el = document.getElementById('batchBreakdown');
  el.innerHTML = (batches || []).length === 0
    ? '<div class="empty-state">Ví không còn số dư để rút.</div>'
    : batches.map((b) => `
      <div class="batch-row">
        <div class="batch-row__left"><div class="date">${fmtDate(b.created_at)}</div></div>
        <div class="batch-row__right">
          <div class="coin">${fmtMoney(b.coin_remaining)} coin</div>
          <div class="vnd">→ ${fmtMoney(b.coin_remaining * b.conversion_rate)} VNĐ</div>
        </div>
      </div>
    `).join('');

  return total;
}

async function checkPendingRequest() {
  const { data } = await supabase.from('wallet_withdrawal_requests').select('id, preview_amount_vnd, created_at').eq('wallet_id', WALLET_ID).eq('status', 'pending').maybeSingle();
  if (data) {
    document.getElementById('pendingNotice').style.display = 'block';
    document.getElementById('pendingNotice').textContent = `Bạn đã có 1 yêu cầu rút ${fmtMoney(data.preview_amount_vnd)} VNĐ đang chờ duyệt (gửi lúc ${fmtDate(data.created_at)}).`;
    document.getElementById('btnSubmitWithdraw').style.display = 'none';
    return true;
  }
  return false;
}

document.getElementById('btnSubmitWithdraw').addEventListener('click', async () => {
  const errorBox = document.getElementById('withdrawError');
  errorBox.classList.remove('show');

  const previewAmount = await loadPreview();
  if (previewAmount <= 0) { errorBox.textContent = 'Ví không còn số dư để rút.'; errorBox.classList.add('show'); return; }

  const btn = document.getElementById('btnSubmitWithdraw');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  try {
    const { error } = await supabase.from('wallet_withdrawal_requests').insert({
      wallet_id: WALLET_ID, requested_by: PARENT_ID, preview_amount_vnd: previewAmount, status: 'pending',
    });
    if (error) throw error;
    alert('Đã gửi yêu cầu rút ví. Vui lòng chờ Kế toán duyệt.');
    window.location.href = 'home.html';
  } catch (err) {
    errorBox.textContent = err.message || 'Có lỗi xảy ra.';
    errorBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi yêu cầu rút toàn bộ ví';
  }
});

(async () => {
  try {
    const { parent, students } = await bootParentShell();
    if (students.length === 0) return;
    PARENT_ID = parent.id;
    const studentId = getSelectedStudentId(students);

    const { data: wallet } = await supabase.from('wallets').select('id').eq('student_id', studentId).maybeSingle();
    if (!wallet) {
      document.getElementById('batchBreakdown').innerHTML = '<div class="empty-state">Chưa có ví.</div>';
      document.getElementById('btnSubmitWithdraw').style.display = 'none';
      return;
    }
    WALLET_ID = wallet.id;

    const hasPending = await checkPendingRequest();
    await loadPreview();
    if (hasPending) document.getElementById('btnSubmitWithdraw').style.display = 'none';
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();
