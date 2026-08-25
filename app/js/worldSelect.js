import { supabase, esc } from './supabase.js';
import { worldsWithAccess } from './shell.js';
import { NAV_CONFIG } from './navConfig.js';
import { t, getLang, setLang, syncLangFromProfile } from './i18n.js';
import { registerInstallBanner } from './installPrompt.js';
import { initFortuneWidget } from './fortuneWidget.js';
import { getPendingApprovalCount } from './approvalCenter.js';

// SUA LOI THAT NGHIEM TRONG: 2 bien nay truoc day khai bao o gan CUOI
// file (bang "let"), nhung "paintLangSwitcher()" lai duoc GOI NGAY o
// dau file (dong duoi day) va co doc "FULL_PROFILE" ben trong — vi "let"
// khong duoc khoi tao truoc dong khai bao cua no (temporal dead zone),
// doc bien truoc khi no duoc khai bao se NEM LOI NGAY LAP TUC, lam DUNG
// TOAN BO phan con lai cua file (moi handler bam nut, dieu huong 4 nhanh...)
// KHONG BAO GIO CHAY DUOC — day chinh la ly do "bam khong vao duoc,
// dung o lobby" ban gap. Chuyen len dau file de bien co san TRUOC khi bi
// doc toi.
let PROFILE = null;
let FULL_PROFILE = null; // dung de ve lai noi dung dich duoc khi doi ngon ngu

// =====================================================================
// MOI — Doi ngon ngu + Dang xuat ngay tai trang cho — dung LAI dung
// ham/kieu nut da co san o shell.js (khong bay dung 1 kieu rieng).
// =====================================================================
function paintLangSwitcher() {
  const current = getLang();
  document.querySelectorAll('#langSwitcher button').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.lang === current);
  });
  if (FULL_PROFILE) renderGreeting(FULL_PROFILE.fullName);
  // Ve lai cac khu vuc co nhan dich duoc (ERP/Room/Banzone) de doi ngon
  // ngu xong hien dung ngay, khong can tai lai trang.
  if (FULL_PROFILE) {
    renderErp(FULL_PROFILE);
    renderRoom(FULL_PROFILE);
    renderBanzone(FULL_PROFILE);
  }
}
document.querySelectorAll('#langSwitcher button').forEach((b) => {
  b.addEventListener('click', () => setLang(b.dataset.lang, { supabase, employeeId: PROFILE?.id }));
});
document.addEventListener('ais:langchange', paintLangSwitcher);
paintLangSwitcher();

document.getElementById('btnLogout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = '/index.html';
});

const STORAGE_KEY = 'ais_lobby_layer';
const WORLD_STORAGE_KEY = 'ais_current_world';

// =====================================================================
// PHAN 1 — Dieu huong 3 lop (overlay, khong tai lai trang) + luu trang
// thai qua sessionStorage/history de F5 hoac bam Back trinh duyet van
// mo dung lop dang xem, dung yeu cau trong dac ta.
// =====================================================================
// LÀM LẠI 22/08/2026: bỏ hẳn lớp "cửa vào" (layerEntry) theo yêu cầu —
// layerBranches (4 khu vực: Cá nhân/Hành chính/Trung tâm/Dữ liệu) giờ là
// màn hình gốc, không còn lớp cha nào phía trên nó nữa.
const PARENT_OF = {
  layerErp: 'layerBranches',
  layerDeptWorkspace: 'layerErp',
  layerCrm: 'layerBranches',
  layerRoom: 'layerBranches',
  layerBanzone: 'layerBranches',
};

let currentLayer = 'layerBranches';

function showLayer(id, { push = true } = {}) {
  const from = document.getElementById(currentLayer);
  const to = document.getElementById(id);
  if (from && from !== to) {
    from.classList.remove('is-active', 'is-entering');
    from.classList.add('is-leaving');
    setTimeout(() => { from.classList.remove('is-leaving'); }, 360);
  }
  to.classList.add('is-active', 'is-entering');
  setTimeout(() => { to.classList.remove('is-entering'); }, 360);
  currentLayer = id;
  sessionStorage.setItem(STORAGE_KEY, id);
  if (push) window.history.pushState({ layer: id }, '', '#' + id.replace('layer', '').toLowerCase());
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('popstate', (e) => {
  const layer = e.state?.layer || 'layerBranches';
  showLayer(layer, { push: false });
  if (layer === 'layerCrm') startCrmAnimation(); else stopCrmAnimation();
});

document.querySelectorAll('[data-back]').forEach((btn) => {
  // SUA LOI THAT: truoc day dung window.history.back() — loi khi khong
  // co "lich su" dung de quay ve (vd tai lai trang dang o thang
  // world-select.html#crm, hoac mo thang link co san #crm) — luc do
  // trinh duyet hoac khong lam gi, hoac nhay ra HAN NGOAI trang nay.
  // Gio di THANG toi dung lop cha (da ghi san trong data-back), luon
  // dang tin cay bat ke lich su trinh duyet dang the nao.
  btn.addEventListener('click', () => { showLayer(btn.dataset.back); stopCrmAnimation(); });
});

// =====================================================================
// PHAN 2 — 4 nhanh: bam the -> mo dung lop noi dung, khoa theo quyen
// that (worldsWithAccess, dung chung logic voi menu chinh).
// =====================================================================
const BRANCH_TO_LAYER = { erp: 'layerErp', crm: 'layerCrm', room: 'layerRoom', banzone: 'layerBanzone' };
const BRANCH_TO_WORLD = { erp: 'erp', crm: 'crm', room: 'personal', banzone: 'database' };

document.querySelectorAll('.branch-card').forEach((card) => {
  card.addEventListener('click', () => {
    if (card.classList.contains('branch-card--locked')) return;
    const layer = BRANCH_TO_LAYER[card.dataset.branch];
    showLayer(layer);
    if (layer === 'layerCrm') startCrmAnimation();
  });
});

function hasAccessToSection(sectionName, profile) {
  const group = NAV_CONFIG.find((g) => g.section === sectionName);
  if (!group) return false;
  return group.items.some((item) => item.visible(profile));
}

function applyBranchLocks(profile) {
  const accessibleWorlds = new Set(worldsWithAccess(profile));
  document.querySelectorAll('.branch-card[data-branch]').forEach((card) => {
    const world = BRANCH_TO_WORLD[card.dataset.branch];
    if (accessibleWorlds.has(world)) return;
    card.classList.add('branch-card--locked');
    card.querySelector('.branch-card__desc').insertAdjacentHTML('afterend', `<div class="branch-card__lock">${t('lobby.locked', '🔒 Không có quyền')}</div>`);
  });
}

// =====================================================================
// PHAN 3 — ERP: doi tab + luoi chuc nang dieu hanh + khoi phong ban.
// =====================================================================
function timeGreeting() {
  const h = new Date().getHours();
  if (h < 11) return t('lobby.greeting.morning', 'Chào buổi sáng');
  if (h < 14) return t('lobby.greeting.noon', 'Chào buổi trưa');
  if (h < 18) return t('lobby.greeting.afternoon', 'Chào buổi chiều');
  return t('lobby.greeting.evening', 'Chào buổi tối');
}

// LÀM LẠI 22/08/2026 — chuyển từ dashboard.js sang đây (world-select.html
// giờ là "Trang chủ" duy nhất, xem ghi chú đầu file). Thay cho eyebrow
// đơn giản "Chào buổi sáng" trước đây — hiện đủ ngày tháng + tên, đúng
// mẫu Tổng quan cũ.
function renderGreeting(fullName) {
  const firstName = fullName?.trim().split(/\s+/).slice(-1)[0] || 'bạn';
  const titleEl = document.querySelector('.hero-greeting__title');
  if (titleEl) titleEl.innerHTML = `${timeGreeting()}, <span id="heroName">${esc(firstName)}</span>`;
  const dateEl = document.getElementById('heroDate');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// LÀM LẠI 22/08/2026 — 4 hàm dưới đây chuyển nguyên từ dashboard.js sang
// (xem ghi chú đầu file: world-select.html giờ là "Trang chủ" duy nhất).
// LÀM LẠI 22/08/2026 — theo yêu cầu: "thông báo sinh nhật là thông báo
// dành cho MỌI NGƯỜI biết" — trước đây chỉ đúng người có sinh nhật mới
// tự thấy banner của chính mình (dùng profile.dob của người đang đăng
// nhập). Giờ truy vấn TOÀN BỘ nhân viên có sinh nhật hôm nay (không phân
// biệt ai đang xem), hiện cho tất cả, kèm nút "🎉 Chúc mừng" gửi lời
// chúc (bảng birthday_wishes, mỗi người chỉ chúc được 1 lần/ngày/người).
async function checkBirthday(currentEmployeeId) {
  const banner = document.getElementById('birthdayBanner');
  const textEl = document.getElementById('birthdayText');
  if (!banner || !textEl) return;

  const today = new Date();
  const { data: employees, error } = await supabase.from('employees').select('id, full_name, dob').not('dob', 'is', null);
  if (error || !employees) return;
  const todaysBirthdays = employees.filter((e) => {
    const d = new Date(e.dob);
    return d.getUTCDate() === today.getDate() && d.getUTCMonth() === today.getMonth();
  });
  if (todaysBirthdays.length === 0) return;

  const ids = todaysBirthdays.map((e) => e.id);
  const { data: wishes } = await supabase.from('birthday_wishes').select('employee_id, wisher_id').in('employee_id', ids).eq('wish_date', today.toISOString().slice(0, 10));
  const wishCountByEmployee = {};
  const iAlreadyWished = new Set();
  (wishes || []).forEach((w) => {
    wishCountByEmployee[w.employee_id] = (wishCountByEmployee[w.employee_id] || 0) + 1;
    if (w.wisher_id === currentEmployeeId) iAlreadyWished.add(w.employee_id);
  });

  banner.classList.add('show');
  textEl.innerHTML = todaysBirthdays.map((e) => {
    const count = wishCountByEmployee[e.id] || 0;
    const isSelf = e.id === currentEmployeeId;
    const already = iAlreadyWished.has(e.id);
    const btnDisabled = isSelf || already;
    return `
      <span class="birthday-wish-item">
        🎂 <strong>${esc(e.full_name)}</strong>
        ${count > 0 ? `<span class="birthday-wish-item__count">${count} lượt chúc</span>` : ''}
        <button type="button" class="birthday-wish-btn" data-employee="${e.id}" ${btnDisabled ? 'disabled' : ''}>${already ? 'Đã chúc ✓' : '🎉 Chúc mừng'}</button>
      </span>
    `;
  }).join(' &nbsp;·&nbsp; ');

  textEl.querySelectorAll('.birthday-wish-btn:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { error: wishErr } = await supabase.from('birthday_wishes').insert({ employee_id: btn.dataset.employee, wisher_id: currentEmployeeId });
      if (wishErr) { btn.disabled = false; return; }
      btn.textContent = 'Đã chúc ✓';
      const countEl = btn.closest('.birthday-wish-item').querySelector('.birthday-wish-item__count');
      const newCount = (parseInt(countEl?.textContent) || 0) + 1;
      if (countEl) countEl.textContent = `${newCount} lượt chúc`;
      else btn.insertAdjacentHTML('beforebegin', `<span class="birthday-wish-item__count">1 lượt chúc</span> `);
    });
  });
}

// LÀM LẠI 22/08/2026 — Bảng "Giao dịch tài chính gần đây": theo yêu cầu
// "thông báo nạp ví/đóng học phí nên tách riêng, tránh bị miss báo cáo
// quan trọng". Rà lại hệ thống thì phát hiện: hiện KHÔNG có cơ chế nào
// tự tạo thông báo (bảng notifications) khi có người nạp ví/đóng học phí
// — 2 việc này chỉ đổi trạng thái ở DB, không ai được báo. Thay vì thêm
// thông báo mới (dễ quên gọi ở 1 trong nhiều chỗ, lại lặp lại đúng rủi ro
// "miss" đang muốn tránh), lấy TRỰC TIẾP dữ liệu gốc mỗi lần vào Trang
// chủ — luôn đúng 100%, không phụ thuộc có ai nhớ gọi thông báo hay
// không. Chỉ hiện cho vai trò cần theo dõi tài chính (Kế toán/Quản lý
// trung tâm/Ban điều hành) — nhân sự khác không liên quan sẽ không thấy.
async function loadFinanceBoard(profile) {
  const board = document.getElementById('financeBoard');
  if (!board) return;
  const canSee = profile.departmentCode === 'ACC' || profile.isCenterManager || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
  if (!canSee) { board.style.display = 'none'; return; }

  const [{ data: topups }, { data: payments }] = await Promise.all([
    supabase.from('wallet_topup_requests')
      .select('id, coin_amount, confirmed_at, wallets(students(full_name, centers(name)))')
      .eq('status', 'confirmed').order('confirmed_at', { ascending: false }).limit(6),
    supabase.from('debt_ledger')
      .select('id, amount_vnd, created_at, invoices(students(full_name, centers(name)))')
      .order('created_at', { ascending: false }).limit(6),
  ]);

  const items = [
    ...(topups || []).filter((r) => r.wallets?.students).map((r) => ({
      time: r.confirmed_at, icon: '💰',
      text: `${esc(r.wallets.students.full_name)} vừa nạp ví ${Number(r.coin_amount).toLocaleString('vi-VN')} Coin`,
      meta: r.wallets.students.centers?.name || '', href: '/acc/wallet-topup-requests.html',
    })),
    ...(payments || []).filter((r) => r.invoices?.students).map((r) => ({
      time: r.created_at, icon: '🎓',
      text: `${esc(r.invoices.students.full_name)} vừa đóng học phí ${Number(r.amount_vnd).toLocaleString('vi-VN')} đ`,
      meta: r.invoices.students.centers?.name || '', href: '/edu/wallet-invoices.html',
    })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 8);

  const list = document.getElementById('financeBoardList');
  if (items.length === 0) { list.innerHTML = '<div class="empty-cell">Chưa có giao dịch nào gần đây.</div>'; return; }
  list.innerHTML = items.map((it) => `
    <div class="notice-board__item" data-href="${it.href}">
      <div class="notice-board__item__title">${it.icon} ${it.text}</div>
      <div class="notice-board__item__meta">${it.meta ? it.meta + ' · ' : ''}${new Date(it.time).toLocaleString('vi-VN')}</div>
    </div>
  `).join('');
  list.querySelectorAll('[data-href]').forEach((el) => {
    el.addEventListener('click', () => { window.location.href = el.dataset.href; });
  });
}

// Tái dùng ĐÚNG nhãn luồng đã có sẵn ở notifications.html (trang đầy đủ)
// — tránh tạo 1 bộ nhãn riêng lệch nhau giữa 2 nơi.
const SCOPE_LABEL = { system: 'Toàn hệ thống', center: 'Trung tâm', department: 'Phòng ban', personal: 'Cá nhân' };
const SCOPE_BADGE_CLASS = { system: 'badge-rejected', center: 'badge-approved_1', department: 'badge-submitted', personal: 'badge-active' };

let ACTIVE_NOTICE_TYPE = 'info';

async function loadNoticeBoard() {
  const list = document.getElementById('noticeBoardList');
  if (!list) return;
  list.innerHTML = '<div class="empty-cell">Đang tải...</div>';
  // LÀM LẠI 24/08/2026 — theo yêu cầu tách "thông báo thông tin" (con
  // người chủ động soạn — vd Ban hành thông báo) và "thông báo hệ thống"
  // (tự sinh theo nghiệp vụ — vd yêu cầu nạp ví), dùng ĐÚNG cột
  // notification_type đã có sẵn ở database, khớp cách trang Thông báo
  // đầy đủ (notifications.html) đã phân loại — không tạo cách phân loại
  // riêng lệch nhau giữa 2 nơi. Nhãn luồng (Toàn hệ thống/Trung tâm/
  // Phòng ban/Cá nhân) vẫn giữ — đây là 2 chiều phân loại khác nhau (loại
  // nội dung vs. phạm vi ai xem được), không thay thế nhau.
  const { data, error } = await supabase.from('notifications').select('id, scope, title, created_at')
    .eq('notification_type', ACTIVE_NOTICE_TYPE).order('created_at', { ascending: false }).limit(6);
  if (error || !data || data.length === 0) { list.innerHTML = '<div class="empty-cell">Chưa có thông báo nào.</div>'; return; }
  list.innerHTML = data.map((n) => `
    <div class="notice-board__item" data-id="${n.id}">
      <div class="notice-board__item__title">${esc(n.title)}</div>
      <div class="notice-board__item__meta">
        <span class="badge ${SCOPE_BADGE_CLASS[n.scope] || ''}" style="font-size:10px; padding:1px 7px;">${SCOPE_LABEL[n.scope] || n.scope}</span>
        · ${new Date(n.created_at).toLocaleString('vi-VN')}
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => { window.location.href = '/notifications.html'; });
  });
}

document.querySelectorAll('.notice-board__tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.notice-board__tab').forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    ACTIVE_NOTICE_TYPE = tab.dataset.notifType;
    loadNoticeBoard();
  });
});

async function loadUnreadCount() {
  const { data, error } = await supabase.rpc('unread_notification_count');
  const unread = error ? 0 : Math.max(data ?? 0, 0);
  const el = document.getElementById('statUnread');
  if (el) el.textContent = String(unread);
}

async function loadStats(profileId) {
  const now = new Date();
  const { data: balance } = await supabase
    .from('leave_balances')
    .select('annual_leave_accrued, annual_leave_used, compensatory_leave')
    .eq('employee_id', profileId).eq('year', now.getFullYear()).eq('month', now.getMonth() + 1).maybeSingle();
  const leaveEl = document.getElementById('statLeave');
  if (leaveEl) leaveEl.textContent = balance
    ? (Number(balance.annual_leave_accrued) - Number(balance.annual_leave_used) + Number(balance.compensatory_leave)).toFixed(1)
    : '0';

  const { count: meetingCount } = await supabase
    .from('meeting_participants').select('meeting_id', { count: 'exact', head: true }).eq('employee_id', profileId);
  const meetingsEl = document.getElementById('statMeetings');
  if (meetingsEl) meetingsEl.textContent = meetingCount ?? 0;

  await loadUnreadCount().catch(() => {});
}

const EXEC_ICONS = { '/exec/reports.html': '📊' };
const DEPT_ICON = { 'Phòng nhân sự': '👥', 'Phòng kế toán': '💰', 'Phòng truyền thông': '📣', 'Phòng cơ sở vật chất': '🔧' };
// MOI — moi phong ban co MAU RIENG khi mo ra (banner chu de), khong con
// dung chung 1 mau xanh nhu truoc.
const DEPT_THEME = {
  'Phòng nhân sự': '#0094D9',
  'Phòng kế toán': '#2FAE6B',
  'Phòng truyền thông': '#A855C9',
  'Phòng cơ sở vật chất': '#D97A3D',
};
// MOI — icon RIENG cho tung chuc nang cu the (truoc day dung chung 1
// icon "📄" cho moi thu trong danh sach con, nhin rat "trong" — gio moi
// muc co bieu tuong dac trung dung noi dung cua no).
const ITEM_ICONS = {
  '/hr/employees.html': '👤', '/hr/positions.html': '🏷️', '/hr/leave-balances.html': '📅',
  '/hr/work-schedule.html': '🗓️', '/hr/contracts.html': '📜', '/hr/leave-requests.html': '✋',
  '/hr/base-salary.html': '💵', '/hr/business-trips.html': '✈️', '/hr/tasks.html': '✅', '/hr/sign.html': '✍️',
  '/acc/payment-requests.html': '🧾', '/acc/advance-requests.html': '💳', '/acc/reports.html': '📊',
  '/acc/discount-programs.html': '🏷️', '/edu/refund-requests.html': '↩️', '/acc/wallet-links.html': '🔗',
  '/acc/wallet-recovery.html': '🛠️', '/acc/sepay-transactions.html': '💸', '/acc/general-ledger.html': '📒',
  '/acc/period-closing.html': '🔒', '/acc/commissions.html': '🎯', '/acc/budget-setup.html': '📈',
  '/acc/attendance-payroll-report.html': '⏱️', '/acc/payroll.html': '💵', '/acc/tasks.html': '✅', '/acc/sign.html': '✍️',
  '/mkt/requests.html': '📣', '/mkt/event-proposals.html': '🎉', '/mkt/expense-reports.html': '🧮',
  '/mkt/accounts.html': '🔐', '/mkt/parent-announcements.html': '📢', '/mkt/extracurricular-programs.html': '🎨',
  '/mkt/tasks.html': '✅', '/mkt/sign.html': '✍️',
  '/fac/requests.html': '🛠️', '/fac/purchase-requests.html': '🛒', '/fac/stats.html': '📦',
  '/fac/tasks.html': '✅', '/fac/sign.html': '✍️',
  // Khối trung tâm — bổ sung khi mở lưới chức năng NGAY trong world-select.html
  // thay vì phải bay sang dashboard.html (xem openCrmWorkspace).
  '/edu/wallet-invoices.html': '🧾', '/acc/wallet-topup-requests.html': '💰', '/edu/wallet-payment-log.html': '📄',
  '/edu/debt-overview.html': '📋', '/edu/program-pricing.html': '💲', '/edu/inventory.html': '📦',
  '/edu/retail-sale.html': '🛍️', '/acc/purchase-orders.html': '🧾', '/edu/center-overview.html': '🏫',
  '/edu/attendance-overview.html': '✅', '/edu/duty-schedule.html': '🗓️', '/edu/teacher-schedule.html': '📚',
  '/edu/class-assignment.html': '🧩', '/edu/students.html': '🎒', '/edu/parent-links.html': '🔗',
  '/edu/grades.html': '📝', '/edu/sign.html': '✍️', '/edu/classes.html': '🏷️', '/edu/teachers.html': '🧑‍🏫',
  '/teacher/classes.html': '🏷️', '/teacher/attendance.html': '✅', '/teacher/grades.html': '📝',
  '/teacher/trial-students.html': '🆕', '/teacher/schedule.html': '📅',
  '/consultant/leads.html': '📇', '/consultant/stats.html': '📊', '/consultant/trial-registration.html': '🆕',
};

const CRM_WORKSPACE_CENTER_KEY = 'ais_lobby_crm_center';

document.querySelectorAll('.erp-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.erp-tab').forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    document.querySelectorAll('.erp-panel').forEach((p) => p.classList.remove('is-active'));
    document.getElementById(tab.dataset.tab === 'exec' ? 'erpPanelExec' : 'erpPanelDept').classList.add('is-active');
  });
});

function renderErp(profile) {
  const execGroup = NAV_CONFIG.find((g) => g.section === 'Ban điều hành');
  const execItems = (execGroup?.items || []).filter((it) => it.visible(profile));
  document.getElementById('execGrid').innerHTML = execItems.length === 0
    ? `<div class="content-sub">${t('lobby.erp.noExecAccess', '🔒 Không có quyền truy cập Tầng Điều hành.')}</div>`
    : execItems.map((it) => `
        <div class="item-card" data-href="${it.href}">
          <span class="item-card__icon">${EXEC_ICONS[it.href] || '📁'}</span>
          <span class="item-card__name">${t(it.labelKey, it.label)}</span>
        </div>
      `).join('');

  const deptSections = ['Phòng nhân sự', 'Phòng kế toán', 'Phòng truyền thông', 'Phòng cơ sở vật chất'];
  document.getElementById('deptGrid').innerHTML = deptSections.map((s) => {
    const visible = hasAccessToSection(s, profile);
    const group = NAV_CONFIG.find((g) => g.section === s);
    const displayName = t(group?.sectionKey, s);
    return `
      <div class="item-card ${visible ? '' : 'item-card--locked'}" data-dept="${s}">
        <span class="item-card__icon">${DEPT_ICON[s]}</span>
        <span class="item-card__name">${displayName}</span>
        ${visible ? '' : '<span class="item-card__lock">🔒</span>'}
      </div>
    `;
  }).join('');

  document.querySelectorAll('#execGrid .item-card, #deptDrillGrid .item-card').forEach((el) => {
    el.addEventListener('click', () => { if (el.dataset.href) window.location.href = el.dataset.href; });
  });
  document.querySelectorAll('#deptGrid .item-card:not(.item-card--locked)').forEach((el) => {
    el.addEventListener('click', () => { openDeptWorkspace(el.dataset.dept, profile); PARENT_OF.layerDeptWorkspace = 'layerErp'; showLayer('layerDeptWorkspace'); });
  });
}

// MOI — tach rieng thanh 1 ham dung lai duoc (truoc day nam thang trong
// callback bam nut) — vi CAN GOI LAI ham nay khi khoi phuc dung lop dang
// xem luc F5/mo lai link #deptworkspace: truoc day chi nho DUNG LOP nao
// dang hien, nhung QUEN mat dang xem phong ban nao BEN TRONG lop do, nen
// hien ra 1 man hinh trong khong — day chinh la loi ban gap.
const DEPT_WORKSPACE_KEY = 'ais_lobby_dept';
const CRM_SUBGROUP_META = {
  tuition: { icon: '🧾', label: 'Thu học phí' },
  warehouse: { icon: '📦', label: 'Kho & Vận hành' },
  role: { icon: '🧑‍💼', label: 'Chức năng riêng' },
};

function openCrmWorkspace(center, profile) {
  const group = NAV_CONFIG.find((g) => g.layer === 'centers');
  if (!group || !center) return;
  sessionStorage.removeItem(DEPT_WORKSPACE_KEY); // tránh nhập nhằng với ERP khi khôi phục lúc F5
  sessionStorage.setItem(CRM_WORKSPACE_CENTER_KEY, JSON.stringify({ id: center.id, name: center.name, theme: center.divisions?.theme_color }));
  const theme = center.divisions?.theme_color || center.theme || 'var(--accent)';
  const allItems = group.items.filter((it) => it.visible(profile));

  document.getElementById('deptWorkspaceBanner').innerHTML = `
    <div class="dept-workspace-banner" style="background:${theme}1a; border-color:${theme}40;">
      <span class="dept-workspace-banner__icon" style="background:${theme};">🎓</span>
      <div><div class="dept-workspace-banner__name">${esc(center.name)}</div><div class="dept-workspace-banner__count">${allItems.length} ${t('lobby.erp.functionCount', 'chức năng')}</div></div>
    </div>
  `;

  function renderSubgroupTiles() {
    document.getElementById('deptWorkspaceGrid').innerHTML = Object.keys(CRM_SUBGROUP_META).map((sgKey) => {
      const sgItems = allItems.filter((it) => it.subgroup === sgKey);
      if (sgItems.length === 0) return '';
      const meta = CRM_SUBGROUP_META[sgKey];
      return `
        <div class="item-card" data-subgroup="${sgKey}" style="border-color:${theme}30;">
          <span class="item-card__icon" style="background:${theme}1a; border-radius:8px; width:32px; height:32px; display:flex; align-items:center; justify-content:center;">${meta.icon}</span>
          <span class="item-card__name">${meta.label}</span>
        </div>
      `;
    }).join('') || `<div class="content-sub">${t('lobby.erp.noItems', 'Không có mục nào.')}</div>`;
    document.querySelectorAll('#deptWorkspaceGrid [data-subgroup]').forEach((c) => {
      c.addEventListener('click', () => renderItemList(c.dataset.subgroup));
    });
  }

  function renderItemList(sgKey) {
    const sgItems = allItems.filter((it) => it.subgroup === sgKey);
    document.getElementById('deptWorkspaceGrid').innerHTML = `
      <button type="button" class="crm-workspace-back">← ${esc(CRM_SUBGROUP_META[sgKey].label)}</button>
      ${sgItems.map((it) => `
        <div class="item-card" data-href="${it.href}" style="border-color:${theme}30;">
          <span class="item-card__icon" style="background:${theme}1a; border-radius:8px; width:32px; height:32px; display:flex; align-items:center; justify-content:center;">${ITEM_ICONS[it.href] || '📄'}</span>
          <span class="item-card__name">${t(it.labelKey, it.label)}</span>
        </div>
      `).join('')}
    `;
    document.querySelector('.crm-workspace-back').addEventListener('click', renderSubgroupTiles);
    document.querySelectorAll('#deptWorkspaceGrid .item-card').forEach((c) => {
      c.addEventListener('click', () => { window.location.href = c.dataset.href; });
    });
  }

  renderSubgroupTiles();
}

function openDeptWorkspace(dept, profile) {
  const group = NAV_CONFIG.find((g) => g.section === dept);
  if (!group) return;
  sessionStorage.removeItem(CRM_WORKSPACE_CENTER_KEY); // tránh nhập nhằng với CRM khi khôi phục lúc F5
  sessionStorage.setItem(DEPT_WORKSPACE_KEY, dept);
  const items = group.items.filter((it) => it.visible(profile));
  const theme = DEPT_THEME[dept] || 'var(--accent)';
  const deptDisplayName = t(group.sectionKey, dept);
  document.getElementById('deptWorkspaceBanner').innerHTML = `
    <div class="dept-workspace-banner" style="background:${theme}1a; border-color:${theme}40;">
      <span class="dept-workspace-banner__icon" style="background:${theme};">${DEPT_ICON[dept] || '🏢'}</span>
      <div><div class="dept-workspace-banner__name">${deptDisplayName}</div><div class="dept-workspace-banner__count">${items.length} ${t('lobby.erp.functionCount', 'chức năng')}</div></div>
    </div>
  `;
  document.getElementById('deptWorkspaceGrid').innerHTML = items.map((it) => `
    <div class="item-card" data-href="${it.href}" style="border-color:${theme}30;">
      <span class="item-card__icon" style="background:${theme}1a; border-radius:8px; width:32px; height:32px; display:flex; align-items:center; justify-content:center;">${ITEM_ICONS[it.href] || '📄'}</span>
      <span class="item-card__name">${t(it.labelKey, it.label)}</span>
    </div>
  `).join('') || `<div class="content-sub">${t('lobby.erp.noItems', 'Không có mục nào.')}</div>`;
  document.querySelectorAll('#deptWorkspaceGrid .item-card').forEach((c) => {
    c.addEventListener('click', () => { window.location.href = c.dataset.href; });
  });
}

// =====================================================================
// PHAN 4 — CRM: quy dao ve tinh quanh logo, du lieu trung tam THAT.
// =====================================================================
// SUA LOI THAT (lan 2): cach cu dung CSS "animation: translateX(var(--
// orbit-r)) + rotate" — ve mat ly thuyet dung, nhung tren thuc te van
// khong an dinh duoc dung do vi thoi diem do offsetWidth (luc lop dang
// an/vua hien) khong dang tin cay, va % trong translateX() lai tinh theo
// KICH THUOC PHAN TU chu khong phai san khau. Lam lai HOAN TOAN khac —
// bo CSS animation, tu tinh toa do bang JS qua requestAnimationFrame,
// gan THANG top/left (khong qua transform/bien CSS nao ca) — chac chan
// dung, khong con phu thuoc thoi diem do kich thuoc.
let crmAnimHandle = null;
let CRM_SATELLITES = []; // { el, angleDeg, radiusPct, speedDegPerSec }

// MOI — moi trung tam gio la 1 "tieu hanh tinh" rieng: kich thuoc khac
// nhau va CO QUY DAO RIENG cua no (dan xen ban kinh deu nhau tu gan ra
// xa) — mau sac gio lay DUNG theo phan he (ALOHA/iLingo) tu du lieu that,
// khong con dung bang mau cau vong tu dat nhu truoc.

async function renderCrm(profile) {
  // SUA — truoc day chi lay id/name/code roi tu bia mau cau vong 8 mau —
  // gio lay DUNG mau chinh thuc cua tung phan he (divisions.theme_color
  // — da co san trong du lieu goc: ALOHA xanh duong, iLingo xanh la),
  // dung 1 nguon du lieu THAT thay vi tu dat mau rieng.
  const { data: allCenters, error } = await supabase
    .from('centers')
    .select('id, name, code, divisions(code, theme_color)')
    .eq('is_active', true)
    .order('name');
  const sub = document.getElementById('crmSub');
  const stage = document.getElementById('crmStage');
  if (error || !allCenters || allCenters.length === 0) { sub.textContent = t('lobby.crm.loadError', 'Không tải được danh sách trung tâm.'); return; }

  // "Các trung tâm không thể thấy của nhau" (dữ liệu) vẫn giữ đúng — chỉ
  // đổi lại CÁCH THỂ HIỆN theo phản hồi: hiện TẤT CẢ trung tâm cho đẹp
  // mắt (hiệu ứng vệ tinh quay quanh cần nhiều hành tinh mới sinh động,
  // 1 hành tinh lẻ loi nhìn trống trải), nhưng KHOÁ không bấm vào được
  // với trung tâm ngoài quyền — không lộ DỮ LIỆU bên trong, chỉ lộ TÊN +
  // icon khoá 🔒, tương tự cách "Hành chính" khoá phòng ban không có quyền.
  const restrictedToOwnCenter = !!profile.centerId
    && !['EXECUTIVE', 'TECH'].includes(profile.roleCode)
    && profile.departmentCode !== 'ACC';
  const centers = allCenters;

  sub.textContent = `${centers.length} ${t('lobby.crm.activeCenters', 'trung tâm đang hoạt động')}`;

  let html = '<div class="crm-logo"><div class="crm-logo__title">AIS</div><div class="crm-logo__sub">OFFICE</div></div>';
  const n = centers.length;
  const minR = 0.18, maxR = 0.46;
  const step = n > 1 ? (maxR - minR) / (n - 1) : 0;

  CRM_SATELLITES = [];
  centers.forEach((c, i) => {
    const rPct = minR + step * i;
    const sizePct = rPct * 200;
    const angleDeg = (137.5 * i) % 360;
    const color = c.divisions?.theme_color || '#94A3B8';
    const diameter = 44 + (i % 3) * 8; // 44/52/60px — hoi to hon truoc, do chu can nhieu cho hon
    // Khoá đúng trung tâm KHÁC trung tâm của mình khi bị giới hạn — trung
    // tâm của chính mình (nếu có trong danh sách) vẫn luôn mở được.
    const isAccessible = !restrictedToOwnCenter || c.id === profile.centerId;
    // SUA — chu bi tran ra ngoai hanh tinh vi dung nguyen "code" trung
    // tam (co the dai 6-7 ky tu) o co chu co dinh — gio CAT NGAN toi da
    // 4 ky tu VA tu giam co chu neu ten van dai hon muc do rong cho phep.
    const rawLabel = (c.code || c.name || '').toUpperCase().replace(/\s+/g, '').slice(0, 4);
    const labelFontSize = rawLabel.length >= 4 ? 9.5 : rawLabel.length === 3 ? 10.5 : 11.5;
    const isAloha = c.divisions?.code === 'ALOHA';

    html += `<div class="crm-orbit" style="width:${sizePct}%; height:${sizePct}%; margin-left:-${sizePct / 2}%; margin-top:-${sizePct / 2}%;"></div>`;
    html += `
      <div class="crm-satellite ${isAccessible ? '' : 'crm-satellite--locked'}" data-center="${c.id}" data-division="${isAloha ? 'aloha' : 'ilingo'}"
           style="width:${diameter}px; height:${diameter}px; ${isAccessible ? `background: radial-gradient(circle at 32% 30%, ${color}dd, ${color}); border-color:${color}; color:${color};` : ''}"
           tabindex="${isAccessible ? '0' : '-1'}" role="button" aria-label="Vào trung tâm ${esc(c.name)}">
        <span class="crm-satellite__label" style="${isAccessible ? `color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.35); font-size:${labelFontSize}px;` : `font-size:${labelFontSize}px;`}">${esc(rawLabel)}</span>
        <span class="crm-satellite__full">${esc(c.name)}${isAccessible ? '' : ' — 🔒'}</span>
      </div>
    `;
    CRM_SATELLITES.push({ angleDeg, radiusPct: rPct, speedDegPerSec: 360 / (45 + rPct * 90), half: diameter / 2 });
  });

  stage.innerHTML = html;
  const satelliteEls = [...stage.querySelectorAll('.crm-satellite')];
  satelliteEls.forEach((el, i) => { CRM_SATELLITES[i].el = el; });

  satelliteEls.forEach((el) => {
    el.addEventListener('click', () => {
      if (el.classList.contains('crm-satellite--locked')) return;
      const centerObj = centers.find((c) => c.id === el.dataset.center);
      localStorage.setItem(WORLD_STORAGE_KEY, 'crm');
      localStorage.setItem('ais_selected_center', el.dataset.center);
      stopCrmAnimation();
      openCrmWorkspace(centerObj, profile);
      PARENT_OF.layerDeptWorkspace = 'layerCrm';
      showLayer('layerDeptWorkspace');
    });
  });
}

function positionCrmSatellitesOnce() {
  const stage = document.getElementById('crmStage');
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return false;
  CRM_SATELLITES.forEach((s) => {
    const rad = (s.angleDeg * Math.PI) / 180;
    const rx = w * s.radiusPct, ry = h * s.radiusPct;
    const x = w / 2 + rx * Math.cos(rad) - s.half;
    const y = h / 2 + ry * Math.sin(rad) - s.half;
    s.el.style.left = x + 'px';
    s.el.style.top = y + 'px';
  });
  return true;
}

function startCrmAnimation() {
  stopCrmAnimation();
  if (!positionCrmSatellitesOnce()) { setTimeout(startCrmAnimation, 80); return; }
  // SUA — truoc day neu may dang bat "giam chuyen dong"
  // (prefers-reduced-motion, thuong la cai dat tiet kiem pin cua may,
  // khong han nguoi dung tu chon) thi TAT HAN xoay — nhin nhu bi dung
  // hinh, du hanh tinh van bam duoc binh thuong. Gio van XOAY, chi cham
  // hon han (theo dung tinh than "giam" chu khong phai "tat het"
  // chuyen dong, dung chuan huong dan hop can bang giua tiep can va
  // trai nghiem).
  // MOI — theo yeu cau, bo han che toc do theo "giam chuyen dong" cua
  // may — luon xoay dung toc do binh thuong, khong tu dong lam cham
  // theo cai dat he dieu hanh nua.
  const speedMultiplier = 1;
  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    const stage = document.getElementById('crmStage');
    const w = stage.clientWidth, h = stage.clientHeight;
    CRM_SATELLITES.forEach((s) => {
      s.angleDeg = (s.angleDeg + s.speedDegPerSec * dt * speedMultiplier) % 360;
      const rad = (s.angleDeg * Math.PI) / 180;
      const rx = w * s.radiusPct, ry = h * s.radiusPct;
      s.el.style.left = (w / 2 + rx * Math.cos(rad) - s.half) + 'px';
      s.el.style.top = (h / 2 + ry * Math.sin(rad) - s.half) + 'px';
    });
    crmAnimHandle = requestAnimationFrame(frame);
  }
  crmAnimHandle = requestAnimationFrame(frame);
}
function stopCrmAnimation() { if (crmAnimHandle) cancelAnimationFrame(crmAnimHandle); crmAnimHandle = null; }

// =====================================================================
// PHAN 5 — ROOM: luoi phang cac chuc nang ca nhan.
// =====================================================================
const ROOM_ICONS = {
  '/directory.html': '📇', '/profile.html': '👤', '/my-payroll.html': '💵', '/meetings.html': '🗓️',
  '/attendance-checkin.html': '📍', '/hr/late-clockin-requests.html': '⏰', '/acc/purchase-orders.html': '🧾',
  '/proposals.html': '💡', '/archive.html': '📚', '/permission-requests.html': '🔑', '/change-password.html': '🔒',
};
function renderRoom(profile) {
  const group = NAV_CONFIG.find((g) => g.section === 'Chức năng cá nhân');
  const grid = document.getElementById('roomGrid');
  grid.innerHTML = group.items.map((item) => {
    const visible = item.visible(profile);
    return `
      <div class="item-card ${visible ? '' : 'item-card--locked'}" data-href="${item.href}">
        <span class="item-card__icon">${ROOM_ICONS[item.href] || '✨'}</span>
        <span class="item-card__name">${t(item.labelKey, item.label)}</span>
        ${visible ? '' : '<span class="item-card__lock">🔒</span>'}
      </div>
    `;
  }).join('');
  grid.querySelectorAll('.item-card:not(.item-card--locked)').forEach((el) => {
    el.addEventListener('click', () => { window.location.href = el.dataset.href; });
  });
}

// =====================================================================
// PHAN 6 — BANZONE: gop theo danh muc (accordion) + tim nhanh.
// =====================================================================
// LÀM LẠI 22/08/2026 — sắp xếp lại theo ĐÚNG PHÒNG BAN SỞ HỮU dữ liệu
// (thay vì nhóm theo chủ đề trừu tượng cũ: Tổ chức/Tài chính/Vận hành) —
// dễ tìm hơn vì khớp đúng cách người dùng nghĩ: "cái tôi cần là của Kế
// toán hay của Trung tâm", theo đúng yêu cầu.
const BANZONE_CATEGORIES = [
  { name: t('lobby.banzone.catAcc', 'Kế toán'), icon: '💰', hrefs: ['/master-data/chart-of-accounts.html', '/master-data/expense-categories.html', '/master-data/wallet-tier-discounts.html'] },
  { name: t('lobby.banzone.catCenter', 'Trung tâm & Học vụ'), icon: '🎓', hrefs: ['/acc/suppliers.html', '/master-data/program-pricing.html', '/master-data/program-plan-discounts.html', '/master-data/size-chart.html'] },
  { name: t('lobby.banzone.catWarehouse', 'Kho vận'), icon: '📦', hrefs: ['/master-data/inventory-items.html'] },
  { name: t('lobby.banzone.catOrgSystem', 'Tổ chức hệ thống'), icon: '🏢', hrefs: ['/master-data/centers.html', '/master-data/departments.html', '/master-data/system-roles.html', '/master-data/divisions.html'] },
];
function renderBanzone(profile) {
  const group = NAV_CONFIG.find((g) => g.section === 'Cấu hình dữ liệu gốc');
  const itemsByHref = {};
  group.items.forEach((it) => { itemsByHref[it.href] = it; });
  const usedHrefs = new Set(BANZONE_CATEGORIES.flatMap((c) => c.hrefs));
  const remaining = group.items.filter((it) => !usedHrefs.has(it.href));
  const categories = [...BANZONE_CATEGORIES];
  if (remaining.length > 0) categories.push({ name: t('lobby.banzone.catSystem', 'Hệ thống'), icon: '⚙️', hrefs: remaining.map((it) => it.href) });

  const box = document.getElementById('banzoneAccordions');
  box.innerHTML = categories.map((cat, ci) => {
    const items = cat.hrefs.map((h) => itemsByHref[h]).filter(Boolean);
    const anyVisible = items.some((it) => it.visible(profile));
    return `
      <div class="accordion ${anyVisible ? '' : 'accordion--locked'}" data-cat="${ci}">
        <div class="accordion__head">
          <span class="accordion__icon">${cat.icon}</span>
          <span class="accordion__name">${cat.name}</span>
          <span class="accordion__count">${items.length} ${t('lobby.banzone.items', 'mục')}${anyVisible ? '' : ' — 🔒'}</span>
          <span class="accordion__arrow">▸</span>
        </div>
        <div class="accordion__body">
          ${items.map((it) => {
            const visible = it.visible(profile);
            const label = t(it.labelKey, it.label);
            return `<div class="accordion-row ${visible ? '' : 'accordion-row--locked'}" data-href="${it.href}" data-name="${label.toLowerCase()}">${label}${visible ? '' : ' 🔒'}</div>`;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  box.querySelectorAll('.accordion:not(.accordion--locked) .accordion__head').forEach((head) => {
    head.addEventListener('click', () => { head.closest('.accordion').classList.toggle('is-open'); });
  });
  box.querySelectorAll('.accordion-row:not(.accordion-row--locked)').forEach((row) => {
    row.addEventListener('click', (e) => { e.stopPropagation(); window.location.href = row.dataset.href; });
  });

  document.getElementById('banzoneSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    box.querySelectorAll('.accordion-row').forEach((row) => {
      const match = !q || row.dataset.name.includes(q);
      row.classList.toggle('accordion-row--hidden', !match);
      if (match && q) row.closest('.accordion').classList.add('is-open');
    });
  });
}

// =====================================================================
// PHAN 7 — Cham cong nhanh (giu nguyen logic, doi mau sang theme sang).
// =====================================================================
let CENTER = null;
let LAST_POSITION = null;
const RADIUS_LIMIT_M = 1000;

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function fmtDistance(m) { return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`; }

function watchPosition() {
  const hint = document.getElementById('ciGpsHint');
  if (!('geolocation' in navigator)) { hint.textContent = t('lobby.checkin.noGeo', 'Trình duyệt không hỗ trợ định vị vị trí.'); return; }
  navigator.geolocation.watchPosition(
    (pos) => {
      LAST_POSITION = pos.coords;
      const dist = distanceMeters(pos.coords.latitude, pos.coords.longitude, CENTER.latitude, CENTER.longitude);
      const inRange = dist <= RADIUS_LIMIT_M;
      hint.textContent = inRange ? `${t('lobby.checkin.inRange', 'Trong phạm vi — cách trung tâm')} ${fmtDistance(dist)}` : `${t('lobby.checkin.outOfRange', 'Ngoài phạm vi — cách')} ${fmtDistance(dist)} (${t('lobby.checkin.rangeLimit', 'giới hạn 1km')})`;
      hint.style.color = inRange ? 'var(--success)' : 'var(--danger)';
      const btnIn = document.getElementById('btnCiIn');
      const btnOut = document.getElementById('btnCiOut');
      if (btnIn.style.display !== 'none') btnIn.disabled = !inRange;
      if (btnOut.style.display !== 'none') btnOut.disabled = !inRange;
    },
    (err) => { hint.textContent = t('lobby.checkin.gpsError', 'Không lấy được vị trí:') + ' ' + (err.message || t('lobby.checkin.gpsPermission', 'cần cho phép truy cập vị trí.')); hint.style.color = 'var(--danger)'; },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

async function loadTodayStatus() {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('attendance_checkins').select('check_type, checked_at')
    .eq('employee_id', PROFILE.id).gte('checked_at', todayStart.toISOString()).order('checked_at', { ascending: true });
  const hasIn = (data || []).some((r) => r.check_type === 'in');
  const hasOut = (data || []).some((r) => r.check_type === 'out');
  const status = document.getElementById('ciStatus');
  const btnIn = document.getElementById('btnCiIn');
  const btnOut = document.getElementById('btnCiOut');
  if (hasIn && hasOut) {
    status.textContent = t('lobby.checkin.doneToday', '✓ Đã hoàn tất chấm công hôm nay (vào & ra).');
    btnIn.style.display = 'none'; btnOut.style.display = 'none';
  } else if (hasIn) {
    status.textContent = `${t('lobby.checkin.checkedInAt', '✓ Đã chấm công vào lúc')} ${new Date(data.find((r) => r.check_type === 'in').checked_at).toLocaleTimeString(getLang() === 'en' ? 'en-US' : 'vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    btnIn.style.display = 'none'; btnOut.style.display = 'block';
  } else {
    status.textContent = t('lobby.checkin.notYet', 'Chưa chấm công vào hôm nay.');
    btnIn.style.display = 'block'; btnOut.style.display = 'none';
  }
}

async function doCheckin(type) {
  const errBox = document.getElementById('ciError');
  errBox.style.display = 'none';
  if (!LAST_POSITION) { errBox.textContent = t('lobby.checkin.waitLocating', 'Chưa xác định được vị trí — đợi vài giây rồi thử lại.'); errBox.style.display = 'block'; return; }
  const dist = distanceMeters(LAST_POSITION.latitude, LAST_POSITION.longitude, CENTER.latitude, CENTER.longitude);
  if (dist > RADIUS_LIMIT_M) { errBox.textContent = `${t('lobby.checkin.tooFar', 'Cách trung tâm')} ${fmtDistance(dist)} — ${t('lobby.checkin.outOfAllowedRange', 'ngoài phạm vi cho phép (1km).')}`; errBox.style.display = 'block'; return; }
  const btn = type === 'in' ? document.getElementById('btnCiIn') : document.getElementById('btnCiOut');
  btn.disabled = true; const oldText = btn.textContent; btn.textContent = t('lobby.checkin.submitting', 'Đang chấm công...');
  try {
    const { error } = await supabase.from('attendance_checkins').insert({
      employee_id: PROFILE.id, center_id: CENTER.id, check_type: type,
      latitude: LAST_POSITION.latitude, longitude: LAST_POSITION.longitude, distance_m: dist,
    });
    if (error) throw error;
    await loadTodayStatus();
  } catch (err) {
    errBox.textContent = err.message || t('lobby.checkin.genericError', 'Có lỗi xảy ra.');
    errBox.style.display = 'block';
    btn.disabled = false; btn.textContent = oldText;
  }
}
document.getElementById('btnCiIn').addEventListener('click', () => doCheckin('in'));
document.getElementById('btnCiOut').addEventListener('click', () => doCheckin('out'));
document.getElementById('btnCloseCheckin').addEventListener('click', () => { document.getElementById('checkinOverlay').classList.remove('is-visible'); });
document.getElementById('checkinOverlay').addEventListener('click', (e) => { if (e.target.id === 'checkinOverlay') e.currentTarget.classList.remove('is-visible'); });

let checkinInitialized = false;
async function openCheckin() {
  document.getElementById('checkinOverlay').classList.add('is-visible');
  if (checkinInitialized) return;
  checkinInitialized = true;
  if (!PROFILE?.centerId) {
    // SUA — truoc day chi hien dong chu bao di dung trang day du, KHONG
    // cho cham cong ngay tai day — trong khi trang day du
    // (attendance-checkin.html) da co san cach xu ly dung: cho tu chon
    // dung trung tam dang co mat. Dong bo lai y het o day, thay vi bat
    // khoi van phong (Ke toan, BDH...) phai roi sang trang khac.
    const { data: centers } = await supabase.from('centers').select('id, name, latitude, longitude').order('name');
    document.getElementById('ciCenterPicker').style.display = 'block';
    document.getElementById('ciGpsHint').textContent = '';
    const select = document.getElementById('ciCenterSelect');
    select.innerHTML = '<option value="">— Chọn trung tâm —</option>' + (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    select.addEventListener('change', () => {
      const chosen = (centers || []).find((c) => c.id === select.value);
      if (!chosen || !chosen.latitude || !chosen.longitude) {
        document.getElementById('btnCiIn').style.display = 'none';
        document.getElementById('btnCiOut').style.display = 'none';
        return;
      }
      CENTER = chosen;
      document.getElementById('ciCenterName').textContent = chosen.name;
      document.getElementById('btnCiIn').style.display = 'block';
      watchPosition();
      loadTodayStatus();
    });
    return;
  }
  const { data: center } = await supabase.from('centers').select('id, name, latitude, longitude').eq('id', PROFILE.centerId).single();
  if (!center || !center.latitude || !center.longitude) {
    document.getElementById('ciGpsHint').textContent = t('lobby.checkin.noGps', 'Trung tâm của bạn chưa có toạ độ GPS — liên hệ kỹ thuật.');
    document.getElementById('btnCiIn').style.display = 'none';
    document.getElementById('btnCiOut').style.display = 'none';
    return;
  }
  CENTER = center;
  document.getElementById('ciCenterName').textContent = center.name;
  watchPosition();
  await loadTodayStatus();
}
document.getElementById('btnOpenCheckin').addEventListener('click', openCheckin);

// =====================================================================
// BOOT
// =====================================================================
(async () => {
  // renderGreeting() gọi bên dưới sau khi có employee.full_name

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) { window.location.href = '/index.html'; return; }

  const { data: employee } = await supabase
    .from('employees')
    .select(`
      id, full_name, center_id, language_preference, dob,
      departments ( code ), positions ( name ),
      system_roles ( code ), centers ( id, name )
    `)
    .eq('auth_user_id', sessionData.session.user.id)
    .single();

  if (!employee) return;
  renderGreeting(employee.full_name);
  checkBirthday(employee.id).catch((e) => console.warn('checkBirthday lỗi:', e));
  loadStats(employee.id).catch(console.warn);
  loadNoticeBoard().catch(console.warn);
  initFortuneWidget(employee.dob);
  const installCard = document.getElementById('installBanner');
  if (installCard) registerInstallBanner(installCard, installCard);
  PROFILE = { id: employee.id, centerId: employee.center_id };
  syncLangFromProfile(employee.language_preference);
  paintLangSwitcher();

  const fullProfile = {
    id: employee.id,
    fullName: employee.full_name || '',
    departmentCode: employee.departments?.code || null,
    positionName: employee.positions?.name || '',
    roleCode: employee.system_roles?.code || 'STAFF',
    centerId: employee.centers?.id || null,
    centerName: employee.centers?.name || '',
    isCenterManager: employee.system_roles?.code === 'CENTER_MANAGER',
  };
  FULL_PROFILE = fullProfile;
  document.getElementById('cardUnread')?.addEventListener('click', () => { window.location.href = '/notifications.html'; });
  document.getElementById('cardPending')?.addEventListener('click', () => { window.location.href = '/approval-center.html'; });

  // MỚI — nối dữ liệu thật cho ô "Việc đang chờ duyệt" (trước đây luôn
  // hiện dấu "—" vì chưa từng tính). Dùng lại ĐÚNG logic 14 nguồn của
  // Trung tâm phê duyệt (js/approvalCenter.js) — không viết trùng.
  getPendingApprovalCount(fullProfile).then((count) => {
    const el = document.getElementById('statPending');
    if (el) el.textContent = String(count);
  }).catch((e) => console.warn('Không đếm được việc chờ duyệt:', e));

  applyBranchLocks(fullProfile);
  renderErp(fullProfile);
  renderRoom(fullProfile);
  renderBanzone(fullProfile);
  await renderCrm(fullProfile);
  loadFinanceBoard(fullProfile).catch(console.warn);

  // Khoi phuc dung lop dang xem neu F5 / mo lai (dung sessionStorage) —
  // SUA: truoc day chi goi showLayer(..., {push:false}) — hien dung lop
  // nhung KHONG dung lai chuoi lich su cha-con, khien nut Back CUA TRINH
  // DUYET (khac voi nut "Quay lai" trong app da sua rieng o tren) van bi
  // sai — gio dung lai DUNG chuoi tu goc truoc khi hien lop dich.
  const savedLayer = sessionStorage.getItem(STORAGE_KEY);
  if (savedLayer && savedLayer !== 'layerBranches' && document.getElementById(savedLayer)) {
    // Nếu đang khôi phục layerDeptWorkspace, xác định TRƯỚC nó thuộc về
    // Hành chính hay Trung tâm — để chuỗi lịch sử (chain) bên dưới tính
    // đúng ngay từ đầu, thay vì tính xong mới sửa lại.
    if (savedLayer === 'layerDeptWorkspace') {
      const savedDept = sessionStorage.getItem(DEPT_WORKSPACE_KEY);
      PARENT_OF.layerDeptWorkspace = (savedDept && NAV_CONFIG.find((g) => g.section === savedDept)) ? 'layerErp' : 'layerCrm';
    }
    window.history.replaceState({ layer: 'layerBranches' }, '', '#branches');
    const chain = [];
    let walk = savedLayer;
    while (walk) { chain.unshift(walk); walk = PARENT_OF[walk]; }
    chain.forEach((id) => { window.history.pushState({ layer: id }, '', '#' + id.replace('layer', '').toLowerCase()); });
    // SUA LOI THAT: truoc day chi hien DUNG LOP nhung QUEN dien lai noi
    // dung ben trong lop "layerDeptWorkspace" (banner + luoi chuc nang
    // cua dung phong ban dang xem) — F5 hoac mo thang link #deptworkspace
    // se ra man hinh trong khong. Neu khong con nho dung phong ban nao
    // (vd xoa rieng sessionStorage nay), lui ve lop cha (Tang Phong ban)
    // thay vi hien 1 man rong.
    if (savedLayer === 'layerDeptWorkspace') {
      const savedDept = sessionStorage.getItem(DEPT_WORKSPACE_KEY);
      const savedCenterRaw = sessionStorage.getItem(CRM_WORKSPACE_CENTER_KEY);
      if (savedDept && NAV_CONFIG.find((g) => g.section === savedDept)) {
        openDeptWorkspace(savedDept, fullProfile);
        showLayer(savedLayer, { push: false });
      } else if (savedCenterRaw) {
        try {
          const savedCenter = JSON.parse(savedCenterRaw);
          openCrmWorkspace(savedCenter, fullProfile);
          showLayer(savedLayer, { push: false });
        } catch (e) {
          showLayer('layerBranches', { push: false });
        }
      } else {
        showLayer('layerErp', { push: false });
      }
    } else {
      showLayer(savedLayer, { push: false });
      if (savedLayer === 'layerCrm') startCrmAnimation();
    }
  } else {
    window.history.replaceState({ layer: 'layerBranches' }, '', '#branches');
  }
})();
