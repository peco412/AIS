// =====================================================================
// I18N — hệ thống đa ngôn ngữ Việt / Anh (đúng yêu cầu đề bài "có lựa
// chọn ngôn ngữ: Việt, Anh"). Thiết kế đơn giản, không phụ thuộc thư viện
// ngoài, dễ mở rộng dần từng trang.
//
// CÁCH DÙNG TRONG HTML TĨNH:
//   <h1 data-i18n="nav.dashboard">Trang chủ</h1>
//   <input data-i18n-placeholder="common.search" placeholder="Tìm kiếm..." />
//   <button data-i18n-title="common.logout" title="Đăng xuất">⎋</button>
// Nội dung tiếng Việt viết sẵn trong HTML đóng vai trò "giá trị mặc định"
// khi phần dịch cho key đó chưa có trong DICT bên dưới -> không bao giờ
// hiển thị trống hoặc hiện nguyên key.
//
// CÁCH DÙNG TRONG JS (chuỗi dựng động, ví dụ render bảng):
//   import { t } from '/js/i18n.js';
//   `<td>${t('common.edit')}</td>`
//
// Muốn thêm 1 trang vào bản dịch: thêm data-i18n="..." vào thẻ HTML tương
// ứng + thêm key đó vào DICT bên dưới với cả 2 ngôn ngữ.
// =====================================================================

const LANG_KEY = 'ais_lang';

const DICT = {
  // ---------- Điều hướng (sidebar) ----------
  'nav.dashboard': { vi: 'Trang chủ', en: 'Home' },
  'nav.notifications': { vi: 'Thông báo', en: 'Notifications' },
  'nav.directory': { vi: 'Thông tin liên lạc', en: 'Directory' },
  'nav.profile': { vi: 'Hồ sơ cá nhân', en: 'My profile' },
  'nav.meetings': { vi: 'Lịch họp', en: 'Meetings' },
  'nav.proposals': { vi: 'Đề xuất nội bộ', en: 'Internal proposals' },
  'nav.archive': { vi: 'Kho lưu trữ hệ thống', en: 'Document archive' },
  'nav.permissions': { vi: 'Xin thêm quyền hạn', en: 'Permission requests' },

  'nav.section.hr': { vi: 'Phòng nhân sự', en: 'Human Resources' },
  'nav.hr.employees': { vi: 'Danh sách nhân viên', en: 'Employee directory' },
  'nav.hr.positions': { vi: 'Quản lý chức vụ', en: 'Manage positions' },
  'nav.hr.leaveBalances': { vi: 'Ngày nghỉ / ngày phép', en: 'Leave balances' },
  'nav.hr.workSchedule': { vi: 'Phân lịch làm việc', en: 'Work schedule' },
  'nav.hr.contracts': { vi: 'Hợp đồng lao động', en: 'Labor contracts' },
  'nav.hr.leaveRequests': { vi: 'Đơn nghỉ phép', en: 'Leave requests' },
  'nav.hr.businessTrips': { vi: 'Đơn công tác', en: 'Business trips' },

  'nav.section.acc': { vi: 'Phòng kế toán', en: 'Accounting' },
  'nav.acc.paymentRequests': { vi: 'Phiếu đề nghị thanh toán', en: 'Payment requests' },
  'nav.acc.advanceRequests': { vi: 'Phiếu tạm ứng', en: 'Advance requests' },
  'nav.acc.reports': { vi: 'Báo cáo tài chính', en: 'Financial reports' },
  'nav.acc.payroll': { vi: 'Bảng lương', en: 'Payroll' },

  'nav.section.mkt': { vi: 'Phòng truyền thông', en: 'Marketing & Communications' },
  'nav.mkt.requests': { vi: 'Yêu cầu truyền thông', en: 'Communication requests' },
  'nav.mkt.eventProposals': { vi: 'Trình sự kiện', en: 'Event proposals' },
  'nav.mkt.expenseReports': { vi: 'Báo cáo chi phí', en: 'Expense reports' },
  'nav.mkt.accounts': { vi: 'Tài khoản nội bộ', en: 'Internal accounts' },

  'nav.section.fac': { vi: 'Phòng cơ sở vật chất', en: 'Facilities' },
  'nav.fac.requests': { vi: 'Yêu cầu CSVC', en: 'Facility requests' },
  'nav.fac.purchaseRequests': { vi: 'Phiếu đề nghị mua sắm', en: 'Purchase requests' },
  'nav.fac.stats': { vi: 'Thống kê', en: 'Statistics' },

  'nav.tasks': { vi: 'Phân việc', en: 'Task assignment' },
  'nav.sign': { vi: 'Ký số hồ sơ', en: 'Sign documents' },

  'nav.section.center': { vi: 'Quản lý trung tâm', en: 'Center management' },
  'nav.edu.overview': { vi: 'Tổng quan trung tâm', en: 'Center overview' },
  'nav.edu.attendance': { vi: 'Điểm danh & thống kê', en: 'Attendance & stats' },
  'nav.edu.tuition': { vi: 'Thu học phí', en: 'Tuition collection' },
  'nav.edu.dutySchedule': { vi: 'Phân lịch trực trung tâm', en: 'Center duty schedule' },
  'nav.edu.teacherSchedule': { vi: 'Phân lịch tuần giáo viên', en: 'Teacher weekly schedule' },
  'nav.edu.teachers': { vi: 'Danh sách giáo viên', en: 'Teacher directory' },
  'nav.edu.classes': { vi: 'Danh sách lớp', en: 'Classes' },
  'nav.edu.students': { vi: 'Danh sách học viên', en: 'Students' },
  'nav.edu.classAssignment': { vi: 'Phân lớp học viên', en: 'Class assignment' },
  'nav.edu.grades': { vi: 'Bảng điểm học viên', en: 'Student grades' },

  'nav.section.teacher': { vi: 'Giáo viên', en: 'Teachers' },
  'nav.teacher.schedule': { vi: 'Lịch giảng dạy', en: 'Teaching schedule' },
  'nav.teacher.classes': { vi: 'Lớp phụ trách', en: 'My classes' },
  'nav.teacher.attendance': { vi: 'Điểm danh', en: 'Attendance' },
  'nav.teacher.grades': { vi: 'Bảng điểm lớp học', en: 'Class grades' },

  'nav.section.consultant': { vi: 'Nhân viên tư vấn', en: 'Consultants' },
  'nav.consultant.leads': { vi: 'Hồ sơ khách hàng', en: 'Customer leads' },
  'nav.consultant.stats': { vi: 'Thống kê hồ sơ', en: 'Lead statistics' },

  'nav.section.exec': { vi: 'Ban điều hành', en: 'Executive board' },
  'nav.exec.reports': { vi: 'Báo cáo tổng hợp', en: 'Consolidated reports' },
  'nav.exec.broadcast': { vi: 'Ban hành thông báo', en: 'Broadcast notice' },
  'nav.exec.orders': { vi: 'Lệnh yêu cầu', en: 'Quick orders' },
  'nav.exec.archive': { vi: 'Kho lưu trữ điều hành', en: 'Executive archive' },

  // ---------- Từ dùng chung khắp nơi ----------
  'common.search': { vi: 'Tìm kiếm...', en: 'Search...' },
  'common.logout': { vi: 'Đăng xuất', en: 'Log out' },
  'common.save': { vi: 'Lưu', en: 'Save' },
  'common.cancel': { vi: 'Huỷ', en: 'Cancel' },
  'common.edit': { vi: 'Sửa', en: 'Edit' },
  'common.delete': { vi: 'Xoá', en: 'Delete' },
  'common.add': { vi: 'Thêm', en: 'Add' },
  'common.view': { vi: 'Xem', en: 'View' },
  'common.close': { vi: 'Đóng', en: 'Close' },
  'common.loading': { vi: 'Đang tải dữ liệu...', en: 'Loading...' },
  'common.saving': { vi: 'Đang lưu...', en: 'Saving...' },
  'common.noData': { vi: 'Không có dữ liệu.', en: 'No data.' },
  'common.status': { vi: 'Trạng thái', en: 'Status' },
  'common.date': { vi: 'Ngày', en: 'Date' },
  'common.name': { vi: 'Tên', en: 'Name' },
  'common.department': { vi: 'Phòng ban', en: 'Department' },
  'common.center': { vi: 'Trung tâm', en: 'Center' },
  'common.position': { vi: 'Chức vụ', en: 'Position' },
  'common.phone': { vi: 'Số điện thoại', en: 'Phone' },
  'common.email': { vi: 'Email', en: 'Email' },
  'common.all': { vi: 'Tất cả', en: 'All' },
  'common.approve': { vi: 'Duyệt', en: 'Approve' },
  'common.reject': { vi: 'Từ chối', en: 'Reject' },
  'common.submit': { vi: 'Gửi', en: 'Submit' },
  'common.note': { vi: 'Ghi chú', en: 'Note' },
  'common.error': { vi: 'Có lỗi xảy ra.', en: 'Something went wrong.' },

  // ---------- Nhãn trạng thái (badge) ----------
  'status.draft': { vi: 'Nháp', en: 'Draft' },
  'status.submitted': { vi: 'Đã gửi', en: 'Submitted' },
  'status.approved_1': { vi: 'Duyệt cấp 1', en: 'Approved (level 1)' },
  'status.approved_2': { vi: 'Đã duyệt', en: 'Approved' },
  'status.rejected': { vi: 'Từ chối', en: 'Rejected' },
  'status.archived': { vi: 'Lưu trữ', en: 'Archived' },
  'status.active': { vi: 'Đang làm việc', en: 'Active' },
  'status.inactive': { vi: 'Ngừng hoạt động', en: 'Inactive' },
  'status.pending': { vi: 'Chưa bắt đầu', en: 'Pending' },
  'status.in_progress': { vi: 'Đang xử lý', en: 'In progress' },
  'status.done': { vi: 'Hoàn thành', en: 'Done' },

  // ---------- Trang đăng nhập ----------
  'login.eyebrow': { vi: 'Hệ thống quản trị nội bộ', en: 'Internal management system' },
  'login.headline': { vi: 'Quản lý vận hành trung tâm, gọn trong một nơi.', en: 'Run your whole center from one place.' },
  'login.sub': { vi: 'Nhân sự, kế toán, học vụ và ban điều hành — cùng một hệ thống, đúng quyền, đúng người.', en: 'HR, accounting, academics and leadership — one system, the right access for everyone.' },
  'login.footer': { vi: '© 2026 ERP AIS — Nội bộ, không công khai', en: '© 2026 ERP AIS — Internal use only' },
  'login.title': { vi: 'Đăng nhập', en: 'Sign in' },
  'login.sub2': { vi: 'Nhập tên đăng nhập nội bộ để tiếp tục.', en: 'Enter your internal username to continue.' },
  'login.username': { vi: 'Tên đăng nhập', en: 'Username' },
  'login.password': { vi: 'Mật khẩu', en: 'Password' },
  'login.remember': { vi: 'Ghi nhớ đăng nhập', en: 'Remember me' },
  'login.forgot': { vi: 'Quên mật khẩu?', en: 'Forgot password?' },
  'login.submit': { vi: 'Đăng nhập', en: 'Sign in' },
  'login.submitting': { vi: 'Đang đăng nhập...', en: 'Signing in...' },
  'login.errFields': { vi: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.', en: 'Please enter both username and password.' },
  'login.errCreds': { vi: 'Sai tên đăng nhập hoặc mật khẩu. Vui lòng thử lại.', en: 'Incorrect username or password. Please try again.' },
  'login.errNoEmployee': { vi: 'Không tìm thấy hồ sơ nhân viên gắn với tài khoản này. Liên hệ phòng nhân sự.', en: 'No employee record found for this account. Please contact HR.' },
  'login.errInactive': { vi: 'Tài khoản của bạn hiện không ở trạng thái hoạt động.', en: 'Your account is not currently active.' },
  'login.errWrongDivision': { vi: 'Tài khoản này thuộc phân hệ khác. Vui lòng chọn đúng phân hệ (ALOHA/iLingo) trước khi đăng nhập.', en: 'This account belongs to a different division. Please select the correct division (ALOHA/iLingo) before signing in.' },
  'login.loaderMessage': { vi: 'Đang vào hệ thống...', en: 'Signing you in...' },
  'login.loaderChangePassword': { vi: 'Đang chuẩn bị đổi mật khẩu...', en: 'Preparing password change...' },

  // ---------- Dashboard ----------
  'dashboard.title': { vi: 'Trang chủ', en: 'Home' },
  'dashboard.apps': { vi: 'Phòng ban', en: 'Departments' },
  'dashboard.appsSub': { vi: 'Bấm vào 1 phòng ban để mở — ô mờ nghĩa là bạn chưa có quyền truy cập.', en: 'Tap a department to open it — greyed out tiles mean you don\'t have access.' },
  'dashboard.quickLinks': { vi: 'Truy cập nhanh', en: 'Quick access' },
  'dashboard.noAccess': { vi: 'Không có quyền', en: 'No access' },
  'dashboard.overview': { vi: 'Tổng quan', en: 'Overview' },
  'dashboard.welcome': { vi: 'Chào mừng quay lại hệ thống ERP AIS.', en: 'Welcome back to ERP AIS.' },
  'dashboard.statUnread': { vi: 'Thông báo chưa đọc', en: 'Unread notifications' },
  'dashboard.statLeave': { vi: 'Ngày phép còn lại', en: 'Leave days left' },
  'dashboard.statPending': { vi: 'Phiếu đang chờ duyệt', en: 'Pending approvals' },
  'dashboard.statMeetings': { vi: 'Cuộc họp sắp tới', en: 'Upcoming meetings' },
  'dashboard.birthday': { vi: 'Chúc mừng sinh nhật!', en: 'Happy Birthday!' },
  'dashboard.searchPlaceholder': { vi: 'Tìm nhân viên, phiếu, lớp học...', en: 'Search employees, forms, classes...' },
};

export function getLang() {
  return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'vi';
}

export function t(key, fallback) {
  const entry = DICT[key];
  const lang = getLang();
  if (!entry) return fallback ?? key;
  return entry[lang] || entry.vi || (fallback ?? key);
}

/**
 * Quét toàn bộ (hoặc 1 phần) DOM và áp dụng bản dịch cho các thẻ có
 * data-i18n / data-i18n-placeholder / data-i18n-title.
 */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n, el.textContent);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder, el.getAttribute('placeholder')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle, el.getAttribute('title')));
  });
  document.documentElement.setAttribute('lang', getLang());
}

/**
 * Đổi ngôn ngữ hiện tại, áp dụng lại toàn trang, và (nếu đã đăng nhập)
 * lưu lựa chọn vào employees.language_preference để lần đăng nhập sau
 * ở thiết bị khác cũng giữ đúng ngôn ngữ đã chọn.
 */
export async function setLang(lang, { persist = true, supabase = null, employeeId = null } = {}) {
  localStorage.setItem(LANG_KEY, lang);
  applyTranslations();
  document.dispatchEvent(new CustomEvent('ais:langchange', { detail: { lang } }));

  if (persist && supabase && employeeId) {
    try {
      await supabase.from('employees').update({ language_preference: lang }).eq('id', employeeId);
    } catch (e) {
      // Không chặn UI nếu lưu thất bại — ngôn ngữ vẫn áp dụng được ở phiên này
      console.warn('Không lưu được tuỳ chọn ngôn ngữ:', e.message);
    }
  }
}

/**
 * Gọi 1 lần lúc khởi tạo trang (sau khi biết employee.language_preference
 * từ DB, nếu có) để đồng bộ ngôn ngữ hiển thị đúng theo hồ sơ nhân viên,
 * tương tự cách shell.js đồng bộ màu phân hệ theo trung tâm thật.
 */
export function syncLangFromProfile(languagePreference) {
  if (languagePreference && (languagePreference === 'en' || languagePreference === 'vi')) {
    localStorage.setItem(LANG_KEY, languagePreference);
  }
  applyTranslations();
}
