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
// Dung CHINH XAC dac ta "Quyen mo rong - Chi Truong phong va Quan ly
// Trung tam" - KHONG tinh Pho phong (khac isDeptHeadOrAbove o tren dung
// rong hon cho cac cho khac).
function isHeadOnlyOrCenterManager(p) {
  return p.roleCode === 'DEPT_HEAD' || p.isCenterManager;
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
      { labelKey: 'nav.dashboard', label: 'Trang chủ', href: '/dashboard.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/></svg>', visible: () => true },
      { labelKey: 'nav.notifications', label: 'Thông báo', href: '/notifications.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 4 1.5 6 2 6.5H4c.5-.5 2-2.5 2-6.5z"/><path d="M9.5 18a2.5 2.5 0 0 0 5 0"/></svg>', visible: () => true },
    ],
  },
  {
    sectionKey: 'nav.section.personal', section: 'Chức năng cá nhân', layer: 'personal',
    alwaysShow: true, // LUÔN hiện đủ nhóm này ở mọi trang, không chỉ khi đang ở đúng trang trong nhóm
    items: [
      { labelKey: 'nav.directory', label: 'Thông tin liên lạc', href: '/directory.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 17c.3-2 1.5-3 3-3s2.7 1 3 3"/><path d="M14 9h4M14 13h4"/></svg>', visible: () => true },
      { labelKey: 'nav.profile', label: 'Hồ sơ cá nhân', href: '/profile.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>', visible: () => true },
      { labelKey: 'nav.myPayroll', label: 'Bảng lương của tôi', href: '/my-payroll.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v.01M18 15v.01"/></svg>', visible: () => true },
      { labelKey: 'nav.meetings', label: 'Lịch họp', href: '/meetings.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/></svg>', visible: () => true },
      { labelKey: 'nav.checkin', label: 'Chấm công vị trí', href: '/attendance-checkin.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>', visible: () => true },
      { labelKey: 'nav.hr.lateClockin', label: 'Đơn xin chấm công trễ', href: '/hr/late-clockin-requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>', visible: () => true },
      { labelKey: 'nav.acc.purchaseOrders', label: 'Phiếu mua hàng', href: '/acc/purchase-orders.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 2h12v19l-2-1-2 1-2-1-2 1-2-1-2 1V2z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>', visible: (p) => !p.isCenterManager },
      { labelKey: 'nav.proposals', label: 'Đề xuất nội bộ', href: '/proposals.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/></svg>', visible: () => true },
      { labelKey: 'nav.archive', label: 'Kho lưu trữ hệ thống', href: '/archive.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>', visible: () => true },
      { labelKey: 'nav.permissions', label: 'Xin thêm quyền hạn', href: '/permission-requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>', visible: (p) => isHeadOnlyOrCenterManager(p) },
    ],
  },
  {
    sectionKey: 'nav.section.hr', section: 'Phòng nhân sự', layer: 'office',
    items: [
      { labelKey: 'nav.hr.employees', label: 'Danh sách nhân viên', href: '/hr/employees.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>', visible: (p) => inDept(p, 'HR') },
      { labelKey: 'nav.hr.positions', label: 'Quản lý chức vụ', href: '/hr/positions.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V4h7l10 8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>', visible: (p) => inDept(p, 'HR') },
      { labelKey: 'nav.hr.leaveBalances', label: 'Ngày nghỉ / ngày phép', href: '/hr/leave-balances.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/></svg>', visible: (p) => inDept(p, 'HR') },
      { labelKey: 'nav.hr.workSchedule', label: 'Phân lịch làm việc', href: '/hr/work-schedule.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z"/><path d="M8 11h8M8 15h8"/></svg>', visible: (p) => inDept(p, 'HR') || p.isCenterManager },
      { labelKey: 'nav.hr.contracts', label: 'Hợp đồng lao động', href: '/hr/contracts.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>', visible: () => true },
      { labelKey: 'nav.hr.leaveRequests', label: 'Đơn nghỉ', href: '/hr/leave-requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M5 21c8 0 14-6 14-14V4h-3C8 4 5 10 5 18v3z"/><path d="M5 21c3-6 6-9 12-13"/></svg>', visible: () => true },
      { labelKey: 'nav.hr.baseSalary', label: 'Bảng lương cơ bản', href: '/hr/base-salary.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v.01M18 15v.01"/></svg>', visible: (p) => inDept(p, 'HR') || inDept(p, 'ACC') },
      { labelKey: 'nav.hr.businessTrips', label: 'Đơn công tác', href: '/hr/business-trips.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M2 13h20"/></svg>', visible: () => true },
      { labelKey: 'nav.tasks', label: 'Phân việc', href: '/hr/tasks.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>', visible: (p) => inDept(p, 'HR') },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/hr/sign.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3.5.5.5-3.5z"/><path d="M16 5l3 3"/></svg>', visible: (p) => (p.departmentCode === 'HR' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    sectionKey: 'nav.section.acc', section: 'Phòng kế toán', layer: 'office',
    items: [
      { labelKey: 'nav.acc.paymentRequests', label: 'Phiếu đề nghị thanh toán', href: '/acc/payment-requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>', visible: () => true },
      { labelKey: 'nav.acc.advanceRequests', label: 'Phiếu tạm ứng', href: '/acc/advance-requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v.01M18 15v.01"/></svg>', visible: () => true },
      { labelKey: 'nav.acc.reports', label: 'Báo cáo tài chính', href: '/acc/reports.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.discountPrograms', label: 'Chương trình ưu đãi học phí & nạp ví', href: '/acc/discount-programs.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M18 6L6 18"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.edu.refundRequests', label: 'Yêu cầu hoàn phí', href: '/edu/refund-requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.walletLinks', label: 'Danh sách liên kết Ví', href: '/acc/wallet-links.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z"/><path d="M8 11h8M8 15h8"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.walletRecovery', label: 'Khắc phục sự cố nạp ví', href: '/acc/wallet-recovery.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-3-3z"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.sepayTransactions', label: 'Nhật ký giao dịch SePay', href: '/acc/sepay-transactions.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 2h12v19l-2-1-2 1-2-1-2 1-2-1-2 1V2z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.generalLedger', label: 'Sổ cái kế toán', href: '/acc/general-ledger.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.periodClosing', label: 'Đối soát & Khoá sổ', href: '/acc/period-closing.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.commissions', label: 'Hoa hồng tư vấn viên', href: '/acc/commissions.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M2 13h20"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.budgetSetup', label: 'Thiết lập ngân sách', href: '/acc/budget-setup.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h13"/><circle cx="17" cy="6" r="1.5"/><circle cx="7" cy="18" r="1.5"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.attendancePayroll', label: 'Bảng kê chấm công', href: '/acc/attendance-payroll-report.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.acc.payroll', label: 'Bảng lương', href: '/acc/payroll.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 2h12v19l-2-1-2 1-2-1-2 1-2-1-2 1V2z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.tasks', label: 'Phân việc', href: '/acc/tasks.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>', visible: (p) => inDept(p, 'ACC') },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/acc/sign.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3.5.5.5-3.5z"/><path d="M16 5l3 3"/></svg>', visible: (p) => (p.departmentCode === 'ACC' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    sectionKey: 'nav.section.mkt', section: 'Phòng truyền thông', layer: 'office',
    items: [
      { labelKey: 'nav.mkt.requests', label: 'Yêu cầu truyền thông', href: '/mkt/requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 10v4h3l5 4V6l-5 4H3z"/><path d="M14 8a4 4 0 0 1 0 8"/><path d="M17 5a8 8 0 0 1 0 14"/></svg>', visible: () => true },
      { labelKey: 'nav.mkt.eventProposals', label: 'Trình sự kiện', href: '/mkt/event-proposals.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M5 3v18"/><path d="M5 4h13l-3 4 3 4H5"/></svg>', visible: (p) => inDept(p, 'MKT') || p.isCenterManager },
      { labelKey: 'nav.mkt.expenseReports', label: 'Báo cáo chi phí', href: '/mkt/expense-reports.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>', visible: (p) => inDept(p, 'MKT') || inDept(p, 'ACC') || isExecOrTech(p) },
      { labelKey: 'nav.mkt.accounts', label: 'Tài khoản nội bộ', href: '/mkt/accounts.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M16 7l3 3M13 10l2 2"/></svg>', visible: (p) => inDept(p, 'MKT') },
      { labelKey: 'nav.tasks', label: 'Phân việc', href: '/mkt/tasks.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>', visible: (p) => inDept(p, 'MKT') },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/mkt/sign.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3.5.5.5-3.5z"/><path d="M16 5l3 3"/></svg>', visible: (p) => (p.departmentCode === 'MKT' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    sectionKey: 'nav.section.fac', section: 'Phòng cơ sở vật chất', layer: 'office',
    items: [
      { labelKey: 'nav.fac.requests', label: 'Yêu cầu CSVC', href: '/fac/requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-3-3z"/></svg>', visible: () => true },
      { labelKey: 'nav.fac.purchaseRequests', label: 'Phiếu mua sắm / sửa chữa', href: '/fac/purchase-requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-3-3z"/></svg>', visible: () => true },
      { labelKey: 'nav.fac.stats', label: 'Thống kê tài sản tồn', href: '/fac/stats.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>', visible: (p) => inDept(p, 'FAC') },
      { labelKey: 'nav.tasks', label: 'Phân việc', href: '/fac/tasks.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>', visible: (p) => inDept(p, 'FAC') },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/fac/sign.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3.5.5.5-3.5z"/><path d="M16 5l3 3"/></svg>', visible: (p) => (p.departmentCode === 'FAC' && isDeptHeadOrAbove(p)) || isExecOrTech(p) },
    ],
  },
  {
    sectionKey: 'nav.section.center', section: 'Khối trung tâm', layer: 'centers',
    items: [
      // ========== Phần 1: Thu học phí ==========
      { subgroup: 'tuition', labelKey: 'nav.edu.generalInvoicing', label: 'Tạo hoá đơn chung', href: '/edu/general-invoicing.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z"/><path d="M8 11h8M8 15h8"/></svg>', visible: (p) => p.isCenterManager || p.roleCode === 'CONSULTANT' || inDept(p, 'ACC') },
      { subgroup: 'tuition', labelKey: 'nav.edu.walletInvoices', label: 'Thu học phí', href: '/edu/wallet-invoices.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>', visible: (p) => p.isCenterManager || p.roleCode === 'CONSULTANT' || inDept(p, 'ACC') },
      { subgroup: 'tuition', labelKey: 'nav.acc.walletTopupRequests', label: 'Xác nhận nạp ví', href: '/acc/wallet-topup-requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>', visible: (p) => p.isCenterManager },
      { subgroup: 'tuition', labelKey: 'nav.edu.walletPaymentLog', label: 'Thu học phí qua Ví (Log)', href: '/edu/wallet-payment-log.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 2h12v19l-2-1-2 1-2-1-2 1-2-1-2 1V2z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>', visible: (p) => p.isCenterManager || p.roleCode === 'CONSULTANT' || inDept(p, 'ACC') },
      { subgroup: 'tuition', labelKey: 'nav.edu.debtOverview', label: 'Công nợ học phí', href: '/edu/debt-overview.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M8 8h8M8 12h6"/></svg>', visible: (p) => p.isCenterManager || isExecOrTech(p) },
      { subgroup: 'tuition', labelKey: 'nav.edu.refundRequests', label: 'Yêu cầu hoàn phí', href: '/edu/refund-requests.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>', visible: (p) => p.isCenterManager || p.roleCode === 'CONSULTANT' || inDept(p, 'ACC') },
      { subgroup: 'tuition', labelKey: 'nav.edu.programPricing', label: 'Bảng giá chương trình học', href: '/edu/program-pricing.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V4h7l10 8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>', visible: (p) => p.isCenterManager || p.roleCode === 'CONSULTANT' || inDept(p, 'ACC') },
      // ========== Phần 2: Kho Trung tâm & Quản lý Chi phí vận hành ==========
      { subgroup: 'warehouse', labelKey: 'nav.edu.inventory', label: 'Kho trung tâm', href: '/edu/inventory.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>', visible: (p) => true },
      { subgroup: 'warehouse', labelKey: 'nav.edu.retailSale', label: 'Phiếu bán lẻ', href: '/edu/retail-sale.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 21V10l6 4v-4l6 4V8l6 4v9H3z"/><path d="M3 21h18"/></svg>', visible: (p) => true },
      { subgroup: 'warehouse', labelKey: 'nav.acc.purchaseOrders', label: 'Phiếu thanh toán chi phí (mua hàng)', href: '/acc/purchase-orders.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 2h12v19l-2-1-2 1-2-1-2 1-2-1-2 1V2z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>', visible: (p) => p.isCenterManager },
      // ========== Phần 3: Chức năng riêng từng vai trò ==========
      // -- Vai trò: Quản lý Trung tâm --
      { subgroup: 'role', labelKey: 'nav.edu.overview', label: 'Tổng quan trung tâm', href: '/edu/center-overview.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/></svg>', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { subgroup: 'role', labelKey: 'nav.edu.attendance', label: 'Điểm danh & thống kê', href: '/edu/attendance-overview.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>', visible: (p) => p.isCenterManager },
      { subgroup: 'role', labelKey: 'nav.acc.budgetSetup', label: 'Ngân sách trung tâm (xem)', href: '/acc/budget-setup.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h13"/><circle cx="17" cy="6" r="1.5"/><circle cx="7" cy="18" r="1.5"/></svg>', visible: (p) => p.isCenterManager },
      { subgroup: 'role', labelKey: 'nav.edu.dutySchedule', label: 'Phân lịch trực trung tâm', href: '/edu/duty-schedule.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { subgroup: 'role', labelKey: 'nav.edu.teacherSchedule', label: 'Phân lịch dạy giáo viên', href: '/edu/teacher-schedule.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/></svg>', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { subgroup: 'role', labelKey: 'nav.edu.classAssignment', label: 'Phân lớp học viên', href: '/edu/class-assignment.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h4l7 12h4"/><path d="M14 6h4l-2.5 3M18 18l-2.5-3"/><path d="M3 18h4l3-5"/></svg>', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { subgroup: 'role', labelKey: 'nav.edu.students', label: 'Quản lý danh sách học viên', href: '/edu/students.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/><circle cx="17.5" cy="9" r="2.8"/><path d="M16 14.3c2.7.4 4.5 2.1 4.5 4.7"/></svg>', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { subgroup: 'role', labelKey: 'nav.edu.parentLinks', label: 'Liên kết Phụ huynh — Học sinh', href: '/edu/parent-links.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1"/></svg>', visible: (p) => p.isCenterManager || inDept(p, 'ACC') || isExecOrTech(p) },
      { subgroup: 'role', labelKey: 'nav.edu.grades', label: 'Xem tổng kết bảng điểm', href: '/edu/grades.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { subgroup: 'role', labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/edu/sign.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3.5.5.5-3.5z"/><path d="M16 5l3 3"/></svg>', visible: (p) => p.isCenterManager || isExecOrTech(p) },
      { subgroup: 'role', labelKey: 'nav.edu.classes', label: 'Danh sách lớp', href: '/edu/classes.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V4h7l10 8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      { subgroup: 'role', labelKey: 'nav.edu.teachers', label: 'Danh sách giáo viên', href: '/edu/teachers.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 17c.3-2 1.5-3 3-3s2.7 1 3 3"/><path d="M14 9h4M14 13h4"/></svg>', visible: (p) => p.isCenterManager || inDept(p, 'HR') || inDept(p, 'MKT') },
      // -- Vai trò: Giáo viên --
      { subgroup: 'role', labelKey: 'nav.teacher.classes', label: 'Lớp phụ trách', href: '/teacher/classes.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V4h7l10 8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>', visible: (p) => p.isTeacher },
      { subgroup: 'role', labelKey: 'nav.teacher.attendance', label: 'Điểm danh học viên', href: '/teacher/attendance.html', icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>', visible: (p) => p.isTeacher },
      { subgroup: 'role', labelKey: 'nav.teacher.grades', label: 'Nhập bảng điểm lớp học', href: '/teacher/grades.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/></svg>', visible: (p) => p.isTeacher },
      { subgroup: 'role', labelKey: 'nav.teacher.trialStudents', label: 'Danh sách học thử theo lớp', href: '/teacher/trial-students.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c0 1.5 2.5 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/></svg>', visible: (p) => p.isTeacher },
      { subgroup: 'role', labelKey: 'nav.teacher.schedule', label: 'Lịch giảng dạy', href: '/teacher/schedule.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/></svg>', visible: (p) => p.isTeacher },
      // -- Vai trò: Nhân viên tư vấn --
      { subgroup: 'role', labelKey: 'nav.consultant.leads', label: 'Hồ sơ khách hàng', href: '/consultant/leads.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 17c.3-2 1.5-3 3-3s2.7 1 3 3"/><path d="M14 9h4M14 13h4"/></svg>', visible: (p) => p.roleCode === 'CONSULTANT' },
      { subgroup: 'role', labelKey: 'nav.acc.commissions', label: 'Hoa hồng của tôi', href: '/acc/commissions.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M2 13h20"/></svg>', visible: (p) => p.roleCode === 'CONSULTANT' },
      { subgroup: 'role', labelKey: 'nav.consultant.stats', label: 'Thống kê hồ sơ', href: '/consultant/stats.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>', visible: (p) => p.roleCode === 'CONSULTANT' },
      { subgroup: 'role', labelKey: 'nav.consultant.trialRegistration', label: 'Đăng ký học thử', href: '/consultant/trial-registration.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c0 1.5 2.5 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/></svg>', visible: (p) => p.roleCode === 'CONSULTANT' },
    ],
  },
  {
    sectionKey: 'nav.section.exec', section: 'Ban điều hành', layer: 'executive',
    items: [
      { labelKey: 'nav.exec.reports', label: 'Báo cáo tổng hợp', href: '/exec/reports.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>', visible: (p) => isExecOrTech(p) },
      { labelKey: 'nav.sign', label: 'Ký số hồ sơ', href: '/exec/sign.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3.5.5.5-3.5z"/><path d="M16 5l3 3"/></svg>', visible: (p) => isExecOrTech(p) },
      { labelKey: 'nav.exec.broadcast', label: 'Ban hành thông báo', href: '/exec/broadcast.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 10v4h3l5 4V6l-5 4H3z"/><path d="M14 8a4 4 0 0 1 0 8"/><path d="M17 5a8 8 0 0 1 0 14"/></svg>', visible: (p) => isHeadOnlyOrCenterManager(p) || isExecOrTech(p) },
      { labelKey: 'nav.exec.orders', label: 'Lệnh yêu cầu', href: '/exec/orders.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 5h14l2 7v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7l2-7z"/></svg>', visible: (p) => p.roleCode === 'EXECUTIVE' || p.roleCode === 'TECH' },
      { labelKey: 'nav.exec.archive', label: 'Kho lưu trữ điều hành', href: '/exec/archive.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>', visible: (p) => p.roleCode === 'EXECUTIVE' || p.roleCode === 'TECH' },
    ],
  },
  {
    // Phần 6 trong đặc tả — tách RIÊNG dữ liệu gốc/cấu hình nền tảng ra
    // khỏi các phòng ban nghiệp vụ để dễ vận hành, đúng ý người dùng.
    // Kỹ thuật được ghi (W/A), Ban điều hành chỉ xem (R) — đảo ngược so
    // với mọi mục khác trong hệ thống.
    sectionKey: 'nav.section.masterdata', section: 'Cấu hình dữ liệu gốc', layer: 'masterdata',
    items: [
      { labelKey: 'nav.md.centers', label: 'Trung tâm', href: '/master-data/centers.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) },
      { labelKey: 'nav.md.suppliers', label: 'Nhà cung cấp', href: '/acc/suppliers.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 21V10l6 4v-4l6 4V8l6 4v9H3z"/><path d="M3 21h18"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) || inDept(p, 'ACC') },
      { labelKey: 'nav.md.expenseCategories', label: 'Hạng mục chi', href: '/master-data/expense-categories.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) },
      { labelKey: 'nav.md.programPricing', label: 'Chương trình & Bảng giá khoá học', href: '/master-data/program-pricing.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V4h7l10 8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) || inDept(p, 'ACC') },
      { labelKey: 'nav.md.paymentPlanDiscounts', label: 'Chiết khấu hình thức đóng học phí', href: '/master-data/payment-plan-discounts.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) || inDept(p, 'ACC') },
      { labelKey: 'nav.md.bulkPaymentDiscounts', label: 'Chiết khấu combo / trọn cấp độ con', href: '/master-data/bulk-payment-discounts.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) || inDept(p, 'ACC') },
      { labelKey: 'nav.md.walletTierDiscounts', label: 'Chiết khấu ví (bậc theo số tiền nạp)', href: '/master-data/wallet-tier-discounts.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) || inDept(p, 'ACC') },
      { labelKey: 'nav.md.sizeChart', label: 'Bảng size theo chiều cao/cân nặng', href: '/master-data/size-chart.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h13"/><circle cx="17" cy="6" r="1.5"/><circle cx="7" cy="18" r="1.5"/></svg>', visible: (p) => ['TECH'].includes(p.roleCode) || inDept(p, 'ACC') || inDept(p, 'FAC') },
      { labelKey: 'nav.md.inventoryItems', label: 'Danh mục sản phẩm kho', href: '/master-data/inventory-items.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) },
      { labelKey: 'nav.md.chartOfAccounts', label: 'Hệ thống tài khoản kế toán', href: '/master-data/chart-of-accounts.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9 4v16"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) || inDept(p, 'ACC') },
      { labelKey: 'nav.md.departments', label: 'Phòng ban', href: '/master-data/departments.html', icon: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) },
      { labelKey: 'nav.md.systemRoles', label: 'Vai trò hệ thống', href: '/master-data/system-roles.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 2l3 6 7 1-5 5 1.5 7L12 18l-6.5 3L7 14 2 9l7-1z"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) },
      { labelKey: 'nav.md.divisions', label: 'Khối đào tạo', href: '/master-data/divisions.html', icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c0 1.5 2.5 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/></svg>', visible: (p) => ['TECH', 'EXECUTIVE'].includes(p.roleCode) },
    ],
  },
];
