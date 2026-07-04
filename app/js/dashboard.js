import { bootShell } from './shell.js';
import { supabase } from './supabase.js';

const birthdayBanner = document.getElementById('birthdayBanner');
const notifBadge = document.getElementById('notifBadge');

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
    loadStats(profile).catch(console.warn);
  } catch (e) {
    // bootShell đã tự điều hướng về login nếu cần
  }
})();
