import { supabase, esc, fmtMoney, bootParentShell, getSelectedStudentId } from './parentSupabase.js';

let STUDENT_ID = null;
let CENTER_ID = null;
let latestCalc = null;
let debounceTimer = null;

function fmtPercent(r) { return `${(Number(r) * 100).toFixed(1)}%`; }

async function updatePreview() {
  const amount = Number(document.getElementById('coinAmount').value);
  const previewBox = document.getElementById('previewBox');
  if (!amount || amount <= 0) {
    previewBox.style.display = 'none';
    const btn = document.getElementById('btnConfirmTopup');
    btn.textContent = 'Chọn số tiền cần nạp';
    btn.disabled = true;
    return;
  }

  const { data, error } = await supabase.rpc('calculate_topup_conversion', { p_coin_amount: amount, p_center_id: CENTER_ID }).single();
  if (error || !data) {
    previewBox.style.display = 'none';
    document.getElementById('btnConfirmTopup').disabled = true;
    return;
  }

  latestCalc = data;
  previewBox.style.display = 'block';

  document.getElementById('previewCoins').textContent = `${fmtMoney(amount)} AIScoins`;
  document.getElementById('previewTierRate').textContent = fmtPercent(data.tier_rate);
  document.getElementById('previewGross').textContent = `${fmtMoney(amount)} coin`;
  const vndToPay = Math.round(amount * data.conversion_rate);
  document.getElementById('previewVnd').textContent = `${fmtMoney(vndToPay)} VNĐ`;

  // Nut xac nhan hien LUON dung so tien se thanh toan — dung cam giac
  // "xem lai truoc khi xac nhan" cua app ngan hang, thay vi 1 nut chung
  // chung "Tao yeu cau" khong ro dang xac nhan bao nhieu tien.
  const btn = document.getElementById('btnConfirmTopup');
  btn.textContent = `Xác nhận nạp ${fmtMoney(vndToPay)} đ →`;
  btn.disabled = false;

  const programRow = document.getElementById('previewProgramRow');
  if (data.program_rate > 0) {
    programRow.style.display = 'flex';
    document.getElementById('previewProgramRate').textContent = `${fmtPercent(data.program_rate)}${data.program_name ? ' — ' + data.program_name : ''}`;
  } else {
    programRow.style.display = 'none';
  }

  const tiers = [10000000, 20000000, 30000000, 50000000];
  const nextTier = tiers.find((t) => t > amount);
  const hint = document.getElementById('previewHint');
  hint.textContent = (nextTier && nextTier - amount <= 2000000)
    ? `💡 Chỉ cần nạp thêm ${fmtMoney(nextTier - amount)} nữa là đạt mốc chiết khấu cao hơn.`
    : '';
}

document.getElementById('coinAmount').addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(updatePreview, 250);
  syncActiveChip();
});

// Nut chon nhanh so tien — bam vao la dien ngay vao o nhap + cap nhat
// xem truoc, giong thao tac quen thuoc cua cac app ngan hang/vi dien tu.
document.querySelectorAll('.amount-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.getElementById('coinAmount').value = chip.dataset.amount;
    syncActiveChip();
    updatePreview();
  });
});
function syncActiveChip() {
  const val = document.getElementById('coinAmount').value;
  document.querySelectorAll('.amount-chip').forEach((c) => c.classList.toggle('active', c.dataset.amount === val));
}

const errorBox = document.getElementById('topupError');

// ---------------------------------------------------------------------
// Tạo YÊU CẦU nạp ví (chưa cộng tiền ngay) — hiện QR chuyển khoản thật,
// đợi Kế toán/Quản lý trung tâm xác nhận đã nhận được tiền mới thật sự
// cộng vào ví (đúng góp ý: không cộng tiền chỉ vì phụ huynh bấm nút, phải
// có bước xác minh dòng tiền thật).
// ---------------------------------------------------------------------
document.getElementById('btnConfirmTopup').addEventListener('click', async () => {
  errorBox.classList.remove('show');
  const amount = Number(document.getElementById('coinAmount').value);
  if (!amount || !latestCalc) { errorBox.textContent = 'Vui lòng nhập số tiền hợp lệ.'; errorBox.classList.add('show'); return; }

  const btn = document.getElementById('btnConfirmTopup');
  btn.disabled = true; btn.textContent = 'Đang tạo yêu cầu...';
  try {
    const { data: request, error } = await supabase.rpc('create_topup_request', {
      p_student_id: STUDENT_ID, p_coin_amount: amount,
    }).single();
    if (error) throw error;

    const { data: bank, error: bankError } = await supabase.from('bank_settings').select('*').eq('id', request.bank_setting_id).single();
    // SUA LOI: truoc day khong bat "bankError" — neu query nay that bai
    // (thuong do RLS chan role phu huynh doc bang bank_settings), "bank"
    // se la null va dong "bank.bank_name" ben duoi nem TypeError, khien
    // toan bo flow QR bi crash am tham (rơi vao catch chung, hien loi mo
    // ho "Co loi xay ra"), trong khi request nap vi VAN DA duoc tao trong
    // DB (con o trang thai pending) — de lai request rac neu phu huynh bam
    // lai. Bao loi ro rang ngay tai day va KHONG hien the qrCard neu thieu
    // thong tin ngan hang.
    if (bankError || !bank) {
      errorBox.textContent = 'Đã tạo yêu cầu nạp ví nhưng không lấy được thông tin tài khoản ngân hàng để hiển thị QR. Vui lòng liên hệ trung tâm để được hỗ trợ hoàn tất chuyển khoản (không tạo lại yêu cầu để tránh trùng lặp).';
      errorBox.classList.add('show');
      return;
    }
    const vndAmount = Math.round(amount * latestCalc.conversion_rate);

    document.getElementById('amountCard').style.display = 'none';
    document.getElementById('btnConfirmTopup').style.display = 'none';
    document.getElementById('qrCard').style.display = 'block';

    document.getElementById('qrBankName').textContent = bank.bank_name;
    document.getElementById('qrAccountNo').textContent = bank.account_no;
    document.getElementById('qrAccountName').textContent = bank.account_name;
    document.getElementById('qrAmount').textContent = `${fmtMoney(vndAmount)} VNĐ`;
    document.getElementById('qrContent').textContent = request.transfer_content;

    // Dùng dịch vụ tạo QR chuyển khoản công khai của VietQR (không cần API
    // key riêng) — tự sinh QR đúng ngân hàng/số tài khoản/số tiền/nội dung.
    const qrUrl = `https://img.vietqr.io/image/${bank.bank_bin}-${bank.account_no}-compact2.png` +
      `?amount=${vndAmount}&addInfo=${encodeURIComponent(request.transfer_content)}&accountName=${encodeURIComponent(bank.account_name)}`;
    document.getElementById('qrImage').src = qrUrl;

    // Lang nghe Realtime — tu dong doi giao dien khi Ke toan HOAC he
    // thong (qua webhook SePay, neu da cau hinh) xac nhan xong, khong
    // can phu huynh phai tu bam lam moi trang.
    subscribeToRequestStatus(request.id);

    // Báo cho Kế toán + Quản lý trung tâm có yêu cầu mới cần đối chiếu sao
    // kê — không đợi họ tự vào kiểm tra định kỳ.
    await notifyStaffNewTopupRequest(request, vndAmount);
  } catch (err) {
    errorBox.textContent = err.message || 'Có lỗi xảy ra.';
    errorBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Tạo yêu cầu nạp ví';
  }
});

async function notifyStaffNewTopupRequest(request, vndAmount) {
  try {
    const { error } = await supabase.rpc('notify_staff_new_topup_request', {
      p_request_id: request.id, p_center_id: CENTER_ID, p_vnd_amount: vndAmount,
    });
    if (error) throw error;
  } catch (e) {
    console.warn('Không gửi được thông báo cho nhân viên:', e.message);
  }
}

// Lang nghe Realtime tren dung 1 dong wallet_topup_requests — khi status
// doi thanh "confirmed" (do Ke toan bam tay HOAC he thong tu dong xac
// nhan qua webhook SePay neu da cau hinh), tu chuyen giao dien sang trang
// thai thanh cong, khong can phu huynh tu lam moi trang.
function subscribeToRequestStatus(requestId) {
  const channel = supabase
    .channel(`topup-request-${requestId}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'wallet_topup_requests', filter: `id=eq.${requestId}`,
    }, (payload) => {
      if (payload.new.status === 'confirmed') {
        showTopupSuccess(payload.new);
        channel.unsubscribe();
      } else if (payload.new.status === 'rejected') {
        showTopupRejected(payload.new);
        channel.unsubscribe();
      }
    })
    .subscribe();
}

function showTopupSuccess(request) {
  document.getElementById('qrCard').style.display = 'none';
  const successEl = document.getElementById('topupSuccess');
  successEl.style.display = 'block';
  successEl.querySelector('#successAmount').textContent = `${fmtMoney(request.confirmed_amount_vnd || 0)} VNĐ`;
}

function showTopupRejected(request) {
  const errorBox = document.getElementById('topupError');
  errorBox.textContent = `Yêu cầu bị từ chối${request.reject_reason ? ': ' + request.reject_reason : ''}. Vui lòng liên hệ trung tâm.`;
  errorBox.classList.add('show');
}

(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length === 0) return;
    STUDENT_ID = getSelectedStudentId(students);
    CENTER_ID = students.find((s) => s.id === STUDENT_ID)?.center_id;
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();
