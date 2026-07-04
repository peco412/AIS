// =====================================================================
// CẤU HÌNH MENU ĐIỀU HƯỚNG THEO VAI TRÒ / PHÒNG BAN
// visible(profile) trả về true/false để quyết định hiển thị mục đó.
// Đây CHỈ là điều hướng UI — quyền truy cập dữ liệu thật được bảo vệ
// bởi Row Level Security ở tầng database (xem 08_rls_policies.sql).
// profile = { roleCode, departmentCode, positionName, isCenterManager, isTeacher }
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
    section: null, // luôn hiển thị, không tiêu đề nhóm
    items: [
      { label: 'Trang chủ', href: '/dashboard.html', icon: '⌂', visible: () => true },
      { label: 'Thông báo', href: '/notifications.html', icon: '🔔', visible: () => true },
      { label: 'Hồ sơ cá nhân', href: '/profile.html', icon: '👤', visible: () => true },
      { label: 'Lịch họp', href: '/meetings.html', icon: '📅', visible: () => true },
      { label: 'Đề xuất nội bộ', href: '/proposals.html', icon: '📝', visible: () => true },
      { label: 'Kho lưu trữ hệ thống', href: '/archive.html', icon: '🗂', visible: () => true },
    ],
  },
  {
    section: 'Phòng nhân sự',
    items: [
      { label: 'Danh sách nhân viên', href: '/hr/employees.html', icon: '🧑‍💼', visible: (p) => inDept(p, 'HR') },
      { label: 'Quản lý chức vụ', href: '/hr/positions.html', icon: '🏷', visible: (p) => inDept(p, 'HR') },
      { label: 'Ngày nghỉ / ngày phép', href: '/hr/leave-balances.html', icon: '🗓', visible: (p) => inDept(p, 'HR') },
      { label: 'Phân lịch làm việc', href: '/hr/work-schedule.html', icon: '📋', visible: (p) => inDept(p, 'HR') || p.isCenterManager },
      { label: 'Hợp đồng lao động', href: '/hr/contracts.html', icon: '📄', visible: () => true },
      { label: 'Đơn nghỉ phép', href: '/hr/leave-requests.html', icon: '🌴', visible: () => true },
      { label: 'Đơn công tác', href: '/hr/business-trips.html', icon: '🧳', visible: () => true },
      { label: 'Ký số hồ sơ', href: '/hr/sign.html', icon: '✍️', visible: (p) => (p.departmentCode === 'HR' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    section: 'Phòng kế toán',
    items: [
      { label: 'Phiếu đề nghị thanh toán', href: '/acc/payment-requests.html', icon: '💳', visible: () => true },
      { label: 'Phiếu tạm ứng', href: '/acc/advance-requests.html', icon: '💵', visible: () => true },
      { label: 'Báo cáo tài chính', href: '/acc/reports.html', icon: '📊', visible: (p) => inDept(p, 'ACC') },
      { label: 'Bảng lương', href: '/acc/payroll.html', icon: '🧾', visible: (p) => inDept(p, 'ACC') },
      { label: 'Phân việc', href: '/acc/tasks.html', icon: '✅', visible: (p) => inDept(p, 'ACC') },
      { label: 'Ký số hồ sơ', href: '/acc/sign.html', icon: '✍️', visible: (p) => (p.departmentCode === 'ACC' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    section: 'Phòng truyền thông',
    items: [
      { label: 'Yêu cầu truyền thông', href: '/mkt/requests.html', icon: '📣', visible: () => true },
      { label: 'Trình sự kiện', href: '/mkt/event-proposals.html', icon: '🎪', visible: (p) => inDept(p, 'MKT') || p.isCenterManager },
      { label: 'Báo cáo chi phí', href: '/mkt/expense-reports.html', icon: '📈', visible: (p) => inDept(p, 'MKT') },
      { label: 'Tài khoản nội bộ', href: '/mkt/accounts.html', icon: '🔑', visible: (p) => inDept(p, 'MKT') },
      { label: 'Phân việc', href: '/mkt/tasks.html', icon: '✅', visible: (p) => inDept(p, 'MKT') },
      { label: 'Ký số hồ sơ', href: '/mkt/sign.html', icon: '✍️', visible: (p) => (p.departmentCode === 'MKT' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    section: 'Phòng cơ sở vật chất',
    items: [
      { label: 'Yêu cầu CSVC', href: '/fac/requests.html', icon: '🛠', visible: () => true },
      { label: 'Phiếu đề nghị mua sắm', href: '/fac/purchase-requests.html', icon: '🧰', visible: () => true },
      { label: 'Thống kê', href: '/fac/stats.html', icon: '📊', visible: (p) => inDept(p, 'FAC') },
      { label: 'Phân việc', href: '/fac/tasks.html', icon: '✅', visible: (p) => inDept(p, 'FAC') },
      { label: 'Ký số hồ sơ', href: '/fac/sign.html', icon: '✍️', visible: (p) => (p.departmentCode === 'FAC' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    section: 'Quản lý trung tâm',
    items: [
      { label: 'Tổng quan trung tâm', href: '/edu/center-overview.html', icon: '🏫', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { label: 'Phân lịch trực trung tâm', href: '/edu/duty-schedule.html', icon: '🕒', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { label: 'Phân lịch tuần giáo viên', href: '/edu/teacher-schedule.html', icon: '📆', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { label: 'Danh sách giáo viên', href: '/edu/teachers.html', icon: '🍎', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { label: 'Danh sách lớp', href: '/edu/classes.html', icon: '🏷', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { label: 'Danh sách học viên', href: '/edu/students.html', icon: '🎒', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { label: 'Phân lớp học viên', href: '/edu/class-assignment.html', icon: '🔀', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { label: 'Bảng điểm học viên', href: '/edu/grades.html', icon: '📈', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
    ],
  },
  {
    section: 'Giáo viên',
    items: [
      { label: 'Lịch giảng dạy', href: '/teacher/schedule.html', icon: '📆', visible: (p) => p.isTeacher },
      { label: 'Lớp phụ trách', href: '/teacher/classes.html', icon: '🏷', visible: (p) => p.isTeacher },
      { label: 'Điểm danh', href: '/teacher/attendance.html', icon: '✔️', visible: (p) => p.isTeacher },
      { label: 'Bảng điểm lớp học', href: '/teacher/grades.html', icon: '📝', visible: (p) => p.isTeacher },
    ],
  },
  {
    section: 'Nhân viên tư vấn',
    items: [
      { label: 'Hồ sơ khách hàng', href: '/consultant/leads.html', icon: '📇', visible: (p) => p.roleCode === 'CONSULTANT' },
      { label: 'Thống kê hồ sơ', href: '/consultant/stats.html', icon: '📊', visible: (p) => p.roleCode === 'CONSULTANT' },
    ],
  },
  {
    section: 'Ban điều hành',
    items: [
      { label: 'Ký số hồ sơ', href: '/exec/sign.html', icon: '✍️', visible: (p) => isExecOrTech(p) },
      { label: 'Ban hành thông báo', href: '/exec/broadcast.html', icon: '📢', visible: (p) => isDeptHeadOrAbove(p) },
      { label: 'Lệnh yêu cầu', href: '/exec/orders.html', icon: '📮', visible: (p) => p.roleCode === 'EXECUTIVE' || p.roleCode === 'TECH' },
      { label: 'Kho lưu trữ điều hành', href: '/exec/archive.html', icon: '🗄', visible: (p) => p.roleCode === 'EXECUTIVE' || p.roleCode === 'TECH' },
    ],
  },
];
