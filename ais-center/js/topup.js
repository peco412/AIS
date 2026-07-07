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
  document.getElementById('previewRate').textContent = fmtPercent(data.discount_rate);
  document.getElementById('previewVnd').textContent = `${fmtMoney(amount * data.conversion_rate)} VNĐ`;

  // Gợi ý mốc bậc cao hơn (mục 5.1, tuỳ chọn không bắt buộc)
  const tiers = [10000000, 20000000, 30000000, 50000000];
  const nextTier = tiers.find((t) => t > amount);
  const hint = document.getElementById('previewHint');
  if (nextTier && nextTier - amount <= 2000000) {
    hint.textContent = `💡 Chỉ cần nạp thêm ${fmtMoney(nextTier - amount)} nữa là đạt mốc chiết khấu cao hơn.`;
  } else {
    hint.textContent = '';
  }
}

document.getElementById('coinAmount').addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(updatePreview, 250);
});

const confirmModal = document.getElementById('confirmModal');
const errorBox = document.getElementById('topupError');

document.getElementById('btnConfirmTopup').addEventListener('click', () => {
  errorBox.classList.remove('show');
  const amount = Number(document.getElementById('coinAmount').value);
  if (!amount || !latestCalc) { errorBox.textContent = 'Vui lòng nhập số tiền hợp lệ.'; errorBox.classList.add('show'); return; }

  document.getElementById('confirmCoin').textContent = `${fmtMoney(amount)} AIScoins`;
  document.getElementById('confirmVnd').textContent = `${fmtMoney(amount * latestCalc.conversion_rate)} VNĐ`;
  document.getElementById('confirmProgram').textContent = latestCalc.program_id ? 'Có áp dụng ưu đãi đặc biệt' : 'Không có';
  confirmModal.style.display = 'flex';
});
document.getElementById('btnCancelConfirm').addEventListener('click', () => { confirmModal.style.display = 'none'; });

document.getElementById('btnFinalConfirm').addEventListener('click', async () => {
  const amount = Number(document.getElementById('coinAmount').value);
  const method = document.getElementById('method').value;

  const btn = document.getElementById('btnFinalConfirm');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    const { error } = await supabase.rpc('topup_wallet', {
      p_student_id: STUDENT_ID, p_coin_amount: amount, p_method: method, p_created_by: null,
    });
    if (error) throw error;
    alert('Nạp ví thành công!');
    window.location.href = 'wallet-detail.html';
  } catch (err) {
    confirmModal.style.display = 'none';
    errorBox.textContent = err.message || 'Có lỗi xảy ra.';
    errorBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Xác nhận nạp';
  }
});

(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length === 0) return;
    STUDENT_ID = getSelectedStudentId(students);
    CENTER_ID = students.find((s) => s.id === STUDENT_ID)?.center_id;
  } catch (e) { /* bootParentShell tự điều hướng */ }
})();
