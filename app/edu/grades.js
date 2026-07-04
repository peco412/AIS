import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const STATUS_LABEL = { graduated: 'Tốt nghiệp', not_passed: 'Chưa đạt' };
let PROFILE = null;
let ALL_ROWS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

async function loadClasses() {
  const { data } = await supabase.from('classes').select('id, name').eq('center_id', PROFILE.centerId).order('name');
  const sel = document.getElementById('filterClass');
  sel.innerHTML = '<option value="">Tất cả các lớp</option>' + (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  // Lấy toàn bộ điểm của các lớp thuộc trung tâm này (join qua classes.center_id
  // bằng cách lọc theo danh sách class_id trước, vì student_grades không có
  // trực tiếp cột center_id).
  const { data: classes } = await supabase.from('classes').select('id').eq('center_id', PROFILE.centerId);
  const classIds = (classes || []).map((c) => c.id);
  if (classIds.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Trung tâm chưa có lớp nào.</td></tr>'; return; }

  const { data, error } = await supabase
    .from('student_grades')
    .select('id, term, score, ranking, final_status, created_at, class_id, classes(name), students(full_name)')
    .in('class_id', classIds)
    .order('created_at', { ascending: false });

  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${error.message}</td></tr>`; return; }
  ALL_ROWS = data || [];
  render();
}

function render() {
  const cls = document.getElementById('filterClass').value;
  const status = document.getElementById('filterFinalStatus').value;
  const search = document.getElementById('searchInput').value.trim().toLowerCase();

  const rows = ALL_ROWS.filter((r) =>
    (!cls || r.class_id === cls) &&
    (!status || r.final_status === status) &&
    (!search || (r.students?.full_name || '').toLowerCase().includes(search))
  );
  document.getElementById('resultCount').textContent = `${rows.length} bản ghi điểm`;

  const tbody = document.getElementById('tableBody');
  if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Chưa có dữ liệu điểm.</td></tr>'; return; }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.students?.full_name || '—')}</td>
      <td class="cell-muted">${esc(r.classes?.name || '—')}</td>
      <td class="cell-muted">${esc(r.term || '—')}</td>
      <td class="mono">${r.score ?? '—'}</td>
      <td>${esc(r.ranking || '—')}</td>
      <td>${r.final_status ? `<span class="badge badge-${r.final_status === 'graduated' ? 'active' : 'rejected'}">${esc(STATUS_LABEL[r.final_status])}</span>` : '—'}</td>
      <td class="cell-muted">${fmtDate(r.created_at)}</td>
    </tr>
  `).join('');
}

['filterClass', 'filterFinalStatus', 'searchInput'].forEach((id) => {
  document.getElementById(id).addEventListener('change', render);
  document.getElementById(id).addEventListener('input', render);
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('center_id').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id };

    if (!PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(profile.roleCode)) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Bạn không thuộc trung tâm nào.</div>';
      return;
    }
    await loadClasses();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
