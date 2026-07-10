import { supabase, bootParentShell } from './parentSupabase.js';

document.getElementById('btnLogout').addEventListener('click', async () => {
  if (!confirm('Đăng xuất khỏi tài khoản này?')) return;
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

(async () => {
  try {
    await bootParentShell();
  } catch (e) { /* bootParentShell tự điều hướng nếu chưa đăng nhập */ }
})();
