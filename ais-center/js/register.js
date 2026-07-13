// =====================================================================
// Dang ky bang SDT + mat khau — DA BO HAN buoc xac minh OTP theo yeu cau
// (dang nhap hang ngay da dung mat khau tu truoc, buoc OTP luc dang ky
// la du thua). QUAN TRONG: de dang ky hoat dong dung KHONG can OTP, phai
// vao Supabase Dashboard -> Authentication -> Providers -> Phone -> TAT
// "Confirm phone" — neu con BAT, Supabase se tu doi hoi xac minh OTP o
// phia server bat ke code frontend co hay khong, se bao loi ngay o day.
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

document.getElementById('btnRegister').addEventListener('click', async () => {
  clearError();
  const fullName = document.getElementById('fullName').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!fullName || !phone || !password) { showError('Vui lòng nhập đầy đủ thông tin.'); return; }
  if (password.length < 6) { showError('Mật khẩu cần tối thiểu 6 ký tự.'); return; }
  if (password !== confirmPassword) { showError('Mật khẩu nhập lại không khớp.'); return; }

  const btn = document.getElementById('btnRegister');
  btn.disabled = true; btn.textContent = 'Đang tạo tài khoản...';
  const { data, error } = await supabase.auth.signUp({
    phone: normalizePhone(phone), password,
    options: { data: { full_name: fullName } },
  });
  btn.disabled = false; btn.textContent = 'Đăng ký';

  if (error) {
    // Hien THANG error.code (dang tin cay nhat theo tai lieu Supabase) —
    // giup chan doan chinh xac ngay, dac biet quan trong voi loi 400 luc
    // dang ky vi co the do NHIEU nguyen nhan cau hinh khac nhau.
    console.error('Lỗi đăng ký — code:', error.code, '| status:', error.status, '| message:', error.message);
    let friendlyMsg;
    if (error.code === 'phone_exists' || error.code === 'user_already_exists') friendlyMsg = 'Số điện thoại này đã có tài khoản — vui lòng đăng nhập.';
    else if (error.code === 'phone_provider_disabled') friendlyMsg = 'Đăng ký bằng SĐT+mật khẩu đang bị TẮT ở cấu hình hệ thống (Supabase Dashboard → Authentication → Sign In / Providers → Phone) — báo quản trị hệ thống bật lên.';
    else if (error.code === 'weak_password') friendlyMsg = 'Mật khẩu quá yếu, vui lòng đặt mật khẩu khác.';
    else if (error.code === 'sms_send_failed') friendlyMsg = 'Không gửi được SMS xác minh — có thể chưa cấu hình nhà cung cấp SMS (Twilio/MessageBird...) bên Supabase.';
    else if (error.code === 'validation_failed') friendlyMsg = 'Định dạng số điện thoại không hợp lệ.';
    else friendlyMsg = `Không đăng ký được (mã lỗi: ${error.code || 'không rõ'}) — báo quản trị hệ thống kèm mã lỗi này.`;
    showError(friendlyMsg);
    return;
  }

  if (!data.session) {
    // Truong hop nay chi xay ra neu "Confirm phone" ben Supabase Dashboard
    // van con BAT — can nguoi quan tri he thong tat thiet lap do di thi
    // dang ky moi vao thang duoc, khong con buoc OTP nao o day nua.
    showError('Không thể vào thẳng tài khoản — hệ thống đang yêu cầu xác minh thêm. Báo quản trị hệ thống kiểm tra lại cấu hình đăng nhập.');
    return;
  }

  window.location.href = 'link-student.html';
});

document.getElementById('btnGoLogin').addEventListener('click', () => { window.location.href = 'index.html'; });
