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
let PAGE_OFFSET = 0;
let HAS_MORE = true;
let ACTIVE_TYPE = 'info';
const PAGE_SIZE = 50;

function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : ''; }
function fmtDateLong(d) { return d ? new Date(d).toLocaleString('vi-VN', { dateStyle: 'long', timeStyle: 'short' }) : ''; }

// MỚI — tách hẳn 2 loại: "Thông tin" (con người chủ động soạn — vd Ban
// hành thông báo, có chữ ký cuối bài) và "Hệ thống" (tự sinh theo nghiệp
// vụ — duyệt đơn, phân việc...). Lọc ngay ở tầng truy vấn (không lọc phía
// trình duyệt như 2 mục con Phạm vi/Nghiệp vụ bên dưới) để đúng cho cả
// khi tải thêm theo trang.
// SUA HIEU NANG: van giu phan trang 50 dong/lan da lam truoc do.
async function loadRows(reset = true) {
  const list = document.getElementById('notifList');
  if (reset) {
    PAGE_OFFSET = 0;
    HAS_MORE = true;
    ALL_ROWS = [];
    list.innerHTML = '<div class="empty-cell">Đang tải dữ liệu...</div>';
  }

  const [{ data: notifs, error }, { data: reads }] = await Promise.all([
    supabase.from('notifications')
      .select('id, scope, title, content, link_url, created_at, notification_type, employees!created_by(full_name, positions(name))')
      .eq('notification_type', ACTIVE_TYPE)
      .order('created_at', { ascending: false })
      .range(PAGE_OFFSET, PAGE_OFFSET + PAGE_SIZE - 1),
    reset ? supabase.from('notification_reads').select('notification_id').eq('employee_id', PROFILE.id) : Promise.resolve({ data: null }),
  ]);

  if (error) { list.innerHTML = `<div class="empty-cell">Lỗi: ${error.message}</div>`; return; }
  HAS_MORE = (notifs || []).length === PAGE_SIZE;
  PAGE_OFFSET += (notifs || []).length;
  ALL_ROWS = reset ? (notifs || []) : ALL_ROWS.concat(notifs || []);
  if (reads) READ_IDS = new Set((reads || []).map((r) => r.notification_id));
  await updateTabCounts();
  render();
}

// Đếm số chưa đọc riêng cho từng tab để hiện cạnh tên tab — đếm bằng 1
// truy vấn count riêng (không lấy hết dữ liệu) để không ảnh hưởng phần
// phân trang chính ở trên.
async function updateTabCounts() {
  const [{ count: infoCount }, { count: sysCount }] = await Promise.all([
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('notification_type', 'info'),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('notification_type', 'system'),
  ]);
  document.getElementById('countInfo').textContent = infoCount != null ? ` (${infoCount})` : '';
  document.getElementById('countSystem').textContent = sysCount != null ? ` (${sysCount})` : '';
}

function render() {
  const scope = document.getElementById('filterScope').value;
  const category = document.getElementById('filterCategory').value;
  const rows = ALL_ROWS.filter((r) => (!scope || r.scope === scope) && (!category || categoryOf(r).label === category));
  document.getElementById('resultCount').textContent = `${rows.length} thông báo${HAS_MORE ? ' (đã tải, còn thêm)' : ''}`;

  const list = document.getElementById('notifList');
  if (rows.length === 0) { list.innerHTML = '<div class="empty-cell">Không có thông báo nào.</div>'; return; }

  list.innerHTML = rows.map((n) => {
    const cat = categoryOf(n);
    return `
    <div class="notif-item ${READ_IDS.has(n.id) ? '' : 'unread'}" data-id="${n.id}">
      <div class="notif-scope-icon">${cat.icon}</div>
      <div class="notif-body">
        <div class="notif-title">${esc(n.title)}</div>
        <div class="notif-content">${esc(n.content || '')}</div>
        <div class="notif-meta"><span class="badge badge-submitted" style="font-size:10px;">${cat.label}</span> · ${SCOPE_LABEL[n.scope]} · ${fmtDate(n.created_at)}</div>
      </div>
    </div>
  `;
  }).join('') + (HAS_MORE ? '<button class="btn btn-outline" id="btnLoadMoreNotif" style="width:100%; margin-top:10px;">Tải thêm</button>' : '');

  document.getElementById('btnLoadMoreNotif')?.addEventListener('click', (e) => {
    e.target.textContent = 'Đang tải...';
    e.target.disabled = true;
    loadRows(false);
  });

  // MỚI — bấm vào 1 thông báo để ĐỌC ĐẦY ĐỦ như đọc 1 bài viết (mở modal
  // chi tiết), thay vì trước đây bấm là điều hướng đi luôn — nội dung dài
  // bị cắt ngắn trong danh sách, không đọc trọn được. Mở modal cũng tự
  // đánh dấu đã đọc luôn (đọc = đã đọc), không cần nút riêng mỗi dòng nữa.
  list.querySelectorAll('.notif-item').forEach((el) => {
    el.addEventListener('click', () => openDetail(el.dataset.id));
  });
}

function openDetail(id) {
  const n = ALL_ROWS.find((r) => r.id === id);
  if (!n) return;
  const cat = categoryOf(n);

  document.getElementById('notifDetailMeta').innerHTML =
    `<span class="badge badge-submitted" style="font-size:10px;">${cat.label}</span><span>${SCOPE_LABEL[n.scope]}</span><span>·</span><span>${fmtDateLong(n.created_at)}</span>`;
  document.getElementById('notifDetailTitle').textContent = n.title;
  document.getElementById('notifDetailContent').textContent = n.content || '';

  const sigBox = document.getElementById('notifDetailSignature');
  if (n.notification_type === 'info' && n.employees?.full_name) {
    document.getElementById('notifSigName').textContent = n.employees.full_name;
    document.getElementById('notifSigTitle').textContent = n.employees.positions?.name || '';
    sigBox.style.display = 'block';
  } else {
    sigBox.style.display = 'none';
  }

  document.getElementById('notifDetailModal').classList.add('show');

  if (!READ_IDS.has(id)) {
    markRead(id).then(() => {
      READ_IDS.add(id);
      render();
    });
  }

  // Nếu thông báo có link_url (thường là loại Hệ thống, gắn với 1 yêu
  // cầu/phiếu cụ thể) thì cho phép nhấn đi tới đúng chỗ đó từ trong modal.
  const goBtn = document.getElementById('notifDetailGoto');
  if (goBtn) goBtn.remove();
  if (n.link_url) {
    const btn = document.createElement('a');
    btn.id = 'notifDetailGoto';
    btn.href = n.link_url;
    btn.className = 'btn btn-accent btn-sm';
    btn.style.marginTop = '18px';
    btn.style.display = 'inline-block';
    btn.textContent = 'Xem yêu cầu liên quan →';
    document.getElementById('notifDetailContent').insertAdjacentElement('afterend', btn);
  }
}

document.getElementById('notifDetailClose').addEventListener('click', () => document.getElementById('notifDetailModal').classList.remove('show'));
document.getElementById('notifDetailModal').addEventListener('click', (e) => {
  if (e.target.id === 'notifDetailModal') document.getElementById('notifDetailModal').classList.remove('show');
});

async function markRead(notificationId) {
  await supabase.from('notification_reads').upsert(
    { notification_id: notificationId, employee_id: PROFILE.id },
    { onConflict: 'notification_id,employee_id' }
  );
}

document.getElementById('filterScope').addEventListener('change', render);
document.getElementById('filterCategory').addEventListener('change', render);

document.getElementById('notifTypeTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-type]');
  if (!btn || btn.classList.contains('active')) return;
  document.querySelectorAll('#notifTypeTabs button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  ACTIVE_TYPE = btn.dataset.type;
  loadRows(true);
});

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
