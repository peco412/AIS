import { supabase, esc, fmtMoney, bootParentShell, getSelectedStudentId } from './parentSupabase.js';

let STUDENT_ID = null;
let CENTER_ID = null;
let latestCalc = null;
let debounceTimer = null;

function fmtPercent(r) { return `${(Number(r) * 100).toFixed(1)}%`; }

async function updatePreview() {
  const amount = Number(document.getElementById('coinAmount').value);
  const previewBox = document.getElementById('previewBox');
  if (!amount || amount <= 0) { previewBox.style.display = 'none'; return; }

  const { data, error } = await supabase.rpc('calculate_topup_conversion', { p_coin_amount: amount, p_center_id: CENTER_ID }).single();
  if (error || !data) { previewBox.style.display = 'none'; return; }

  latestCalc = data;
  previewBox.style.display = 'block';

  document.getElementById('previewCoins').textContent = `${fmtMoney(amount)} AIScoins`;
  document.getElementById('previewTierRate').textContent = fmtPercent(data.tier_rate);
  document.getElementById('previewGross').textContent = `${fmtMoney(amount)} coin`;
  document.getElementById('previewVnd').textContent = `${fmtMoney(amount * data.conversion_rate)} VNĐ`;

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
});

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

    const { data: bank } = await supabase.from('bank_settings').select('*').eq('id', request.bank_setting_id).single();
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
    const { data: staffRole } = await supabase.from('departments').select('id').eq('code', 'ACC').single();
    const { data: staff } = await supabase.from('employees').select('id')
      .or(`department_id.eq.${staffRole?.id},center_id.eq.${CENTER_ID}`);

    const title = `💰 Yêu cầu nạp ví mới — ${request.transfer_content}`;
    const content = `Cần đối chiếu chuyển khoản ${vndAmount.toLocaleString('vi-VN')} VNĐ, nội dung "${request.transfer_content}".`;

    for (const s of staff || []) {
      await supabase.from('notifications').insert({
        scope: 'personal', target_employee_id: s.id, title, content, url: '/acc/wallet-topup-requests.html',
      });
    }
  } catch (e) {
    console.warn('Không gửi được thông báo cho nhân viên:', e.message);
  }
}

(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length === 0) return;
    STUDENT_ID = getSelectedStudentId(students);
    CENTER_ID = students.find((s) => s.id === STUDENT_ID)?.center_id;
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();
