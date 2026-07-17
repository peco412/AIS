import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let STUDENTS = [];
let CURRENT_CLASS = null;

async function loadClasses() {
  const { data: classes } = await supabase.from('classes').select('id, name, level_id').eq('teacher_id', PROFILE.id).order('name');
  const sel = document.getElementById('classSelect');
  sel.innerHTML = (classes || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const params = new URLSearchParams(location.search);
  const preselect = params.get('class');
  if (preselect && classes.some((c) => c.id === preselect)) sel.value = preselect;
  return classes || [];
}

async function loadStudentsAndGrades() {
  const classId = document.getElementById('classSelect').value;
  const tbody = document.getElementById('gradesBody');
  if (!classId) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Bạn chưa có lớp nào.</td></tr>'; return; }
  tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Đang tải...</td></tr>';

  const { data: classInfo } = await supabase.from('classes').select('id, level_id').eq('id', classId).single();
  CURRENT_CLASS = classInfo;

  const { data: students } = await supabase.from('students').select('id, full_name').eq('class_id', classId).order('full_name');
  STUDENTS = students || [];

  // Lấy điểm gần nhất của mỗi học viên trong lớp này (nếu có) để hiển thị sẵn
  const { data: grades } = await supabase
    .from('student_grades')
    .select('student_id, score, ranking, final_status, term, created_at')
    .eq('class_id', classId)
    .order('created_at', { ascending: false });

  const latestByStudent = {};
  (grades || []).forEach((g) => { if (!latestByStudent[g.student_id]) latestByStudent[g.student_id] = g; });

  render(latestByStudent);
}

function render(latestByStudent) {
  const tbody = document.getElementById('gradesBody');
  if (STUDENTS.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Lớp chưa có học viên nào.</td></tr>'; return; }

  tbody.innerHTML = STUDENTS.map((s) => {
    const g = latestByStudent[s.id] || {};
    return `
    <tr data-student="${s.id}">
      <td>${esc(s.full_name)}</td>
      <td><input type="number" step="0.1" class="score-input" value="${g.score ?? ''}" /></td>
      <td><input type="text" class="ranking-input" value="${esc(g.ranking ?? '')}" placeholder="Giỏi / Khá / TB..." /></td>
      <td>
        <select class="status-input">
          <option value="">— Chưa xếp —</option>
          <option value="graduated" ${g.final_status === 'graduated' ? 'selected' : ''}>Tốt nghiệp</option>
          <option value="not_passed" ${g.final_status === 'not_passed' ? 'selected' : ''}>Chưa đạt</option>
        </select>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('classSelect').addEventListener('change', loadStudentsAndGrades);

document.getElementById('btnSave').addEventListener('click', async () => {
  const classId = document.getElementById('classSelect').value;
  const term = document.getElementById('termInput').value.trim() || null;
  if (!classId) return;

  const rows = [];
  document.querySelectorAll('#gradesBody tr[data-student]').forEach((tr) => {
    const studentId = tr.dataset.student;
    const score = tr.querySelector('.score-input').value;
    const ranking = tr.querySelector('.ranking-input').value.trim();
    const finalStatus = tr.querySelector('.status-input').value;
    if (score || ranking || finalStatus) {
      rows.push({
        student_id: studentId, class_id: classId, level_id: CURRENT_CLASS?.level_id || null, term,
        score: score ? Number(score) : null, ranking: ranking || null,
        final_status: finalStatus || null, entered_by: PROFILE.id,
      });
    }
  });

  if (rows.length === 0) { alert('Chưa có điểm nào để lưu.'); return; }

  const btn = document.getElementById('btnSave');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  const { error } = await supabase.from('student_grades').insert(rows);
  btn.disabled = false; btn.textContent = 'Lưu bảng điểm';
  if (error) { alert('Lỗi lưu bảng điểm: ' + error.message); return; }
  alert('Đã lưu bảng điểm. Dữ liệu sẽ tự hiển thị ở Bảng điểm học viên của trung tâm.');
  await loadStudentsAndGrades();
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    const classes = await loadClasses();
    if (classes.length === 0) { document.getElementById('gradesBody').innerHTML = '<tr><td colspan="4" class="empty-cell">Bạn hiện chưa được phân công lớp nào.</td></tr>'; return; }
    await loadStudentsAndGrades();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
