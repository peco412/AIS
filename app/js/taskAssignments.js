import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { t } from '/js/i18n.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.' + code, code) });
const STATUS_BADGE = { pending: 'draft', in_progress: 'approved_1', done: 'active', overdue: 'rejected' };

// Nguồn "đầu việc" thật của từng phòng ban — đây chính là ý nghĩa của "Phân
// việc": các yêu cầu/phiếu phát sinh từ đúng module của phòng ban (vd Kế
// toán có Phiếu thanh toán + Phiếu tạm ứng) được LIỆT KÊ TRỰC TIẾP ở đây
// để trưởng phòng thấy ngay và phân công cho nhân sự — không phải việc tự
// nghĩ ra. "Giao việc ngoài luồng" chỉ dùng cho việc phát sinh KHÁC hẳn,
// không nằm trong các module yêu cầu này.
const REQUEST_SOURCES = {
  HR: [
    { table: 'leave_requests', label: 'Đơn xin nghỉ', statuses: ['approved_1'], titleFn: (r) => `Xử lý đơn nghỉ ${r.code || ''}${r.reason_note ? ' — ' + r.reason_note : ''}`, href: '/hr/leave-requests.html' },
    { table: 'business_trips', label: 'Đơn công tác', statuses: ['approved_1'], titleFn: (r) => `Xử lý đơn công tác ${r.code} — ${r.title || ''}`, href: '/hr/business-trips.html' },
  ],
  ACC: [
    // SUA LOI: truoc day dung ['submitted','approved_1'] tu luc chua co
    // cap "Quan ly truc tiep" (migration 39) - 'submitted'/'draft' luc do
    // dang cho QUAN LY TRUC TIEP duyet, CHUA toi luot Ke toan, hien nham
    // vao day khien Ke toan thay ca viec chua den luot minh xu ly.
    { table: 'payment_requests', label: 'Phiếu đề nghị thanh toán', statuses: ['approved_1'], titleFn: (r) => `Xử lý phiếu thanh toán ${r.code}`, href: '/acc/payment-requests.html' },
    { table: 'advance_requests', label: 'Phiếu đề nghị tạm ứng', statuses: ['approved_1'], titleFn: (r) => `Xử lý phiếu tạm ứng ${r.code}`, href: '/acc/advance-requests.html' },
  ],
  MKT: [
    { table: 'communication_requests', label: 'Yêu cầu truyền thông', statuses: ['center_approved', 'in_progress'], titleFn: (r) => `Xử lý yêu cầu: ${r.title}`, href: '/mkt/requests.html' },
  ],
  FAC: [
    { table: 'facility_requests', label: 'Yêu cầu CSVC', statuses: ['center_approved', 'in_progress'], titleFn: (r) => `Xử lý yêu cầu: ${r.title}`, href: '/fac/requests.html' },
    // SUA LOI TUONG TU: purchase_requests gio la draft(chu ky)->submitted
    // (cho QL truc tiep)->approved_1(cho CSVC)->approved_2(cho BDH), 'draft'
    // khong con dung nghia "cho CSVC" nua.
    { table: 'purchase_requests', label: 'Phiếu đề nghị mua sắm/sửa chữa', statuses: ['draft'], titleFn: (r) => `Xử lý phiếu ${r.request_type === 'repair' ? 'sửa chữa' : 'mua sắm'} ${r.code}`, href: '/fac/purchase-requests.html' },
  ],
};

/**
 * Khởi tạo trang Phân việc cho 1 phòng ban cụ thể.
 * @param {string} deptCode - 'ACC' | 'MKT' | 'FAC'
 */
export async function initTaskAssignments(deptCode) {
  let PROFILE = null;
  let DEPT_ID = null;
  let IS_HEAD = false;
  let TEAM = [];
  let ALL_ROWS = [];
  let PENDING_REQUESTS = [];

  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

  async function loadTeam() {
    const { data } = await supabase.from('employees').select('id, full_name').eq('department_id', DEPT_ID).order('full_name');
    TEAM = data || [];
    const sel = document.getElementById('assignTo');
    sel.innerHTML = TEAM.map((e) => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('');
  }

  // Lấy các yêu cầu đang chờ xử lý của phòng ban này TRỰC TIẾP từ đúng
  // module nghiệp vụ (payment_requests, advance_requests...), đã lọc bỏ
  // những yêu cầu đã có người phụ trách (đã tồn tại task_assignments trỏ
  // tới) để tránh giao trùng — rồi hiển thị NGAY trên trang, không giấu
  // trong dropdown của modal nữa.
  async function loadPendingRequests() {
    const sources = REQUEST_SOURCES[deptCode] || [];
    const existing = await supabase
      .from('task_assignments')
      .select('related_table, related_id')
      .eq('department_id', DEPT_ID)
      .neq('status', 'done');
    const alreadyAssigned = new Set((existing.data || []).map((t) => `${t.related_table}:${t.related_id}`));

    const results = await Promise.all(sources.map((src) =>
      supabase.from(src.table).select('*').in('status', src.statuses).then((r) => (r.data || []).map((row) => ({ ...row, src })))
    ));

    PENDING_REQUESTS = results.flat()
      .filter((r) => !alreadyAssigned.has(`${r.src.table}:${r.id}`))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    renderPending();
  }

  function renderPending() {
    const tbody = document.getElementById('pendingTableBody');
    if (!tbody) return;

    if (PENDING_REQUESTS.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">🎉 Không có yêu cầu nào đang chờ phân công.</td></tr>';
      return;
    }

    tbody.innerHTML = PENDING_REQUESTS.map((r, i) => `
      <tr>
        <td><span class="badge badge-submitted">${esc(r.src.label)}</span></td>
        <td>${esc(r.code || r.title)}</td>
        <td>${IS_HEAD ? `<button class="btn btn-accent btn-sm" data-assign="${i}">Giao việc</button>` : `<a href="${esc(r.src.href)}" class="btn btn-outline btn-sm">Xem</a>`}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-assign]').forEach((btn) => {
      btn.addEventListener('click', () => openAssignModal(PENDING_REQUESTS[Number(btn.dataset.assign)]));
    });
  }

  async function loadRows() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';
    const scope = document.getElementById('viewScope').value;

    let query = supabase
      .from('task_assignments')
      .select('id, title, description, due_date, status, assigned_to, assigned_by, related_table, related_id, employees:assigned_to(full_name), assigner:assigned_by(full_name)')
      .eq('department_id', DEPT_ID)
      .order('due_date', { ascending: true });
    if (scope === 'mine') query = query.eq('assigned_to', PROFILE.id);

    const { data, error } = await query;
    if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
    ALL_ROWS = data || [];
    render();
  }

  function render() {
    document.getElementById('resultCount').textContent = `${ALL_ROWS.length} công việc`;
    const tbody = document.getElementById('tableBody');
    if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có công việc nào.</td></tr>'; return; }

    const sourceByTable = {};
    Object.values(REQUEST_SOURCES).flat().forEach((s) => { sourceByTable[s.table] = s; });

    tbody.innerHTML = ALL_ROWS.map((r) => {
      const src = r.related_table ? sourceByTable[r.related_table] : null;
      return `
      <tr>
        <td>
          <strong>${esc(r.title)}</strong>${r.description ? `<div class="cell-muted">${esc(r.description)}</div>` : ''}
          ${src ? `<div><a href="${esc(src.href)}" class="cell-muted" style="text-decoration:underline;">↳ Xem yêu cầu gốc</a></div>` : '<div class="cell-muted">Việc ngoài luồng</div>'}
        </td>
        <td>${esc(r.employees?.full_name || '—')}</td>
        <td class="cell-muted">${esc(r.assigner?.full_name || '—')}</td>
        <td class="cell-muted">${fmtDate(r.due_date)}</td>
        <td><span class="badge badge-${STATUS_BADGE[r.status]}">${esc(STATUS_LABEL[r.status])}</span></td>
        <td>
          ${r.assigned_to === PROFILE.id && r.status !== 'done' ? `
            <select class="select-input" data-status="${r.id}" style="padding:5px 8px;font-size:12px;">
              <option value="pending" ${r.status === 'pending' ? 'selected' : ''}>Chưa bắt đầu</option>
              <option value="in_progress" ${r.status === 'in_progress' ? 'selected' : ''}>Đang xử lý</option>
              <option value="done" ${r.status === 'done' ? 'selected' : ''}>Hoàn thành</option>
            </select>` : ''}
        </td>
      </tr>
    `;
    }).join('');

    tbody.querySelectorAll('[data-status]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const { error } = await supabase.from('task_assignments').update({ status: sel.value }).eq('id', sel.dataset.status);
        if (error) { alert('Lỗi: ' + error.message); return; }
        await loadRows();
      });
    });
  }

  document.getElementById('viewScope').addEventListener('change', loadRows);

  // ---------------------------------------------------------------------
  // Modal giao việc — 2 cách mở:
  // 1) Bấm "Giao việc" ngay trên 1 yêu cầu đang chờ (openAssignModal) —
  //    tiêu đề tự điền sẵn, chỉ cần chọn người nhận.
  // 2) Bấm "+ Giao việc ngoài luồng" (openOffPipelineModal) — nhập tay
  //    hoàn toàn, dùng cho việc phát sinh KHÔNG nằm trong các module yêu
  //    cầu ở trên.
  // ---------------------------------------------------------------------
  const modal = document.getElementById('taskModal');
  const formError = document.getElementById('formError');
  let CURRENT_LINKED = null;

  function openAssignModal(request) {
    CURRENT_LINKED = request;
    formError.classList.remove('show');
    document.getElementById('taskModalTitle').textContent = `Giao việc: ${request.src.label}`;
    document.getElementById('taskModalSub').style.display = 'block';
    document.getElementById('taskModalSub').textContent = `Yêu cầu gốc: ${request.code || request.title}`;
    document.getElementById('taskTitle').value = request.src.titleFn(request);
    document.getElementById('taskTitle').readOnly = true;
    document.getElementById('taskDesc').value = '';
    document.getElementById('dueDate').value = '';
    modal.classList.add('show');
  }

  function openOffPipelineModal() {
    CURRENT_LINKED = null;
    formError.classList.remove('show');
    document.getElementById('taskModalTitle').textContent = 'Giao việc ngoài luồng';
    document.getElementById('taskModalSub').style.display = 'none';
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskTitle').readOnly = false;
    document.getElementById('taskDesc').value = '';
    document.getElementById('dueDate').value = '';
    modal.classList.add('show');
  }

  document.getElementById('btnAdd')?.addEventListener('click', openOffPipelineModal);
  document.getElementById('closeModal')?.addEventListener('click', () => modal.classList.remove('show'));
  document.getElementById('cancelModal')?.addEventListener('click', () => modal.classList.remove('show'));

  document.getElementById('submitTask')?.addEventListener('click', async () => {
    formError.classList.remove('show');
    const title = document.getElementById('taskTitle').value.trim();
    if (!title) { formError.textContent = 'Vui lòng nhập tiêu đề công việc.'; formError.classList.add('show'); return; }

    const btn = document.getElementById('submitTask');
    btn.disabled = true; btn.textContent = 'Đang giao...';
    try {
      const { error } = await supabase.from('task_assignments').insert({
        department_id: DEPT_ID, assigned_by: PROFILE.id,
        assigned_to: document.getElementById('assignTo').value,
        title, description: document.getElementById('taskDesc').value || null,
        due_date: document.getElementById('dueDate').value || null,
        status: 'pending',
        related_table: CURRENT_LINKED?.src.table || null,
        related_id: CURRENT_LINKED?.id || null,
      });
      if (error) throw error;
      modal.classList.remove('show');
      await Promise.all([loadRows(), loadPendingRequests()]);
    } catch (err) {
      formError.textContent = err.message || 'Có lỗi xảy ra.';
      formError.classList.add('show');
    } finally {
      btn.disabled = false; btn.textContent = 'Giao việc';
    }
  });

  try {
    const { profile } = await bootShell();
    const { data: dept } = await supabase.from('departments').select('id').eq('code', deptCode).single();
    DEPT_ID = dept?.id;
    PROFILE = profile;
    IS_HEAD = (profile.departmentCode === deptCode && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode))
      || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);

    document.getElementById('btnAdd').style.display = IS_HEAD ? 'inline-flex' : 'none';
    if (IS_HEAD) document.getElementById('deptScopeOption').style.display = 'block';

    await loadTeam();
    await Promise.all([loadRows(), loadPendingRequests()]);
  } catch (e) { /* bootShell tự điều hướng */ }
}
