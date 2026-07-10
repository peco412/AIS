// =====================================================================
// CẤU HÌNH MENU ĐIỀU HƯỚNG THEO VAI TRÒ / PHÒNG BAN
// visible(profile) trả về true/false để quyết định hiển thị mục đó.
// Đây CHỈ là điều hướng UI — quyền truy cập dữ liệu thật được bảo vệ
// bởi Row Level Security ở tầng database (xem 08_rls_policies.sql).
// profile = { roleCode, departmentCode, positionName, isCenterManager, isTeacher }
//
// labelKey/sectionKey trỏ tới key trong js/i18n.js — shell.js sẽ tự dịch
// sang VI/EN theo lựa chọn ngôn ngữ hiện tại. Trường "label"/"section"
// (tiếng Việt) chỉ dùng làm giá trị dự phòng nếu thiếu key trong DICT.
// =====================================================================

function isDeptHeadOrAbove(p) {
  return ['DEPT_HEAD', 'DEPT_DEPUTY', 'EXECUTIVE', 'TECH'].includes(p.roleCode);
}
function isExecOrTech(p) {
  return ['EXECUTIVE', 'TECH'].includes(p.roleCode);
}
function inDept(p, code) {
  return p.departmentCode === code || isExecOrTech(p);
}

export const NAV_CONFIG = [
  {
    section: null, layer: 'overview', // luôn hiển thị, không tiêu đề nhóm — đúng 2 mục "Bảng tổng quan" + "Thông báo"
    items: [
      { labelKey: 'nav.dashboard', label: 'Trang chủ', href: '/dashboard.html', icon: '⌂', visible: () => true },
      { labelKey: 'nav.notifications', label: 'Thông báo', href: '/notifications.html', icon: '🔔', visible: () => true },
    ],
  },
  {
    sectionKey: 'nav.section.personal', section: 'Chức năng cá nhân', layer: 'personal',
    alwaysShow: true, // LUÔN hiện đủ nhóm này ở mọi trang, không chỉ khi đang ở đúng trang trong nhóm
    items: [
      { labelKey: 'nav.directory', label: 'Thông tin liên lạc', href: '/directory.html', icon: '📇', visible: () => true },
      { labelKey: 'nav.profile', label: 'Hồ sơ cá nhân', href: '/profile.html', icon: '👤', visible: () => true },
      { labelKey: 'nav.meetings', label: 'Lịch họp', href: '/meetings.html', icon: '📅', visible: () => true },
      { labelKey: 'nav.checkin', label: 'Chấm công vị trí', href: '/attendance-checkin.html', icon: '📍', visible: () => true },
      { labelKey: 'nav.hr.lateClockin', label: 'Đơn xin chấm công trễ', href: '/hr/late-clockin-requests.html', icon: '⏰', visible: () => true },
      { labelKey: 'nav.acc.purchaseOrders', label: 'Phiếu mua hàng', href: '/acc/purchase-orders.html', icon: '🧾', visible: () => true },
      { labelKey: 'nav.proposals', label: 'Đề xuất nội bộ', href: '/proposals.html', icon: '📝', visible: () => true },
      { labelKey: 'nav.archive', label: 'Kho lưu trữ hệ thống', href: '/archive.html', icon: '🗂', visible: () => true },
      { labelKey: 'nav.permissions', label: 'Xin thêm quyền hạn', href: '/permission-requests.html', icon: '🔐', visible: (p) => ['DEPT_HEAD', 'DEPT_DEPUTY', 'EXECUTIVE', 'TECH'].includes(p.roleCode) },
    ],
  },
  {
    sectionKey: 'nav.section.hr', section: 'Phòng nhân sự', layer: 'office',
    items: [
      { labelKey: 'nav.hr.employees', label: 'Danh sách nhân viên', href: '/hr/employees.html', icon: '🧑‍💼', visible: (p) => inDept(p, 'HR') },
      { labelKey: 'nav.hr.positions', label: 'Quản lý chức vụ', href: '/hr/positions.html', icon: '🏷', visible: (p) => inDept(p, 'HR') },
      { labelKey: 'nav.hr.leaveBalances', label: 'Ngày nghỉ / ngày phép', href: '/hr/leave-balances.html', icon: '🗓', visible: (p) => inDept(p, 'HR') },
      { labelKey: 'nav.hr.workSchedule', label: 'Phân lịch làm việc', href: '/hr/work-schedule.html', icon: '📋', visible: (p) => inDept(p, 'HR') || p.isCenterManager },
      { labelKey: 'nav.hr.contracts', label: 'Hợp đồng lao động', href: '/hr/contracts.html', icon: '📄', visible: () => true },
      { labelKey: 'nav.hr.leaveRequests', label: 'Đơn nghỉ (Cán bộ)', href: '/hr/leave-requests.html', icon: '🌴', visible: (p) => !p.isTeacher },
      { labelKey: 'nav.hr.baseSalary', label: 'Bảng lương cơ bản', href: '/hr/base-salary.html', icon: '💰', visible: (p) => inDept(p, 'HR') || inDept(p, 'ACC') },
      { labelKey: 'nav.hr.businessTrips', label: 'Đơn công tác', href: '/hr/business-trips.html', icon: '🧳', visible: () => true },
      { labelKey: 'nav.tasks', label: 'Phân việc', href: '/hr/tasks.html', icon: '✅', visible: (p) => inDept(p, 'HR') },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/hr/sign.html', icon: '✍️', visible: (p) => (p.departmentCode === 'HR' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    sectionKey: 'nav.section.acc', section: 'Phòng kế toán', layer: 'office',
    items: [
      { labelKey: 'nav.acc.paymentRequests', label: 'Phiếu đề nghị thanh toán', href: '/acc/payment-requests.html', icon: '💳', visible: () => true },
      { labelKey: 'nav.acc.advanceRequests', label: 'Phiếu tạm ứng', href: '/acc/advance-requests.html', icon: '💵', visible: () => true },
      { labelKey: 'nav.acc.reports', label: 'Báo cáo tài chính', href: '/acc/reports.html', icon: '📊', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.discountPrograms', label: 'Hệ thống ưu đãi & Chiết khấu ví', href: '/acc/discount-programs.html', icon: '🎁', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.walletTopupRequests', label: 'Xác nhận nạp ví', href: '/acc/wallet-topup-requests.html', icon: '✅', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.edu.refundRequests', label: 'Yêu cầu hoàn phí', href: '/edu/refund-requests.html', icon: '↩️', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.walletLinks', label: 'Danh sách liên kết Ví', href: '/acc/wallet-links.html', icon: '📋', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.attendancePayroll', label: 'Bảng kê chấm công', href: '/acc/attendance-payroll-report.html', icon: '🕒', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.edu.parentLinks', label: 'Liên kết Phụ huynh', href: '/edu/parent-links.html', icon: '🔗', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.edu.walletInvoices', label: 'Thu học phí qua Ví', href: '/edu/wallet-invoices.html', icon: '💳', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.payroll', label: 'Bảng lương', href: '/acc/payroll.html', icon: '🧾', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.tasks', label: 'Phân việc', href: '/acc/tasks.html', icon: '✅', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/acc/sign.html', icon: '✍️', visible: (p) => (p.departmentCode === 'ACC' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    sectionKey: 'nav.section.mkt', section: 'Phòng truyền thông', layer: 'office',
    items: [
      { labelKey: 'nav.mkt.requests', label: 'Yêu cầu truyền thông', href: '/mkt/requests.html', icon: '📣', visible: () => true },
      { labelKey: 'nav.mkt.eventProposals', label: 'Trình sự kiện', href: '/mkt/event-proposals.html', icon: '🎪', visible: (p) => inDept(p, 'MKT') || p.isCenterManager },
      { labelKey: 'nav.mkt.expenseReports', label: 'Báo cáo chi phí', href: '/mkt/expense-reports.html', icon: '📈', visible: (p) => inDept(p, 'MKT') },
      { labelKey: 'nav.mkt.accounts', label: 'Tài khoản nội bộ', href: '/mkt/accounts.html', icon: '🔑', visible: (p) => inDept(p, 'MKT') },
      { labelKey: 'nav.tasks', label: 'Phân việc', href: '/mkt/tasks.html', icon: '✅', visible: (p) => inDept(p, 'MKT') },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/mkt/sign.html', icon: '✍️', visible: (p) => (p.departmentCode === 'MKT' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    sectionKey: 'nav.section.fac', section: 'Phòng cơ sở vật chất', layer: 'office',
    items: [
      { labelKey: 'nav.fac.requests', label: 'Yêu cầu CSVC', href: '/fac/requests.html', icon: '🛠', visible: () => true },
      { labelKey: 'nav.fac.purchaseRequests', label: 'Phiếu mua sắm / sửa chữa', href: '/fac/purchase-requests.html', icon: '🧰', visible: () => true },
      { labelKey: 'nav.fac.stats', label: 'Thống kê tài sản tồn', href: '/fac/stats.html', icon: '📊', visible: (p) => inDept(p, 'FAC') },
      { labelKey: 'nav.tasks', label: 'Phân việc', href: '/fac/tasks.html', icon: '✅', visible: (p) => inDept(p, 'FAC') },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/fac/sign.html', icon: '✍️', visible: (p) => (p.departmentCode === 'FAC' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    sectionKey: 'nav.section.center', section: 'Quản lý trung tâm', layer: 'centers',
    items: [
      { labelKey: 'nav.edu.overview', label: 'Tổng quan trung tâm', href: '/edu/center-overview.html', icon: '🏫', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { labelKey: 'nav.edu.attendance', label: 'Điểm danh & thống kê', href: '/edu/attendance-overview.html', icon: '✅', visible: (p) => p.isCenterManager },
      { labelKey: 'nav.edu.walletInvoices', label: 'Thu học phí', href: '/edu/wallet-invoices.html', icon: '💳', visible: (p) => p.isCenterManager || inDept(p, 'ACC') },
      { labelKey: 'nav.edu.programPricing', label: 'Bảng giá chương trình học', href: '/edu/program-pricing.html', icon: '🏷️', visible: (p) => p.isCenterManager || inDept(p, 'ACC') },
      { labelKey: 'nav.edu.inventory', label: 'Kho trung tâm', href: '/edu/inventory.html', icon: '📦', visible: (p) => true },
      { labelKey: 'nav.edu.refundRequests', label: 'Yêu cầu hoàn phí', href: '/edu/refund-requests.html', icon: '↩️', visible: (p) => p.isCenterManager || inDept(p, 'ACC') },
      { labelKey: 'nav.edu.debtOverview', label: 'Công nợ tổng hợp', href: '/edu/debt-overview.html', icon: '📒', visible: (p) => p.isCenterManager || isExecOrTech(p) },
      { labelKey: 'nav.edu.parentLinks', label: 'Liên kết Phụ huynh', href: '/edu/parent-links.html', icon: '🔗', visible: (p) => p.isCenterManager || inDept(p, 'ACC') },
      { labelKey: 'nav.acc.walletTopupRequests', label: 'Xác nhận nạp ví', href: '/acc/wallet-topup-requests.html', icon: '✅', visible: (p) => p.isCenterManager },
      { labelKey: 'nav.edu.dutySchedule', label: 'Phân lịch trực trung tâm', href: '/edu/duty-schedule.html', icon: '🕒', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { labelKey: 'nav.edu.teacherSchedule', label: 'Phân lịch tuần giáo viên', href: '/edu/teacher-schedule.html', icon: '📆', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { labelKey: 'nav.edu.teachers', label: 'Danh sách giáo viên', href: '/edu/teachers.html', icon: '🍎', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { labelKey: 'nav.edu.classes', label: 'Danh sách lớp', href: '/edu/classes.html', icon: '🏷', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { labelKey: 'nav.edu.students', label: 'Danh sách học viên', href: '/edu/students.html', icon: '🎒', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { labelKey: 'nav.edu.classAssignment', label: 'Phân lớp học viên', href: '/edu/class-assignment.html', icon: '🔀', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { labelKey: 'nav.edu.grades', label: 'Bảng điểm học viên', href: '/edu/grades.html', icon: '📈', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { labelKey: 'nav.hr.leaveRequests', label: 'Đơn nghỉ (Cán bộ và Giáo viên)', href: '/hr/leave-requests.html', icon: '🌴', visible: (p) => p.isCenterManager },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/edu/sign.html', icon: '✍️', visible: (p) => p.isCenterManager || isExecOrTech(p) },
    ],
  },
  {
    sectionKey: 'nav.section.teacher', section: 'Giáo viên', layer: 'centers',
    items: [
      { labelKey: 'nav.teacher.schedule', label: 'Lịch giảng dạy', href: '/teacher/schedule.html', icon: '📆', visible: (p) => p.isTeacher },
      { labelKey: 'nav.teacher.classes', label: 'Lớp phụ trách', href: '/teacher/classes.html', icon: '🏷', visible: (p) => p.isTeacher },
      { labelKey: 'nav.teacher.attendance', label: 'Điểm danh', href: '/teacher/attendance.html', icon: '✔️', visible: (p) => p.isTeacher },
      { labelKey: 'nav.teacher.grades', label: 'Bảng điểm lớp học', href: '/teacher/grades.html', icon: '📝', visible: (p) => p.isTeacher },
      { labelKey: 'nav.teacher.trialStudents', label: 'Danh sách học thử', href: '/teacher/trial-students.html', icon: '🎓', visible: (p) => p.isTeacher },
      { labelKey: 'nav.hr.leaveRequests', label: 'Đơn nghỉ', href: '/hr/leave-requests.html', icon: '🌴', visible: (p) => p.isTeacher },
    ],
  },
  {
    sectionKey: 'nav.section.consultant', section: 'Nhân viên tư vấn', layer: 'centers',
    items: [
      { labelKey: 'nav.consultant.leads', label: 'Hồ sơ khách hàng', href: '/consultant/leads.html', icon: '📇', visible: (p) => p.roleCode === 'CONSULTANT' },
      { labelKey: 'nav.consultant.trialRegistration', label: 'Đăng ký học thử', href: '/consultant/trial-registration.html', icon: '🎓', visible: (p) => p.roleCode === 'CONSULTANT' },
      { labelKey: 'nav.edu.walletInvoices', label: 'Thu học phí', href: '/edu/wallet-invoices.html', icon: '💳', visible: (p) => p.roleCode === 'CONSULTANT' },
      { labelKey: 'nav.edu.programPricing', label: 'Bảng giá chương trình học', href: '/edu/program-pricing.html', icon: '🏷️', visible: (p) => p.roleCode === 'CONSULTANT' },
      { labelKey: 'nav.edu.refundRequests', label: 'Yêu cầu hoàn phí', href: '/edu/refund-requests.html', icon: '↩️', visible: (p) => p.roleCode === 'CONSULTANT' },
      { labelKey: 'nav.consultant.stats', label: 'Thống kê hồ sơ', href: '/consultant/stats.html', icon: '📊', visible: (p) => p.roleCode === 'CONSULTANT' },
      { labelKey: 'nav.hr.leaveRequests', label: 'Đơn nghỉ (Cán bộ)', href: '/hr/leave-requests.html', icon: '🌴', visible: (p) => p.roleCode === 'CONSULTANT' },
    ],
  },
  {
    sectionKey: 'nav.section.exec', section: 'Ban điều hành', layer: 'executive',
    items: [
      { labelKey: 'nav.exec.reports', label: 'Báo cáo tổng hợp', href: '/exec/reports.html', icon: '📊', visible: (p) => isExecOrTech(p) },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/exec/sign.html', icon: '✍️', visible: (p) => isExecOrTech(p) },
      { labelKey: 'nav.exec.broadcast', label: 'Ban hành thông báo', href: '/exec/broadcast.html', icon: '📢', visible: (p) => isDeptHeadOrAbove(p) },
      { labelKey: 'nav.exec.orders', label: 'Lệnh yêu cầu', href: '/exec/orders.html', icon: '📮', visible: (p) => p.roleCode === 'EXECUTIVE' || p.roleCode === 'TECH' },
      { labelKey: 'nav.exec.archive', label: 'Kho lưu trữ điều hành', href: '/exec/archive.html', icon: '🗄', visible: (p) => p.roleCode === 'EXECUTIVE' || p.roleCode === 'TECH' },
    ],
  },
  {
    // Phần 6 trong đặc tả — tách RIÊNG dữ liệu gốc/cấu hình nền tảng ra
    // khỏi các phòng ban nghiệp vụ để dễ vận hành, đúng ý người dùng.
    // Kỹ thuật được ghi (W/A), Ban điều hành chỉ xem (R) — đảo ngược so
    // với mọi mục khác trong hệ thống.
    sectionKey: 'nav.section.masterdata', section: 'Cấu hình dữ liệu gốc', layer: 'masterdata',
    items: [
      { labelKey: 'nav.md.centers', label: 'Trung tâm', href: '/master-data/centers.html', icon: '🏫', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) },
      { labelKey: 'nav.md.suppliers', label: 'Nhà cung cấp', href: '/acc/suppliers.html', icon: '🏭', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) || inDept(p, 'ACC') },
      { labelKey: 'nav.md.expenseCategories', label: 'Hạng mục chi', href: '/master-data/expense-categories.html', icon: '🗂️', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) },
      { labelKey: 'nav.md.programPricing', label: 'Chương trình & Bảng giá khoá học', href: '/edu/program-pricing.html', icon: '🏷️', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) || inDept(p, 'ACC') },
      { labelKey: 'nav.md.inventoryItems', label: 'Danh mục sản phẩm kho', href: '/edu/inventory.html', icon: '📦', visible: (p) => p.roleCode === 'TECH' },
    ],
  },
];
