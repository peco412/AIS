import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let WORKING_CENTER_ID = null;
let STUDENTS = [];
let ACTIVE_CLASSES = [];
let LEVELS_BY_ID = {};
let NEXT_LEVEL_BY_ID = {};

async function initCenterPicker() {
  if (PROFILE.centerId) { WORKING_CENTER_ID = PROFILE.centerId; return; }
  // HR/MKT xem toàn hệ thống -> phải chọn 1 trung tâm để thao tác
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
  const { data: levels } = await supabase
    .from('program_levels')
    .select('id, name, display_order, program_id')
    .order('program_id')
    .order('display_order');

  (levels || []).forEach((l) => { LEVELS_BY_ID[l.id] = l; });

  // Cấp độ kế tiếp = cùng program_id, display_order kế tiếp
  (levels || []).forEach((l) => {
    const next = (levels || []).find((x) => x.program_id === l.program_id && x.display_order === l.display_order + 1);
    if (next) NEXT_LEVEL_BY_ID[l.id] = next.id;
  });

  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, level_id, student_count, status')
    .eq('center_id', WORKING_CENTER_ID)
    .eq('status', 'active');
  ACTIVE_CLASSES = classes || [];
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data: students, error } = await supabase
    .from('students')
    .select('id, full_name, entry_level_id, program_levels(name)')
    .eq('center_id', WORKING_CENTER_ID)
    .is('class_id', null)
    .eq('status', 'studying')
    .order('full_name');

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

  const ids = (students || []).map((s) => s.id);
  let latestGradeByStudent = {};
  if (ids.length > 0) {
    const { data: grades } = await supabase
      .from('student_grades')
      .select('student_id, level_id, final_status, created_at, program_levels(name)')
      .in('student_id', ids)
      .order('created_at', { ascending: false });
    (grades || []).forEach((g) => {
      if (!latestGradeByStudent[g.student_id]) latestGradeByStudent[g.student_id] = g; // dòng đầu tiên = mới nhất nhờ order desc
    });
  }

  STUDENTS = (students || []).map((s) => {
    const lastGrade = latestGradeByStudent[s.id] || null;
    let suggestedClass = null;
    if (lastGrade && lastGrade.final_status === 'graduated') {
      const nextLevelId = NEXT_LEVEL_BY_ID[lastGrade.level_id];
      if (nextLevelId) {
        suggestedClass = ACTIVE_CLASSES.find((c) => c.level_id === nextLevelId) || null;
      }
    }
    return { ...s, lastGrade, suggestedClass, isReturning: !!lastGrade };
  });

  render();
}

function render() {
  const kind = document.getElementById('filterKind').value;
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const rows = STUDENTS.filter((s) =>
    (!kind || (kind === 'new' ? !s.isReturning : s.isReturning)) &&
    (!search || s.full_name.toLowerCase().includes(search))
  );
  document.getElementById('resultCount').textContent = `${rows.length} học viên chưa có lớp`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Không có học viên nào cần phân lớp.</td></tr>'; return; }

  const classOptions = (selectedId) => '<option value="">— Chọn lớp —</option>' +
    ACTIVE_CLASSES.map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)} (sĩ số ${c.student_count})</option>`).join('');

  tbody.innerHTML = rows.map((s) => `
    <tr>
      <td>${esc(s.full_name)}</td>
      <td class="cell-muted">${esc(s.program_levels?.name || '—')}</td>
      <td class="cell-muted">
        ${s.lastGrade
          ? `${esc(s.lastGrade.program_levels?.name || '')} — ${s.lastGrade.final_status === 'graduated' ? '<span class="badge badge-active">Tốt nghiệp</span>' : '<span class="badge badge-rejected">Chưa đạt</span>'}`
          : 'Học viên mới'}
      </td>
      <td class="cell-muted">${s.suggestedClass ? `<strong>${esc(s.suggestedClass.name)}</strong>` : (s.isReturning ? 'Cần xếp thủ công' : '—')}</td>
      <td>${window.__CLASS_ASSIGN_CAN_EDIT__ ? `<select class="select-input" data-select="${s.id}">${classOptions(s.suggestedClass?.id)}</select>` : '<span class="cell-muted">Chỉ xem</span>'}</td>
      <td>${window.__CLASS_ASSIGN_CAN_EDIT__ ? `<button class="btn btn-accent btn-sm" data-assign="${s.id}">Xếp lớp</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-assign]').forEach((btn) => {
    btn.addEventListener('click', () => assign(btn.dataset.assign, btn));
  });
}

async function assign(studentId, btn) {
  const select = document.querySelector(`[data-select="${studentId}"]`);
  const classId = select.value;
  if (!classId) { alert('Vui lòng chọn lớp trước khi xếp.'); return; }
  btn.disabled = true; btn.textContent = 'Đang xếp...';
  const { error } = await supabase.from('students').update({ class_id: classId }).eq('id', studentId);
  if (error) { alert('Không thể xếp lớp: ' + error.message); btn.disabled = false; btn.textContent = 'Xếp lớp'; return; }
  await loadRows();
}

document.getElementById('filterKind').addEventListener('change', render);
document.getElementById('searchInput').addEventListener('input', render);

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    // Ma tran: Phan lop hoc vien chi Quan ly trung tam duoc ghi, BDH/Ky
    // thuat chi xem.
    window.__CLASS_ASSIGN_CAN_EDIT__ = profile.isCenterManager;
    await initCenterPicker();
    await loadLookups();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
