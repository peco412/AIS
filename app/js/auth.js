import { supabase, usernameToEmail } from './supabase.js';
import { setLang, getLang, applyTranslations, t } from './i18n.js';
import { showLoginLoader } from './loginLoader.js';

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

  // Đổi logo theo đúng phân hệ nếu có file riêng (assets/logo-ilingo.png),
  // tự quay về logo ALOHA nếu chưa có logo riêng cho phân hệ đó.
  [document.getElementById('brandMarkLogo'), document.getElementById('watermarkLogo')].forEach((img) => {
    if (!img) return;
    img.src = `assets/logo-${div}.png`;
    img.onerror = () => { img.onerror = null; img.src = 'assets/logo-aloha.png'; };
  });
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
    .select('id, full_name, temp_password_flag, status, center_id, centers(divisions(code))')
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

  // Nhân viên gắn với 1 trung tâm cụ thể chỉ được đăng nhập đúng phân hệ
  // của trung tâm đó (chặn ALOHA đăng nhập vào phân hệ iLingo và ngược
  // lại). Nhân sự khối văn phòng (HR/ACC/BĐH... không gắn trung tâm) được
  // đăng nhập ở cả 2 phân hệ vì họ phục vụ chung cho toàn công ty.
  const employeeDivision = employee.centers?.divisions?.code; // 'ALOHA' | 'ILINGO' | undefined
  const selectedDivision = htmlEl.getAttribute('data-division'); // 'aloha' | 'ilingo'
  if (employeeDivision && employeeDivision.toLowerCase() !== selectedDivision) {
    showError(t('login.errWrongDivision'));
    await supabase.auth.signOut();
    return;
  }

  if (employee.temp_password_flag) {
    await showLoginLoader({ division: selectedDivision, message: t('login.loaderChangePassword', 'Đang chuẩn bị đổi mật khẩu...') });
    window.location.href = 'change-password.html';
    return;
  }

  await showLoginLoader({ division: selectedDivision, message: t('login.loaderMessage', 'Đang vào hệ thống...') });
  window.location.href = 'dashboard.html';
});

// Nếu đã đăng nhập sẵn (session còn hiệu lực) thì chuyển thẳng vào dashboard
supabase.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = 'dashboard.html';
});
