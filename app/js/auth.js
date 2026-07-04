import { supabase, usernameToEmail } from './supabase.js';

// ---------------------------------------------------------------------
// Đổi phân hệ (chỉ đổi màu accent theo #0094D9 ALOHA / #0B6C37 iLingo)
// ---------------------------------------------------------------------
const divisionButtons = document.querySelectorAll('[data-division-btn]');
const htmlEl = document.documentElement;

function setDivision(div) {
  htmlEl.setAttribute('data-division', div);
  divisionButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.divisionBtn === div ? 'true' : 'false');
  });
  localStorage.setItem('ais_division', div);
  document.getElementById('brandTitle').textContent =
    div === 'ilingo' ? 'iLingo' : 'ALOHA';
}

divisionButtons.forEach((btn) => {
  btn.addEventListener('click', () => setDivision(btn.dataset.divisionBtn));
});

setDivision(localStorage.getItem('ais_division') || 'aloha');

// ---------------------------------------------------------------------
// Đổi ngôn ngữ hiển thị (Việt / Anh) — lưu lựa chọn, áp dụng đầy đủ
// khi có bảng nội dung đa ngôn ngữ ở bước sau
// ---------------------------------------------------------------------
const langButtons = document.querySelectorAll('[data-lang-btn]');
function setLang(lang) {
  langButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.langBtn === lang ? 'true' : 'false');
  });
  localStorage.setItem('ais_lang', lang);
}
langButtons.forEach((btn) => btn.addEventListener('click', () => setLang(btn.dataset.langBtn)));
setLang(localStorage.getItem('ais_lang') || 'vi');

// ---------------------------------------------------------------------
// Đăng nhập
// ---------------------------------------------------------------------
const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const submitBtn = document.getElementById('loginSubmit');

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('show');
}
function clearError() {
  errorBox.classList.remove('show');
  errorBox.textContent = '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang đăng nhập...';

  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Đăng nhập';
    showError('Sai tên đăng nhập hoặc mật khẩu. Vui lòng thử lại.');
    return;
  }

  // Lấy hồ sơ nhân viên tương ứng để kiểm tra buộc đổi mật khẩu lần đầu
  const { data: employee, error: empError } = await supabase
    .from('employees')
    .select('id, full_name, temp_password_flag, status')
    .eq('auth_user_id', data.user.id)
    .single();

  submitBtn.disabled = false;
  submitBtn.textContent = 'Đăng nhập';

  if (empError || !employee) {
    showError('Không tìm thấy hồ sơ nhân viên gắn với tài khoản này. Liên hệ phòng nhân sự.');
    await supabase.auth.signOut();
    return;
  }

  if (employee.status !== 'active') {
    showError('Tài khoản của bạn hiện không ở trạng thái hoạt động.');
    await supabase.auth.signOut();
    return;
  }

  if (employee.temp_password_flag) {
    window.location.href = 'change-password.html';
    return;
  }

  window.location.href = 'dashboard.html';
});

// Nếu đã đăng nhập sẵn (session còn hiệu lực) thì chuyển thẳng vào dashboard
supabase.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = 'dashboard.html';
});

// =====================================================================
// ĐĂNG KÝ SERVICE WORKER + TỰ ĐỘNG HỎI RELOAD KHI CÓ BẢN MỚI
// =====================================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {

      // Kiểm tra định kỳ xem server có SW mới không (mỗi 5 phút)
      setInterval(() => reg.update(), 5 * 60 * 1000);

      // Khi phát hiện SW mới đang cài (do đổi CACHE_NAME trong sw.js)
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            // Hỏi trước khi reload để tránh mất dữ liệu đang nhập dở
            if (confirm('Có bản cập nhật mới. Tải lại trang ngay?')) {
              window.location.reload();
            }
          }
        });
      });

    }).catch((err) => console.warn('SW register failed:', err));
  });

  // Phòng trường hợp controllerchange bắn nhiều lần
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}