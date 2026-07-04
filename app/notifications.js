import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const SCOPE_ICON = { system: '🌐', center: '🏫', department: '🏢', personal: '👤' };
const SCOPE_LABEL = { system: 'Toàn hệ thống', center: 'Trung tâm', department: 'Phòng ban', personal: 'Cá nhân' };

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
  const rows = ALL_ROWS.filter((r) => !scope || r.scope === scope);
  document.getElementById('resultCount').textContent = `${rows.length} thông báo`;

  const list = document.getElementById('notifList');
  if (rows.length === 0) { list.innerHTML = '<div class="empty-cell">Không có thông báo nào.</div>'; return; }

  list.innerHTML = rows.map((n) => `
    <div class="notif-item ${READ_IDS.has(n.id) ? '' : 'unread'}" data-id="${n.id}">
      <div class="notif-scope-icon">${SCOPE_ICON[n.scope] || '🔔'}</div>
      <div class="notif-body">
        <div class="notif-title">${esc(n.title)}</div>
        <div class="notif-content">${esc(n.content || '')}</div>
        <div class="notif-meta">${SCOPE_LABEL[n.scope]} · ${fmtDate(n.created_at)}</div>
      </div>
      ${!READ_IDS.has(n.id) ? '<button class="btn btn-outline btn-sm" data-mark>Đánh dấu đã đọc</button>' : ''}
    </div>
  `).join('');

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
