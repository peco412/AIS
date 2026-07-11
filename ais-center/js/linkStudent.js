import { supabase, bootParentShell } from './parentSupabase.js';

document.getElementById('btnSkip').addEventListener('click', () => { window.location.href = 'home.html'; });

document.getElementById('btnLink').addEventListener('click', async () => {
  const errorBox = document.getElementById('linkError');
  const successBox = document.getElementById('linkSuccess');
  errorBox.classList.remove('show');
  successBox.style.display = 'none';

  const name = document.getElementById('studentName').value.trim();
  const dob = document.getElementById('studentDob').value;
  if (!name || !dob) {
    errorBox.textContent = 'Vui lòng nhập đầy đủ họ tên và ngày sinh học sinh.';
    errorBox.classList.add('show');
    return;
  }

  const btn = document.getElementById('btnLink');
  btn.disabled = true; btn.textContent = 'Đang kiểm tra...';
  try {
    const { data, error } = await supabase.rpc('self_link_student', { p_full_name: name, p_dob: dob }).single();
    if (error) throw error;

    if (data.success) {
      successBox.style.display = 'block';
      successBox.textContent = '✅ ' + data.message;
      setTimeout(() => { window.location.href = 'home.html'; }, 1500);
    } else {
      errorBox.textContent = data.message;
      errorBox.classList.add('show');
    }
  } catch (err) {
    errorBox.textContent = err.message || 'Có lỗi xảy ra, vui lòng thử lại.';
    errorBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Liên kết ngay';
  }
});

// Nếu đã có sẵn học sinh liên kết rồi (vào lại trang này nhầm) -> chuyển
// thẳng về trang chủ, không cần liên kết thêm.
(async () => {
  try {
    const { students } = await bootParentShell();
    if (students.length > 0) window.location.href = 'home.html';
  } catch (e) { /* bootParentShell tự điều hướng nếu chưa đăng nhập */ }
})();
