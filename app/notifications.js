import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const SCOPE_ICON = {
  system: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.5-4-9s1.5-6.5 4-9z"/></svg>',
  center: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/></svg>',
  department: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/></svg>',
  personal: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>',
};
const SCOPE_LABEL = { system: 'Toàn hệ thống', center: 'Trung tâm', department: 'Phòng ban', personal: 'Cá nhân' };

// PHAN LOAI THEO NGHIEP VU — suy ra tu tien to duong dan link_url (da co
// san), KHONG can sua tung noi tao thong bao (9+ cho khac nhau trong he
// thong) — cach nhanh nhat de tach "chong cheo" nhieu loai thong bao
// tron lan 1 danh sach nhu truoc, ma khong dong cham nhieu code.
const CATEGORY_MAP = [
  { prefix: '/hr/', label: 'Nhân sự', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/><circle cx="17.5" cy="9" r="2.8"/><path d="M16 14.3c2.7.4 4.5 2.1 4.5 4.7"/></svg>' },
  { prefix: '/acc/', label: 'Kế toán', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v.01M18 15v.01"/></svg>' },
  { prefix: '/fac/', label: 'CSVC', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-3-3z"/></svg>' },
  { prefix: '/mkt/', label: 'Truyền thông', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 10v4h3l5 4V6l-5 4H3z"/><path d="M14 8a4 4 0 0 1 0 8"/><path d="M17 5a8 8 0 0 1 0 14"/></svg>' },
  { prefix: '/edu/', label: 'Học vụ / Học phí', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c0 1.5 2.5 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/></svg>' },
  { prefix: '/exec/', label: 'Ban điều hành', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/></svg>' },
];
function categoryOf(row) {
  const url = row.link_url || '';
  const found = CATEGORY_MAP.find((c) => url.startsWith(c.prefix));
  return found || { label: 'Khác', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 4 1.5 6 2 6.5H4c.5-.5 2-2.5 2-6.5z"/><path d="M9.5 18a2.5 2.5 0 0 0 5 0"/></svg>' };
}

let PROFILE = null;
let ALL_ROWS = [];
let READ_IDS = new Set();

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : ''; }

async function loadRows() {
  const list = document.getElementById('notifList');
  list.innerHTML = '<div class="empty-cell">Đang tải dữ liệu...</div>';

  const [{ data: notifs, error }, { data: reads }] = await Promise.all([
    supabase.from('notifications').select('*').order('created_at', { ascending: false }),
    supabase.from('notification_reads').select('notification_id').eq('employee_id', PROFILE.id),
  ]);

  if (error) { list.innerHTML = `<div class="empty-cell">Lỗi: ${error.message}</div>`; return; }
  ALL_ROWS = notifs || [];
  READ_IDS = new Set((reads || []).map((r) => r.notification_id));
  render();
}

function render() {
  const scope = document.getElementById('filterScope').value;
  const category = document.getElementById('filterCategory').value;
  const rows = ALL_ROWS.filter((r) => (!scope || r.scope === scope) && (!category || categoryOf(r).label === category));
  document.getElementById('resultCount').textContent = `${rows.length} thông báo`;

  const list = document.getElementById('notifList');
  if (rows.length === 0) { list.innerHTML = '<div class="empty-cell">Không có thông báo nào.</div>'; return; }

  list.innerHTML = rows.map((n) => {
    const cat = categoryOf(n);
    return `
    <div class="notif-item ${READ_IDS.has(n.id) ? '' : 'unread'}" data-id="${n.id}" ${n.link_url ? `data-goto="${esc(n.link_url)}" style="cursor:pointer;"` : ''}>
      <div class="notif-scope-icon">${cat.icon}</div>
      <div class="notif-body">
        <div class="notif-title">${esc(n.title)}</div>
        <div class="notif-content">${esc(n.content || '')}</div>
        <div class="notif-meta"><span class="badge badge-submitted" style="font-size:10px;">${cat.label}</span> · ${SCOPE_LABEL[n.scope]} · ${fmtDate(n.created_at)}</div>
      </div>
      ${!READ_IDS.has(n.id) ? '<button class="btn btn-outline btn-sm" data-mark>Đánh dấu đã đọc</button>' : ''}
    </div>
  `;
  }).join('');

  // Bam vao thong bao (ngoai nut "Danh dau da doc") -> dieu huong toi
  // dung trang lien quan, dung du lieu link_url moi sua/them.
  list.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-mark]')) return;
      window.location.href = el.dataset.goto;
    });
  });

  list.querySelectorAll('[data-mark]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.notif-item').dataset.id;
      await markRead(id);
      await loadRows();
    });
  });
}

async function markRead(notificationId) {
  await supabase.from('notification_reads').upsert(
    { notification_id: notificationId, employee_id: PROFILE.id },
    { onConflict: 'notification_id,employee_id' }
  );
}

document.getElementById('filterScope').addEventListener('change', render);
document.getElementById('filterCategory').addEventListener('change', render);

document.getElementById('btnMarkAll').addEventListener('click', async () => {
  const unread = ALL_ROWS.filter((r) => !READ_IDS.has(r.id));
  if (unread.length === 0) return;
  await supabase.from('notification_reads').upsert(
    unread.map((r) => ({ notification_id: r.id, employee_id: PROFILE.id })),
    { onConflict: 'notification_id,employee_id' }
  );
  await loadRows();
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
