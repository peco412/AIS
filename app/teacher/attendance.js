import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let STUDENTS = [];
let ATTENDANCE_STATE = {}; // student_id -> boolean (true = có mặt)

function todayStr() { return new Date().toISOString().slice(0, 10); }

async function loadClasses() {
  const { data: classes } = await supabase.from('classes').select('id, name').eq('teacher_id', PROFILE.id).order('name');
  const sel = document.getElementById('classSelect');
  sel.innerHTML = (classes || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const params = new URLSearchParams(location.search);
  const preselect = params.get('class');
  if (preselect && classes.some((c) => c.id === preselect)) sel.value = preselect;
  return classes || [];
}

async function loadStudents() {
  const classId = document.getElementById('classSelect').value;
  const date = document.getElementById('sessionDate').value;
  const list = document.getElementById('attendanceList');
  if (!classId) { list.innerHTML = '<div class="empty-cell">Bạn chưa có lớp nào.</div>'; return; }
  list.innerHTML = '<div class="empty-cell">Đang tải danh sách học viên...</div>';

  const { data: students } = await supabase.from('students').select('id, full_name').eq('class_id', classId).order('full_name');
  STUDENTS = students || [];

  const { data: existing } = await supabase.from('class_attendance').select('student_id, present').eq('class_id', classId).eq('session_date', date);
  ATTENDANCE_STATE = {};
  STUDENTS.forEach((s) => { ATTENDANCE_STATE[s.id] = true; }); // mặc định có mặt
  (existing || []).forEach((e) => { ATTENDANCE_STATE[e.student_id] = e.present; });

  render();
}

function render() {
  const list = document.getElementById('attendanceList');
  if (STUDENTS.length === 0) { list.innerHTML = '<div class="empty-cell">Lớp chưa có học viên nào.</div>'; return; }

  list.innerHTML = STUDENTS.map((s) => `
    <div class="attendance-row">
      <span>${esc(s.full_name)}</span>
      <div class="attendance-toggle" data-student="${s.id}">
        <button type="button" class="present ${ATTENDANCE_STATE[s.id] ? 'active' : ''}" data-val="true">Có mặt</button>
        <button type="button" class="absent ${!ATTENDANCE_STATE[s.id] ? 'active' : ''}" data-val="false">Vắng</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.attendance-toggle').forEach((toggle) => {
    toggle.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        ATTENDANCE_STATE[toggle.dataset.student] = btn.dataset.val === 'true';
        render();
      });
    });
  });
}

document.getElementById('classSelect').addEventListener('change', loadStudents);
document.getElementById('sessionDate').addEventListener('change', loadStudents);

document.getElementById('btnSave').addEventListener('click', async () => {
  const classId = document.getElementById('classSelect').value;
  const date = document.getElementById('sessionDate').value;
  if (!classId || !date) return;

  const btn = document.getElementById('btnSave');
  btn.disabled = true; btn.textContent = 'Đang lưu...';

  const rows = STUDENTS.map((s) => ({
    class_id: classId, student_id: s.id, session_date: date,
    present: ATTENDANCE_STATE[s.id], taken_by: PROFILE.id,
  }));

  const { error } = await supabase.from('class_attendance').upsert(rows, { onConflict: 'class_id,student_id,session_date' });
  btn.disabled = false; btn.textContent = '💾 Lưu điểm danh';
  if (error) { alert('Lỗi lưu điểm danh: ' + error.message); return; }
  alert('Đã lưu điểm danh buổi học.');
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    document.getElementById('sessionDate').value = todayStr();
    const classes = await loadClasses();
    if (classes.length === 0) { document.getElementById('attendanceList').innerHTML = '<div class="empty-cell">Bạn hiện chưa được phân công lớp nào.</div>'; return; }
    await loadStudents();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
