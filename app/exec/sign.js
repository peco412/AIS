import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;

function isHead(dept) { return PROFILE.departmentCode === dept && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode); }
function isExec() { return ['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode); }

async function fetchPending() {
  const rows = [];

  // Hợp đồng lao động
  if (isHead('HR') || isExec()) {
    const { data } = await supabase.from('contracts').select('id, code, status, employees:employee_id(full_name)').in('status', ['submitted', 'approved_1']);
    (data || []).forEach((r) => {
      if (r.status === 'submitted' && isHead('HR')) rows.push(row('Hợp đồng lao động', r.code, r.employees?.full_name, 'Chờ trưởng phòng NS ký', '/hr/contracts.html'));
      if (r.status === 'approved_1' && isExec()) rows.push(row('Hợp đồng lao động', r.code, r.employees?.full_name, 'Chờ ban điều hành ký', '/hr/contracts.html'));
    });
  }

  // Phiếu đề nghị thanh toán
  if (isHead('ACC') || isExec()) {
    const { data } = await supabase.from('payment_requests').select('id, code, status, employees:requester_id(full_name)').in('status', ['submitted', 'approved_1']);
    (data || []).forEach((r) => {
      if (r.status === 'submitted' && (isHead('ACC') || isExec())) rows.push(row('Phiếu đề nghị thanh toán', r.code, r.employees?.full_name, 'Chờ kế toán ký', '/acc/payment-requests.html'));
      if (r.status === 'approved_1' && isExec()) rows.push(row('Phiếu đề nghị thanh toán', r.code, r.employees?.full_name, 'Chờ ban điều hành ký', '/acc/payment-requests.html'));
    });
  }

  // Phiếu đề nghị tạm ứng
  if (isHead('ACC') || isExec()) {
    const { data } = await supabase.from('advance_requests').select('id, code, status, employees:requester_id(full_name)').in('status', ['draft', 'approved_1']);
    (data || []).forEach((r) => {
      if (r.status === 'draft' && (isHead('ACC') || isExec())) rows.push(row('Phiếu đề nghị tạm ứng', r.code, r.employees?.full_name, 'Chờ kế toán ký', '/acc/advance-requests.html'));
      if (r.status === 'approved_1' && isExec()) rows.push(row('Phiếu đề nghị tạm ứng', r.code, r.employees?.full_name, 'Chờ ban điều hành ký', '/acc/advance-requests.html'));
    });
  }

  // Trình sự kiện
  if (isHead('MKT') || isExec()) {
    const { data } = await supabase.from('event_proposals').select('id, code, status, employees:center_manager_id(full_name)').in('status', ['draft', 'approved_1']);
    (data || []).forEach((r) => {
      if (r.status === 'draft' && (isHead('MKT') || isExec())) rows.push(row('Trình sự kiện', r.code, r.employees?.full_name, 'Chờ truyền thông duyệt', '/mkt/event-proposals.html'));
      if (r.status === 'approved_1' && isExec()) rows.push(row('Trình sự kiện', r.code, r.employees?.full_name, 'Chờ ban điều hành duyệt', '/mkt/event-proposals.html'));
    });
  }

  // Phiếu đề nghị mua sắm
  if (isHead('FAC') || isExec()) {
    const { data } = await supabase.from('purchase_requests').select('id, code, status, employees:requester_id(full_name)').in('status', ['draft', 'approved_1']);
    (data || []).forEach((r) => {
      if (r.status === 'draft' && (isHead('FAC') || isExec())) rows.push(row('Phiếu đề nghị mua sắm', r.code, r.employees?.full_name, 'Chờ trưởng phòng CSVC duyệt', '/fac/purchase-requests.html'));
      if (r.status === 'approved_1' && isExec()) rows.push(row('Phiếu đề nghị mua sắm', r.code, r.employees?.full_name, 'Chờ ban điều hành ký', '/fac/purchase-requests.html'));
    });
  }

  // Đề xuất nội bộ (mọi phòng ban nếu là trưởng phòng, hoặc exec/tech cho tất cả)
  {
    const { data } = await supabase.from('internal_proposals').select('id, code, status, department_id, employees:employee_id(full_name), departments(code)').in('status', ['submitted', 'approved_1']);
    (data || []).forEach((r) => {
      const deptCode = r.departments?.code;
      if (r.status === 'submitted' && (isHead(deptCode) || isExec())) rows.push(row('Đề xuất nội bộ', r.code, r.employees?.full_name, 'Chờ trưởng phòng duyệt', '/proposals.html'));
      if (r.status === 'approved_1' && isExec()) rows.push(row('Đề xuất nội bộ', r.code, r.employees?.full_name, 'Chờ ban điều hành duyệt', '/proposals.html'));
    });
  }

  return rows;
}

function row(type, code, requester, stepLabel, href) {
  return { type, code, requester: requester || '—', stepLabel, href };
}

function render(rows) {
  document.getElementById('tableBody').innerHTML = rows.length === 0
    ? '<tr><td colspan="5" class="empty-cell">🎉 Không có hồ sơ nào đang chờ bạn xử lý.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td>${esc(r.type)}</td>
        <td class="cell-code">${esc(r.code)}</td>
        <td>${esc(r.requester)}</td>
        <td><span class="badge badge-submitted">${esc(r.stepLabel)}</span></td>
        <td><a class="btn btn-accent btn-sm" href="${esc(r.href)}">Xử lý →</a></td>
      </tr>
    `).join('');
}

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    const rows = await fetchPending();
    render(rows);
  } catch (e) { /* bootShell tự điều hướng */ }
})();
