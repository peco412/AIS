// =====================================================================
// TRUNG TÂM PHÊ DUYỆT
// -----------------------------------------------------------------------
// VẤN ĐỀ ĐANG SỬA: hệ thống có ~12 luồng "chờ duyệt" khác nhau nằm rải
// rác ở nhiều trang riêng (acc/payment-requests, acc/advance-requests,
// acc/purchase-orders, hr/contracts, hr/business-trips, hr/late-clockin-
// requests, fac/purchase-requests, fac/requests, mkt/event-proposals,
// mkt/requests, edu/refund-requests, permission-requests, đơn nghỉ phép,
// đề xuất nội bộ...). Cán bộ có vai trò duyệt (trưởng/phó phòng, quản lý
// trung tâm, ban điều hành, nhân sự...) phải nhớ và tự vào TỪNG trang một
// để biết có việc đang chờ mình hay không — không có nơi tổng hợp.
//
// File này KHÔNG thay thế các trang duyệt hiện có (vẫn giữ nguyên toàn bộ
// logic duyệt/ký/từ chối đã chạy đúng ở từng nơi, để không rủi ro sai sót
// dữ liệu tài chính/hồ sơ). Nó chỉ ĐỌC lại đúng các điều kiện "ai được
// duyệt bước nào" y hệt từng trang gốc (ghi rõ nguồn ở mỗi hàm bên dưới),
// gom thành 1 danh sách, và bấm vào là nhảy thẳng tới đúng trang/đúng
// dòng để xử lý — giải quyết đúng vấn đề "phải tìm từng nơi".
//
// Nếu sau này chuẩn hoá lại logic phân quyền duyệt (gộp các hàm isDeptHead/
// IS_EXEC đang bị lặp lại và có sai khác nhẹ giữa các file thành 1 nguồn
// dùng chung), sửa ở CÁC FILE GỐC trước, rồi cập nhật lại các hàm isEligible*
// dưới đây cho khớp.
// =====================================================================
import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ALL_ITEMS = [];
let ACTIVE_FILTER = 'all';

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }
function fmtMoney(n) { return n || n === 0 ? Number(n).toLocaleString('vi-VN') + ' đ' : ''; }

// ---------------------------------------------------------------------
// Mỗi nguồn: { key, label, icon, load(profile) -> Promise<item[]> }
// item chuẩn hoá: { source, title, meta, stepLabel, url, updatedAt }
// ---------------------------------------------------------------------
const ICONS = {
  money: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
  doc: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 2h12v19l-2-1-2 1-2-1-2 1-2-1-2 1V2z"/></svg>',
  people: '<svg class="icon" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><circle cx="18" cy="9" r="2.5"/><path d="M15.5 14.3c2.7.3 4.5 2 4.5 5.7"/></svg>',
  cart: '<svg class="icon" viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12.5h10L20 8H6"/></svg>',
  home: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/></svg>',
};

function directManagerMap(rows, getEmp) {
  const map = {};
  rows.forEach((r) => {
    const emp = getEmp(r);
    if (!emp) return;
    const key = emp.__requesterId;
    map[key] = emp.department_id
      ? (emp.department_id === PROFILE.departmentId && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode))
      : (emp.center_id === PROFILE.centerId && PROFILE.roleCode === 'CENTER_MANAGER');
  });
  return map;
}

// --- 1) Phiếu đề nghị thanh toán (acc/payment-requests.js) ------------
async function loadPaymentRequests() {
  const { data, error } = await supabase.from('payment_requests')
    .select('id, code, amount, content, status, updated_at, requester_id, employees!payment_requests_requester_id_fkey(full_name, department_id, center_id)')
    .order('updated_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_ACC_HEAD = PROFILE.departmentCode === 'ACC' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode);
  const IS_EXEC = PROFILE.roleCode === 'EXECUTIVE';
  const dmm = directManagerMap(data, (r) => r.employees && { ...r.employees, __requesterId: r.requester_id });
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (r.status === 'submitted' && dmm[r.requester_id]) step = 'Quản lý trực tiếp ký';
    else if (r.status === 'approved_1' && (IS_ACC_HEAD || IS_EXEC)) step = 'Kế toán ký';
    else if (r.status === 'approved_2' && IS_EXEC) step = 'Ban điều hành ký';
    if (!step) return;
    out.push({ source: 'Đề nghị thanh toán', icon: ICONS.money, title: r.content || r.code, meta: `${esc(r.employees?.full_name || '—')} · ${fmtMoney(r.amount)}`, stepLabel: step, url: '/acc/payment-requests.html', updatedAt: r.updated_at });
  });
  return out;
}

// --- 2) Phiếu đề nghị tạm ứng (acc/advance-requests.js) ---------------
async function loadAdvanceRequests() {
  const { data, error } = await supabase.from('advance_requests')
    .select('id, code, amount, reason, status, updated_at, requester_id, employees!advance_requests_requester_id_fkey(full_name, department_id, center_id)')
    .order('updated_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_ACC_HEAD = PROFILE.departmentCode === 'ACC' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode);
  const IS_EXEC = PROFILE.roleCode === 'EXECUTIVE';
  const dmm = directManagerMap(data, (r) => r.employees && { ...r.employees, __requesterId: r.requester_id });
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (r.status === 'draft' && dmm[r.requester_id]) step = 'Quản lý trực tiếp ký';
    else if (r.status === 'approved_1' && (IS_ACC_HEAD || IS_EXEC)) step = 'Kế toán ký';
    else if (r.status === 'approved_2' && IS_EXEC) step = 'Ban điều hành ký';
    if (!step) return;
    out.push({ source: 'Đề nghị tạm ứng', icon: ICONS.money, title: r.reason || r.code, meta: `${esc(r.employees?.full_name || '—')} · ${fmtMoney(r.amount)}`, stepLabel: step, url: '/acc/advance-requests.html', updatedAt: r.updated_at });
  });
  return out;
}

// --- 3) Phiếu mua hàng (acc/purchase-orders.js) ------------------------
async function loadPurchaseOrders() {
  const { data, error } = await supabase.from('purchase_orders')
    .select('id, code, total_amount, status, created_at, requester_id, employees!purchase_orders_requester_id_fkey(full_name, department_id, center_id)')
    .order('created_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  // CHUẨN HOÁ 22/08/2026: đồng bộ với acc/purchase-orders.js — TECH được
  // xem toàn bộ nhưng không duyệt trong hệ thống thật (dùng công cụ test
  // riêng), nên IS_EXEC ở đây chỉ tính EXECUTIVE, khớp 5 luồng duyệt khác.
  const IS_ACC = PROFILE.departmentCode === 'ACC' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode);
  const IS_EXEC = PROFILE.roleCode === 'EXECUTIVE';
  const dmm = directManagerMap(data, (r) => r.employees && { ...r.employees, __requesterId: r.requester_id });
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (r.status === 'draft' && dmm[r.requester_id]) step = 'Quản lý trực tiếp duyệt';
    else if (r.status === 'approved_1' && (IS_ACC || IS_EXEC)) step = 'Kế toán duyệt';
    else if (r.status === 'approved_2' && IS_EXEC) step = 'Ban điều hành ký';
    if (!step) return;
    out.push({ source: 'Phiếu mua hàng', icon: ICONS.cart, title: r.code, meta: `${esc(r.employees?.full_name || '—')} · ${fmtMoney(r.total_amount)}`, stepLabel: step, url: '/acc/purchase-orders.html', updatedAt: r.created_at });
  });
  return out;
}

// --- 4) Hợp đồng lao động (hr/contracts.js) -----------------------------
async function loadContracts() {
  const { data, error } = await supabase.from('contracts')
    .select('id, code, status, updated_at, employee_id, employees!contracts_employee_id_fkey(full_name)')
    .order('updated_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_HR_HEAD = PROFILE.departmentCode === 'HR' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode);
  const IS_EXEC = PROFILE.roleCode === 'EXECUTIVE'; // CHUẨN HOÁ 22/08/2026 — đồng bộ hr/contracts.js
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (r.status === 'submitted' && IS_HR_HEAD) step = 'Trưởng phòng NS ký';
    else if (r.status === 'approved_1' && IS_EXEC) step = 'Ban điều hành ký';
    if (!step) return;
    out.push({ source: 'Hợp đồng lao động', icon: ICONS.doc, title: `${r.code} — ${esc(r.employees?.full_name || '')}`, meta: '', stepLabel: step, url: '/hr/contracts.html', updatedAt: r.updated_at });
  });
  return out;
}

// --- 5) Đơn công tác (hr/business-trips.js) -----------------------------
async function loadBusinessTrips() {
  const { data, error } = await supabase.from('business_trips')
    .select('id, code, title, status, created_at, employee_id, employees!business_trips_employee_id_fkey(full_name, department_id, center_id)')
    .order('created_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_HR = PROFILE.departmentCode === 'HR' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode);
  const IS_EXEC = PROFILE.roleCode === 'EXECUTIVE';
  const dmm = directManagerMap(data, (r) => r.employees && { ...r.employees, __requesterId: r.employee_id });
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (r.status === 'submitted' && dmm[r.employee_id]) step = 'Quản lý trực tiếp duyệt';
    else if (r.status === 'approved_1' && IS_HR) step = 'Phòng Nhân sự duyệt';
    else if (r.status === 'approved_2' && IS_EXEC) step = 'Ban điều hành duyệt';
    if (!step) return;
    out.push({ source: 'Đơn công tác', icon: ICONS.doc, title: r.title || r.code, meta: esc(r.employees?.full_name || '—'), stepLabel: step, url: '/hr/business-trips.html', updatedAt: r.created_at });
  });
  return out;
}

// --- 6) Đơn xin chấm công trễ (hr/late-clockin-requests.js) -------------
async function loadLateClockin() {
  const { data, error } = await supabase.from('late_clockin_requests')
    .select('id, code, late_date, reason, status, employee_id, created_at, employees!late_clockin_requests_employee_id_fkey(full_name)')
    .order('created_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_HR_DEPUTY = PROFILE.departmentCode === 'HR' && PROFILE.roleCode === 'DEPT_DEPUTY';
  if (!IS_HR_DEPUTY) return [];
  return data.filter((r) => r.status === 'pending').map((r) => ({
    source: 'Chấm công trễ', icon: ICONS.people, title: `${esc(r.employees?.full_name || '—')} — ${fmtDate(r.late_date)}`, meta: esc(r.reason || ''), stepLabel: 'Phó phòng NS duyệt', url: '/hr/late-clockin-requests.html', updatedAt: r.created_at,
  }));
}

// --- 7) Đơn nghỉ phép (js/leaveFormFlow.js) ------------------------------
async function loadLeaveRequests() {
  const { data, error } = await supabase.from('leave_requests')
    .select('id, code, form_code, status, created_at, employee_id, employees!leave_requests_employee_id_fkey(full_name, department_id, center_id)')
    .order('created_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  // Ghi chú: leaveFormFlow.js dùng canApproveLevel1/2/3 với logic phòng ban
  // riêng cho "office" và "teacher" khá dài; ở đây chỉ tái hiện phần lõi
  // (trưởng phòng cùng phòng / quản lý TT cùng trung tâm cho cấp 1, HR cho
  // cấp 2, EXEC cho cấp 3) — đủ để BÁO CÓ VIỆC CHỜ, người dùng bấm vào
  // trang gốc để xử lý chính xác theo đúng luồng đầy đủ.
  const IS_HR = PROFILE.departmentCode === 'HR';
  const IS_EXEC = PROFILE.roleCode === 'EXECUTIVE';
  const out = [];
  data.forEach((r) => {
    const emp = r.employees;
    const isLevel1 = emp && (
      (emp.department_id && emp.department_id === PROFILE.departmentId && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode)) ||
      (emp.center_id && emp.center_id === PROFILE.centerId && PROFILE.roleCode === 'CENTER_MANAGER')
    );
    let step = null;
    if (r.status === 'submitted' && (isLevel1 || IS_EXEC)) step = 'Trưởng phòng duyệt (cấp 1)';
    else if (r.status === 'approved_1' && (IS_HR || IS_EXEC)) step = 'Nhân sự duyệt (cấp 2)';
    else if (r.status === 'approved_2' && IS_EXEC) step = 'Ban điều hành duyệt (cấp 3)';
    if (!step) return;
    out.push({ source: 'Đơn nghỉ phép', icon: ICONS.people, title: `${esc(emp?.full_name || '—')} — ${esc(r.form_code || r.code)}`, meta: '', stepLabel: step, url: '/hr/leave-requests.html', updatedAt: r.created_at });
  });
  return out;
}

// --- 8) Phiếu đề nghị mua sắm / sửa chữa CSVC (fac/purchase-requests.js) -
async function loadFacPurchaseRequests() {
  const { data, error } = await supabase.from('purchase_requests')
    .select('id, code, status, request_type, updated_at, requester_id, center_id')
    .order('updated_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_FAC_HEAD = PROFILE.departmentCode === 'FAC' && PROFILE.roleCode === 'DEPT_HEAD';
  const IS_EXEC = PROFILE.roleCode === 'EXECUTIVE';
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (r.status === 'draft' && (IS_FAC_HEAD || IS_EXEC)) step = 'Trưởng phòng CSVC duyệt';
    else if (r.status === 'approved_1' && IS_EXEC) step = 'Ban điều hành ký';
    if (!step) return;
    out.push({ source: 'Đề nghị mua sắm CSVC', icon: ICONS.cart, title: `${r.code} (${r.request_type === 'repair' ? 'Sửa chữa' : 'Mua sắm'})`, meta: '', stepLabel: step, url: '/fac/purchase-requests.html', updatedAt: r.updated_at });
  });
  return out;
}

// --- 9) Trình sự kiện (mkt/event-proposals.js) ---------------------------
async function loadEventProposals() {
  const { data, error } = await supabase.from('event_proposals')
    .select('id, code, status, updated_at, center_id, centers(name)')
    .order('updated_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_MKT_HEAD = PROFILE.departmentCode === 'MKT' && PROFILE.roleCode === 'DEPT_HEAD';
  const IS_EXEC = PROFILE.roleCode === 'EXECUTIVE';
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (r.status === 'draft' && (IS_MKT_HEAD || IS_EXEC)) step = 'Truyền thông duyệt';
    else if (r.status === 'approved_1' && IS_EXEC) step = 'Ban điều hành duyệt';
    if (!step) return;
    out.push({ source: 'Trình sự kiện', icon: ICONS.doc, title: `${r.code} — ${esc(r.centers?.name || '')}`, meta: '', stepLabel: step, url: '/mkt/event-proposals.html', updatedAt: r.updated_at });
  });
  return out;
}

// --- 10) Yêu cầu CSVC (fac/requests.js) -----------------------------------
async function loadFacilityRequests() {
  const { data, error } = await supabase.from('facility_requests')
    .select('id, title, request_type, status, updated_at, requester_id, center_id, centers(name), employees!facility_requests_requester_id_fkey(full_name)')
    .order('updated_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_FAC = PROFILE.departmentCode === 'FAC';
  const IS_CENTER_MANAGER = PROFILE.roleCode === 'CENTER_MANAGER' || ['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode);
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (IS_CENTER_MANAGER && r.status === 'pending' && r.center_id === PROFILE.centerId) step = 'Quản lý trung tâm xác nhận';
    else if (IS_FAC && ['center_approved', 'in_progress'].includes(r.status)) step = 'Phòng CSVC xử lý';
    if (!step) return;
    out.push({ source: 'Yêu cầu CSVC', icon: ICONS.home, title: r.title, meta: `${esc(r.employees?.full_name || '—')} · ${esc(r.centers?.name || '')}`, stepLabel: step, url: '/fac/requests.html', updatedAt: r.updated_at });
  });
  return out;
}

// --- 11) Yêu cầu truyền thông (mkt/requests.js) ---------------------------
async function loadCommunicationRequests() {
  const { data, error } = await supabase.from('communication_requests')
    .select('id, title, status, updated_at, requester_id, center_id, centers(name), employees!communication_requests_requester_id_fkey(full_name)')
    .order('updated_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_MKT = PROFILE.departmentCode === 'MKT';
  const IS_CENTER_MANAGER = PROFILE.roleCode === 'CENTER_MANAGER' || ['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode);
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (IS_CENTER_MANAGER && r.status === 'pending' && r.center_id === PROFILE.centerId) step = 'Quản lý trung tâm xác nhận';
    else if (IS_MKT && ['center_approved', 'in_progress'].includes(r.status)) step = 'Phòng Truyền thông xử lý';
    if (!step) return;
    out.push({ source: 'Yêu cầu truyền thông', icon: ICONS.doc, title: r.title, meta: `${esc(r.employees?.full_name || '—')} · ${esc(r.centers?.name || '')}`, stepLabel: step, url: '/mkt/requests.html', updatedAt: r.updated_at });
  });
  return out;
}

// --- 12) Đơn xin rút ví / hoàn tiền (edu/refund-requests.js) -------------
async function loadRefundRequests() {
  const { data, error } = await supabase.from('wallet_withdrawal_requests')
    .select('id, preview_amount_vnd, actual_amount_vnd, status, created_at, students(full_name)')
    .order('created_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_ACC = PROFILE.departmentCode === 'ACC';
  const IS_CENTER_STAFF = ['CENTER_MANAGER', 'CONSULTANT'].includes(PROFILE.roleCode);
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (r.status === 'pending' && IS_CENTER_STAFF) step = 'Trung tâm xác nhận';
    else if (r.status === 'center_confirmed' && IS_ACC) step = 'Kế toán duyệt hoàn';
    if (!step) return;
    out.push({ source: 'Rút ví / hoàn tiền', icon: ICONS.money, title: esc(r.students?.full_name || '—'), meta: fmtMoney(r.preview_amount_vnd || r.actual_amount_vnd), stepLabel: step, url: '/edu/refund-requests.html', updatedAt: r.created_at });
  });
  return out;
}

// --- 13) Xin thêm quyền hạn (permission-requests.js) ----------------------
async function loadPermissionRequests() {
  if (!['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode)) return []; // chỉ EXEC/TECH duyệt
  const { data, error } = await supabase.from('permission_requests')
    .select('id, module_key, reason, status, created_at, target:employees!permission_requests_target_employee_id_fkey(full_name), requester:employees!permission_requests_requested_by_fkey(full_name)')
    .eq('status', 'pending').order('created_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  return data.map((r) => ({
    source: 'Xin thêm quyền hạn', icon: ICONS.people, title: `${esc(r.requester?.full_name || '—')} — ${esc(r.module_key)}`, meta: esc(r.reason || ''), stepLabel: 'Ban điều hành duyệt', url: '/permission-requests.html', updatedAt: r.created_at,
  }));
}

// --- 14) Đề xuất nội bộ (js/proposals.js) ---------------------------------
async function loadInternalProposals() {
  const { data, error } = await supabase.from('internal_proposals')
    .select('id, code, title, status, updated_at, employee_id, department_id, departments(name), employees!internal_proposals_employee_id_fkey(full_name)')
    .order('updated_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const isDeptHeadOf = (r) => {
    if (r.department_id !== PROFILE.departmentId) return false;
    if (PROFILE.roleCode === 'CENTER_MANAGER') return true; // EDU dùng CENTER_MANAGER làm "trưởng phòng"
    return ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode);
  };
  const IS_EXEC = PROFILE.roleCode === 'EXECUTIVE'; // CHUẨN HOÁ 22/08/2026 — đồng bộ js/proposals.js
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (r.status === 'submitted' && (isDeptHeadOf(r) || IS_EXEC)) step = 'Trưởng phòng duyệt';
    else if (r.status === 'approved_1' && IS_EXEC) step = 'Ban điều hành duyệt';
    if (!step) return;
    out.push({ source: 'Đề xuất nội bộ', icon: ICONS.doc, title: r.title || r.code, meta: esc(r.employees?.full_name || '—'), stepLabel: step, url: '/proposals.html', updatedAt: r.updated_at });
  });
  return out;
}

// --- 15) Chi phí quảng cáo (mkt/expense-reports.js) -----------------------
async function loadAdExpenses() {
  const { data, error } = await supabase.from('mkt_ad_expenses')
    .select('id, code, platform, amount, status, created_at, centers(name)')
    .order('created_at', { ascending: false }).limit(300);
  if (error || !data) return [];
  const IS_HEAD = PROFILE.departmentCode === 'MKT' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode);
  const IS_ACC = PROFILE.departmentCode === 'ACC';
  const IS_EXEC = PROFILE.roleCode === 'EXECUTIVE'; // CHUẨN HOÁ 22/08/2026 — đồng bộ mkt/expense-reports.js
  const out = [];
  data.forEach((r) => {
    let step = null;
    if (r.status === 'draft' && (IS_HEAD || IS_EXEC)) step = 'Trưởng phòng MKT duyệt';
    else if (r.status === 'approved_1' && (IS_ACC || IS_EXEC)) step = 'Duyệt (Kế toán)';
    else if (r.status === 'approved_2' && IS_EXEC) step = 'Duyệt (Ban điều hành)';
    if (!step) return;
    out.push({ source: 'Chi phí quảng cáo', icon: ICONS.money, title: `${r.code} — ${esc(r.platform || '')}`, meta: `${esc(r.centers?.name || '')} · ${fmtMoney(r.amount)}`, stepLabel: step, url: '/mkt/expense-reports.html', updatedAt: r.created_at });
  });
  return out;
}

const SOURCES = [
  loadPaymentRequests, loadAdvanceRequests, loadPurchaseOrders, loadContracts,
  loadBusinessTrips, loadLateClockin, loadLeaveRequests, loadFacPurchaseRequests,
  loadEventProposals, loadFacilityRequests, loadCommunicationRequests,
  loadRefundRequests, loadPermissionRequests, loadInternalProposals, loadAdExpenses,
];

function renderChips() {
  const groups = {};
  ALL_ITEMS.forEach((it) => { groups[it.source] = (groups[it.source] || 0) + 1; });
  const chipsEl = document.getElementById('approvalChips');
  const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  chipsEl.innerHTML = `
    <button class="approval-chip ${ACTIVE_FILTER === 'all' ? 'is-active' : ''}" data-filter="all">Tất cả <span class="approval-chip__count">${ALL_ITEMS.length}</span></button>
    ${entries.map(([name, count]) => `
      <button class="approval-chip ${ACTIVE_FILTER === name ? 'is-active' : ''}" data-filter="${esc(name)}">${esc(name)} <span class="approval-chip__count">${count}</span></button>
    `).join('')}
  `;
  chipsEl.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { ACTIVE_FILTER = b.dataset.filter; render(); }));
}

function render() {
  renderChips();
  const list = ALL_ITEMS.filter((it) => ACTIVE_FILTER === 'all' || it.source === ACTIVE_FILTER)
    .sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0)); // chờ lâu nhất lên trước
  const el = document.getElementById('approvalList');
  if (list.length === 0) {
    el.innerHTML = `
      <div class="approval-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
        <div style="font-weight:700; color:var(--ink);">Không có việc gì đang chờ bạn duyệt</div>
        <div style="margin-top:4px;">Mọi phiếu/đơn thuộc phạm vi phê duyệt của bạn đều đã được xử lý.</div>
      </div>`;
    return;
  }
  el.innerHTML = list.map((it) => `
    <div class="approval-row">
      <div class="approval-row__icon">${it.icon}</div>
      <div class="approval-row__body">
        <div class="approval-row__title">${esc(it.title || '—')}</div>
        <div class="approval-row__meta">${it.source}${it.meta ? ' · ' + it.meta : ''} · ${fmtDate(it.updatedAt)}</div>
        <span class="approval-row__step">${esc(it.stepLabel)}</span>
      </div>
      <div class="approval-row__action">
        <button class="btn btn-accent btn-sm" data-go="${esc(it.url)}">Xử lý ngay</button>
      </div>
    </div>
  `).join('');
  el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { window.location.href = b.dataset.go; }));
}

// MỚI — cho phép trang khác (world-select.html) hiện đúng số việc đang
// chờ duyệt (ô "Việc đang chờ duyệt" ở Trang chủ trước đây luôn hiện dấu
// "—" vì chưa từng nối dữ liệu) — dùng lại ĐÚNG 14 nguồn đã có ở trên,
// không viết trùng logic lọc theo quyền ở nơi khác (dễ lệch nhau).
export async function getPendingApprovalCount(profile) {
  PROFILE = profile;
  const results = await Promise.all(SOURCES.map((fn) => fn().catch(() => [])));
  return results.flat().length;
}

async function loadAll() {
  document.getElementById('approvalList').innerHTML = '<div class="approval-empty">Đang tải dữ liệu từ tất cả phòng ban...</div>';
  const results = await Promise.all(SOURCES.map((fn) => fn().catch((e) => { console.error(fn.name, e); return []; })));
  ALL_ITEMS = results.flat();
  ACTIVE_FILTER = 'all';
  render();
}

(async () => {
  const { profile } = await bootShell();
  // Cần thêm department_id (không có sẵn trong profile chuẩn từ bootShell,
  // xem js/proposals.js — cùng 1 cách xử lý) để so khớp "trưởng phòng cùng
  // phòng" cho các luồng bên trên.
  const { data: emp } = await supabase.from('employees').select('department_id, center_id').eq('id', profile.id).single();
  PROFILE = { ...profile, departmentId: emp?.department_id || null, centerId: emp?.center_id || profile.centerId };

  document.getElementById('btnRefresh').addEventListener('click', loadAll);
  await loadAll();
})();
