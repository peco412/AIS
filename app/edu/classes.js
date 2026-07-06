import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { t } from '/js/i18n.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.class_' + code, code) });
let PROFILE = null;
let PROGRAMS = [], LEVELS = [], SUBLEVELS = [], TEACHERS = [];
let ALL_ROWS = [];

function fillSelect(el, items, { valueKey = 'id', labelKey = 'name', placeholder } = {}) {
  el.innerHTML = '';
  if (placeholder) el.innerHTML += `<option value="">${esc(placeholder)}</option>`;
  items.forEach((i) => { el.innerHTML += `<option value="${i[valueKey]}">${esc(i[labelKey])}</option>`; });
}

async function loadLookups() {
  const [{ data: programs }, { data: levels }, { data: sublevels }, { data: teachers }] = await Promise.all([
    supabase.from('programs').select('id, name').order('display_order'),
    supabase.from('program_levels').select('id, name, program_id').order('display_order'),
    supabase.from('program_sublevels').select('id, name, level_id').order('display_order'),
    supabase.from('employees').select('id, full_name, center_id').eq('center_id', PROFILE.centerId),
  ]);
  PROGRAMS = programs || []; LEVELS = levels || []; SUBLEVELS = sublevels || []; TEACHERS = teachers || [];

  fillSelect(document.getElementById('filterProgram'), PROGRAMS, { placeholder: 'Tất cả chương trình' });
  fillSelect(document.getElementById('program'), PROGRAMS, { placeholder: '— Chọn chương trình —' });
  fillSelect(document.getElementById('teacher'), TEACHERS, { valueKey: 'id', labelKey: 'full_name', placeholder: '— Chưa phân công —' });
}

document.getElementById('program').addEventListener('change', (e) => {
  const levels = LEVELS.filter((l) => l.program_id === e.target.value);
  fillSelect(document.getElementById('level'), levels, { placeholder: '—' });
  fillSelect(document.getElementById('sublevel'), [], { placeholder: '—' });
});
document.getElementById('level').addEventListener('change', (e) => {
  const subs = SUBLEVELS.filter((s) => s.level_id === e.target.value);
  fillSelect(document.getElementById('sublevel'), subs, { placeholder: '—' });
});

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';
  const { data, error } = await supabase
    .from('classes')
    .select('id, name, schedule_note, student_count, start_date, status, program_id, level_id, sublevel_id, teacher_id, programs(name), program_levels(name), program_sublevels(name), employees(full_name)')
    .eq('center_id', PROFILE.centerId)
    .order('start_date', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

function render() {
  const program = document.getElementById('filterProgram').value;
  const status = document.getElementById('filterStatus').value;
  const search = document.getElementById('searchInput').value.trim().toLowerCase();

  const rows = ALL_ROWS.filter((r) =>
    (!program || r.program_id === program) &&
    (!status || r.status === status) &&
    (!search || r.name.toLowerCase().includes(search))
  );
  document.getElementById('resultCount').textContent = `${rows.length} lớp`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Không có lớp nào.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td><strong>${esc(r.name)}</strong><div class="cell-muted">${esc(r.schedule_note || '')}</div></td>
      <td class="cell-muted">${esc(r.programs?.name || '')} ${r.program_levels?.name ? '· ' + esc(r.program_levels.name) : ''} ${r.program_sublevels?.name ? '· ' + esc(r.program_sublevels.name) : ''}</td>
      <td>${r.employees?.full_name ? esc(r.employees.full_name) : '<span class="cell-muted">Chưa phân công</span>'}</td>
      <td class="mono">${r.student_count}</td>
      <td class="cell-muted">${fmtDate(r.start_date)}</td>
      <td><span class="badge badge-${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
      <td><button class="btn btn-outline btn-sm" data-edit="${r.id}">Sửa</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
}

['filterProgram', 'filterStatus', 'searchInput'].forEach((id) => {
  document.getElementById(id).addEventListener('change', render);
  document.getElementById(id).addEventListener('input', render);
});

// ---------------------------------------------------------------------
// Modal thêm/sửa
// ---------------------------------------------------------------------
const modal = document.getElementById('classModal');
const form = document.getElementById('classForm');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  document.getElementById('classId').value = '';
  document.getElementById('modalTitle').textContent = 'Thêm lớp';
  document.getElementById('autoGenSchedule').closest('.field').style.display = 'block';
  fillSelect(document.getElementById('level'), [], { placeholder: '—' });
  fillSelect(document.getElementById('sublevel'), [], { placeholder: '—' });
  formError.classList.remove('show');
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

async function openEdit(id) {
  const { data: row } = await supabase.from('classes').select('*').eq('id', id).single();
  if (!row) return;
  document.getElementById('modalTitle').textContent = `Sửa lớp — ${row.name}`;
  document.getElementById('classId').value = row.id;
  document.getElementById('className').value = row.name;
  document.getElementById('program').value = row.program_id || '';
  fillSelect(document.getElementById('level'), LEVELS.filter((l) => l.program_id === row.program_id), { placeholder: '—' });
  document.getElementById('level').value = row.level_id || '';
  fillSelect(document.getElementById('sublevel'), SUBLEVELS.filter((s) => s.level_id === row.level_id), { placeholder: '—' });
  document.getElementById('sublevel').value = row.sublevel_id || '';
  document.getElementById('teacher').value = row.teacher_id || '';
  document.getElementById('scheduleNote').value = row.schedule_note || '';
  document.querySelectorAll('.day-of-week').forEach((el) => { el.checked = (row.days_of_week || []).includes(Number(el.value)); });
  document.getElementById('classStartTime').value = row.start_time || '';
  document.getElementById('classEndTime').value = row.end_time || '';
  document.getElementById('autoGenSchedule').checked = false;
  document.getElementById('autoGenSchedule').closest('.field').style.display = 'none'; // chỉ tự sinh lịch lúc TẠO MỚI, không áp dụng khi sửa
  document.getElementById('startDate').value = row.start_date || '';
  document.getElementById('endDate').value = row.end_date || '';
  document.getElementById('status').value = row.status;
  document.getElementById('note').value = row.note || '';
  formError.classList.remove('show');
  modal.classList.add('show');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');
  const id = document.getElementById('classId').value;
  const daysOfWeek = Array.from(document.querySelectorAll('.day-of-week:checked')).map((el) => Number(el.value));
  const payload = {
    name: document.getElementById('className').value.trim(),
    center_id: PROFILE.centerId,
    program_id: document.getElementById('program').value || null,
    level_id: document.getElementById('level').value || null,
    sublevel_id: document.getElementById('sublevel').value || null,
    teacher_id: document.getElementById('teacher').value || null,
    schedule_note: document.getElementById('scheduleNote').value || null,
    start_date: document.getElementById('startDate').value || null,
    end_date: document.getElementById('endDate').value || null,
    start_time: document.getElementById('classStartTime').value || null,
    end_time: document.getElementById('classEndTime').value || null,
    days_of_week: daysOfWeek.length ? daysOfWeek : null,
    status: document.getElementById('status').value,
    note: document.getElementById('note').value || null,
  };

  const autoGen = document.getElementById('autoGenSchedule').checked;
  if (!id && autoGen) {
    if (!payload.start_date || !payload.end_date || !daysOfWeek.length || !payload.teacher_id) {
      formError.textContent = 'Để tự động tạo lịch, cần đủ: Ngày khai giảng, Ngày kết thúc, ít nhất 1 ngày học/tuần, và Giáo viên phụ trách.';
      formError.classList.add('show');
      return;
    }
  }

  const btn = document.getElementById('submitClass');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    let newClassId = id;
    if (id) {
      const { error } = await supabase.from('classes').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('classes').insert(payload).select('id').single();
      if (error) throw error;
      newClassId = data.id;
    }

    if (!id && autoGen) {
      await generateSchedule(newClassId, payload);
    }

    modal.classList.remove('show');
    await loadRows();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu';
  }
});

// Tự sinh "phiên học" (class_sessions) cho mọi ngày khớp days_of_week từ
// start_date đến end_date, VÀ tự sinh lịch tuần giáo viên tương ứng
// (teacher_weekly_schedules lưu theo từng tuần nên cần 1 dòng/tuần).
async function generateSchedule(classId, payload) {
  const start = new Date(payload.start_date);
  const end = new Date(payload.end_date);
  const sessions = [];
  const weeksSeen = new Set();
  const teacherRows = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const isoDay = d.getDay() === 0 ? 7 : d.getDay(); // JS: 0=CN -> quy về 7 khớp check(1..7)
    if (!payload.days_of_week.includes(isoDay)) continue;

    const dateStr = d.toISOString().slice(0, 10);
    sessions.push({ class_id: classId, session_date: dateStr });

    // Mỗi tuần chỉ cần 1 dòng lịch/ngày trong tuần đó cho giáo viên (không lặp
    // lại nếu cùng tuần đã có nhiều ngày trùng day_of_week — thực tế không
    // xảy ra vì mỗi ngày trong vòng lặp là duy nhất).
    const monday = new Date(d);
    monday.setDate(d.getDate() - (isoDay - 1));
    const weekKey = `${monday.toISOString().slice(0, 10)}_${isoDay}`;
    if (!weeksSeen.has(weekKey)) {
      weeksSeen.add(weekKey);
      teacherRows.push({
        teacher_id: payload.teacher_id, class_id: classId, center_id: payload.center_id,
        week_start_date: monday.toISOString().slice(0, 10), day_of_week: isoDay,
        start_time: payload.start_time, end_time: payload.end_time,
      });
    }
  }

  if (sessions.length > 0) {
    const { error: sessErr } = await supabase.from('class_sessions').insert(sessions);
    if (sessErr) console.warn('Không tạo được lịch điểm danh:', sessErr.message);
  }
  if (teacherRows.length > 0) {
    const { error: schedErr } = await supabase.from('teacher_weekly_schedules').insert(teacherRows);
    if (schedErr) console.warn('Không tạo được lịch tuần giáo viên:', schedErr.message);
  }
}

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('center_id, centers(name)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id };

    if (!PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(profile.roleCode)) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Bạn không thuộc trung tâm nào để quản lý lớp học.</div>';
      return;
    }
    document.getElementById('centerHint').textContent = `Trung tâm: ${emp?.centers?.name || '—'}`;

    await loadLookups();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
