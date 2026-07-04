import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const STATUS_LABEL = { pending: 'Chưa bắt đầu', in_progress: 'Đang xử lý', done: 'Hoàn thành', overdue: 'Trễ hạn' };
const STATUS_BADGE = { pending: 'draft', in_progress: 'approved_1', done: 'active', overdue: 'rejected' };

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

  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

  async function loadTeam() {
    const { data } = await supabase.from('employees').select('id, full_name').eq('department_id', DEPT_ID).order('full_name');
    TEAM = data || [];
    const sel = document.getElementById('assignTo');
    sel.innerHTML = TEAM.map((e) => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('');
  }

  async function loadRows() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';
    const scope = document.getElementById('viewScope').value;

    let query = supabase
      .from('task_assignments')
      .select('id, title, description, due_date, status, assigned_to, assigned_by, employees:assigned_to(full_name), assigner:assigned_by(full_name)')
      .eq('department_id', DEPT_ID)
      .order('due_date', { ascending: true });
    if (scope === 'mine') query = query.eq('assigned_to', PROFILE.id);

    const { data, error } = await query;
    if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
    ALL_ROWS = data || [];
    render();
  }

  function render() {
    document.getElementById('resultCount').textContent = `${ALL_ROWS.length} công việc`;
    const tbody = document.getElementById('tableBody');
    if (ALL_ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có công việc nào.</td></tr>'; return; }

    tbody.innerHTML = ALL_ROWS.map((r) => `
      <tr>
        <td><strong>${esc(r.title)}</strong>${r.description ? `<div class="cell-muted">${esc(r.description)}</div>` : ''}</td>
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
    `).join('');

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
  // Giao việc mới
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
    if (IS_HEAD) document.getElementById('deptScopeOption').style.display = 'block';

    await loadTeam();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
}
