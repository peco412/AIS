import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const DAY_LABEL = { 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7', 7: 'Chủ nhật' };
let PROFILE = null;
let WORKING_CENTER_ID = null;
let CAN_EDIT = false;
let ALL_ROWS = [];
let TEACHERS = [];

function fmtTime(t) { return t ? t.slice(0, 5) : ''; }
function mondayOf(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

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
    await loadRows();
  });
}

async function loadLookups() {
  const [{ data: classes }, { data: teachers }] = await Promise.all([
    supabase.from('classes').select('id, name').eq('center_id', WORKING_CENTER_ID).eq('status', 'active').order('name'),
    supabase.from('employees').select('id, full_name, positions(name)').eq('center_id', WORKING_CENTER_ID)
      .eq('positions.name', 'Giáo viên'),
  ]);
  TEACHERS = (teachers || []).filter((t) => t.positions?.name === 'Giáo viên');

  document.getElementById('classSelect').innerHTML = '<option value="">— Chọn lớp —</option>' +
    (classes || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const teacherOpts = '<option value="">— Chọn giáo viên —</option>' +
    TEACHERS.map((t) => `<option value="${t.id}">${esc(t.full_name)}</option>`).join('');
  document.getElementById('teacherSelect').innerHTML = teacherOpts;
  document.getElementById('substituteFor').innerHTML = '<option value="">— Không —</option>' + teacherOpts;

  document.getElementById('filterWeek').value = mondayOf();
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const weekStart = mondayOf(document.getElementById('filterWeek').value);
  const { data, error } = await supabase
    .from('teacher_weekly_schedules')
    .select(`
      id, day_of_week, start_time, end_time, is_substitute, note, week_start_date,
      class_id, classes(name),
      teacher_id, teacher:employees!teacher_weekly_schedules_teacher_id_fkey(full_name),
      substitute_for_teacher_id, sub_for:employees!teacher_weekly_schedules_substitute_for_teacher_id_fkey(full_name)
    `)
    .eq('center_id', WORKING_CENTER_ID)
    .eq('week_start_date', weekStart)
    .order('day_of_week');

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = ALL_ROWS.filter((r) => !search || (r.teacher?.full_name || '').toLowerCase().includes(search));
  document.getElementById('resultCount').textContent = `${rows.length} buổi dạy`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có lịch nào trong tuần này.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${DAY_LABEL[r.day_of_week]}</td>
      <td class="cell-code">${fmtTime(r.start_time)}${r.end_time ? ' – ' + fmtTime(r.end_time) : ''}</td>
      <td>${esc(r.classes?.name || '—')}</td>
      <td>${esc(r.teacher?.full_name || '—')} ${r.is_substitute ? '<span class="badge badge-submitted">Dạy thay</span>' : ''}</td>
      <td class="cell-muted">${r.is_substitute ? esc(r.sub_for?.full_name || '—') : '—'}</td>
      <td>${CAN_EDIT ? `<button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
}

document.getElementById('filterWeek').addEventListener('change', loadRows);
document.getElementById('searchInput').addEventListener('input', render);

document.getElementById('isSubstitute').addEventListener('change', (e) => {
  document.getElementById('substituteForField').style.display = e.target.checked ? '' : 'none';
});

const modal = document.getElementById('schedModal');
const form = document.getElementById('schedForm');
const formError = document.getElementById('formError');
const deleteBtn = document.getElementById('deleteSched');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  document.getElementById('schedId').value = '';
  document.getElementById('weekStart').value = mondayOf(document.getElementById('filterWeek').value);
  document.getElementById('substituteForField').style.display = 'none';
  document.getElementById('modalTitle').textContent = 'Thêm buổi dạy';
  deleteBtn.style.display = 'none';
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

function openEdit(id) {
  const row = ALL_ROWS.find((r) => r.id === id);
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

deleteBtn.addEventListener('click', async () => {
  const id = document.getElementById('schedId').value;
  if (!id || !confirm('Xoá buổi dạy này?')) return;
  const { error } = await supabase.from('teacher_weekly_schedules').delete().eq('id', id);
  if (error) { formError.textContent = error.message; formError.classList.add('show'); return; }
  modal.classList.remove('show');
  await loadRows();
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
    week_start_date: mondayOf(document.getElementById('weekStart').value),
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
    await loadRows();
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
    document.getElementById('btnAdd').style.display = CAN_EDIT ? '' : 'none';
    await initCenterPicker();
    await loadLookups();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
