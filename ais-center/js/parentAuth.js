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

// MOI — nhan vien dang nhap de dung Mang xa hoi: dung LAI dung quy uoc
// ten dang nhap -> email gia "@ais.local" nhu ben AIS OFFICE (khong
// tao he thong dinh danh rieng), chi khac o cho goi tu 1 form khac.
const USERNAME_DOMAIN = '@ais.local';
function usernameToEmail(username) {
  return username.trim().toLowerCase().replace(/\s+/g, '') + USERNAME_DOMAIN;
}

let isStaffMode = false;
document.getElementById('btnToggleStaffLogin').addEventListener('click', () => {
  isStaffMode = !isStaffMode;
  document.getElementById('fieldPhone').style.display = isStaffMode ? 'none' : 'block';
  document.getElementById('fieldUsername').style.display = isStaffMode ? 'block' : 'none';
  document.getElementById('btnToggleStaffLogin').textContent = isStaffMode
    ? '📱 Đăng nhập bằng số điện thoại (phụ huynh)'
    : '👤 Đăng nhập bằng tài khoản nhân viên';
  document.getElementById('btnGoRegister').style.display = isStaffMode ? 'none' : 'inline';
  document.getElementById('btnForgot').style.display = isStaffMode ? 'none' : 'inline';
  clearError();
});

document.getElementById('btnLogin').addEventListener('click', async () => {
  clearError();
  const password = document.getElementById('password').value;
  const btn = document.getElementById('btnLogin');

  if (isStaffMode) {
    const username = document.getElementById('username').value.trim();
    if (!username || !password) { showError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.'); return; }
    btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    btn.disabled = false; btn.textContent = 'Đăng nhập';
    if (error) {
      showError(error.code === 'invalid_credentials' ? 'Tên đăng nhập hoặc mật khẩu không đúng.' : `Không đăng nhập được (mã lỗi: ${error.code || 'không rõ'}).`);
      return;
    }
    window.location.href = 'community.html';
    return;
  }

  const phone = normalizePhone(document.getElementById('phone').value.trim());
  if (!phone || !password) { showError('Vui lòng nhập đầy đủ số điện thoại và mật khẩu.'); return; }

  btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
  const { error } = await supabase.auth.signInWithPassword({ phone, password });
  btn.disabled = false; btn.textContent = 'Đăng nhập';

  if (error) {
    // Hien THANG error.code (theo dung tai lieu Supabase, day la truong
    // DANG TIN CAY nhat de xac dinh nguyen nhan that su, dang tin cay
    // hon nhieu so voi doan chu error.message hay HTTP status chung
    // chung) — giup chan doan chinh xac ngay tren man hinh, khong can
    // vao Dashboard xem log.
    console.error('Lỗi đăng nhập — code:', error.code, '| status:', error.status, '| message:', error.message);
    let friendlyMsg;
    if (error.code === 'phone_not_confirmed') friendlyMsg = 'Số điện thoại chưa được xác minh — báo quản trị hệ thống xác nhận lại tài khoản này.';
    else if (error.code === 'phone_provider_disabled') friendlyMsg = 'Đăng nhập bằng SĐT+mật khẩu đang bị tắt ở cấu hình hệ thống — báo quản trị hệ thống kiểm tra lại.';
    else if (error.code === 'invalid_credentials') friendlyMsg = 'Số điện thoại hoặc mật khẩu không đúng.';
    else if (error.code === 'user_banned') friendlyMsg = 'Tài khoản này đang bị tạm khoá — liên hệ trung tâm.';
    else if (error.code === 'over_request_rate_limit' || error.code === 'over_sms_send_rate_limit') friendlyMsg = 'Thử lại quá nhiều lần — vui lòng đợi vài phút rồi thử lại.';
    else friendlyMsg = `Không đăng nhập được (mã lỗi: ${error.code || 'không rõ'}) — báo quản trị hệ thống kèm mã lỗi này.`;
    showError(friendlyMsg);
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
  if (!data.session) return;
  // MOI — kiem tra dung day la phien phu huynh hay nhan vien truoc khi
  // dieu huong, tranh nhan vien (khong co ho so parent_accounts) bi
  // dua nham ve home.html (trang danh rieng cho phu huynh).
  const { data: parent } = await supabase.from('parent_accounts').select('id').eq('auth_user_id', data.session.user.id).maybeSingle();
  window.location.href = parent ? 'home.html' : 'community.html';
})();
