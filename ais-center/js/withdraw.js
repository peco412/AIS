import { supabase, esc, fmtMoney, fmtDate, bootParentShell } from './parentSupabase.js';

let PARENT_ID = null;
let WALLET_ID = null;
let STUDENT_ID_FOR_REQUEST = null;

// SUA LOI THAT: truoc day dung 1 cong thuc phuc tap "tru theo so khoa da
// hoc" cho CA VI — ap dung SAI cho moi coin trong vi, ke ca coin tu nap
// vi thong thuong (khong lien quan gi toi goi "Dong 2 khoa lien/Tron cap
// do con"). "Rut vi" gio CHI la rut lai dung so du con lai CHUA DUNG toi
// — don gian, chinh xac, dung ban chat thao tac. Hoan phi gia goi hoc
// khi nghi giua chung dung dung nut "Hoan phi" tren hoa don, do Ke toan
// xu ly rieng.
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

// Kiem tra yeu cau GAN NHAT bat ke trang thai nao — bao du 4 trang thai
// (pending/center_confirmed/approved/rejected), tranh phu huynh tuong
// nhu chua tung gui yeu cau khi thuc ra dang co 1 yeu cau dang xu ly.
async function checkPendingRequest() {
  const { data } = await supabase
    .from('wallet_withdrawal_requests')
    .select('id, preview_amount_vnd, status, created_at, reject_reason')
    .eq('wallet_id', WALLET_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const notice = document.getElementById('pendingNotice');
  if (!data) { notice.style.display = 'none'; return false; }

  const STATUS_MSG = {
    pending: `Yêu cầu rút ${fmtMoney(data.preview_amount_vnd)} VNĐ đang chờ Trung tâm xác nhận (gửi lúc ${fmtDate(data.created_at)}).`,
    center_confirmed: `Yêu cầu rút ${fmtMoney(data.preview_amount_vnd)} VNĐ đã được Trung tâm xác nhận, đang chờ Kế toán duyệt cuối.`,
    approved: `Yêu cầu rút ${fmtMoney(data.preview_amount_vnd)} VNĐ đã được duyệt xong — Kế toán sẽ chuyển khoản hoàn tiền trong thời gian sớm nhất.`,
    rejected: `Yêu cầu rút ví trước đó đã bị từ chối${data.reject_reason ? ` — Lý do: "${esc(data.reject_reason)}"` : ''}. Bạn có thể gửi yêu cầu mới nếu cần.`,
  };

  notice.style.display = 'block';
  notice.textContent = STATUS_MSG[data.status] || '';

  return data.status === 'pending' || data.status === 'center_confirmed';
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
      wallet_id: WALLET_ID, student_id: STUDENT_ID_FOR_REQUEST, requested_by: PARENT_ID, preview_amount_vnd: previewAmount, status: 'pending',
    });
    if (error) throw error;
    alert('Đã gửi yêu cầu rút ví. Vui lòng chờ Kế toán duyệt.');
    window.location.href = 'wallet.html';
  } catch (err) {
    errorBox.textContent = err.message || 'Có lỗi xảy ra.';
    errorBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi yêu cầu rút toàn bộ số dư';
  }
});

(async () => {
  try {
    const { parent, students } = await bootParentShell();
    if (students.length === 0) return;
    PARENT_ID = parent.id;

    // SUA: vi la vi CHUNG — dung con dau tien trong danh sach de tra vi
    // (ket qua giong het nhau du chon con nao), khong con phu thuoc vao
    // co che "chon con" da bo (xem sua o trang Vi/Trang chu truoc do).
    const studentId = students[0].id;
    STUDENT_ID_FOR_REQUEST = studentId;

    const { data: wallet } = await supabase.from('wallet_students').select('wallet_id').eq('student_id', studentId).maybeSingle();
    const ownerLabel = document.getElementById('walletOwnerLabel');
    if (!wallet) {
      if (ownerLabel) ownerLabel.textContent = students.map((s) => s.full_name).join(', ');
      document.getElementById('batchBreakdown').innerHTML = '<div class="empty-state">Chưa có ví.</div>';
      document.getElementById('btnSubmitWithdraw').style.display = 'none';
      return;
    }
    WALLET_ID = wallet.wallet_id;

    // Luon hien du ten TAT CA con dang dung chung vi nay — khong chi con
    // dau tien — de phu huynh biet ro dang rut dung vi cua ai.
    const { data: members } = await supabase.from('wallet_students').select('students(full_name)').eq('wallet_id', WALLET_ID);
    const names = (members || []).map((m) => m.students?.full_name).filter(Boolean);
    if (ownerLabel) ownerLabel.textContent = names.length > 1 ? `Ví chung — ${names.join(', ')}` : (names[0] || '—');
    if (names.length > 1) {
      const sharedNotice = document.getElementById('sharedWalletNotice');
      if (sharedNotice) {
        sharedNotice.style.display = 'block';
        sharedNotice.textContent = `Đây là ví chung của ${names.join(', ')}. Rút ví sẽ tất toán toàn bộ số dư chung, không chỉ riêng phần của 1 con.`;
      }
    }

    const blocksNewRequest = await checkPendingRequest();
    await loadPreview();
    if (blocksNewRequest) document.getElementById('btnSubmitWithdraw').style.display = 'none';
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();
