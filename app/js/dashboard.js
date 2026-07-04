import { bootShell } from './shell.js';
import { supabase } from './supabase.js';
import { NAV_CONFIG } from './navConfig.js';
import { t } from './i18n.js';

const birthdayBanner = document.getElementById('birthdayBanner');
const notifBadge = document.getElementById('notifBadge');

// Icon đại diện cho từng nhóm phòng ban trên lưới App Hub (khác icon của
// từng trang con trong sectionKey, vì đây là icon "cả phòng ban" to hơn).
const HUB_ICON = {
  'nav.section.hr': '🧑‍💼',
  'nav.section.acc': '💰',
  'nav.section.mkt': '📣',
  'nav.section.fac': '🛠',
  'nav.section.center': '🏫',
  'nav.section.teacher': '🍎',
  'nav.section.consultant': '📇',
  'nav.section.exec': '🏛',
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderHub(profile) {
  const appHub = document.getElementById('appHub');
  const quickHub = document.getElementById('quickHub');
  if (!appHub || !quickHub) return;
  appHub.innerHTML = '';
  quickHub.innerHTML = '';

  NAV_CONFIG.forEach((group) => {
    const visibleItems = group.items.filter((item) => item.visible(profile));

    if (!group.sectionKey) {
      // Nhóm không tiêu đề = mục dùng chung, ai cũng có -> hiển thị ở "Truy cập nhanh"
      group.items.forEach((item) => {
        const a = document.createElement('a');
        a.href = item.href;
        a.className = 'app-tile';
        a.innerHTML = `<div class="app-tile__icon">${item.icon}</div><div class="app-tile__label">${esc(t(item.labelKey, item.label))}</div>`;
        quickHub.appendChild(a);
      });
      return;
    }

    const hasAccess = visibleItems.length > 0;
    const el = document.createElement(hasAccess ? 'a' : 'div');
    el.className = 'app-tile' + (hasAccess ? '' : ' disabled');
    if (hasAccess) el.href = visibleItems[0].href;
    el.innerHTML = `
      <div class="app-tile__icon">${HUB_ICON[group.sectionKey] || '📁'}</div>
      <div class="app-tile__label">${esc(t(group.sectionKey, group.section || ''))}</div>
      ${!hasAccess ? `<div class="app-tile__lock">🔒 ${esc(t('dashboard.noAccess', 'Không có quyền'))}</div>` : ''}
    `;
    if (!hasAccess) el.title = t('dashboard.noAccess', 'Bạn không có quyền truy cập phòng ban này.');
    appHub.appendChild(el);
  });
}

function checkBirthday(dob, fullName) {
  if (!dob) return;
  const today = new Date();
  const d = new Date(dob);
  if (d.getUTCDate() === today.getDate() && d.getUTCMonth() === today.getMonth()) {
    birthdayBanner.classList.add('show');
    document.getElementById('birthdayText').textContent =
      `Hôm nay là sinh nhật của ${fullName}! Chúc bạn một ngày thật vui và nhiều sức khoẻ.`;
  }
}

async function loadUnreadCount(profile) {
  // Dùng RPC tính đúng "chưa tồn tại bản ghi đã đọc" ở DB, 1 round-trip thay vì
  // 2 câu đếm rời rạc rồi trừ (cách cũ sai khi thông báo hết phạm vi/bị xoá).
  const { data, error } = await supabase.rpc('unread_notification_count');
  const unread = error ? 0 : Math.max(data ?? 0, 0);
  if (notifBadge) {
    notifBadge.textContent = unread > 99 ? '99+' : String(unread);
    notifBadge.style.display = unread > 0 ? 'flex' : 'none';
  }
  return unread;
}

async function loadStats(profile) {
  // Ngày phép còn lại (tháng hiện tại)
  const now = new Date();
  const { data: balance } = await supabase
    .from('leave_balances')
    .select('annual_leave_accrued, annual_leave_used, compensatory_leave')
    .eq('employee_id', profile.id)
    .eq('year', now.getFullYear())
    .eq('month', now.getMonth() + 1)
    .maybeSingle();

  document.getElementById('statLeave').textContent = balance
    ? (Number(balance.annual_leave_accrued) - Number(balance.annual_leave_used) + Number(balance.compensatory_leave)).toFixed(1)
    : '0';

  // Cuộc họp sắp tới (7 ngày tới) mà mình được mời
  const { count: meetingCount } = await supabase
    .from('meeting_participants')
    .select('meeting_id', { count: 'exact', head: true })
    .eq('employee_id', profile.id);
  document.getElementById('statMeetings').textContent = meetingCount ?? 0;

  document.getElementById('statPending').textContent = '—';
  const unread = await loadUnreadCount(profile).catch(() => 0);
  document.getElementById('statUnread').textContent = unread;
}

(async () => {
  try {
    const { profile } = await bootShell();
    checkBirthday(profile.dob, profile.fullName.split(' ').slice(-1)[0]);
    renderHub(profile);
    document.addEventListener('ais:langchange', () => renderHub(profile));
    loadStats(profile).catch(console.warn);
  } catch (e) {
    // bootShell đã tự điều hướng về login nếu cần
  }
})();
