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
