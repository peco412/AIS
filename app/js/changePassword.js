import { supabase } from './supabase.js';

const form = document.getElementById('changePwForm');
const errorBox = document.getElementById('pwError');
const submitBtn = document.getElementById('pwSubmit');

// Bắt buộc phải có phiên đăng nhập hợp lệ mới được vào trang này
const { data: sessionData } = await supabase.auth.getSession();
if (!sessionData.session) {
  window.location.href = 'index.html';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('show');

  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (newPassword.length < 6) {
    errorBox.textContent = 'Mật khẩu phải có ít nhất 6 ký tự.';
    errorBox.classList.add('show');
    return;
  }
  if (newPassword !== confirmPassword) {
    errorBox.textContent = 'Mật khẩu xác nhận không khớp.';
    errorBox.classList.add('show');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang cập nhật...';

  const { error: updateAuthError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateAuthError) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Xác nhận và tiếp tục';
    errorBox.textContent = 'Không thể cập nhật mật khẩu: ' + updateAuthError.message;
    errorBox.classList.add('show');
    return;
  }

  const { data: userData } = await supabase.auth.getUser();
  await supabase
    .from('employees')
    .update({ temp_password_flag: false })
    .eq('auth_user_id', userData.user.id);

  window.location.href = 'dashboard.html';
});
