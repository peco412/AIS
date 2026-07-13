import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const SCOPE_ICON = { system: '🌐', center: '🏫', department: '🏢', personal: '👤' };
const SCOPE_LABEL = { system: 'Toàn hệ thống', center: 'Trung tâm', department: 'Phòng ban', personal: 'Cá nhân' };

// PHAN LOAI THEO NGHIEP VU — suy ra tu tien to duong dan link_url (da co
// san), KHONG can sua tung noi tao thong bao (9+ cho khac nhau trong he
// thong) — cach nhanh nhat de tach "chong cheo" nhieu loai thong bao
// tron lan 1 danh sach nhu truoc, ma khong dong cham nhieu code.
const CATEGORY_MAP = [
  { prefix: '/hr/', label: 'Nhân sự', icon: '👥' },
  { prefix: '/acc/', label: 'Kế toán', icon: '💰' },
  { prefix: '/fac/', label: 'CSVC', icon: '🔧' },
  { prefix: '/mkt/', label: 'Truyền thông', icon: '📣' },
  { prefix: '/edu/', label: 'Học vụ / Học phí', icon: '🎓' },
  { prefix: '/exec/', label: 'Ban điều hành', icon: '🏛️' },
];
function categoryOf(row) {
  const url = row.link_url || '';
  const found = CATEGORY_MAP.find((c) => url.startsWith(c.prefix));
  return found || { label: 'Khác', icon: '🔔' };
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
