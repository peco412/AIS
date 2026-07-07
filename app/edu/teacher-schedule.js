import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const DAY_LABEL = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
let PROFILE = null;
let WORKING_CENTER_ID = null;
let CAN_EDIT = false;
let TEACHERS = [];
let WEEK_ROWS = [];

function fmtTime(t) { return t ? t.slice(0, 5) : ''; }
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

async function initCenterPicker() {
  if (PROFILE.centerId) { WORKING_CENTER_ID = PROFILE.centerId; return; }
  const { data: centers } = await supabase.from('centers').select('id, name').order('name');
  const sel = document.getElementById('filterCenterHQ');
  sel.style.display = '';
  sel.innerHTML = (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  WORKING_CENTER_ID = centers?.[0]?.id || null;
  sel.addEventListener('change', async () => {
    WORKING_CENTER_ID = sel.value;
    await loadLookups();
    await loadWeek();
  });
}

async function loadLookups() {
  const [{ data: classes }, { data: teachers }] = await Promise.all([
    supabase.from('classes').select('id, name').eq('center_id', WORKING_CENTER_ID).eq('status', 'active').order('name'),
    supabase.from('employees').select('id, full_name, positions(name)').eq('center_id', WORKING_CENTER_ID).eq('positions.name', 'Giáo viên'),
  ]);
  TEACHERS = (teachers || []).filter((t) => t.positions?.name === 'Giáo viên');

  document.getElementById('classSelect').innerHTML = '<option value="">— Chọn lớp —</option>' +
    (classes || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const teacherOpts = '<option value="">— Chọn giáo viên —</option>' +
    TEACHERS.map((t) => `<option value="${t.id}">${esc(t.full_name)}</option>`).join('');
  document.getElementById('teacherSelect').innerHTML = teacherOpts;
  document.getElementById('substituteFor').innerHTML = '<option value="">— Không —</option>' + teacherOpts;
}

function currentWeekStart() { return mondayOf(document.getElementById('filterWeek').value); }

async function loadWeek() {
  const tbody = document.getElementById('weekGridBody');
  tbody.innerHTML = '<tr><td class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const weekStart = currentWeekStart();
  const weekEnd = addDays(weekStart, 6);
  document.getElementById('weekLabel').textContent = `Tuần ${fmtShort(weekStart)} – ${fmtShort(weekEnd)}`;

  const { data, error } = await supabase
    .from('teacher_weekly_schedules')
    .select(`
      id, day_of_week, start_time, end_time, is_substitute, note, week_start_date,
      class_id, classes(name),
      teacher_id, teacher:employees!teacher_weekly_schedules_teacher_id_fkey(full_name),
      substitute_for_teacher_id, sub_for:employees!teacher_weekly_schedules_substitute_for_teacher_id_fkey(full_name)
    `)
    .eq('center_id', WORKING_CENTER_ID)
    .eq('week_start_date', weekStart);

  if (error) { tbody.innerHTML = `<tr><td class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  WEEK_ROWS = data || [];

  document.getElementById('resultCount').textContent = `${TEACHERS.length} giáo viên`;
  renderHead(weekStart);
  renderBody(weekStart);
}

function renderHead(weekStart) {
  const head = document.getElementById('weekGridHead');
  head.innerHTML = '<th class="week-grid__name-col">Giáo viên</th>' +
    DAY_LABEL.map((label, i) => `<th>${label}<span class="day-date">${fmtShort(addDays(weekStart, i))}</span></th>`).join('');
}

function renderBody(weekStart) {
  const tbody = document.getElementById('weekGridBody');
  if (TEACHERS.length === 0) { tbody.innerHTML = '<tr><td class="empty-cell">Trung tâm chưa có giáo viên nào.</td></tr>'; return; }

  const byTeacherDay = {};
  WEEK_ROWS.forEach((r) => { byTeacherDay[`${r.teacher_id}_${r.day_of_week}`] = r; });

  tbody.innerHTML = TEACHERS.map((t) => `
    <tr>
      <td class="week-grid__name-col">${esc(t.full_name)}</td>
      ${DAY_LABEL.map((_, i) => {
        const dayOfWeek = i + 1;
        const sched = byTeacherDay[`${t.id}_${dayOfWeek}`];
        return `<td>
          <div class="week-cell ${sched ? 'has-shift' : ''}" data-teacher="${t.id}" data-day="${dayOfWeek}" data-sched="${sched?.id || ''}">
            ${sched
              ? `<span class="shift-label">${esc(sched.classes?.name || '—')}${sched.start_time ? '<br>' + fmtTime(sched.start_time) : ''}${sched.is_substitute ? ' 🔁' : ''}</span>`
              : (CAN_EDIT ? '<span class="shift-empty">+</span>' : '')}
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
      else openAddForCell(cell.dataset.teacher, Number(cell.dataset.day));
    });
  });
}

document.getElementById('filterWeek').addEventListener('change', loadWeek);
document.getElementById('btnPrevWeek').addEventListener('click', () => {
  document.getElementById('filterWeek').value = addDays(currentWeekStart(), -7);
  loadWeek();
});
document.getElementById('btnNextWeek').addEventListener('click', () => {
  document.getElementById('filterWeek').value = addDays(currentWeekStart(), 7);
  loadWeek();
});

document.getElementById('isSubstitute').addEventListener('change', (e) => {
  document.getElementById('substituteForField').style.display = e.target.checked ? '' : 'none';
});

const modal = document.getElementById('schedModal');
const form = document.getElementById('schedForm');
const formError = document.getElementById('formError');
const deleteBtn = document.getElementById('deleteSched');

function openAddForCell(teacherId, dayOfWeek) {
  form.reset();
  document.getElementById('schedId').value = '';
  document.getElementById('teacherSelect').value = teacherId;
  document.getElementById('dayOfWeek').value = dayOfWeek;
  document.getElementById('weekStart').value = currentWeekStart();
  document.getElementById('substituteForField').style.display = 'none';
  document.getElementById('modalTitle').textContent = `Thêm buổi dạy — ${DAY_LABEL[dayOfWeek - 1]}`;
  deleteBtn.style.display = 'none';
  formError.classList.remove('show');
  modal.classList.add('show');
}

function openEdit(id) {
  const row = WEEK_ROWS.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('modalTitle').textContent = 'Sửa buổi dạy';
  document.getElementById('schedId').value = row.id;
  document.getElementById('classSelect').value = row.class_id || '';
  document.getElementById('teacherSelect').value = row.teacher_id;
  document.getElementById('weekStart').value = row.week_start_date;
  document.getElementById('dayOfWeek').value = row.day_of_week;
  document.getElementById('startTime').value = row.start_time || '';
  document.getElementById('endTime').value = row.end_time || '';
  document.getElementById('isSubstitute').checked = row.is_substitute;
  document.getElementById('substituteForField').style.display = row.is_substitute ? '' : 'none';
  document.getElementById('substituteFor').value = row.substitute_for_teacher_id || '';
  document.getElementById('note').value = row.note || '';
  deleteBtn.style.display = 'inline-flex';
  formError.classList.remove('show');
  modal.classList.add('show');
}

document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

deleteBtn.addEventListener('click', async () => {
  const id = document.getElementById('schedId').value;
  if (!id || !confirm('Xoá buổi dạy này?')) return;
  const { error } = await supabase.from('teacher_weekly_schedules').delete().eq('id', id);
  if (error) { formError.textContent = error.message; formError.classList.add('show'); return; }
  modal.classList.remove('show');
  await loadWeek();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('schedId').value;
  const isSub = document.getElementById('isSubstitute').checked;
  const payload = {
    class_id: document.getElementById('classSelect').value || null,
    teacher_id: document.getElementById('teacherSelect').value,
    center_id: WORKING_CENTER_ID,
    week_start_date: currentWeekStart(),
    day_of_week: Number(document.getElementById('dayOfWeek').value),
    start_time: document.getElementById('startTime').value || null,
    end_time: document.getElementById('endTime').value || null,
    is_substitute: isSub,
    substitute_for_teacher_id: isSub ? (document.getElementById('substituteFor').value || null) : null,
    note: document.getElementById('note').value || null,
    created_by: PROFILE.id,
  };
  const btn = document.getElementById('submitSched');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { error } = id
      ? await supabase.from('teacher_weekly_schedules').update(payload).eq('id', id)
      : await supabase.from('teacher_weekly_schedules').insert(payload);
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
    document.getElementById('filterWeek').value = mondayOf();
    await initCenterPicker();
    await loadLookups();
    await loadWeek();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
