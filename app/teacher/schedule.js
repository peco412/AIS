import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const DAY_LABEL = { 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7', 7: 'Chủ nhật' };
let PROFILE = null;

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

async function loadWeek() {
  const board = document.getElementById('weekBoard');
  board.innerHTML = '<div class="empty-cell">Đang tải dữ liệu...</div>';

  const weekStart = mondayOf(document.getElementById('weekPicker').value);
  document.getElementById('weekLabel').textContent = `Tuần ${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart, 6))}`;

  const { data, error } = await supabase
    .from('teacher_weekly_schedules')
    .select('id, day_of_week, start_time, end_time, is_substitute, note, class_id, classes(name), substitute_for_teacher_id, sub_for:employees!teacher_weekly_schedules_substitute_for_teacher_id_fkey(full_name)')
    .eq('teacher_id', PROFILE.id)
    .eq('week_start_date', weekStart)
    .order('day_of_week');

  if (error) { board.innerHTML = `<div class="empty-cell">Lỗi: ${esc(error.message)}</div>`; return; }

  const byDay = {};
  (data || []).forEach((r) => { (byDay[r.day_of_week] = byDay[r.day_of_week] || []).push(r); });

  board.innerHTML = [1, 2, 3, 4, 5, 6, 7].map((day) => `
    <div class="stat-card">
      <div class="label">${DAY_LABEL[day]}</div>
      ${(byDay[day] || []).length === 0
        ? '<div class="cell-muted" style="margin-top:8px;">Không có buổi dạy</div>'
        : (byDay[day] || []).map((s) => `
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
            <div class="value" style="font-size:15px;">${esc(s.classes?.name || 'Lớp chưa gán')}</div>
            <div class="cell-code">${fmtTime(s.start_time)}${s.end_time ? ' – ' + fmtTime(s.end_time) : ''}</div>
            ${s.is_substitute ? `<div class="delta" style="color:var(--warning);">Dạy thay ${esc(s.sub_for?.full_name || '')}</div>` : ''}
            ${s.note ? `<div class="cell-muted">${esc(s.note)}</div>` : ''}
          </div>
        `).join('')}
    </div>
  `).join('');
}

document.getElementById('weekPicker').addEventListener('change', loadWeek);
document.getElementById('btnPrevWeek').addEventListener('click', () => {
  document.getElementById('weekPicker').value = addDays(mondayOf(document.getElementById('weekPicker').value), -7);
  loadWeek();
});
document.getElementById('btnNextWeek').addEventListener('click', () => {
  document.getElementById('weekPicker').value = addDays(mondayOf(document.getElementById('weekPicker').value), 7);
  loadWeek();
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    document.getElementById('weekPicker').value = mondayOf();
    await loadWeek();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
