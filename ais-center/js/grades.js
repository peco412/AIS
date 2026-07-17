import { supabase, esc, fmtDate, bootParentShell } from './parentSupabase.js';

// MỚI: gộp bảng điểm của TẤT CẢ con vào 1 màn hình, nhóm theo tên con —
// không cần bấm qua lại giữa từng con nữa (đồng bộ với Ví AIScoins đã
// dùng chung 1 ví gia đình, và trang Công nợ & Học vụ cũng đã gộp tương tự).

const RANKING_COLOR = { 'Xuất sắc': 'paid', 'Giỏi': 'paid', 'Khá': 'partial', 'Trung bình': 'partial', 'Yếu': 'unpaid' };

function gradeCardHtml(g) {
  return `
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
      ${g.final_status ? `<div class="cell-muted" style="font-size:12px; margin-top:4px;">${g.final_status === 'graduated' ? 'Đã hoàn thành khoá' : 'Chưa đạt, cần học lại'}</div>` : ''}
      <div class="cell-muted" style="font-size:11px; margin-top:8px;">Cập nhật: ${fmtDate(g.created_at)}</div>
    </div>
  `;
}

(async () => {
  try {
    const { students } = await bootParentShell();
    const listEl = document.getElementById('gradesList');
    if (students.length === 0) return;

    const studentIds = students.map((s) => s.id);
    const { data, error } = await supabase
      .from('student_grades')
      .select('student_id, term, score, ranking, final_status, created_at, classes(name, programs(name), program_sublevels(name))')
      .in('student_id', studentIds)
      .order('created_at', { ascending: false });

    if (error) { listEl.innerHTML = `<div class="empty-state">Lỗi: ${esc(error.message)}</div>`; return; }
    if (!data || data.length === 0) { listEl.innerHTML = '<div class="empty-state">Chưa có bảng điểm nào được ghi nhận.</div>'; return; }

    if (students.length === 1) {
      listEl.innerHTML = data.map(gradeCardHtml).join('');
      return;
    }

    // Nhiều hơn 1 con -> nhóm theo tên con, mỗi nhóm có tiêu đề riêng để dễ
    // phân biệt mà không cần bấm chuyển qua lại.
    listEl.innerHTML = students.map((s) => {
      const rows = data.filter((g) => g.student_id === s.id);
      if (rows.length === 0) return '';
      return `
        <h3 style="margin:18px 0 10px; font-size:14px;">${esc(s.full_name)}</h3>
        ${rows.map(gradeCardHtml).join('')}
      `;
    }).join('') || '<div class="empty-state">Chưa có bảng điểm nào được ghi nhận.</div>';
  } catch (e) { /* bootParentShell tự điều hướng / tự hiện lỗi */ }
})();
