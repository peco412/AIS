// =====================================================================
// Đăng nhập bằng SĐT + OTP — dùng Supabase Auth Phone Provider có sẵn
// (KHÔNG tự xây OTP riêng, tận dụng cơ chế OTP built-in của Supabase Auth
// để tránh trùng lặp hạ tầng SMS — Dashboard -> Authentication -> Providers
// -> Phone -> bật + kết nối nhà cung cấp SMS thật trước khi dùng trang này).
// =====================================================================
const ENV = window.__ENV__ || {};
const supabase = window.supabase.createClient(
  ENV.SUPABASE_URL || 'https://iikflzntcpqliuxrzvdz.supabase.co',
  ENV.SUPABASE_ANON_KEY || 'sb_publishable_LS0uVPYtiWQeS6o0HeaClA_ygGjI8oM'
);

const errorBox = document.getElementById('loginError');
function showError(msg) { errorBox.textContent = msg; errorBox.classList.add('show'); }
function clearError() { errorBox.classList.remove('show'); errorBox.textContent = ''; }

function normalizePhone(input) {
  const digits = input.trim().replace(/\s+/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return '+84' + digits.slice(1); // quy ước số Việt Nam
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

  window.location.href = 'home.html';
});

document.getElementById('btnResendOtp').addEventListener('click', async () => {
  clearError();
  const { error } = await supabase.auth.signInWithOtp({ phone: currentPhone });
  if (error) showError('Không gửi lại được mã: ' + error.message);
  else alert('Đã gửi lại mã OTP.');
});

(async () => {
  const { data } = await supabase.auth.getSession();
  if (data.session) window.location.href = 'home.html';
})();
