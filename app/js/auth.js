import { supabase, usernameToEmail } from './supabase.js';
import { setLang, getLang, applyTranslations, t } from './i18n.js';

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
// Đổi ngôn ngữ hiển thị (Việt / Anh) — dùng chung engine js/i18n.js với
// toàn bộ hệ thống, chưa đăng nhập nên chỉ lưu localStorage (không có
// employeeId để đồng bộ lên DB, việc đó xảy ra ở shell.js sau khi đăng nhập).
// ---------------------------------------------------------------------
const langButtons = document.querySelectorAll('[data-lang-btn]');
function paintLangButtons() {
  const current = getLang();
  langButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.langBtn === current ? 'true' : 'false');
  });
}
langButtons.forEach((btn) => btn.addEventListener('click', () => { setLang(btn.dataset.langBtn, { persist: false }); paintLangButtons(); }));
applyTranslations();
paintLangButtons();

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
    showError(t('login.errFields'));
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = t('login.submitting');

  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    submitBtn.disabled = false;
    submitBtn.textContent = t('login.submit');
    showError(t('login.errCreds'));
    return;
  }

  // Lấy hồ sơ nhân viên tương ứng để kiểm tra buộc đổi mật khẩu lần đầu
  const { data: employee, error: empError } = await supabase
    .from('employees')
    .select('id, full_name, temp_password_flag, status')
    .eq('auth_user_id', data.user.id)
    .single();

  submitBtn.disabled = false;
  submitBtn.textContent = t('login.submit');

  if (empError || !employee) {
    showError(t('login.errNoEmployee'));
    await supabase.auth.signOut();
    return;
  }

  if (employee.status !== 'active') {
    showError(t('login.errInactive'));
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
