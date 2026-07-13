// =====================================================================
// SUPABASE CLIENT — cấu hình dùng chung toàn ứng dụng
// =====================================================================
// QUAN TRỌNG: đây là anon/public key, được phép public trên frontend
// (bảo mật thật sự nằm ở Row Level Security trong Postgres, xem file
// 08_rls_policies.sql). KHÔNG bao giờ đặt service_role key ở đây.
//
// Khi deploy thật, thay 2 giá trị dưới bằng Project URL / anon key
// lấy từ Supabase Dashboard → Settings → API. Nên inject qua biến môi
// trường lúc build (Vercel) thay vì hard-code trực tiếp trong repo công khai.
// =====================================================================

const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || 'https://iikflzntcpqliuxrzvdz.supabase.co';
const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY || 'sb_publishable_LS0uVPYtiWQeS6o0HeaClA_ygGjI8oM';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Quy ước: tên đăng nhập nội bộ (VMTDTP) được map sang email giả để dùng
// Supabase Auth (yêu cầu email). Domain nội bộ cố định, không phải email thật.
export const USERNAME_DOMAIN = '@ais.local';

export function usernameToEmail(username) {
  return username.trim().toLowerCase().replace(/\s+/g, '') + USERNAME_DOMAIN;
}

export function emailToUsername(email) {
  return (email || '').split('@')[0].toUpperCase();
}

// ---------------------------------------------------------------------
// Chống XSS lưu trữ: PHẢI dùng hàm này mỗi khi nội suy dữ liệu do người
// dùng nhập (họ tên, tiêu đề, nội dung, ghi chú...) vào chuỗi gán cho
// innerHTML. Không dùng cho dữ liệu đã biết chắc là do hệ thống sinh ra
// (id, ngày tháng đã format...).
// ---------------------------------------------------------------------
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------
// STORAGE PRIVATE: bucket "attachments" đã chuyển sang Private (xem
// supabase_migrations_13_private_storage.sql). Từ nay LƯU ĐƯỜNG DẪN
// (path) vào các cột *_url trong DB, KHÔNG lưu public URL — vì bucket
// private không còn public URL cố định. Khi cần hiển thị/tải file,
// luôn xin 1 signed URL có hạn (mặc định 5 phút) ngay lúc người dùng bấm
// xem, không lưu signed URL vào DB vì nó sẽ hết hạn.
// ---------------------------------------------------------------------
export async function uploadPrivateFile(path, file, options = {}) {
  const { error } = await supabase.storage.from('attachments').upload(path, file, options);
  if (error) throw error;
  return path;
}

export async function resolveFileUrl(stored, expiresInSeconds = 300) {
  if (!stored) return null;
  // Tương thích ngược: dữ liệu cũ (trước khi chuyển private) đã lưu sẵn public URL đầy đủ
  if (/^https?:\/\//i.test(stored)) return stored;
  const { data, error } = await supabase.storage.from('attachments').createSignedUrl(stored, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function openFile(stored) {
  try {
    const url = await resolveFileUrl(stored);
    if (url) window.open(url, '_blank', 'noopener');
    else alert('File không tồn tại.');
  } catch (e) {
    alert('Không thể mở file: ' + (e.message || 'Có lỗi xảy ra.'));
  }
}

// ---------------------------------------------------------------------
// Gọi Edge Function "send-push" để gửi thông báo đẩy thật ngay sau khi
// tạo 1 dòng thông báo trong bảng "notifications". Không chặn luồng
// chính nếu gửi push thất bại (chỉ log cảnh báo) — bản thân thông báo
// trong app vẫn đã được lưu thành công dù push có gửi được hay không.
// ---------------------------------------------------------------------
export async function triggerPush(notification) {
  try {
    await supabase.functions.invoke('send-push', {
      body: {
        scope: notification.scope,
        center_id: notification.center_id || null,
        department_id: notification.department_id || null,
        target_employee_id: notification.target_employee_id || null,
        title: notification.title,
        content: notification.content || '',
        url: notification.link_url || notification.url || '/notifications.html',
      },
    });
  } catch (e) {
    console.warn('Không gửi được thông báo đẩy:', e.message);
  }
}

// ---------------------------------------------------------------------
// Báo cho ĐÚNG trưởng/phó phòng (không phải cả phòng ban) mỗi khi có 1
// yêu cầu/phiếu mới cần họ vào "Phân việc" giao cho nhân sự xử lý — đây
// là mắt xích trước đây bị thiếu: tạo phiếu xong không ai được báo, nên
// trưởng phòng không biết có việc mới để phân công.
// ---------------------------------------------------------------------
// SUA LOI NGHIEM TRONG: truoc day insert SAI cot "url" (khong ton tai
// tren bang notifications) va THIEU cot bat buoc "created_by" - loi bi
// nuot am tham qua try/catch, khien Truong phong 9 luong nghiep vu khac
// nhau KHONG BAO GIO nhan duoc thong bao tu truoc gio. Them tham so
// p_created_by (bat buoc — nguoi tao ra hanh dong kich hoat thong bao
// nay, dung PROFILE.id tai noi goi).
export async function notifyDepartmentHeads(deptCode, title, content, linkUrl, createdBy) {
  try {
    if (!createdBy) { console.warn('notifyDepartmentHeads: thiếu createdBy, không gửi được thông báo (cột created_by bắt buộc).'); return; }
    const { data: dept } = await supabase.from('departments').select('id').eq('code', deptCode).single();
    if (!dept) return;
    const { data: heads } = await supabase
      .from('employees')
      .select('id, system_roles(code)')
      .eq('department_id', dept.id);

    const headIds = (heads || [])
      .filter((e) => ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(e.system_roles?.code))
      .map((e) => e.id);

    for (const employeeId of headIds) {
      const notif = { scope: 'personal', target_employee_id: employeeId, title, content, link_url: linkUrl, created_by: createdBy };
      await supabase.from('notifications').insert(notif);
      triggerPush(notif);
    }
  } catch (e) {
    console.warn('Không gửi được thông báo cho trưởng phòng:', e.message);
  }
}
