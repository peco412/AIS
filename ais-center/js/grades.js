import { supabase, esc, fmtDate, bootParentShell, getSelectedStudentId, setSelectedStudentId } from './parentSupabase.js';

let STUDENTS = [];
let SELECTED_ID = null;

function renderSwitcher() {
  const el = document.getElementById('studentSwitcher');
  if (STUDENTS.length <= 1) { el.style.display = 'none'; return; }
  el.innerHTML = STUDENTS.map((s) => `
    <button class="student-chip ${s.id === SELECTED_ID ? 'active' : ''}" data-id="${s.id}">${esc(s.full_name)}</button>
  `).join('');
  el.querySelectorAll('[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => { setSelectedStudentId(btn.dataset.id); SELECTED_ID = btn.dataset.id; renderSwitcher(); loadGrades(); });
  });
}

const RANKING_COLOR = { 'Xuất sắc': 'paid', 'Giỏi': 'paid', 'Khá': 'partial', 'Trung bình': 'partial', 'Yếu': 'unpaid' };

async function loadGrades() {
  const listEl = document.getElementById('gradesList');
  listEl.innerHTML = '<div class="empty-state">Đang tải dữ liệu...</div>';

  const { data, error } = await supabase
    .from('student_grades')
    .select('term, score, ranking, final_status, created_at, classes(name, programs(name), program_sublevels(name))')
    .eq('student_id', SELECTED_ID)
    .order('created_at', { ascending: false });

  if (error) { listEl.innerHTML = `<div class="empty-state">Lỗi: ${esc(error.message)}</div>`; return; }
  if (!data || data.length === 0) { listEl.innerHTML = '<div class="empty-state">Chưa có bảng điểm nào được ghi nhận.</div>'; return; }

  listEl.innerHTML = data.map((g) => `
    <div class="card">
      <div class="invoice-row__top">
        <span>${esc(g.classes?.programs?.name || '—')} — ${esc(g.classes?.program_sublevels?.name || '')}</span>
        ${g.ranking ? `<span class="badge ${RANKING_COLOR[g.ranking] || 'partial'}">${esc(g.ranking)}</span>` : ''}
      </div>
      <div class="invoice-row__sub">Lớp: ${esc(g.classes?.name || '—')} ${g.term ? `· Kỳ: ${esc(g.term)}` : ''}</div>
      <div class="batch-row" style="border:none; padding-top:10px;">
        <span class="cell-muted">Điểm số</span>
        <strong class="mono" style="font-size:16px;">${g.score != null ? g.score : '—'}</strong>
      </div>
      ${g.final_status ? `<div class="cell-muted" style="font-size:12px; margin-top:4px;">${g.final_status === 'graduated' ? '✅ Đã hoàn thành khoá' : '🔁 Chưa đạt, cần học lại'}</div>` : ''}
      <div class="cell-muted" style="font-size:11px; margin-top:8px;">Cập nhật: ${fmtDate(g.created_at)}</div>
    </div>
  `).join('');
}

(async () => {
  try {
    const { students } = await bootParentShell();
    STUDENTS = students;
    if (STUDENTS.length === 0) return;
    SELECTED_ID = getSelectedStudentId(STUDENTS);
    renderSwitcher();
    await loadGrades();
  } catch (e) { /* bootParentShell tự điều hướng / tự hiện lỗi */ }
})();
