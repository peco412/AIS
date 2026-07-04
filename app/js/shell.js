import { supabase } from './supabase.js';
import { NAV_CONFIG } from './navConfig.js';
import { t, applyTranslations, syncLangFromProfile, setLang, getLang } from './i18n.js';

document.documentElement.setAttribute('data-division', localStorage.getItem('ais_division') || 'aloha');

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
}

function renderNav(profile, currentPage) {
  const sidebarNav = document.getElementById('sidebarNav');
  if (!sidebarNav) return;
  sidebarNav.innerHTML = '';
  NAV_CONFIG.forEach((group) => {
    const visibleItems = group.items.filter((item) => item.visible(profile));
    if (visibleItems.length === 0) return;
    if (group.sectionKey) {
      const heading = document.createElement('div');
      heading.className = 'sidebar__section';
      heading.textContent = t(group.sectionKey, group.section || '');
      sidebarNav.appendChild(heading);
    }
    const ul = document.createElement('ul');
    ul.className = 'sidebar__nav';
    visibleItems.forEach((item) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = item.href;
      a.innerHTML = `<span class="icon">${item.icon}</span><span>${esc(t(item.labelKey, item.label))}</span>`;
      if (currentPage && currentPage.endsWith(item.href)) a.classList.add('active');
      li.appendChild(a);
      ul.appendChild(li);
    });
    sidebarNav.appendChild(ul);
  });
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/**
 * Chèn 1 nút chuyển ngôn ngữ (VI/EN) vào topbar bằng JS — tránh phải sửa
 * lại phần <header> của mọi trang HTML trong hệ thống.
 */
function injectLangSwitcher(profileId) {
  const topbarRight = document.querySelector('.topbar__right');
  if (!topbarRight || document.getElementById('langSwitcher')) return;

  const wrap = document.createElement('div');
  wrap.id = 'langSwitcher';
  wrap.style.cssText = 'display:flex;background:var(--surface-fill);border-radius:999px;padding:2px;gap:2px;';
  wrap.innerHTML = `
    <button type="button" data-lang="vi" style="border:none;background:transparent;padding:5px 10px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;color:var(--muted);">VI</button>
    <button type="button" data-lang="en" style="border:none;background:transparent;padding:5px 10px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;color:var(--muted);">EN</button>
  `;
  topbarRight.insertBefore(wrap, topbarRight.firstChild);

  function paint() {
    const current = getLang();
    wrap.querySelectorAll('button').forEach((b) => {
      const active = b.dataset.lang === current;
      b.style.background = active ? 'var(--accent)' : 'transparent';
      b.style.color = active ? '#fff' : 'var(--muted)';
    });
  }
  wrap.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => setLang(b.dataset.lang, { supabase, employeeId: profileId }));
  });
  document.addEventListener('ais:langchange', paint);
  paint();
}

/**
 * Khởi tạo khung trang (sidebar/topbar) cho MỌI trang trong app.
 * Trả về { profile, supabase } để trang gọi tiếp logic riêng của nó.
 * Nếu chưa đăng nhập -> tự chuyển hướng về trang login.
 */
export async function bootShell() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    window.location.href = '/index.html';
    throw new Error('NO_SESSION');
  }

  const { data: employee, error } = await supabase
    .from('employees')
    .select(`
      id, full_name, avatar_url, dob, language_preference,
      departments ( code, name ),
      positions ( name, is_teacher_eligible ),
      system_roles ( code, name ),
      centers ( id, name, divisions ( code ) )
    `)
    .eq('auth_user_id', sessionData.session.user.id)
    .single();

  if (error || !employee) {
    window.location.href = '/index.html';
    throw new Error('NO_EMPLOYEE');
  }

  // Màu giao diện phải theo ĐÚNG trung tâm thật của nhân viên (qua division),
  // không phải theo lựa chọn tạm ở màn hình đăng nhập (localStorage) — nhân
  // viên khối văn phòng (HR/ACC/BĐH...) không gắn 1 trung tâm cụ thể thì mới
  // dùng lại lựa chọn đăng nhập làm mặc định.
  const realDivisionCode = employee.centers?.divisions?.code?.toLowerCase();
  if (realDivisionCode) {
    document.documentElement.setAttribute('data-division', realDivisionCode);
    localStorage.setItem('ais_division', realDivisionCode);
  }

  const profile = {
    id: employee.id,
    fullName: employee.full_name,
    dob: employee.dob,
    departmentCode: employee.departments?.code || null,
    departmentName: employee.departments?.name || '',
    positionName: employee.positions?.name || '',
    roleCode: employee.system_roles?.code || 'STAFF',
    roleName: employee.system_roles?.name || '',
    centerId: employee.centers?.id || null,
    centerName: employee.centers?.name || '',
    isCenterManager: employee.positions?.name === 'Quản lý trung tâm',
    // Dùng cờ is_teacher_eligible (không phải so tên chức vụ) để đúng nghiệp vụ
    // "kiêm nhiệm": nhân viên khối văn phòng vẫn có thể dạy nếu chức vụ được
    // đánh dấu is_teacher_eligible = true (khớp với app/edu/teachers.js).
    isTeacher: !!employee.positions?.is_teacher_eligible,
  };

  // Ngôn ngữ hiển thị theo đúng hồ sơ nhân viên (employees.language_preference),
  // để đăng nhập ở thiết bị khác vẫn giữ đúng lựa chọn đã lưu.
  syncLangFromProfile(employee.language_preference);

  window.__AIS_PROFILE__ = profile;

  const userChipName = document.getElementById('userChipName');
  const userChipRole = document.getElementById('userChipRole');
  const userChipAvatar = document.getElementById('userChipAvatar');
  if (userChipName) userChipName.textContent = profile.fullName;
  if (userChipRole) userChipRole.textContent = profile.positionName || profile.roleName;
  if (userChipAvatar) userChipAvatar.textContent = initials(profile.fullName);

  renderNav(profile, document.body.dataset.page || location.pathname);
  applyTranslations();
  injectLangSwitcher(profile.id);
  document.addEventListener('ais:langchange', () => {
    renderNav(profile, document.body.dataset.page || location.pathname);
    applyTranslations();
    document.getElementById('logoutBtn')?.setAttribute('title', t('common.logout'));
  });

  document.getElementById('logoutBtn')?.setAttribute('title', t('common.logout'));
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/index.html';
  });
  document.getElementById('menuToggle')?.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.toggle('open');
  });

  return { profile, supabase };
}