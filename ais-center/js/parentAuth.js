// =====================================================================
// Đăng nhập bằng SĐT + MẬT KHẨU (thay cho OTP mỗi lần đăng nhập, thuận
// tiện hơn cho phụ huynh dùng hàng ngày). OTP vẫn được giữ lại — chỉ
// dùng cho 2 việc: xác minh SĐT lần đầu lúc Đăng ký, và luồng "Quên mật
// khẩu" (xem register.js / forgotPassword.js).
// =====================================================================
const ENV = window.__ENV__ || {};
const supabase = window.supabase.createClient(
  ENV.SUPABASE_URL || 'https://your-project.supabase.co',
  ENV.SUPABASE_ANON_KEY || 'your-anon-key'
);

const errorBox = document.getElementById('loginError');
function showError(msg) { errorBox.textContent = msg; errorBox.classList.add('show'); }
function clearError() { errorBox.classList.remove('show'); errorBox.textContent = ''; }

function normalizePhone(input) {
  const digits = input.trim().replace(/\s+/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return '+84' + digits.slice(1);
  return '+84' + digits;
}

document.getElementById('btnLogin').addEventListener('click', async () => {
  clearError();
  const phone = normalizePhone(document.getElementById('phone').value.trim());
  const password = document.getElementById('password').value;
  if (!phone || !password) { showError('Vui lòng nhập đầy đủ số điện thoại và mật khẩu.'); return; }

  const btn = document.getElementById('btnLogin');
  btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
  const { error } = await supabase.auth.signInWithPassword({ phone, password });
  btn.disabled = false; btn.textContent = 'Đăng nhập';

  if (error) {
    showError(error.message.includes('Invalid login credentials')
      ? 'Số điện thoại hoặc mật khẩu không đúng.'
      : 'Không đăng nhập được: ' + error.message);
    return;
  }
  window.location.href = 'home.html';
});

document.getElementById('btnGoRegister').addEventListener('click', () => { window.location.href = 'register.html'; });
document.getElementById('btnForgot').addEventListener('click', () => { window.location.href = 'forgot-password.html'; });

// Bấm Enter ở ô mật khẩu cũng đăng nhập luôn, đỡ phải với chuột bấm nút
document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnLogin').click();
});

(async () => {
  const { data } = await supabase.auth.getSession();
  if (data.session) window.location.href = 'home.html';
})();
