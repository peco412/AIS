import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { t } from '/js/i18n.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.' + code, code) });
const STATUS_BADGE = { pending: 'draft', in_progress: 'approved_1', done: 'active', overdue: 'rejected' };

// Nguồn "đầu việc" thật của từng phòng ban — đây chính là ý nghĩa của "Phân
// việc": trưởng phòng giao 1 YÊU CẦU CỤ THỂ đang chờ xử lý (không phải việc
// tự nghĩ ra) cho nhân viên trong phòng xử lý.
const REQUEST_SOURCES = {
  ACC: [
    { table: 'payment_requests', label: 'Phiếu đề nghị thanh toán', statuses: ['submitted', 'approved_1'], titleFn: (r) => `Xử lý phiếu thanh toán ${r.code}`, href: '/acc/payment-requests.html' },
    { table: 'advance_requests', label: 'Phiếu đề nghị tạm ứng', statuses: ['draft', 'approved_1'], titleFn: (r) => `Xử lý phiếu tạm ứng ${r.code}`, href: '/acc/advance-requests.html' },
  ],
  MKT: [
    { table: 'communication_requests', label: 'Yêu cầu truyền thông', statuses: ['pending', 'in_progress'], titleFn: (r) => `Xử lý yêu cầu: ${r.title}`, href: '/mkt/requests.html' },
  ],
  FAC: [
    { table: 'facility_requests', label: 'Yêu cầu CSVC', statuses: ['pending', 'in_progress'], titleFn: (r) => `Xử lý yêu cầu: ${r.title}`, href: '/fac/requests.html' },
    { table: 'purchase_requests', label: 'Phiếu đề nghị mua sắm', statuses: ['draft', 'approved_1'], titleFn: (r) => `Xử lý phiếu mua sắm ${r.code}`, href: '/fac/purchase-requests.html' },
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

  // Lấy các yêu cầu đang chờ xử lý của phòng ban này, đã lọc bỏ những yêu
  // cầu đã có người phụ trách (đã tồn tại task_assignments trỏ tới) để
  // tránh giao trùng. Các yêu cầu này được hiện TRỰC TIẾP thành dòng ở
  // đầu bảng Phân việc (xem renderPendingRow) để trưởng phòng thấy ngay
  // và phân công tại chỗ — không còn giấu trong dropdown của modal nữa.
  async function loadPendingRequests() {
    const sources = REQUEST_SOURCES[deptCode] || [];
    const existing = await supabase
      .from('task_assignments')
      .select('related_table, related_id')
      .eq('department_id', DEPT_ID)
      .neq('status', 'done');
    const alreadyAssigned = new Set((existing.data || []).map((t) => `${t.related_table}:${t.related_id}`));

    const results = await Promise.all(sources.map((src) =>
      supabase.from(src.table).select('id, code, title').in('status', src.statuses).then((r) => (r.data || []).map((row) => ({ ...row, src })))
    ));

    PENDING_REQUESTS = results.flat().filter((r) => !alreadyAssigned.has(`${r.src.table}:${r.id}`));
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

  // Dòng "chờ phân công" — hiện trực tiếp trong bảng để trưởng phòng thấy
  // ngay và phân công tại chỗ, không cần mở modal chọn từ dropdown.
  function renderPendingRow(r, idx) {
    const teamOptions = TEAM.map((e) => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('');
    return `
      <tr class="row-pending" style="background:var(--warning-bg, rgba(245,158,11,0.06));">
        <td>
          <strong>${esc(r.src.titleFn(r))}</strong>
          <div class="cell-muted">${esc(r.src.label)}</div>
          <div><a href="${esc(r.src.href)}" class="cell-muted" style="text-decoration:underline;">↳ Xem yêu cầu gốc</a></div>
        </td>
        <td>
          ${IS_HEAD ? `
            <select class="select-input" data-pending-assignee="${idx}" style="padding:5px 8px;font-size:12px;">
              <option value="">— Chọn người nhận —</option>
              ${teamOptions}
            </select>` : '<span class="cell-muted">—</span>'}
        </td>
        <td class="cell-muted">—</td>
        <td>
          ${IS_HEAD ? `<input type="date" class="select-input" data-pending-due="${idx}" style="padding:4px 6px;font-size:12px;" />` : '—'}
        </td>
        <td><span class="badge badge-draft">Chưa phân công</span></td>
        <td>
          ${IS_HEAD ? `<button class="btn btn-accent btn-sm" data-pending-assign="${idx}">Giao việc</button>` : ''}
        </td>
      </tr>
    `;
  }

  function render() {
    const pendingCount = PENDING_REQUESTS.length;
    document.getElementById('resultCount').textContent = pendingCount > 0
      ? `${ALL_ROWS.length} công việc · ${pendingCount} yêu cầu chờ phân công`
      : `${ALL_ROWS.length} công việc`;

    const tbody = document.getElementById('tableBody');
    const sourceByTable = {};
    Object.values(REQUEST_SOURCES).flat().forEach((s) => { sourceByTable[s.table] = s; });

    const pendingHtml = PENDING_REQUESTS.map((r, idx) => renderPendingRow(r, idx)).join('');

    const assignedHtml = ALL_ROWS.map((r) => {
      const src = r.related_table ? sourceByTable[r.related_table] : null;
      return `
      <tr>
        <td>
          <strong>${esc(r.title)}</strong>${r.description ? `<div class="cell-muted">${esc(r.description)}</div>` : ''}
          ${src ? `<div><a href="${esc(src.href)}" class="cell-muted" style="text-decoration:underline;">↳ Xem yêu cầu gốc</a></div>` : ''}
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

    if (!pendingHtml && !assignedHtml) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có công việc nào.</td></tr>';
      return;
    }
    tbody.innerHTML = pendingHtml + assignedHtml;

    tbody.querySelectorAll('[data-status]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const { error } = await supabase.from('task_assignments').update({ status: sel.value }).eq('id', sel.dataset.status);
        if (error) { alert('Lỗi: ' + error.message); return; }
        await loadRows();
      });
    });

    tbody.querySelectorAll('[data-pending-assign]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.pendingAssign);
        const req = PENDING_REQUESTS[idx];
        const assigneeSel = tbody.querySelector(`[data-pending-assignee="${idx}"]`);
        const dueInput = tbody.querySelector(`[data-pending-due="${idx}"]`);
        const assignedTo = assigneeSel?.value;
        if (!assignedTo) { alert('Vui lòng chọn người nhận trước khi giao việc.'); return; }

        btn.disabled = true; btn.textContent = 'Đang giao...';
        const { error } = await supabase.from('task_assignments').insert({
          department_id: DEPT_ID, assigned_by: PROFILE.id,
          assigned_to: assignedTo,
          title: req.src.titleFn(req),
          description: null,
          due_date: dueInput?.value || null,
          status: 'pending',
          related_table: req.src.table,
          related_id: req.id,
        });
        if (error) { alert('Lỗi: ' + error.message); btn.disabled = false; btn.textContent = 'Giao việc'; return; }
        await loadPendingRequests();
        await loadRows();
      });
    });
  }

  document.getElementById('viewScope').addEventListener('change', loadRows);

  // ---------------------------------------------------------------------
  // Giao việc mới — CHỈ dùng cho việc ngoài luồng (không gắn 1 yêu cầu cụ
  // thể nào). Các yêu cầu đang chờ xử lý (phiếu thanh toán, tạm ứng...)
  // giờ hiện trực tiếp thành dòng ở đầu bảng (xem renderPendingRow) để
  // trưởng phòng thấy ngay và phân công tại chỗ, không cần qua modal này.
  // ---------------------------------------------------------------------
  const modal = document.getElementById('taskModal');
  const formError = document.getElementById('formError');

  document.getElementById('btnAdd')?.addEventListener('click', () => {
    formError.classList.remove('show');
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDesc').value = '';
    document.getElementById('dueDate').value = '';
    modal.classList.add('show');
  });
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
        related_table: null,
        related_id: null,
      });
      if (error) throw error;
      modal.classList.remove('show');
      await loadRows();
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
    if (IS_HEAD) {
      document.getElementById('deptScopeOption').style.display = 'block';
      // Mặc định xem "Toàn phòng" để trưởng phòng thấy ngay các yêu cầu
      // đang chờ phân công, không phải bấm chuyển tab mới thấy.
      document.getElementById('viewScope').value = 'dept';
    }

    await loadTeam();
    await loadPendingRequests();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
}
