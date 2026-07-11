// =====================================================================
// Đăng ký bằng SĐT + mật khẩu — tuỳ cấu hình Supabase Auth (mục "Confirm
// phone" trong Phone Provider) mà có thể cần xác minh OTP 1 LẦN DUY NHẤT
// ngay sau khi đăng ký trước khi dùng được; các lần đăng nhập SAU đó chỉ
// cần SĐT + mật khẩu, không cần OTP nữa.
// =====================================================================
const ENV = window.__ENV__ || {};
const supabase = window.supabase.createClient(
  ENV.SUPABASE_URL || 'https://your-project.supabase.co',
  ENV.SUPABASE_ANON_KEY || 'your-anon-key'
);

const errorBox = document.getElementById('registerError');
function showError(msg) { errorBox.textContent = msg; errorBox.classList.add('show'); }
function clearError() { errorBox.classList.remove('show'); errorBox.textContent = ''; }

function normalizePhone(input) {
  const digits = input.trim().replace(/\s+/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return '+84' + digits.slice(1);
  return '+84' + digits;
}

let currentPhone = '';

document.getElementById('btnRegister').addEventListener('click', async () => {
  clearError();
  const fullName = document.getElementById('fullName').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!fullName || !phone || !password) { showError('Vui lòng nhập đầy đủ thông tin.'); return; }
  if (password.length < 6) { showError('Mật khẩu cần tối thiểu 6 ký tự.'); return; }
  if (password !== confirmPassword) { showError('Mật khẩu nhập lại không khớp.'); return; }

  currentPhone = normalizePhone(phone);

  const btn = document.getElementById('btnRegister');
  btn.disabled = true; btn.textContent = 'Đang tạo tài khoản...';
  const { data, error } = await supabase.auth.signUp({
    phone: currentPhone, password,
    options: { data: { full_name: fullName } },
  });
  btn.disabled = false; btn.textContent = 'Đăng ký';

  if (error) {
    showError(error.message.includes('already registered') || error.message.includes('already exists')
      ? 'Số điện thoại này đã có tài khoản — vui lòng đăng nhập.'
      : 'Không đăng ký được: ' + error.message);
    return;
  }

  if (data.session) {
    // Khong yeu cau xac minh OTP (da tat "Confirm phone" o Supabase) -> vao thang
    window.location.href = 'link-student.html';
    return;
  }

  // Can xac minh OTP 1 lan de kich hoat tai khoan
  document.getElementById('registerStep').style.display = 'none';
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
  window.location.href = 'link-student.html';
});

document.getElementById('btnResendOtp').addEventListener('click', async () => {
  clearError();
  const { error } = await supabase.auth.resend({ type: 'sms', phone: currentPhone });
  if (error) showError('Không gửi lại được mã: ' + error.message);
  else alert('Đã gửi lại mã OTP.');
});

document.getElementById('btnGoLogin').addEventListener('click', () => { window.location.href = 'index.html'; });
