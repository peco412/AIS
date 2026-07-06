import { supabase } from './supabase.js';

// ---------------------------------------------------------------------
// Danh sách CHUẨN các loại hồ sơ có luồng duyệt 2 cấp (draft/submitted ->
// approved_1 -> approved_2, dùng chung enum workflow_status trong DB),
// cộng thêm 2 loại đơn nhân sự mà Ban điều hành có thể duyệt THAY trưởng
// phòng nếu cần (business_trips, leave_requests — các đơn này chỉ có 1
// bước duyệt, do trưởng phòng NS HOẶC Ban điều hành, ai duyệt trước).
//
// Dùng chung cho:
//  - /exec/sign.html (danh sách đầy đủ, tách rõ cấp 1 / cấp 2)
//  - /dashboard.html (thẻ số liệu "Phiếu đang chờ duyệt" cho Ban điều hành)
// để không phải khai báo trùng 2 nơi và lỡ quên cập nhật đồng bộ.
// ---------------------------------------------------------------------
export const APPROVAL_SOURCES = [
  {
    table: 'contracts', label: 'Hợp đồng lao động', dept: 'HR', href: '/hr/contracts.html',
    select: 'id, code, status, employees:employee_id(full_name)',
    level1Statuses: ['submitted'], level1Label: 'Chờ trưởng phòng NS ký',
    level2Statuses: ['approved_1'], level2Label: 'Chờ Ban điều hành ký',
  },
  {
    table: 'payment_requests', label: 'Phiếu đề nghị thanh toán', dept: 'ACC', href: '/acc/payment-requests.html',
    select: 'id, code, status, employees:requester_id(full_name)',
    level1Statuses: ['submitted'], level1Label: 'Chờ kế toán ký',
    level2Statuses: ['approved_1'], level2Label: 'Chờ Ban điều hành ký',
  },
  {
    table: 'advance_requests', label: 'Phiếu đề nghị tạm ứng', dept: 'ACC', href: '/acc/advance-requests.html',
    select: 'id, code, status, employees:requester_id(full_name)',
    level1Statuses: ['draft'], level1Label: 'Chờ kế toán ký',
    level2Statuses: ['approved_1'], level2Label: 'Chờ Ban điều hành ký',
  },
  {
    table: 'event_proposals', label: 'Trình sự kiện', dept: 'MKT', href: '/mkt/event-proposals.html',
    select: 'id, code, status, employees:center_manager_id(full_name)',
    level1Statuses: ['draft'], level1Label: 'Chờ truyền thông duyệt',
    level2Statuses: ['approved_1'], level2Label: 'Chờ Ban điều hành duyệt',
  },
  {
    table: 'purchase_requests', label: 'Phiếu đề nghị mua sắm', dept: 'FAC', href: '/fac/purchase-requests.html',
    select: 'id, code, status, employees:requester_id(full_name)',
    level1Statuses: ['draft'], level1Label: 'Chờ trưởng phòng CSVC duyệt',
    level2Statuses: ['approved_1'], level2Label: 'Chờ Ban điều hành ký',
  },
  {
    // Đề xuất nội bộ không cố định 1 phòng ban — dept được đọc theo từng dòng
    table: 'internal_proposals', label: 'Đề xuất nội bộ', dept: null, href: '/proposals.html',
    select: 'id, code, status, department_id, employees:employee_id(full_name), departments(code)',
    level1Statuses: ['submitted'], level1Label: 'Chờ trưởng phòng duyệt',
    level2Statuses: ['approved_1'], level2Label: 'Chờ Ban điều hành duyệt',
  },
  {
    // Chỉ có 1 bước duyệt (submitted -> approved_2 thẳng), do trưởng phòng NS
    // HOẶC Ban điều hành, ai duyệt trước — không có approved_1 riêng.
    table: 'business_trips', label: 'Đơn xin đi công tác', dept: 'HR', href: '/hr/business-trips.html',
    select: 'id, code, title, status, employees:employee_id(full_name)',
    level1Statuses: ['submitted'], level1Label: 'Chờ trưởng phòng NS (hoặc BĐH) duyệt',
    level2Statuses: [], level2Label: '',
    backupOnly: true,
  },
  {
    table: 'leave_requests', label: 'Đơn xin nghỉ phép', dept: 'HR', href: '/hr/leave-requests.html',
    select: 'id, code, leave_type, status, employees:employee_id(full_name)',
    level1Statuses: ['submitted'], level1Label: 'Chờ trưởng phòng NS (hoặc BĐH) duyệt',
    level2Statuses: [], level2Label: '',
    backupOnly: true,
  },
];

function isHead(profile, dept) { return profile.departmentCode === dept && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode); }
function isExec(profile) { return ['EXECUTIVE', 'TECH'].includes(profile.roleCode); }

function row(type, code, requester, stepLabel, href, backupOnly) {
  return { type, code, requester: requester || '—', stepLabel, href, backupOnly };
}

/**
 * Trả về { level1Rows, level2Rows } — level1Rows là các phiếu đang chờ ĐÚNG
 * lượt trưởng phòng (Ban điều hành có thể duyệt thay nếu cần), level2Rows
 * là các phiếu ĐÃ QUA trưởng phòng, chỉ Ban điều hành mới duyệt được.
 */
export async function fetchPendingApprovals(profile) {
  const level1Rows = [];
  const level2Rows = [];

  for (const src of APPROVAL_SOURCES) {
    const allStatuses = [...src.level1Statuses, ...src.level2Statuses];
    if (allStatuses.length === 0) continue;
    if (src.dept && !(isHead(profile, src.dept) || isExec(profile))) continue;

    const { data, error } = await supabase.from(src.table).select(src.select).in('status', allStatuses);
    if (error || !data) continue;

    data.forEach((r) => {
      const rowDept = src.dept || r.departments?.code;
      const requester = r.employees?.full_name;
      const code = r.code || r.title;

      if (src.level1Statuses.includes(r.status) && (isHead(profile, rowDept) || isExec(profile))) {
        level1Rows.push(row(src.label, code, requester, src.level1Label, src.href, src.backupOnly));
      }
      if (src.level2Statuses.includes(r.status) && isExec(profile)) {
        level2Rows.push(row(src.label, code, requester, src.level2Label, src.href, false));
      }
    });
  }

  return { level1Rows, level2Rows };
}
