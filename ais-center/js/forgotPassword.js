// =====================================================================
// Quên mật khẩu — xác minh lại danh tính bằng OTP (đã có sẵn hạ tầng),
// sau khi xác minh thành công sẽ có phiên đăng nhập hợp lệ để tự đặt
// mật khẩu mới (không cần biết mật khẩu cũ).
// =====================================================================
const ENV = window.__ENV__ || {};
const supabase = window.supabase.createClient(
  ENV.SUPABASE_URL || 'https://your-project.supabase.co',
  ENV.SUPABASE_ANON_KEY || 'your-anon-key'
);

const errorBox = document.getElementById('forgotError');
function showError(msg) { errorBox.textContent = msg; errorBox.classList.add('show'); }
function clearError() { errorBox.classList.remove('show'); errorBox.textContent = ''; }

function normalizePhone(input) {
  const digits = input.trim().replace(/\s+/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return '+84' + digits.slice(1);
  return '+84' + digits;
}

let currentPhone = '';

document.getElementById('btnSendOtp').addEventListener('click', async () => {
  clearError();
  const raw = document.getElementById('phone').value.trim();
  if (!raw) { showError('Vui lòng nhập số điện thoại.'); return; }
  currentPhone = normalizePhone(raw);

  const btn = document.getElementById('btnSendOtp');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  const { error } = await supabase.auth.signInWithOtp({ phone: currentPhone });
  btn.disabled = false; btn.textContent = 'Gửi mã OTP';

  if (error) { showError('Không gửi được mã OTP: ' + error.message); return; }
  document.getElementById('phoneStep').style.display = 'none';
  document.getElementById('otpStep').style.display = 'block';
  document.getElementById('otpPhoneDisplay').textContent = currentPhone;
});

document.getElementById('btnVerifyOtp').addEventListener('click', async () => {
  clearError();
  const otp = document.getElementById('otp').value.trim();
  if (!otp) { showError('Vui lòng nhập mã OTP.'); return; }

  const btn = document.getElementById('btnVerifyOtp');
  btn.disabled = true; btn.textContent = 'Đang xác nhận...';
  const { error } = await supabase.auth.verifyOtp({ phone: currentPhone, token: otp, type: 'sms' });
  btn.disabled = false; btn.textContent = 'Xác nhận';

  if (error) { showError('Mã OTP không đúng hoặc đã hết hạn: ' + error.message); return; }

  document.getElementById('otpStep').style.display = 'none';
  document.getElementById('newPasswordStep').style.display = 'block';
});

document.getElementById('btnResendOtp').addEventListener('click', async () => {
  clearError();
  const { error } = await supabase.auth.signInWithOtp({ phone: currentPhone });
  if (error) showError('Không gửi lại được mã: ' + error.message);
  else alert('Đã gửi lại mã OTP.');
});

document.getElementById('btnSetPassword').addEventListener('click', async () => {
  clearError();
  const newPassword = document.getElementById('newPassword').value;
  const confirmNewPassword = document.getElementById('confirmNewPassword').value;
  if (newPassword.length < 6) { showError('Mật khẩu cần tối thiểu 6 ký tự.'); return; }
  if (newPassword !== confirmNewPassword) { showError('Mật khẩu nhập lại không khớp.'); return; }

  const btn = document.getElementById('btnSetPassword');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  btn.disabled = false; btn.textContent = 'Đặt mật khẩu mới';

  if (error) { showError('Không đặt được mật khẩu mới: ' + error.message); return; }
  alert('Đã đặt mật khẩu mới thành công! Vui lòng đăng nhập lại.');
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

document.getElementById('btnGoLogin').addEventListener('click', () => { window.location.href = 'index.html'; });
