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
  'nav.myPayroll': { vi: 'Bảng lương của tôi', en: 'My payslip' },
  'nav.meetings': { vi: 'Lịch họp', en: 'Meetings' },
  'nav.checkin': { vi: 'Chấm công vị trí', en: 'Location check-in' },
  'nav.layer.overview': { vi: 'Thông Báo & Tổng Quan', en: 'Notifications & Overview' },
  'nav.layer.executive': { vi: 'Ban Điều Hành', en: 'Executive Board' },
  'nav.layer.office': { vi: 'Khối Văn Phòng', en: 'Office Block' },
  'nav.layer.centers': { vi: 'Khối Trung Tâm', en: 'Centers System' },
  'nav.layer.masterdata': { vi: 'Cấu Hình Dữ Liệu Gốc', en: 'Master Data' },
  'nav.layer.personal': { vi: 'Tiện Ích Cá Nhân', en: 'Personal Utilities' },
  'nav.section.masterdata': { vi: 'Cấu hình dữ liệu gốc', en: 'Master Data' },
  'nav.md.centers': { vi: 'Trung tâm', en: 'Centers' },
  'nav.md.suppliers': { vi: 'Nhà cung cấp', en: 'Suppliers' },
  'nav.md.expenseCategories': { vi: 'Hạng mục chi', en: 'Expense categories' },
  'nav.md.programPricing': { vi: 'Chương trình & Bảng giá khoá học', en: 'Programs & course pricing' },
  'nav.md.paymentPlanDiscounts': { vi: 'Chiết khấu hình thức đóng học phí', en: 'Payment plan discounts' },
  'nav.md.walletTierDiscounts': { vi: 'Chiết khấu ví (bậc theo số tiền nạp)', en: 'Wallet tier discounts' },
  'nav.md.sizeChart': { vi: 'Bảng size theo chiều cao/cân nặng', en: 'Size chart' },
  'nav.md.inventoryItems': { vi: 'Danh mục sản phẩm kho', en: 'Inventory product catalog' },
  'nav.md.programPlanDiscounts': { vi: 'Ưu đãi & Hình thức theo chương trình', en: 'Program discounts & payment plans' },
  'nav.md.chartOfAccounts': { vi: 'Hệ thống tài khoản kế toán', en: 'Chart of accounts' },
  'nav.md.departments': { vi: 'Phòng ban', en: 'Departments' },
  'nav.md.systemRoles': { vi: 'Vai trò hệ thống', en: 'System roles' },
  'nav.md.divisions': { vi: 'Khối đào tạo', en: 'Training divisions' },
  'nav.section.personal': { vi: 'Chức năng cá nhân', en: 'Personal functions' },
  'nav.hr.lateClockin': { vi: 'Đơn xin chấm công trễ', en: 'Late clock-in request' },
  'nav.hr.baseSalary': { vi: 'Bảng lương cơ bản', en: 'Base salary config' },
  'nav.proposals': { vi: 'Đề xuất nội bộ', en: 'Internal proposals' },
  'nav.archive': { vi: 'Kho lưu trữ hệ thống', en: 'Document archive' },
  'nav.permissions': { vi: 'Xin thêm quyền hạn', en: 'Permission requests' },

  'nav.section.hr': { vi: 'Phòng nhân sự', en: 'Human Resources' },
  'nav.hr.employees': { vi: 'Danh sách nhân viên', en: 'Employee directory' },
  'nav.hr.positions': { vi: 'Quản lý chức vụ', en: 'Manage positions' },
  'nav.hr.leaveBalances': { vi: 'Ngày nghỉ / ngày phép', en: 'Leave balances' },
  'nav.hr.workSchedule': { vi: 'Phân lịch làm việc', en: 'Work schedule' },
  'nav.hr.contracts': { vi: 'Hợp đồng lao động', en: 'Labor contracts' },
  'nav.hr.leaveRequests': { vi: 'Đơn nghỉ (Cán bộ)', en: 'Leave requests (Staff)' },
  'nav.teacher.leaveRequests': { vi: 'Đơn nghỉ (Giáo viên)', en: 'Leave requests (Teachers)' },
  'nav.teacher.leaveRequestsApprove': { vi: 'Duyệt đơn nghỉ giáo viên', en: 'Approve teacher leave' },
  'nav.hr.businessTrips': { vi: 'Đơn công tác', en: 'Business trips' },

  'nav.section.acc': { vi: 'Phòng kế toán', en: 'Accounting' },
  'nav.acc.paymentRequests': { vi: 'Phiếu đề nghị thanh toán', en: 'Payment requests' },
  'nav.acc.advanceRequests': { vi: 'Phiếu tạm ứng', en: 'Advance requests' },
  'nav.acc.reports': { vi: 'Báo cáo tài chính', en: 'Financial reports' },
  'nav.acc.discountPrograms': { vi: 'Chương trình ưu đãi học phí & nạp ví', en: 'Tuition & wallet discount programs' },
  'nav.acc.walletTopupRequests': { vi: 'Xác nhận nạp ví', en: 'Confirm wallet top-ups' },
  'nav.edu.refundRequests': { vi: 'Yêu cầu hoàn phí', en: 'Refund requests' },
  'nav.acc.walletLinks': { vi: 'Danh sách liên kết Ví', en: 'Wallet links list' },
  'nav.acc.walletRecovery': { vi: 'Khắc phục sự cố nạp ví', en: 'Wallet topup recovery' },
  'nav.acc.sepayTransactions': { vi: 'Nhật ký giao dịch SePay', en: 'SePay transaction log' },
  'nav.acc.generalLedger': { vi: 'Sổ cái kế toán', en: 'General ledger' },
  'nav.acc.periodClosing': { vi: 'Đối soát & Khoá sổ', en: 'Reconciliation & closing' },
  'nav.acc.commissions': { vi: 'Hoa hồng tư vấn viên', en: 'Consultant commissions' },
  'nav.acc.budgetSetup': { vi: 'Thiết lập ngân sách', en: 'Budget setup' },
  'nav.acc.suppliers': { vi: 'Nhà cung cấp', en: 'Suppliers' },
  'nav.acc.purchaseOrders': { vi: 'Phiếu mua hàng', en: 'Purchase orders' },
  'nav.edu.programPricing': { vi: 'Bảng giá chương trình học', en: 'Program pricing' },
  'nav.edu.inventory': { vi: 'Kho trung tâm', en: 'Center inventory' },
  'nav.acc.attendancePayroll': { vi: 'Bảng kê chấm công', en: 'Attendance payroll report' },
  'nav.acc.payroll': { vi: 'Bảng lương', en: 'Payroll' },

  'nav.section.mkt': { vi: 'Phòng truyền thông', en: 'Marketing & Communications' },
  'nav.mkt.requests': { vi: 'Yêu cầu truyền thông', en: 'Communication requests' },
  'nav.mkt.eventProposals': { vi: 'Trình sự kiện', en: 'Event proposals' },
  'nav.mkt.expenseReports': { vi: 'Báo cáo chi phí', en: 'Expense reports' },
  'nav.mkt.accounts': { vi: 'Tài khoản nội bộ', en: 'Internal accounts' },
  'nav.mkt.parentAnnouncements': { vi: 'Thông báo cho Phụ huynh', en: 'Parent announcements' },
  'nav.mkt.extracurricular': { vi: 'Chương trình ngoại khoá', en: 'Extracurricular programs' },

  'nav.section.fac': { vi: 'Phòng cơ sở vật chất', en: 'Facilities' },
  'nav.fac.requests': { vi: 'Yêu cầu CSVC', en: 'Facility requests' },
  'nav.fac.purchaseRequests': { vi: 'Phiếu đề nghị mua sắm', en: 'Purchase requests' },
  'nav.fac.stats': { vi: 'Thống kê', en: 'Statistics' },

  'nav.tasks': { vi: 'Phân việc', en: 'Task assignment' },
  'nav.sign': { vi: 'Ký số hồ sơ', en: 'Sign documents' },

  'nav.section.center': { vi: 'Khối trung tâm', en: 'Centers block' },
  'nav.edu.overview': { vi: 'Tổng quan trung tâm', en: 'Center overview' },
  'nav.edu.attendance': { vi: 'Điểm danh & thống kê', en: 'Attendance & stats' },
  'nav.edu.tuition': { vi: 'Thu học phí', en: 'Tuition collection' },
  'nav.edu.debtOverview': { vi: 'Công nợ tổng hợp', en: 'Consolidated debt' },
  'nav.edu.parentLinks': { vi: 'Liên kết Phụ huynh', en: 'Parent-student links' },
  'nav.edu.generalInvoicing': { vi: 'Tạo hoá đơn chung', en: 'General invoicing' },
  'nav.edu.walletInvoices': { vi: 'Thu học phí', en: 'Tuition collection' },
  'nav.edu.walletPaymentLog': { vi: 'Thu học phí qua Ví (Log)', en: 'Wallet payment log' },
  'nav.edu.dutySchedule': { vi: 'Phân lịch trực trung tâm', en: 'Center duty schedule' },
  'nav.edu.teacherSchedule': { vi: 'Phân lịch tuần giáo viên', en: 'Teacher weekly schedule' },
  'nav.edu.teachers': { vi: 'Danh sách giáo viên', en: 'Teacher directory' },
  'nav.edu.classes': { vi: 'Danh sách lớp', en: 'Classes' },
  'nav.edu.students': { vi: 'Danh sách học viên', en: 'Students' },
  'nav.edu.teachers': { vi: 'Danh sách giáo viên', en: 'Teachers' },
  'nav.edu.parentLinks': { vi: 'Liên kết Phụ huynh — Học sinh', en: 'Parent-Student Links' },
  'nav.edu.classAssignment': { vi: 'Phân lớp học viên', en: 'Class assignment' },
  'nav.edu.grades': { vi: 'Bảng điểm học viên', en: 'Student grades' },

  'nav.section.teacher': { vi: 'Giáo viên', en: 'Teachers' },
  'nav.teacher.schedule': { vi: 'Lịch giảng dạy', en: 'Teaching schedule' },
  'nav.teacher.classes': { vi: 'Lớp phụ trách', en: 'My classes' },
  'nav.teacher.attendance': { vi: 'Điểm danh', en: 'Attendance' },
  'nav.teacher.grades': { vi: 'Bảng điểm lớp học', en: 'Class grades' },
  'nav.teacher.trialStudents': { vi: 'Danh sách học thử', en: 'Trial students' },

  'nav.section.consultant': { vi: 'Nhân viên tư vấn', en: 'Consultants' },
  'nav.consultant.leads': { vi: 'Hồ sơ khách hàng', en: 'Customer leads' },
  'nav.consultant.trialRegistration': { vi: 'Đăng ký học thử', en: 'Trial registration' },
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
  'common.installApp': { vi: 'Cài đặt ứng dụng', en: 'Install app' },

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
  'status.overdue': { vi: 'Trễ hạn', en: 'Overdue' },
  'status.employee_active': { vi: 'Đang làm việc', en: 'Active' },
  'status.employee_probation': { vi: 'Thử việc', en: 'Probation' },
  'status.employee_inactive': { vi: 'Ngừng hoạt động', en: 'Inactive' },
  'status.employee_resigned': { vi: 'Đã nghỉ việc', en: 'Resigned' },
  'status.request_pending': { vi: 'Chờ xử lý', en: 'Pending' },
  'status.request_approved': { vi: 'Đã duyệt', en: 'Approved' },
  'status.request_in_progress': { vi: 'Đang xử lý', en: 'In progress' },
  'status.request_done': { vi: 'Hoàn thành', en: 'Done' },
  'status.request_rejected': { vi: 'Từ chối', en: 'Rejected' },
  'status.permission_pending': { vi: 'Chờ duyệt', en: 'Pending' },
  'status.permission_approved': { vi: 'Đã duyệt', en: 'Approved' },
  'status.permission_rejected': { vi: 'Từ chối', en: 'Rejected' },
  'status.lead_potential': { vi: 'Tiềm năng', en: 'Potential' },
  'status.lead_success': { vi: 'Thành công', en: 'Success' },
  'status.lead_rejected': { vi: 'Từ chối', en: 'Rejected' },
  'status.receivable_open': { vi: 'Chưa thu', en: 'Open' },
  'status.receivable_partial': { vi: 'Thu một phần', en: 'Partial' },
  'status.receivable_paid': { vi: 'Đã thu đủ', en: 'Paid' },
  'status.receivable_overdue': { vi: 'Quá hạn', en: 'Overdue' },
  'status.student_trial': { vi: 'Học thử', en: 'Trial' },
  'status.student_studying': { vi: 'Đang học', en: 'Studying' },
  'status.student_reserved': { vi: 'Bảo lưu', en: 'Reserved' },
  'status.student_withdrawn': { vi: 'Đã nghỉ', en: 'Withdrawn' },
  'status.grade_graduated': { vi: 'Tốt nghiệp', en: 'Graduated' },
  'status.grade_not_passed': { vi: 'Chưa đạt', en: 'Not passed' },
  'status.class_active': { vi: 'Đang học', en: 'Active' },
  'status.class_completed': { vi: 'Đã kết thúc', en: 'Completed' },
  'status.class_cancelled': { vi: 'Đã huỷ', en: 'Cancelled' },
  'status.leaveform_draft': { vi: 'Nháp', en: 'Draft' },
  'status.leaveform_submitted': { vi: 'Chờ Trưởng phòng duyệt', en: 'Awaiting dept. head approval' },
  'status.leaveform_approved_1': { vi: 'Chờ Nhân sự duyệt', en: 'Awaiting HR approval' },
  'status.leaveform_approved_2': { vi: 'Chờ Ban điều hành duyệt', en: 'Awaiting executive approval' },
  'status.leaveform_approved_3': { vi: 'Đã duyệt xong', en: 'Fully approved' },
  'status.leaveform_rejected': { vi: 'Từ chối', en: 'Rejected' },
  'status.contract_draft': { vi: 'Chờ nhân viên ký', en: 'Awaiting employee signature' },
  'status.contract_submitted': { vi: 'Chờ trưởng phòng NS ký', en: 'Awaiting HR head signature' },
  'status.contract_approved_1': { vi: 'Chờ ban điều hành ký', en: 'Awaiting executive signature' },
  'status.contract_approved_2': { vi: 'Đã lưu trữ', en: 'Archived' },
  'status.contract_archived': { vi: 'Đã lưu trữ', en: 'Archived' },
  'status.contract_rejected': { vi: 'Từ chối', en: 'Rejected' },
  'status.payment_draft': { vi: 'Chờ ký & đính kèm chứng từ', en: 'Awaiting signature & receipts' },
  'status.payment_submitted': { vi: 'Chờ kế toán ký', en: 'Awaiting accountant signature' },
  'status.payment_approved_1': { vi: 'Chờ ban điều hành ký', en: 'Awaiting executive signature' },
  'status.payment_approved_2': { vi: 'Đã lưu trữ', en: 'Archived' },
  'status.payment_archived': { vi: 'Đã lưu trữ', en: 'Archived' },
  'status.payment_rejected': { vi: 'Từ chối', en: 'Rejected' },
  'status.advance_draft': { vi: 'Chờ kế toán ký', en: 'Awaiting accountant signature' },
  'status.advance_submitted': { vi: 'Chờ kế toán ký', en: 'Awaiting accountant signature' },
  'status.advance_approved_1': { vi: 'Chờ ban điều hành ký', en: 'Awaiting executive signature' },
  'status.advance_approved_2': { vi: 'Đã lưu trữ', en: 'Archived' },
  'status.advance_archived': { vi: 'Đã lưu trữ', en: 'Archived' },
  'status.advance_rejected': { vi: 'Từ chối', en: 'Rejected' },
  'status.purchase_draft': { vi: 'Chờ trưởng phòng CSVC duyệt', en: 'Awaiting facilities head approval' },
  'status.purchase_submitted': { vi: 'Chờ trưởng phòng CSVC duyệt', en: 'Awaiting facilities head approval' },
  'status.purchase_approved_1': { vi: 'Chờ ban điều hành ký', en: 'Awaiting executive signature' },
  'status.purchase_approved_2': { vi: 'Đã lưu trữ', en: 'Archived' },
  'status.purchase_archived': { vi: 'Đã lưu trữ', en: 'Archived' },
  'status.purchase_rejected': { vi: 'Từ chối', en: 'Rejected' },
  'status.event_draft': { vi: 'Chờ truyền thông duyệt', en: 'Awaiting marketing approval' },
  'status.event_submitted': { vi: 'Chờ truyền thông duyệt', en: 'Awaiting marketing approval' },
  'status.event_approved_1': { vi: 'Chờ ban điều hành duyệt', en: 'Awaiting executive approval' },
  'status.event_approved_2': { vi: 'Đã lưu trữ', en: 'Archived' },
  'status.event_archived': { vi: 'Đã lưu trữ', en: 'Archived' },
  'status.event_rejected': { vi: 'Từ chối', en: 'Rejected' },
  'status.proposal_draft': { vi: 'Nháp', en: 'Draft' },
  'status.proposal_submitted': { vi: 'Chờ trưởng phòng duyệt', en: 'Awaiting department head approval' },
  'status.proposal_approved_1': { vi: 'Chờ ban điều hành duyệt', en: 'Awaiting executive approval' },
  'status.proposal_approved_2': { vi: 'Đã duyệt & lưu trữ', en: 'Approved & archived' },
  'status.proposal_archived': { vi: 'Đã duyệt & lưu trữ', en: 'Approved & archived' },
  'status.proposal_rejected': { vi: 'Từ chối', en: 'Rejected' },

  // ---------- Trang đăng nhập ----------
  'login.eyebrow': { vi: 'Hệ thống quản trị nội bộ', en: 'Internal management system' },
  'login.headline': { vi: 'Quản lý vận hành trung tâm, gọn trong một nơi.', en: 'Run your whole center from one place.' },
  'login.sub': { vi: 'Nhân sự, kế toán, học vụ và ban điều hành — cùng một hệ thống, đúng quyền, đúng người.', en: 'HR, accounting, academics and leadership — one system, the right access for everyone.' },
  'login.footer': { vi: '© 2026 AIS OFFICE — Nội bộ, không công khai', en: '© 2026 AIS OFFICE — Internal use only' },
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
  'dashboard.welcome': { vi: 'Chào mừng quay lại hệ thống AIS OFFICE.', en: 'Welcome back to AIS OFFICE.' },
  'dashboard.statUnread': { vi: 'Thông báo chưa đọc', en: 'Unread notifications' },
  'dashboard.statLeave': { vi: 'Ngày phép còn lại', en: 'Leave days left' },
  'dashboard.statPending': { vi: 'Phiếu đang chờ duyệt', en: 'Pending approvals' },
  'dashboard.statMeetings': { vi: 'Cuộc họp sắp tới', en: 'Upcoming meetings' },
  'dashboard.birthday': { vi: 'Chúc mừng sinh nhật!', en: 'Happy Birthday!' },
  'dashboard.searchPlaceholder': { vi: 'Tìm nhân viên, phiếu, lớp học...', en: 'Search employees, forms, classes...' },

  // ===== Trang chờ (world-select.html) — them moi khi dich day du =====
  'lobby.greeting.morning': { vi: 'Chào buổi sáng', en: 'Good morning' },
  'lobby.greeting.noon': { vi: 'Chào buổi trưa', en: 'Good afternoon' },
  'lobby.greeting.afternoon': { vi: 'Chào buổi chiều', en: 'Good afternoon' },
  'lobby.greeting.evening': { vi: 'Chào buổi tối', en: 'Good evening' },
  'lobby.entry.sub': { vi: 'Chọn 1 mục để bắt đầu', en: 'Choose one to get started' },
  'lobby.entry.doorTitle': { vi: 'Vào cửa', en: 'Enter' },
  'lobby.entry.doorDesc': { vi: 'Đi vào hệ thống — ERP, CRM, Room, Banzone', en: 'Go inside — ERP, CRM, Room, Banzone' },
  'lobby.entry.checkinTitle': { vi: 'Chấm công', en: 'Check-in' },
  'lobby.entry.checkinDesc': { vi: 'Check-in / Check-out nhanh', en: 'Quick check-in / check-out' },
  'lobby.back': { vi: '← Quay lại', en: '← Back' },
  'lobby.branches.title': { vi: 'Chọn khu vực', en: 'Choose an area' },
  'lobby.branches.sub': { vi: 'Bấm vào 1 thẻ để đi sâu vào bên trong', en: 'Tap a card to go inside' },
  'lobby.branch.erp.name': { vi: 'ERP', en: 'ERP' },
  'lobby.branch.erp.desc': { vi: 'PHÒNG BAN', en: 'DEPARTMENTS' },
  'lobby.branch.crm.name': { vi: 'CRM', en: 'CRM' },
  'lobby.branch.crm.desc': { vi: 'TRUNG TÂM', en: 'CENTERS' },
  'lobby.branch.room.name': { vi: 'ROOM', en: 'ROOM' },
  'lobby.branch.room.desc': { vi: 'CÁ NHÂN', en: 'PERSONAL' },
  'lobby.branch.banzone.name': { vi: 'BANZONE', en: 'BANZONE' },
  'lobby.branch.banzone.desc': { vi: 'DATABASE', en: 'DATABASE' },
  'lobby.locked': { vi: '🔒 Không có quyền', en: '🔒 No access' },
  'lobby.lockedFull': { vi: '🔒 Không có quyền truy cập', en: '🔒 No access' },
  'lobby.erp.title': { vi: 'ERP — Khối Quản Trị Phòng Ban', en: 'ERP — Department Management' },
  'lobby.erp.tabExec': { vi: 'Tầng Điều hành', en: 'Executive Floor' },
  'lobby.erp.tabDept': { vi: 'Tầng Phòng ban', en: 'Department Floor' },
  'lobby.erp.noExecAccess': { vi: '🔒 Không có quyền truy cập Tầng Điều hành.', en: '🔒 No access to the Executive Floor.' },
  'lobby.erp.functionCount': { vi: 'chức năng', en: 'functions' },
  'lobby.erp.noItems': { vi: 'Không có mục nào.', en: 'No items.' },
  'lobby.crm.title': { vi: 'CRM — Khối Trung Tâm', en: 'CRM — Centers' },
  'lobby.crm.loading': { vi: 'Đang tải danh sách trung tâm...', en: 'Loading centers...' },
  'lobby.crm.activeCenters': { vi: 'trung tâm đang hoạt động', en: 'active centers' },
  'lobby.crm.loadError': { vi: 'Không tải được danh sách trung tâm.', en: 'Could not load the centers list.' },
  'lobby.room.title': { vi: 'Room — Không gian cá nhân', en: 'Room — Personal Space' },
  'lobby.banzone.title': { vi: 'Banzone — Kho dữ liệu gốc', en: 'Banzone — Master Data' },
  'lobby.banzone.searchPlaceholder': { vi: 'Tìm nhanh (VD: trung tâm, chi phí, kho...)', en: 'Quick search (e.g. centers, expenses, inventory...)' },
  'lobby.banzone.catOrg': { vi: 'Tổ chức', en: 'Organization' },
  'lobby.banzone.catFinance': { vi: 'Tài chính', en: 'Finance' },
  'lobby.banzone.catOps': { vi: 'Vận hành', en: 'Operations' },
  'lobby.banzone.catSystem': { vi: 'Hệ thống', en: 'System' },
  'lobby.banzone.items': { vi: 'mục', en: 'items' },
  'lobby.checkin.title': { vi: 'Chấm công nhanh', en: 'Quick Check-in' },
  'lobby.checkin.locating': { vi: 'Đang xác định vị trí...', en: 'Locating you...' },
  'lobby.checkin.btnIn': { vi: 'Chấm công vào', en: 'Check in' },
  'lobby.checkin.btnOut': { vi: 'Chấm công ra', en: 'Check out' },
  'lobby.checkin.moreLink': { vi: 'Xem đầy đủ lịch sử chấm công →', en: 'View full check-in history →' },
  'lobby.checkin.noCenter': { vi: 'Bạn không gắn cố định 1 trung tâm — dùng trang chấm công đầy đủ để chọn đúng trung tâm đang có mặt.', en: "You aren't assigned to a fixed center — use the full check-in page to pick the center you're at." },
  'lobby.checkin.noGps': { vi: 'Trung tâm của bạn chưa có toạ độ GPS — liên hệ kỹ thuật.', en: "Your center doesn't have GPS coordinates set — contact tech support." },
  'lobby.footer.hint': { vi: 'Bấm vào cửa để bắt đầu', en: 'Tap the door to get started' },
  'lobby.footer.skip': { vi: 'Vào thẳng ERP như mọi khi', en: 'Go straight to ERP as usual' },
  'lobby.checkin.noGeo': { vi: 'Trình duyệt không hỗ trợ định vị vị trí.', en: "Your browser doesn't support location." },
  'lobby.checkin.inRange': { vi: 'Trong phạm vi — cách trung tâm', en: 'In range — distance to center' },
  'lobby.checkin.outOfRange': { vi: 'Ngoài phạm vi — cách', en: 'Out of range — distance' },
  'lobby.checkin.rangeLimit': { vi: 'giới hạn 1km', en: '1km limit' },
  'lobby.checkin.gpsError': { vi: 'Không lấy được vị trí:', en: 'Could not get location:' },
  'lobby.checkin.gpsPermission': { vi: 'cần cho phép truy cập vị trí.', en: 'location permission is required.' },
  'lobby.checkin.doneToday': { vi: '✓ Đã hoàn tất chấm công hôm nay (vào & ra).', en: "✓ You've completed check-in and check-out today." },
  'lobby.checkin.checkedInAt': { vi: '✓ Đã chấm công vào lúc', en: '✓ Checked in at' },
  'lobby.checkin.notYet': { vi: 'Chưa chấm công vào hôm nay.', en: "You haven't checked in today." },
  'lobby.checkin.waitLocating': { vi: 'Chưa xác định được vị trí — đợi vài giây rồi thử lại.', en: 'Location not ready yet — wait a few seconds and try again.' },
  'lobby.checkin.tooFar': { vi: 'Cách trung tâm', en: 'Distance to center' },
  'lobby.checkin.outOfAllowedRange': { vi: 'ngoài phạm vi cho phép (1km).', en: 'is outside the allowed 1km range.' },
  'lobby.checkin.submitting': { vi: 'Đang chấm công...', en: 'Checking in...' },
  'lobby.checkin.genericError': { vi: 'Có lỗi xảy ra.', en: 'Something went wrong.' },
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
