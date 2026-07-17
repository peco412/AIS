import { bootShell } from '/js/shell.js';
import { supabase, esc, triggerPush } from '/js/supabase.js';

let PROFILE = null;
let STUDENTS = [];
let SESSION_DATES = []; // các ngày có phiên học thật (class_sessions) của lớp đang chọn
let ATTENDANCE_STATE = {}; // student_id -> 'present' | 'excused' | 'unexcused'

const TYPE_LABEL = { present: 'Có mặt', excused: 'Vắng có phép (P)', unexcused: 'Vắng không phép (KP)' };

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

// Chỉ điểm danh được đúng ngày đã lên lịch (class_sessions) — nếu lớp
// chưa được tạo lịch tự động (không dùng tính năng "tự sinh lịch" lúc tạo
// lớp) thì cho phép điểm danh tự do như trước, không chặn gì cả.
async function loadSessionDates() {
  const classId = document.getElementById('classSelect').value;
  const { data } = await supabase.from('class_sessions').select('session_date').eq('class_id', classId).order('session_date');
  SESSION_DATES = (data || []).map((r) => r.session_date);

  const dateInput = document.getElementById('sessionDate');
  const hint = document.getElementById('sessionDateHint');
  if (SESSION_DATES.length === 0) {
    hint.textContent = 'Lớp này chưa có lịch phiên học tự động — có thể điểm danh tự do theo ngày bất kỳ.';
    dateInput.removeAttribute('min');
    dateInput.removeAttribute('max');
    return;
  }

  const today = todayStr();
  const isTodaySession = SESSION_DATES.includes(today);
  dateInput.value = isTodaySession ? today : SESSION_DATES[0];
  hint.textContent = isTodaySession
    ? 'Hôm nay có lịch học — điểm danh bình thường.'
    : 'Hôm nay KHÔNG có lịch học của lớp này theo kế hoạch.';
}

async function loadStudents() {
  const classId = document.getElementById('classSelect').value;
  const date = document.getElementById('sessionDate').value;
  const list = document.getElementById('attendanceList');
  if (!classId) { list.innerHTML = '<div class="empty-cell">Bạn chưa có lớp nào.</div>'; return; }
  list.innerHTML = '<div class="empty-cell">Đang tải danh sách học viên...</div>';

  const { data: students } = await supabase.from('students').select('id, full_name').eq('class_id', classId).order('full_name');
  STUDENTS = students || [];

  const { data: existing } = await supabase.from('class_attendance').select('student_id, present, attendance_type').eq('class_id', classId).eq('session_date', date);
  ATTENDANCE_STATE = {};
  STUDENTS.forEach((s) => { ATTENDANCE_STATE[s.id] = 'present'; }); // mặc định có mặt
  (existing || []).forEach((e) => { ATTENDANCE_STATE[e.student_id] = e.attendance_type || (e.present ? 'present' : 'unexcused'); });

  render();
}

function render() {
  const list = document.getElementById('attendanceList');
  if (STUDENTS.length === 0) { list.innerHTML = '<div class="empty-cell">Lớp chưa có học viên nào.</div>'; return; }

  list.innerHTML = STUDENTS.map((s) => `
    <div class="attendance-row">
      <span>${esc(s.full_name)}</span>
      <div class="attendance-toggle" data-student="${s.id}">
        <button type="button" class="present ${ATTENDANCE_STATE[s.id] === 'present' ? 'active' : ''}" data-val="present">Có mặt</button>
        <button type="button" class="excused ${ATTENDANCE_STATE[s.id] === 'excused' ? 'active' : ''}" data-val="excused">P</button>
        <button type="button" class="absent ${ATTENDANCE_STATE[s.id] === 'unexcused' ? 'active' : ''}" data-val="unexcused">KP</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.attendance-toggle').forEach((toggle) => {
    toggle.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        ATTENDANCE_STATE[toggle.dataset.student] = btn.dataset.val;
        render();
      });
    });
  });
}

document.getElementById('classSelect').addEventListener('change', async () => {
  await loadSessionDates();
  await loadStudents();
});
document.getElementById('sessionDate').addEventListener('change', loadStudents);

document.getElementById('btnSave').addEventListener('click', async () => {
  const classId = document.getElementById('classSelect').value;
  const date = document.getElementById('sessionDate').value;
  if (!classId || !date) return;

  const btn = document.getElementById('btnSave');
  btn.disabled = true; btn.textContent = 'Đang lưu...';

  const rows = STUDENTS.map((s) => ({
    class_id: classId, student_id: s.id, session_date: date,
    present: ATTENDANCE_STATE[s.id] === 'present',
    attendance_type: ATTENDANCE_STATE[s.id],
    taken_by: PROFILE.id,
  }));

  const { error } = await supabase.from('class_attendance').upsert(rows, { onConflict: 'class_id,student_id,session_date' });
  btn.disabled = false; btn.textContent = 'Lưu điểm danh';
  if (error) {
    // Lỗi phổ biến nhất ở đây là chặn điểm danh lùi ngày (xem trigger DB) —
    // hiện thẳng thông báo gốc vì nó đã giải thích rõ cách xin quyền.
    alert('Lỗi lưu điểm danh: ' + error.message);
    return;
  }

  // Học viên vắng KHÔNG PHÉP -> báo ngay cho Quản lý trung tâm để liên hệ
  // phụ huynh, đúng yêu cầu — không đợi đến báo cáo tổng hợp cuối ngày.
  const unexcusedStudents = STUDENTS.filter((s) => ATTENDANCE_STATE[s.id] === 'unexcused');
  if (unexcusedStudents.length > 0) {
    await notifyUnexcusedAbsence(classId, date, unexcusedStudents);
  }

  alert('Đã lưu điểm danh buổi học.');
});

async function notifyUnexcusedAbsence(classId, date, students) {
  const { data: classInfo } = await supabase.from('classes').select('name, center_id').eq('id', classId).single();
  if (!classInfo) return;

  const { data: role } = await supabase.from('system_roles').select('id').eq('code', 'CENTER_MANAGER').single();
  if (!role) return;
  const { data: managers } = await supabase.from('employees').select('id').eq('center_id', classInfo.center_id).eq('role_id', role.id);

  const names = students.map((s) => s.full_name).join(', ');
  const title = `${students.length} học viên vắng không phép hôm ${new Date(date).toLocaleDateString('vi-VN')}`;
  const content = `Lớp ${classInfo.name}: ${names} — vắng không phép, cần liên hệ ngay với phụ huynh.`;

  for (const manager of managers || []) {
    const notif = { scope: 'personal', target_employee_id: manager.id, title, content, link_url: `/edu/class-attendance-matrix.html?class=${classId}` };
    await supabase.from('notifications').insert({ ...notif, created_by: PROFILE.id });
    triggerPush(notif);
  }
}

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    document.getElementById('sessionDate').value = todayStr();
    const classes = await loadClasses();
    if (classes.length === 0) { document.getElementById('attendanceList').innerHTML = '<div class="empty-cell">Bạn hiện chưa được phân công lớp nào.</div>'; return; }
    await loadSessionDates();
    await loadStudents();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
