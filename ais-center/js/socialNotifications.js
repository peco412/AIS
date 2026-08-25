import { supabase, esc, bootSocialShell } from './parentSupabase.js';

let PROFILE = null;

function initials(name) { return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase(); }
function avatarHtml(url, name) { return url ? `<img src="${esc(url)}" alt="" />` : esc(initials(name)); }

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(dateStr).toLocaleDateString('vi-VN');
}

const TYPE_TEXT = {
  like: (name) => `<strong>${esc(name)}</strong> đã thích bài viết của bạn`,
  comment: (name) => `<strong>${esc(name)}</strong> đã bình luận về bài viết của bạn`,
  reply: (name) => `<strong>${esc(name)}</strong> đã trả lời bình luận của bạn`,
  friend_request: (name) => `<strong>${esc(name)}</strong> đã gửi lời mời kết bạn`,
  friend_accept: (name) => `<strong>${esc(name)}</strong> đã chấp nhận lời mời kết bạn của bạn`,
  share: (name) => `<strong>${esc(name)}</strong> đã chia sẻ lại bài viết của bạn`,
};
const TYPE_ICON = { like: '❤️', comment: '💬', reply: '↩️', friend_request: '➕', friend_accept: '✓', share: '🔁' };

async function loadNotifications() {
  const box = document.getElementById('notifList');
  const { data: notifs, error } = await supabase
    .from('social_notifications')
    .select('id, type, is_read, created_at, post_id, friendship_id, actor:actor_profile_id(id, display_name, avatar_url)')
    .eq('recipient_profile_id', PROFILE.profileId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) { box.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  if (!notifs || notifs.length === 0) { box.innerHTML = '<div class="empty-state">Chưa có thông báo nào.</div>'; return; }

  box.innerHTML = notifs.map((n) => {
    const actorName = n.actor?.display_name || 'Ai đó';
    const textFn = TYPE_TEXT[n.type];
    const targetHref = n.type === 'friend_request' || n.type === 'friend_accept' ? 'social-profile.html' : (n.post_id ? `community.html?post=${n.post_id}` : 'community.html');
    return `
      <a href="${targetHref}" class="notif-row ${n.is_read ? '' : 'unread'}" data-notif="${n.id}" style="position:relative;">
        <div class="notif-row__avatar">${avatarHtml(n.actor?.avatar_url, actorName)}</div>
        <span class="notif-row__icon">${TYPE_ICON[n.type] || '🔔'}</span>
        <div>
          <div class="notif-row__text">${textFn ? textFn(actorName) : 'Có hoạt động mới'}</div>
          <div class="notif-row__time">${timeAgo(n.created_at)}</div>
        </div>
      </a>
    `;
  }).join('');
}

document.getElementById('btnMarkAllRead').addEventListener('click', async () => {
  await supabase.rpc('mark_all_social_notifications_read');
  document.querySelectorAll('.notif-row.unread').forEach((el) => el.classList.remove('unread'));
});

(async () => {
  try {
    PROFILE = await bootSocialShell();
    await loadNotifications();
    // Vào trang này coi như đã xem hết — tự đánh dấu đã đọc (đúng hành
    // vi thông thường của mạng xã hội, không cần bấm nút riêng).
    await supabase.rpc('mark_all_social_notifications_read');
  } catch (e) {
    document.getElementById('notifList').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
})();
