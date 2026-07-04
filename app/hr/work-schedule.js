import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const DAY_LABEL = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
let PROFILE = null;
let CAN_EDIT = false;
let EMPLOYEES = [];
let WEEK_ROWS = [];

function mondayOf(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtShort(d) { return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }); }

async function loadLookups() {
  const [{ data: centers }, { data: employees }] = await Promise.all([
    supabase.from('centers').select('id, name').order('name'),
    // Nhân sự hành chính = trừ phòng học vụ (EDU), đúng phạm vi đề bài
    supabase.from('employees').select('id, employee_code, full_name, center_id, departments(code)').order('full_name'),
  ]);
  EMPLOYEES = (employees || []).filter((e) => e.departments?.code !== 'EDU');

  const centerOpts = '<option value="">— Chọn trung tâm —</option>' +
    (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  document.getElementById('centerSelect').innerHTML = centerOpts;
  document.getElementById('filterCenter').innerHTML = '<option value="">Tất cả trung tâm</option>' +
    (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  document.getElementById('employeeSelect').innerHTML = '<option value="">— Chọn nhân viên —</option>' +
    EMPLOYEES.map((e) => `<option value="${e.id}">${esc(e.employee_code)} — ${esc(e.full_name)}</option>`).join('');
}

function currentWeekStart() { return mondayOf(document.getElementById('weekPicker').value); }

async function loadWeek() {
  const tbody = document.getElementById('weekGridBody');
  tbody.innerHTML = '<tr><td class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const weekStart = currentWeekStart();
  const weekEnd = addDays(weekStart, 6);
  document.getElementById('weekLabel').textContent = `Tuần ${fmtShort(weekStart)} – ${fmtShort(weekEnd)}`;

  const centerFilter = document.getElementById('filterCenter').value;
  const employeesInView = centerFilter ? EMPLOYEES.filter((e) => e.center_id === centerFilter) : EMPLOYEES;

  let query = supabase
    .from('work_schedules')
    .select('id, work_date, shift, employee_id, center_id')
    .gte('work_date', weekStart)
    .lte('work_date', weekEnd);
  if (centerFilter) query = query.eq('center_id', centerFilter);

  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  WEEK_ROWS = data || [];

  document.getElementById('resultCount').textContent = `${employeesInView.length} nhân viên`;
  renderHead(weekStart);
  renderBody(employeesInView, weekStart);
}

function renderHead(weekStart) {
  const head = document.getElementById('weekGridHead');
  head.innerHTML = '<th class="week-grid__name-col">Nhân viên</th>' +
    DAY_LABEL.map((label, i) => `<th>${label}<span class="day-date">${fmtShort(addDays(weekStart, i))}</span></th>`).join('');
}

function renderBody(employeesInView, weekStart) {
  const tbody = document.getElementById('weekGridBody');
  if (employeesInView.length === 0) {
    tbody.innerHTML = '<tr><td class="empty-cell">Không có nhân viên nào trong phạm vi này.</td></tr>';
    return;
  }

  const byEmpDay = {};
  WEEK_ROWS.forEach((r) => { byEmpDay[`${r.employee_id}_${r.work_date}`] = r; });

  tbody.innerHTML = employeesInView.map((emp) => `
    <tr>
      <td class="week-grid__name-col">${esc(emp.full_name)}<div class="cell-muted" style="font-weight:400;">${esc(emp.employee_code)}</div></td>
      ${DAY_LABEL.map((_, i) => {
        const date = addDays(weekStart, i);
        const sched = byEmpDay[`${emp.id}_${date}`];
        return `<td>
          <div class="week-cell ${sched ? 'has-shift' : ''}" data-emp="${emp.id}" data-center="${emp.center_id || ''}" data-date="${date}" data-sched="${sched?.id || ''}">
            ${sched ? `<span class="shift-label">${esc(sched.shift || 'Có lịch')}</span>` : (CAN_EDIT ? '<span class="shift-empty">+</span>' : '')}
          </div>
        </td>`;
      }).join('')}
    </tr>
  `).join('');

  if (!CAN_EDIT) return;
  tbody.querySelectorAll('.week-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const schedId = cell.dataset.sched;
      if (schedId) {
        openEdit(schedId);
      } else {
        openAddForCell(cell.dataset.emp, cell.dataset.center, cell.dataset.date);
      }
    });
  });
}

document.getElementById('filterCenter').addEventListener('change', loadWeek);
document.getElementById('weekPicker').addEventListener('change', loadWeek);
document.getElementById('btnPrevWeek').addEventListener('click', () => {
  document.getElementById('weekPicker').value = addDays(currentWeekStart(), -7);
  loadWeek();
});
document.getElementById('btnNextWeek').addEventListener('click', () => {
  document.getElementById('weekPicker').value = addDays(currentWeekStart(), 7);
  loadWeek();
});

const modal = document.getElementById('schedModal');
const form = document.getElementById('schedForm');
const formError = document.getElementById('formError');
const deleteBtn = document.getElementById('deleteSched');

function openAddForCell(employeeId, centerId, date) {
  form.reset();
  document.getElementById('schedId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm lịch làm việc';
  document.getElementById('employeeSelect').value = employeeId;
  document.getElementById('centerSelect').value = centerId;
  document.getElementById('workDate').value = date;
  deleteBtn.style.display = 'none';
  formError.classList.remove('show');
  modal.classList.add('show');
}

function openEdit(id) {
  const row = WEEK_ROWS.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('modalTitle').textContent = 'Sửa lịch làm việc';
  document.getElementById('schedId').value = row.id;
  document.getElementById('employeeSelect').value = row.employee_id;
  document.getElementById('centerSelect').value = row.center_id;
  document.getElementById('workDate').value = row.work_date;
  document.getElementById('shift').value = row.shift || '';
  deleteBtn.style.display = 'inline-flex';
  formError.classList.remove('show');
  modal.classList.add('show');
}

document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

deleteBtn.addEventListener('click', async () => {
  const id = document.getElementById('schedId').value;
  if (!id || !confirm('Xoá lịch làm việc này?')) return;
  const { error } = await supabase.from('work_schedules').delete().eq('id', id);
  if (error) { formError.textContent = error.message; formError.classList.add('show'); return; }
  modal.classList.remove('show');
  await loadWeek();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('schedId').value;
  const payload = {
    employee_id: document.getElementById('employeeSelect').value,
    center_id: document.getElementById('centerSelect').value,
    work_date: document.getElementById('workDate').value,
    shift: document.getElementById('shift').value || null,
    created_by: PROFILE.id,
  };
  const btn = document.getElementById('submitSched');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = id
      ? await supabase.from('work_schedules').update(payload).eq('id', id)
      : await supabase.from('work_schedules').insert(payload);
    if (error) throw error;
    modal.classList.remove('show');
    await loadWeek();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    CAN_EDIT = profile.departmentCode === 'HR' || profile.roleCode === 'EXECUTIVE' || profile.roleCode === 'TECH';
    document.getElementById('weekPicker').value = mondayOf();
    await loadLookups();
    await loadWeek();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
