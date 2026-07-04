import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, openFile } from '/js/supabase.js';

const LEAVE_TYPE_LABEL = { annual: 'Nghỉ phép', unpaid: 'Nghỉ không lương', social_insurance: 'Nghỉ BHXH' };
const REASON_LABEL = {
  work_swap: 'Bù ngày làm', personal_family: 'Cá nhân / gia đình', sick: 'Bệnh / ốm',
  maternity: 'Thai sản', ceremony: 'Hiếu hỉ', funeral: 'Đám tang',
};
const STATUS_LABEL = { draft: 'Nháp', submitted: 'Đã gửi', approved_1: 'Duyệt cấp 1', approved_2: 'Đã duyệt', archived: 'Lưu trữ', rejected: 'Từ chối' };

let PROFILE = null;
let CAN_APPROVE = false;
let ALL_ROWS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

async function loadBalanceHint() {
  const now = new Date();
  const { data } = await supabase
    .from('leave_balances')
    .select('annual_leave_accrued, annual_leave_used, compensatory_leave')
    .eq('employee_id', PROFILE.id)
    .eq('year', now.getFullYear())
    .eq('month', now.getMonth() + 1)
    .maybeSingle();

  const hint = document.getElementById('leaveBalanceHint');
  if (!data) { hint.textContent = 'Chưa có dữ liệu ngày phép tháng này.'; return; }
  const remain = (Number(data.annual_leave_accrued) - Number(data.annual_leave_used) + Number(data.compensatory_leave)).toFixed(1);
  hint.textContent = `Bạn còn ${remain} ngày phép (bao gồm nghỉ bù) trong tháng này.`;
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const scope = document.getElementById('viewScope').value;
  let query = supabase
    .from('leave_requests')
    .select('id, code, leave_type, leave_reason, start_date, days, return_date, reason_note, status, employee_id, attachment_url, employees(full_name, employee_code)')
    .order('created_at', { ascending: false });

  if (scope === 'mine') query = query.eq('employee_id', PROFILE.id);

  const { data, error } = await query;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Lỗi tải dữ liệu: ${error.message}</td></tr>`;
    return;
  }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const statusFilter = document.getElementById('filterStatus').value;
  const rows = ALL_ROWS.filter((r) => !statusFilter || r.status === statusFilter);
  document.getElementById('resultCount').textContent = `${rows.length} đơn`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Chưa có đơn nào.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="cell-code">${esc(r.code)}</td>
      <td>${esc(r.employees?.full_name || '—')} <span class="cell-muted">(${esc(r.employees?.employee_code || '')})</span></td>
      <td>${esc(LEAVE_TYPE_LABEL[r.leave_type] || r.leave_type)}</td>
      <td>${fmtDate(r.start_date)}</td>
      <td>${r.days}</td>
      <td class="cell-muted">${esc(REASON_LABEL[r.leave_reason] || r.reason_note || '—')}</td>
      <td><span class="badge badge-${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td>
        ${r.attachment_url ? `<button class="btn btn-outline btn-sm" data-open="${esc(r.attachment_url)}">Xem đính kèm</button>` : ''}
        ${CAN_APPROVE && r.status === 'submitted'
          ? `<button class="btn btn-accent btn-sm" data-approve="${r.id}">Duyệt</button>
             <button class="btn btn-outline btn-sm" data-reject="${r.id}">Từ chối</button>`
          : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => openFile(btn.dataset.open)));
  tbody.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', (e) => approve(e.currentTarget, btn.dataset.approve)));
  tbody.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', (e) => reject(e.currentTarget, btn.dataset.reject)));
}

// Duyệt: gọi RPC atomic ở DB (đổi trạng thái + trừ ngày phép trong cùng 1
// transaction) thay vì 2 request rời rạc — tránh mất đồng bộ nếu mất mạng
// giữa 2 bước, và tránh lost-update khi bấm nhiều lần liên tiếp.
async function approve(btn, id) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Đang xử lý...';
  const { error } = await supabase.rpc('approve_leave_request', { p_leave_id: id });
  if (error) {
    alert('Không thể duyệt: ' + error.message);
    btn.disabled = false;
    btn.textContent = 'Duyệt';
    return;
  }
  await loadRows();
}

async function reject(btn, id) {
  if (btn.disabled) return;
  btn.disabled = true;
  const { error } = await supabase
    .from('leave_requests')
    .update({ status: 'rejected', approved_by: PROFILE.id, approved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { alert('Không thể cập nhật: ' + error.message); btn.disabled = false; return; }
  await loadRows();
}

['filterStatus', 'viewScope'].forEach((id) => document.getElementById(id).addEventListener('change', () => {
  if (id === 'viewScope') loadRows(); else render();
}));

// ---------------------------------------------------------------------
// Modal tạo đơn
// ---------------------------------------------------------------------
const modal = document.getElementById('leaveModal');
const form = document.getElementById('leaveForm');
const formError = document.getElementById('formError');

document.getElementById('btnAddLeave').addEventListener('click', () => {
  form.reset();
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const submitBtn = document.getElementById('submitLeave');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang gửi...';

  try {
    let attachmentUrl = null;
    const file = document.getElementById('attachment').files[0];
    if (file) {
      const path = `leave-requests/${PROFILE.id}/${Date.now()}_${file.name}`;
      attachmentUrl = await uploadPrivateFile(path, file);
    }

    const { error } = await supabase.from('leave_requests').insert({
      employee_id: PROFILE.id,
      leave_type: document.getElementById('leaveType').value,
      leave_reason: document.getElementById('leaveReason').value,
      start_date: document.getElementById('startDate').value,
      days: Number(document.getElementById('days').value),
      return_date: document.getElementById('returnDate').value || null,
      reason_note: document.getElementById('reasonNote').value || null,
      attachment_url: attachmentUrl,
      status: 'submitted',
    });
    if (error) throw error;

    modal.classList.remove('show');
    await loadRows();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Gửi đơn';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    CAN_APPROVE = profile.departmentCode === 'HR' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode)
      || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (CAN_APPROVE) document.getElementById('deptScopeOption').style.display = 'block';
    await loadBalanceHint();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
