import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

(async () => {
  try {
    const { profile } = await bootShell();

    const { data: myClasses } = await supabase.from('classes').select('id, name').eq('teacher_id', profile.id);
    const classIds = (myClasses || []).map((c) => c.id);
    const classNameById = {}; (myClasses || []).forEach((c) => { classNameById[c.id] = c.name; });

    const tbody = document.getElementById('tableBody');
    if (classIds.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Bạn chưa phụ trách lớp nào.</td></tr>'; return; }

    const { data, error } = await supabase
      .from('students')
      .select('full_name, dob, parent_name, phone, trial_start_date, trial_end_date, trial_sessions_count, class_id')
      .in('class_id', classIds)
      .eq('status', 'trial')
      .order('trial_start_date', { ascending: false });

    if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
    if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Không có học viên học thử nào trong lớp bạn phụ trách.</td></tr>'; return; }

    tbody.innerHTML = data.map((r) => `
      <tr>
        <td>${esc(r.full_name)}</td>
        <td class="cell-muted">${esc(classNameById[r.class_id] || '—')}</td>
        <td class="cell-muted">${fmtDate(r.dob)}</td>
        <td class="cell-muted">${esc(r.parent_name || '—')}</td>
        <td class="mono cell-muted">${esc(r.phone || '—')}</td>
        <td class="cell-muted">${fmtDate(r.trial_start_date)} → ${fmtDate(r.trial_end_date)}</td>
        <td class="mono" style="text-align:center;">${r.trial_sessions_count ?? '—'}</td>
      </tr>
    `).join('');
  } catch (e) { /* bootShell tự điều hướng */ }
})();
