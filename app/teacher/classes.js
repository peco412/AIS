import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

async function openContacts(classId, className) {
  const modal = document.getElementById('contactsModal');
  const tbody = document.getElementById('contactsBody');
  document.getElementById('contactsTitle').textContent = `Liên lạc học viên — ${className}`;
  tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Đang tải...</td></tr>';
  modal.classList.add('show');

  const { data, error } = await supabase
    .from('students')
    .select('full_name, parent_name, phone, backup_phone')
    .eq('class_id', classId)
    .order('full_name');

  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Lớp chưa có học viên.</td></tr>'; return; }

  tbody.innerHTML = data.map((s) => `
    <tr>
      <td>${esc(s.full_name)}</td>
      <td class="cell-muted">${esc(s.parent_name || '—')}</td>
      <td class="cell-code">${esc(s.phone || '—')}</td>
      <td class="cell-code">${esc(s.backup_phone || '—')}</td>
    </tr>
  `).join('');
}

document.getElementById('closeContactsModal').addEventListener('click', () => {
  document.getElementById('contactsModal').classList.remove('show');
});

(async () => {
  try {
    const { profile } = await bootShell();

    const { data: classes, error } = await supabase
      .from('classes')
      .select('id, name, schedule_note, student_count, status, programs(name), program_levels(name)')
      .eq('teacher_id', profile.id)
      .order('name');

    const wrap = document.getElementById('classCards');
    if (error) { wrap.innerHTML = `<div class="empty-cell">Lỗi tải dữ liệu: ${esc(error.message)}</div>`; return; }
    if (!classes || classes.length === 0) {
      wrap.innerHTML = '<div class="empty-cell">Bạn hiện chưa được phân công lớp nào.</div>';
      return;
    }

    wrap.innerHTML = classes.map((c) => `
      <div class="stat-card">
        <div class="label">${esc(c.programs?.name || '')} ${c.program_levels?.name ? '· ' + esc(c.program_levels.name) : ''}</div>
        <div class="value" style="font-size:18px;">${esc(c.name)}</div>
        <div class="delta" style="color:var(--muted);">${esc(c.schedule_note || '')}</div>
        <div class="delta">Sĩ số: ${c.student_count}</div>
        <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
          <a class="btn btn-outline btn-sm" href="/teacher/attendance.html?class=${c.id}">Điểm danh</a>
          <a class="btn btn-outline btn-sm" href="/teacher/grades.html?class=${c.id}">Bảng điểm</a>
          <button class="btn btn-outline btn-sm" data-contacts="${c.id}" data-name="${esc(c.name)}">Liên lạc PH</button>
        </div>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-contacts]').forEach((btn) => {
      btn.addEventListener('click', () => openContacts(btn.dataset.contacts, btn.dataset.name));
    });
  } catch (e) { /* bootShell tự điều hướng */ }
})();
