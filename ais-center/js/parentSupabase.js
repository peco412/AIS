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
    window.location.href = '/index.html';
    throw new Error('NO_SESSION');
  }

  // SUA LOI THAT: truoc day neu buoc nao ben duoi (tai ho so phu huynh,
  // tai danh sach hoc sinh...) bi loi bat ngo, ham nay THROW, va MOI
  // TRANG goi no deu bat loi bang catch RONG (chi co comment, khong hien
  // gi ca) — khien trang trang tron, nhin nhu "chua lam xong tinh nang"
  // dung y nhu nguoi dung phan anh, trong khi thuc ra la co loi bi nuot
  // im lang. Boc rieng doan nay de LUON hien banner loi ro rang truoc
  // khi nem loi tiep, du trang goi co bat loi im lang hay khong.
  try {
    return await bootParentShellInner(sessionData);
  } catch (e) {
    if (e.message === 'NO_SESSION') throw e; // da dieu huong roi, khong can bao gi them
    console.error('bootParentShell lỗi:', e);
    const main = document.querySelector('main') || document.body;
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#fce7e6; color:#d3352f; padding:16px; border-radius:12px; margin:16px; font-size:14px; line-height:1.5;';
    banner.innerHTML = `⚠️ <strong>Không tải được dữ liệu.</strong><br>${e.message || 'Có lỗi xảy ra, vui lòng thử lại.'}<br><button onclick="location.reload()" style="margin-top:8px; padding:8px 16px; border-radius:8px; border:none; background:#d3352f; color:#fff; font-weight:600;">Tải lại trang</button>`;
    main.prepend(banner);
    throw e;
  }
}

async function bootParentShellInner(sessionData) {
  const phone = sessionData.session.user.phone || sessionData.session.user.user_metadata?.phone;
  let { data: parent } = await supabase.from('parent_accounts').select('*').eq('auth_user_id', sessionData.session.user.id).maybeSingle();

  if (!parent && phone) {
    // Nhân viên có thể đã tạo TRƯỚC hồ sơ phụ huynh này (chưa gắn auth_user_id,
    // ví dụ khi liên kết phụ huynh với học sinh trước khi phụ huynh dùng App
    // lần đầu) — gọi RPC để LIÊN KẾT an toàn vào hồ sơ có sẵn theo đúng SĐT
    // của phiên đăng nhập hiện tại (không update trực tiếp từ client vì RLS
    // sẽ chặn hồ sơ chưa có auth_user_id — xem claim_parent_account() ở DB).
    const { data: claimed } = await supabase.rpc('claim_parent_account').maybeSingle();
    // SUA LOI THAT: claim_parent_account() la ham SQL tra ve KIEU DONG
    // (composite type) - khi KHONG tim thay dong nao de nhan, no tra ve
    // 1 "dong" voi TAT CA field = null (vd {id:null, full_name:null,...}),
    // KHONG PHAI null hoan toan! `if (claimed)` truoc day luon dung vi
    // day van la 1 object hop le (chi la rong), khien code tuong nham la
    // "da tim thay ho so" va BO QUA luon buoc tao moi ben duoi — de lai
    // "parent.id" = null, gay loi 400 "eq.null" khi truy van sau nay.
    if (claimed?.id) parent = claimed;
  }

  if (!parent) {
    // Lần đầu xác thực OTP thành công, chưa có hồ sơ nào khớp SĐT — tự tạo
    // hồ sơ mới liên kết với auth_user_id này. SUA LOI THAT: truoc day mac
    // dinh thang "Phụ huynh" (chuoi chung chung) vi luong OTP KHONG HOI TEN
    // nhu luong dang ky bang mat khau — khien danh sach "Lien ket Vi" ben
    // ERP hien toan chu "Phụ huynh" giong het nhau, khong phan biet duoc
    // ai voi ai. Gio hoi ten that ngay luc tao tai khoan lan dau.
    let realName = sessionData.session.user.user_metadata?.full_name;
    if (!realName) {
      realName = window.prompt('Chào mừng bạn! Vui lòng nhập họ tên của bạn để hoàn tất đăng ký:', '')?.trim();
    }
    const { data: created, error } = await supabase.from('parent_accounts').insert({
      auth_user_id: sessionData.session.user.id,
      full_name: realName || 'Phụ huynh (chưa cập nhật tên)',
      phone: phone || 'unknown',
    }).select('*').single();
    if (error) { console.error('Không tạo được hồ sơ phụ huynh:', error.message); throw error; }
    parent = created;
  }

  if (!parent || !parent.id) {
    // Neu toi day ma van chua co "parent.id" hop le (vd do thieu GRANT
    // quyen bang, hoac insert bi RLS chan ngam khi doc lai) — bao loi ro
    // rang thay vi de cac buoc sau (truy van parent_student_links) chay
    // voi id=null, gay loi 400 kho hieu "eq.null" nhu truoc day.
    console.error('Không xác định được hồ sơ phụ huynh sau khi đăng ký/đăng nhập.', parent);
    throw new Error('Không tải được hồ sơ phụ huynh. Vui lòng thử đăng xuất và đăng nhập lại, hoặc báo quản trị hệ thống nếu lỗi lặp lại.');
  }

  // Tu dong lien ket voi TAT CA hoc sinh co SDT trung khop (khong can
  // phu huynh tu nhap Ho ten/Ngay sinh) - chay moi lan vao App nen cung
  // se bat duoc hoc sinh MOI duoc them SDT trung sau nay, khong chi luc
  // dang ky lan dau. Loi o day KHONG chan luong dang nhap (chi log), vi
  // day la tien ich cong them, khong phai buoc bat buoc de vao App.
  try {
    await supabase.rpc('auto_link_all_students_by_phone');
  } catch (e) {
    console.warn('Không tự động liên kết được học sinh theo SĐT:', e.message);
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
    window.location.href = '/index.html';
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