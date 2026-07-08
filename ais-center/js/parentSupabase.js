// =====================================================================
// AIS CENTER — client Supabase riêng cho App phụ huynh.
// Dùng CHUNG 1 Supabase project với AIS ERP (multi-frontend, single-
// backend — đúng kiến trúc mục 6 tài liệu), nhưng đăng nhập bằng luồng
// KHÁC hoàn toàn (SĐT + OTP qua Supabase Auth Phone Provider), không dùng
// chung namespace @ais.local của nhân viên.
//
// CẦN CẤU HÌNH TRƯỚC KHI DÙNG:
//   1. Supabase Dashboard -> Authentication -> Providers -> Phone -> bật
//      + kết nối 1 nhà cung cấp SMS thật (Twilio/MessageBird/Vonage...).
//   2. Tạo file ais-center/env.js (không commit), cùng format với
//      app/env.js:
//        window.__ENV__ = { SUPABASE_URL: '...', SUPABASE_ANON_KEY: '...' };
// =====================================================================

const ENV = window.__ENV__ || {};
const SUPABASE_URL = ENV.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }
export function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }
export function fmtDateTime(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

/**
 * Đảm bảo đã đăng nhập, nạp hồ sơ parent_account (tự tạo nếu lần đầu đăng
 * nhập thành công qua OTP mà chưa có hồ sơ tương ứng), và nạp danh sách
 * học sinh đã liên kết. Gọi ở đầu MỌI trang trong app này (trừ trang login).
 */
export async function bootParentShell() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    window.location.href = '/ais-center/index.html';
    throw new Error('NO_SESSION');
  }

  const phone = sessionData.session.user.phone || sessionData.session.user.user_metadata?.phone;
  let { data: parent } = await supabase.from('parent_accounts').select('*').eq('auth_user_id', sessionData.session.user.id).maybeSingle();

  if (!parent && phone) {
    // Nhân viên có thể đã tạo TRƯỚC hồ sơ phụ huynh này (chưa gắn auth_user_id,
    // ví dụ khi liên kết phụ huynh với học sinh trước khi phụ huynh dùng App
    // lần đầu) — gọi RPC để LIÊN KẾT an toàn vào hồ sơ có sẵn theo đúng SĐT
    // của phiên đăng nhập hiện tại (không update trực tiếp từ client vì RLS
    // sẽ chặn hồ sơ chưa có auth_user_id — xem claim_parent_account() ở DB).
    const { data: claimed } = await supabase.rpc('claim_parent_account').maybeSingle();
    if (claimed) parent = claimed;
  }

  if (!parent) {
    // Lần đầu xác thực OTP thành công, chưa có hồ sơ nào khớp SĐT — tự tạo
    // hồ sơ mới liên kết với auth_user_id này (chưa có link tới học sinh
    // nào, cần lễ tân/kế toán trung tâm bổ sung link thủ công qua ERP sau
    // khi xác minh danh tính).
    const { data: created, error } = await supabase.from('parent_accounts').insert({
      auth_user_id: sessionData.session.user.id,
      full_name: sessionData.session.user.user_metadata?.full_name || 'Phụ huynh',
      phone: phone || 'unknown',
    }).select('*').single();
    if (error) { console.error('Không tạo được hồ sơ phụ huynh:', error.message); throw error; }
    parent = created;
  }

  const { data: links } = await supabase
    .from('parent_student_links')
    .select('student_id, relationship, students(id, full_name, center_id, centers(name))')
    .eq('parent_account_id', parent.id);

  const students = (links || []).map((l) => ({ ...l.students, relationship: l.relationship }));

  // Điền tên phụ huynh vào topbar nếu trang có phần tử này
  const nameEl = document.getElementById('parentName');
  if (nameEl) nameEl.textContent = parent.full_name;

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/ais-center/index.html';
  });

  if (students.length === 0) {
    const notice = document.getElementById('noStudentNotice');
    if (notice) notice.style.display = 'block';
  }

  return { parent, students };
}

/** Lấy học sinh đang được chọn (lưu trong localStorage khi phụ huynh có nhiều con) */
export function getSelectedStudentId(students) {
  const saved = localStorage.getItem('ais_center_selected_student');
  if (saved && students.some((s) => s.id === saved)) return saved;
  return students[0]?.id || null;
}
export function setSelectedStudentId(id) {
  localStorage.setItem('ais_center_selected_student', id);
}
