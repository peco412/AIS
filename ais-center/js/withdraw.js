import { supabase, esc, fmtMoney, fmtDate, bootParentShell, getSelectedStudentId } from './parentSupabase.js';

let PARENT_ID = null;
let WALLET_ID = null;
let STUDENT_ID_FOR_REQUEST = null;

async function loadPreview() {
  const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining, conversion_rate, created_at').eq('wallet_id', WALLET_ID).gt('coin_remaining', 0).order('created_at');

  // Dùng ĐÚNG công thức chính thức (tính cả số khoá đã học) thay vì chỉ
  // cộng số dư còn lại như trước — tránh phụ huynh thấy 1 số lúc gửi yêu
  // cầu, rồi Kế toán duyệt ra số khác hẳn gây hiểu lầm.
  const { data: total, error } = await supabase.rpc('calculate_wallet_refund', { p_wallet_id: WALLET_ID });
  document.getElementById('previewRefund').textContent = error ? '—' : `${fmtMoney(Number(total) || 0)} VNĐ`;

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

// SUA LOI THAT: truoc day CHI kiem tra status='pending' — neu yeu cau da
// bi TU CHOI, dang cho Ke toan (center_confirmed), hoac da hoan xong
// (approved), trang nay KHONG HIEN GI CA, phu huynh tuong nhu chua tung
// gui yeu cau — day chinh la ly do "co cho hien co cho khong" giua ERP
// (da sua du 4 trang thai) va App phu huynh (truoc day chi biet 1 trang
// thai). Gio kiem tra YEU CAU GAN NHAT bat ke trang thai nao.
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

  // Chi CHO PHEP gui yeu cau MOI khi yeu cau gan nhat da bi TU CHOI hoac
  // DA HOAN XONG (approved) — con dang pending/center_confirmed thi phai
  // cho xu ly xong yeu cau hien tai truoc, tranh gui trung.
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
    btn.disabled = false; btn.textContent = 'Gửi yêu cầu rút toàn bộ ví';
  }
});

(async () => {
  try {
    const { parent, students } = await bootParentShell();
    if (students.length === 0) return;
    PARENT_ID = parent.id;
    const studentId = getSelectedStudentId(students);

    // Luon hien ten hoc sinh de phu huynh xac nhan dung la con minh
    // truoc khi gui yeu cau rut vi - tranh nham vi giua cac con.
    const student = students.find((s) => s.id === studentId);
    const ownerLabel = document.getElementById('walletOwnerLabel');
    if (ownerLabel) ownerLabel.textContent = student ? `Ví của: ${student.full_name}` : '—';

    const { data: wallet } = await supabase.from('wallet_students').select('wallet_id').eq('student_id', studentId).maybeSingle();
    if (!wallet) {
      document.getElementById('batchBreakdown').innerHTML = '<div class="empty-state">Chưa có ví.</div>';
      document.getElementById('btnSubmitWithdraw').style.display = 'none';
      return;
    }
    WALLET_ID = wallet.wallet_id;
    STUDENT_ID_FOR_REQUEST = studentId;

    // Neu vi nay dang dung chung voi anh/chi/em khac, bao ro cho phu
    // huynh biet TRUOC khi gui yeu cau rut - vi rut se tat toan CA quy
    // chung, khong chi rieng phan cua con dang chon.
    const { data: members } = await supabase.from('wallet_students').select('students(full_name)').eq('wallet_id', WALLET_ID);
    if (members && members.length > 1) {
      const names = members.map((m) => m.students?.full_name).filter(Boolean).join(', ');
      if (ownerLabel) ownerLabel.textContent = `Ví chung — ${names}`;
      const sharedNotice = document.getElementById('sharedWalletNotice');
      if (sharedNotice) {
        sharedNotice.style.display = 'block';
        sharedNotice.textContent = `Đây là ví chung của ${names}. Rút ví sẽ tất toán toàn bộ số dư chung, không chỉ riêng phần của 1 con.`;
      }
    }

    const blocksNewRequest = await checkPendingRequest();
    await loadPreview();
    if (blocksNewRequest) document.getElementById('btnSubmitWithdraw').style.display = 'none';
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();