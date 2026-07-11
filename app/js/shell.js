import { supabase } from './supabase.js';
import { NAV_CONFIG } from './navConfig.js';
import { t, applyTranslations, syncLangFromProfile, setLang, getLang } from './i18n.js';
import { attachInstallButton } from './installPrompt.js';

document.documentElement.setAttribute('data-division', localStorage.getItem('ais_division') || 'aloha');

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
}

// Các mục dùng chung luôn hiển thị dù đang ở phòng ban nào (điều hướng
// nhanh) — không tính là "1 phòng ban" nên không bị lọc theo ngữ cảnh.
// (Đã bỏ ALWAYS_VISIBLE_HREFS — không còn cần thiết sau khi tách "Chức
// năng cá nhân" thành nhóm alwaysShow riêng, xem NAV_CONFIG.)

// Kiểm tra quyền hiển thị mặc định THEO đúng vai trò/phòng ban, HOẶC đã
// được cấp thêm riêng qua module "Xin thêm quyền hạn" (granted_permissions,
// nạp sẵn vào profile.grantedModules ở trên).
// Giao diện điện thoại CHỈ hiện các tác vụ cơ bản theo đúng yêu cầu BGD:
// thông báo, đơn xin nghỉ, đơn công tác, yêu cầu truyền thông, yêu cầu
// CSVC, và toàn bộ nhóm "chức năng cá nhân" — các module nghiệp vụ theo
// phòng ban (nhân sự/kế toán/CSVC quản trị...) chỉ dùng trên web/máy tính.
export const MOBILE_ALLOWED_HREFS = new Set([
  '/dashboard.html', '/notifications.html', '/profile.html', '/directory.html',
  '/meetings.html', '/attendance-checkin.html', '/hr/late-clockin-requests.html',
  '/proposals.html', '/archive.html', '/permission-requests.html',
  '/hr/leave-requests.html', '/hr/business-trips.html', '/hr/contracts.html', '/my-payroll.html',
  '/mkt/requests.html', '/fac/requests.html', '/exec/broadcast.html',
]);
export function isMobileViewport() {
  return window.matchMedia('(max-width: 960px)').matches;
}

function canAccess(item, profile) {
  if (isMobileViewport() && !MOBILE_ALLOWED_HREFS.has(item.href)) return false;
  return item.visible(profile) || !!profile.grantedModules?.has(item.href);
}

function findActiveGroup(currentPage, profile) {
  if (!currentPage) return null;
  // SUA LOI THAT: truoc day chi tim nhom DAU TIEN co chua href nay, KHONG
  // quan tam nguoi dang xem co thuoc nhom do khong. Vi mot so trang dung
  // chung o NHIEU nhom (vd "Don nghi" o ca Nhan su LAN Khoi trung tam,
  // "Phieu mua hang" o ca Ke toan LAN Khoi trung tam), Quan ly trung
  // tam/Giao vien/Tu van vien bi day nham vao nhom dung TRUOC trong mang
  // (Nhan su/Ke toan) dù ho khong thuoc phong do. Gio uu tien nhom ma
  // chinh nguoi dang xem CO QUYEN thay item do (canAccess), chi fallback
  // ve khop href don thuan neu khong nhom nao khop dung quyen.
  //
  // Loai bo nhom "alwaysShow" (vd "Chuc nang ca nhan") khoi danh sach
  // canh tranh — nhung nhom nay LUON hien rieng, khong nen duoc chon lam
  // "nhom dang active" chi vi chua 1 item trung href (vd "Phieu mua
  // hang" xuat hien ca o day nhu 1 loi tat ca nhan).
  const groupsWithHref = NAV_CONFIG.filter((group) =>
    group.sectionKey && !group.alwaysShow && group.items.some((item) => currentPage.endsWith(item.href))
  );
  if (groupsWithHref.length === 0) return null;
  if (profile) {
    const matchByRole = groupsWithHref.find((group) =>
      group.items.some((item) => currentPage.endsWith(item.href) && canAccess(item, profile))
    );
    if (matchByRole) return matchByRole;

    // Khong nhom nao qua duoc kiem tra quyen (vd giao vien khong co quyen
    // "Thu hoc phi" o CA 2 ban, do dung thu vao link khong danh cho ho) —
    // thay vi mac dinh chon nhom DUNG DAU mang (thuong la Nhan su/Ke toan,
    // gay cam giac "bi day nham vao phong khac"), uu tien nhom co layer
    // KHOP DUNG boi canh vai tro chinh cua nguoi dang xem.
    const isCentersPerson = profile.isCenterManager || profile.isTeacher || profile.roleCode === 'CONSULTANT';
    const layerPref = isCentersPerson ? 'centers' : 'office';
    const byLayer = groupsWithHref.find((group) => group.layer === layerPref);
    if (byLayer) return byLayer;
  }
  return groupsWithHref[0];
}

function renderNav(profile, currentPage) {
  const sidebarNav = document.getElementById('sidebarNav');
  if (!sidebarNav) return;
  sidebarNav.innerHTML = '';

  // 1) "Tầng Thông báo, Tổng quan công việc" — luôn hiện đầu tiên
  const topGroup = NAV_CONFIG.find((g) => !g.sectionKey && !g.section);
  if (topGroup) {
    const items = topGroup.items.filter((item) => canAccess(item, profile));
    if (items.length > 0) {
      const heading = document.createElement('div');
      heading.className = 'sidebar__section';
      heading.textContent = t('nav.layer.overview', 'Thông Báo & Tổng Quan');
      sidebarNav.appendChild(heading);

      const ul = document.createElement('ul');
      ul.className = 'sidebar__nav';
      items.forEach((item) => ul.appendChild(buildNavLi(item, profile, currentPage)));
      sidebarNav.appendChild(ul);
    }
  }

  // 2) "Chức năng cá nhân" — LUÔN hiện đủ (alwaysShow: true), không chỉ khi
  // đang đứng đúng trang trong nhóm này như trước, để đúng ý "1 trong 4
  // phần chính luôn thấy được, không ẩn hiện tuỳ ngữ cảnh".
  const personalGroup = NAV_CONFIG.find((g) => g.alwaysShow);
  if (personalGroup) {
    const items = personalGroup.items.filter((item) => canAccess(item, profile));
    if (items.length > 0) {
      const parentLabel = document.createElement('div');
      parentLabel.className = 'sidebar__section sidebar__section--parent';
      parentLabel.textContent = t('nav.layer.personal', 'Tiện Ích Cá Nhân');
      sidebarNav.appendChild(parentLabel);

      const heading = document.createElement('div');
      heading.className = 'sidebar__section sidebar__section--child';
      heading.textContent = t(personalGroup.sectionKey, personalGroup.section);
      sidebarNav.appendChild(heading);

      const ul = document.createElement('ul');
      ul.className = 'sidebar__nav';
      items.forEach((item) => ul.appendChild(buildNavLi(item, profile, currentPage)));
      sidebarNav.appendChild(ul);
    }
  }

  // 3) "Tầng Phòng ban điều hành" HOẶC "Tầng Hệ thống trung tâm" — tuỳ
  // nhóm đang active thuộc layer nào (2 tầng khác nhau theo đúng yêu cầu,
  // KHÔNG gộp chung 1 nhãn "Các phòng ban" như trước nữa). Vẫn chỉ hiện
  // đúng 1 nhóm con tại 1 thời điểm (giữ nguyên tắc chống rối mắt).
  const activeGroup = findActiveGroup(currentPage, profile);
  if (!activeGroup || activeGroup.alwaysShow || !activeGroup.sectionKey) return;

  const visibleItems = activeGroup.items.filter((item) => canAccess(item, profile));
  if (visibleItems.length === 0) return;

  const LAYER_LABEL = {
    executive: { key: 'nav.layer.executive', fallback: 'Ban Điều Hành' },
    office: { key: 'nav.layer.office', fallback: 'Khối Văn Phòng' },
    centers: { key: 'nav.layer.centers', fallback: 'Khối Trung Tâm' },
    masterdata: { key: 'nav.layer.masterdata', fallback: 'Cấu Hình Dữ Liệu Gốc' },
  };
  const layerInfo = LAYER_LABEL[activeGroup.layer];

  if (layerInfo) {
    const parentLabel = document.createElement('div');
    parentLabel.className = 'sidebar__section sidebar__section--parent';
    parentLabel.textContent = t(layerInfo.key, layerInfo.fallback);
    sidebarNav.appendChild(parentLabel);
  }

  // "Ban điều hành" chỉ có đúng 1 nhóm bên trong — nhãn cha và nhãn con sẽ
  // trùng chữ nhau ("Ban Điều Hành" / "Ban điều hành"), bỏ nhãn con cho
  // gọn, khác với Khối Văn Phòng/Khối Trung Tâm có nhiều phòng ban con
  // thật sự cần phân biệt.
  if (activeGroup.layer !== 'executive' && activeGroup.layer !== 'masterdata') {
    const heading = document.createElement('div');
    heading.className = 'sidebar__section sidebar__section--child';
    heading.textContent = t(activeGroup.sectionKey, activeGroup.section || '');
    sidebarNav.appendChild(heading);
  }

  const ul = document.createElement('ul');
  ul.className = 'sidebar__nav';
  const SUBGROUP_LABEL = {
    tuition: 'Thu học phí',
    warehouse: 'Kho & Chi phí vận hành',
    role: 'Chức năng riêng (theo vai trò)',
  };
  let lastSubgroup = null;
  visibleItems.forEach((item) => {
    if (item.subgroup && item.subgroup !== lastSubgroup && SUBGROUP_LABEL[item.subgroup]) {
      lastSubgroup = item.subgroup;
      const subHeading = document.createElement('li');
      subHeading.className = 'sidebar__subgroup';
      subHeading.textContent = SUBGROUP_LABEL[item.subgroup];
      ul.appendChild(subHeading);
    }
    ul.appendChild(buildNavLi(item, profile, currentPage));
  });
  sidebarNav.appendChild(ul);
}

function buildNavLi(item, profile, currentPage) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = item.href;
  a.innerHTML = `<span class="icon">${item.icon}</span><span>${esc(t(item.labelKey, item.label))}</span>`;
  if (currentPage && currentPage.endsWith(item.href)) a.classList.add('active');
  li.appendChild(a);
  return li;
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
 * Chèn nút "📲 Cài đặt ứng dụng" vào topbar bằng JS — trước đây không có
 * nơi nào để tải ứng dụng về máy, người dùng không biết là cài được.
 */
function injectInstallButton() {
  const topbarRight = document.querySelector('.topbar__right, .hub-topbar__right');
  if (!topbarRight || document.getElementById('installAppBtn')) return;

  const btn = document.createElement('button');
  btn.id = 'installAppBtn';
  btn.className = 'icon-btn';
  btn.title = t('common.installApp', 'Cài đặt ứng dụng');
  btn.textContent = '📲';
  btn.style.display = 'none';
  topbarRight.insertBefore(btn, topbarRight.firstChild);
  attachInstallButton(btn);
}

/**
 * Khởi tạo khung trang (sidebar/topbar) cho MỌI trang trong app.
 * Trả về { profile, supabase } để trang gọi tiếp logic riêng của nó.
 * Nếu chưa đăng nhập -> tự chuyển hướng về trang login.
 */
export async function bootShell() {
  // Luoi an toan: neu sau 12 giay ma trang van dang "Dang tai..." (vi du
  // do mang cham/DNS/Supabase tam ngung), hien banner ro rang thay vi de
  // nguoi dung nhin man hinh trong mai khong biet dang xay ra chuyen gi.
  const watchdog = setTimeout(() => {
    const nameEl = document.getElementById('userChipName');
    if (nameEl && nameEl.textContent === 'Đang tải...') {
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9999; background:#d3352f; color:#fff; padding:10px 16px; font-size:13px; text-align:center; font-weight:600;';
      banner.textContent = '⚠️ Tải trang lâu hơn bình thường — có thể do mất mạng. Bấm để tải lại trang.';
      banner.style.cursor = 'pointer';
      banner.addEventListener('click', () => window.location.reload());
      document.body.prepend(banner);
    }
  }, 12000);

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    clearTimeout(watchdog);
    window.location.href = '/index.html';
    throw new Error('NO_SESSION');
  }

  const { data: employee, error } = await supabase
    .from('employees')
    .select(`
      id, full_name, avatar_url, dob, language_preference, can_teach, is_academic_board,
      departments ( code, name ),
      positions ( name, is_teacher_eligible ),
      system_roles ( code, name ),
      centers ( id, name, divisions ( code ) )
    `)
    .eq('auth_user_id', sessionData.session.user.id)
    .single();

  if (error || !employee) {
    // Log lỗi thật ra console — trước đây lỗi bị nuốt im lặng, khiến người
    // dùng thấy như "không đăng nhập được" dù auth đã thành công, chỉ là
    // bước tải hồ sơ nhân viên ngay sau đó bị lỗi (ví dụ thiếu cột DB do
    // chưa chạy đủ migration).
    console.error('bootShell: không tải được hồ sơ nhân viên.', error);
    clearTimeout(watchdog);
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
    // SỬA LỖI THẬT: truoc day so khop theo TEN CHUC VU ("Quản lý trung tâm"
    // - chuoi text, de lech neu dat ten chuc vu khac di du chi 1 ky tu, hoac
    // employee chua duoc gan dung position_id) - khien Quan ly trung tam chi
    // vao duoc dung 1 trang duy nhat khong dieu kien (Kho trung tam), moi noi
    // khac deu bi an vi dieu kien nay luon sai. Doi sang dung MA VAI TRO he
    // thong (giong het cach RLS/backend dang dung o khap noi: 'CENTER_MANAGER').
    isCenterManager: employee.system_roles?.code === 'CENTER_MANAGER',
    // Dùng cờ is_teacher_eligible (không phải so tên chức vụ) để đúng nghiệp vụ
    // "kiêm nhiệm": nhân viên khối văn phòng vẫn có thể dạy nếu chức vụ được
    // đánh dấu is_teacher_eligible = true (khớp với app/edu/teachers.js).
    // "Giáo viên linh hoạt": true nếu chức vụ mặc định cho phép dạy, HOẶC
    // nhân sự khối văn phòng được tick riêng "Có thể đứng lớp giảng dạy"
    // (employees.can_teach) — không cần đổi cả phòng ban/chức vụ chính.
    isTeacher: !!employee.positions?.is_teacher_eligible || !!employee.can_teach,
    isAcademicBoard: !!employee.is_academic_board,
  };

  // SUA LOI THAT: cau nay truoc day chay TRUOC buoc cap nhat "Dang tai..."
  // -> ten that o goc tren. Neu cau nay bi treo/loi (mang chap chon, RLS
  // sai...), CA HAM bootShell dung lai o day, khong bao gio chay toi doan
  // cap nhat giao dien, gay hien tuong "Dang tai..." vinh vien ma khong
  // co loi ro rang nao hien ra (nguoi goi bootShell chi bat loi im lang).
  // Boc rieng try/catch de 1 truy van PHU khong lam sap ca trang.
  let grantedModules = new Set();
  try {
    const { data: grants } = await supabase
      .from('granted_permissions')
      .select('module_key')
      .eq('employee_id', employee.id);
    grantedModules = new Set((grants || []).map((g) => g.module_key));
  } catch (e) {
    console.warn('bootShell: không tải được quyền mở rộng (granted_permissions), tiếp tục không có quyền này.', e);
  }
  profile.grantedModules = grantedModules;

  // Ngôn ngữ hiển thị theo đúng hồ sơ nhân viên (employees.language_preference),
  // để đăng nhập ở thiết bị khác vẫn giữ đúng lựa chọn đã lưu.
  syncLangFromProfile(employee.language_preference);

  window.__AIS_PROFILE__ = profile;

  const userChipName = document.getElementById('userChipName');
  const userChipRole = document.getElementById('userChipRole');
  const userChipAvatar = document.getElementById('userChipAvatar');
  if (userChipName) userChipName.textContent = profile.fullName;
  clearTimeout(watchdog); // toi day la thanh cong hoan toan, khong con can canh bao "tai lau" nua
  if (userChipRole) userChipRole.textContent = profile.positionName || profile.roleName;
  if (userChipAvatar) userChipAvatar.textContent = initials(profile.fullName);

  renderNav(profile, document.body.dataset.page || location.pathname);
  applyTranslations();
  injectLangSwitcher(profile.id);
  injectInstallButton();

  // Xoay ngang/dọc hoặc đổi kích thước cửa sổ qua đúng mốc di động/desktop
  // (960px) -> tự vẽ lại menu cho khớp đúng danh sách được phép xem.
  let wasMobile = isMobileViewport();
  window.addEventListener('resize', () => {
    const nowMobile = isMobileViewport();
    if (nowMobile !== wasMobile) {
      wasMobile = nowMobile;
      renderNav(profile, document.body.dataset.page || location.pathname);
    }
  });

  // Bấm logo để quay về màn hình chọn phòng ban (Trang chủ)
  const brand = document.querySelector('.sidebar__brand');
  if (brand) {
    brand.style.cursor = 'pointer';
    brand.addEventListener('click', () => { window.location.href = '/dashboard.html'; });
  }
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