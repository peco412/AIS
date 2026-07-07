import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const MARK = { present: 'O', excused: 'P', unexcused: 'KP' };

function fmtShort(d) { return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }); }

(async () => {
  try {
    await bootShell();

    const params = new URLSearchParams(location.search);
    const classId = params.get('class');
    if (!classId) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Thiếu thông tin lớp — mở trang này từ danh sách lớp.</div>';
      return;
    }

    const { data: classInfo } = await supabase.from('classes').select('name').eq('id', classId).single();
    document.getElementById('className').textContent = `Bảng điểm danh — ${classInfo?.name || ''}`;

    const [{ data: sessions }, { data: students }, { data: attendance }] = await Promise.all([
      supabase.from('class_sessions').select('session_date').eq('class_id', classId).lte('session_date', new Date().toISOString().slice(0, 10)).order('session_date'),
      supabase.from('students').select('id, full_name').eq('class_id', classId).order('full_name'),
      supabase.from('class_attendance').select('student_id, session_date, attendance_type, present').eq('class_id', classId),
    ]);

    const head = document.getElementById('matrixHead');
    const body = document.getElementById('matrixBody');

    if (!sessions || sessions.length === 0) {
      body.innerHTML = '<tr><td class="empty-cell">Lớp này chưa có lịch phiên học tự động (xem "Tự động tạo lịch điểm danh" khi tạo lớp) — chưa có dữ liệu để hiển thị dạng bảng.</td></tr>';
      return;
    }
    if (!students || students.length === 0) {
      body.innerHTML = '<tr><td class="empty-cell">Lớp chưa có học viên nào.</td></tr>';
      return;
    }

    head.innerHTML = '<th class="name-col">Danh sách học viên</th>' +
      sessions.map((s) => `<th>${fmtShort(s.session_date)}</th>`).join('');

    const lookup = {};
    (attendance || []).forEach((a) => {
      const type = a.attendance_type || (a.present ? 'present' : 'unexcused');
      lookup[`${a.student_id}_${a.session_date}`] = type;
    });

    body.innerHTML = students.map((st) => `
      <tr>
        <td class="name-col">${esc(st.full_name)}</td>
        ${sessions.map((s) => {
          const type = lookup[`${st.id}_${s.session_date}`];
          return `<td>${type ? `<span class="att-mark ${type}">${MARK[type]}</span>` : '<span class="att-mark none">–</span>'}</td>`;
        }).join('')}
      </tr>
    `).join('');
  } catch (e) { /* bootShell tự điều hướng */ }
})();
