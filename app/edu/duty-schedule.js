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
  const { data: centers } = await supabase.from('centers').select('id, name').order('name');
  const filterCenter = document.getElementById('filterCenter');

  if (CAN_EDIT) {
    // Quản lý trung tâm chỉ trực trung tâm mình -> khoá filter về đúng trung tâm đó
    filterCenter.innerHTML = (centers || [])
      .filter((c) => c.id === PROFILE.centerId)
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    filterCenter.disabled = true;

    const { data: employees } = await supabase
      .from('employees').select('id, employee_code, full_name').eq('center_id', PROFILE.centerId).order('full_name');
    EMPLOYEES = employees || [];
    document.getElementById('employeeSelect').innerHTML = '<option value="">— Chọn nhân viên —</option>' +
      EMPLOYEES.map((e) => `<option value="${e.id}">${esc(e.employee_code)} — ${esc(e.full_name)}</option>`).join('');
  } else {
    filterCenter.innerHTML = '<option value="">— Chọn trung tâm để xem —</option>' +
      (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }
}

function currentWeekStart() { return mondayOf(document.getElementById('weekPicker').value); }

async function loadEmployeesForCenter(centerId) {
  if (CAN_EDIT) return EMPLOYEES;
  if (!centerId) return [];
  const { data } = await supabase.from('employees').select('id, employee_code, full_name').eq('center_id', centerId).order('full_name');
  return data || [];
}

async function loadWeek() {
  const tbody = document.getElementById('weekGridBody');
  tbody.innerHTML = '<tr><td class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const centerId = CAN_EDIT ? PROFILE.centerId : document.getElementById('filterCenter').value;
  if (!centerId) {
    tbody.innerHTML = '<tr><td class="empty-cell">Chọn 1 trung tâm để xem lịch trực.</td></tr>';
    document.getElementById('resultCount').textContent = '';
    return;
  }

  const weekStart = currentWeekStart();
  const weekEnd = addDays(weekStart, 6);
  document.getElementById('weekLabel').textContent = `Tuần ${fmtShort(weekStart)} – ${fmtShort(weekEnd)}`;

  const employeesInView = await loadEmployeesForCenter(centerId);

  const { data, error } = await supabase
    .from('center_duty_schedules')
    .select('id, duty_date, shift, employee_id, center_id')
    .eq('center_id', centerId)
    .gte('duty_date', weekStart)
    .lte('duty_date', weekEnd);

  if (error) { tbody.innerHTML = `<tr><td class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  WEEK_ROWS = data || [];

  document.getElementById('resultCount').textContent = `${employeesInView.length} nhân viên`;
  renderHead(weekStart);
  renderBody(employeesInView, weekStart, centerId);
}

function renderHead(weekStart) {
  const head = document.getElementById('weekGridHead');
  head.innerHTML = '<th class="week-grid__name-col">Nhân viên</th>' +
    DAY_LABEL.map((label, i) => `<th>${label}<span class="day-date">${fmtShort(addDays(weekStart, i))}</span></th>`).join('');
}

function renderBody(employeesInView, weekStart, centerId) {
  const tbody = document.getElementById('weekGridBody');
  if (employeesInView.length === 0) {
    tbody.innerHTML = '<tr><td class="empty-cell">Trung tâm này chưa có nhân viên.</td></tr>';
    return;
  }

  const byEmpDay = {};
  WEEK_ROWS.forEach((r) => { byEmpDay[`${r.employee_id}_${r.duty_date}`] = r; });

  tbody.innerHTML = employeesInView.map((emp) => `
    <tr>
      <td class="week-grid__name-col">${esc(emp.full_name)}<div class="cell-muted" style="font-weight:400;">${esc(emp.employee_code)}</div></td>
      ${DAY_LABEL.map((_, i) => {
        const date = addDays(weekStart, i);
        const sched = byEmpDay[`${emp.id}_${date}`];
        return `<td>
          <div class="week-cell ${sched ? 'has-shift' : ''}" data-emp="${emp.id}" data-date="${date}" data-sched="${sched?.id || ''}">
            ${sched ? `<span class="shift-label">${esc(sched.shift || 'Trực')}</span>` : (CAN_EDIT ? '<span class="shift-empty">+</span>' : '')}
          </div>
        </td>`;
      }).join('')}
    </tr>
  `).join('');

  if (!CAN_EDIT) return;
  tbody.querySelectorAll('.week-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const schedId = cell.dataset.sched;
      if (schedId) openEdit(schedId);
      else openAddForCell(cell.dataset.emp, cell.dataset.date);
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

const modal = document.getElementById('dutyModal');
const form = document.getElementById('dutyForm');
const formError = document.getElementById('formError');
const deleteBtn = document.getElementById('deleteDuty');

function openAddForCell(employeeId, date) {
  form.reset();
  document.getElementById('dutyId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm lịch trực';
  document.getElementById('employeeSelect').value = employeeId;
  document.getElementById('dutyDate').value = date;
  deleteBtn.style.display = 'none';
  formError.classList.remove('show');
  modal.classList.add('show');
}

function openEdit(id) {
  const row = WEEK_ROWS.find((r) => r.id === id);
  if (!row || !CAN_EDIT) return;
  document.getElementById('modalTitle').textContent = 'Sửa lịch trực';
  document.getElementById('dutyId').value = row.id;
  document.getElementById('employeeSelect').value = row.employee_id;
  document.getElementById('dutyDate').value = row.duty_date;
  document.getElementById('shift').value = row.shift || '';
  deleteBtn.style.display = 'inline-flex';
  formError.classList.remove('show');
  modal.classList.add('show');
}

document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

deleteBtn.addEventListener('click', async () => {
  const id = document.getElementById('dutyId').value;
  if (!id || !confirm('Xoá lịch trực này?')) return;
  const { error } = await supabase.from('center_duty_schedules').delete().eq('id', id);
  if (error) { formError.textContent = error.message; formError.classList.add('show'); return; }
  modal.classList.remove('show');
  await loadWeek();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('dutyId').value;
  const payload = {
    employee_id: document.getElementById('employeeSelect').value,
    center_id: PROFILE.centerId,
    duty_date: document.getElementById('dutyDate').value,
    shift: document.getElementById('shift').value || null,
    created_by: PROFILE.id,
  };
  const btn = document.getElementById('submitDuty');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = id
      ? await supabase.from('center_duty_schedules').update(payload).eq('id', id)
      : await supabase.from('center_duty_schedules').insert(payload);
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
    CAN_EDIT = profile.isCenterManager;
    document.getElementById('weekPicker').value = mondayOf();
    await loadLookups();
    await loadWeek();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
