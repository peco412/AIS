import { supabase, bootParentShell } from './parentSupabase.js';

document.getElementById('btnChange').addEventListener('click', async () => {
  const errorBox = document.getElementById('changeError');
  const successBox = document.getElementById('changeSuccess');
  errorBox.classList.remove('show');
  successBox.style.display = 'none';

  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  if (newPassword.length < 6) { errorBox.textContent = 'Mật khẩu cần tối thiểu 6 ký tự.'; errorBox.classList.add('show'); return; }
  if (newPassword !== confirmPassword) { errorBox.textContent = 'Mật khẩu nhập lại không khớp.'; errorBox.classList.add('show'); return; }

  const btn = document.getElementById('btnChange');
  btn.disabled = true; btn.textContent = 'Đang cập nhật...';
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  btn.disabled = false; btn.textContent = 'Cập nhật mật khẩu';

  if (error) { errorBox.textContent = 'Không cập nhật được: ' + error.message; errorBox.classList.add('show'); return; }

  successBox.style.display = 'block';
  successBox.textContent = 'Đã đổi mật khẩu thành công.';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
});

(async () => {
  try {
    await bootParentShell();
  } catch (e) { /* bootParentShell tự điều hướng nếu chưa đăng nhập */ }
})();
