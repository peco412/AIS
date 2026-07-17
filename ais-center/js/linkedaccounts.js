import { supabase, esc, fmtDate, bootParentShell } from './parentSupabase.js';

function renderRow(link, myPhone) {
  const s = link.students;
  if (!s) return '';

  const phoneMatch = [];
  if (s.phone && myPhone && s.phone.replace(/\D/g, '').slice(-9) === myPhone.replace(/\D/g, '').slice(-9)) phoneMatch.push('SĐT chính');
  if (s.backup_phone && myPhone && s.backup_phone.replace(/\D/g, '').slice(-9) === myPhone.replace(/\D/g, '').slice(-9)) phoneMatch.push('SĐT phụ huynh 2');

  return `
    <div class="card" style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
      <div>
        <div style="font-weight:600;">${esc(s.full_name)}</div>
        <div class="cell-muted" style="font-size:12px; margin-top:2px;">${esc(s.centers?.name || '')}</div>
        <div class="cell-muted" style="font-size:12px; margin-top:2px;">Quan hệ: ${esc(link.relationship || 'Chưa xác định')}</div>
        <div class="cell-muted" style="font-size:12px; margin-top:2px;">Liên kết lúc: ${fmtDate(link.created_at)}</div>
        ${phoneMatch.length ? `<div style="font-size:12px; margin-top:4px; color:var(--accent-deep);">Khớp theo: ${phoneMatch.join(', ')}</div>` : ''}
      </div>
      <button class="btn-unlink" data-id="${s.id}" data-name="${esc(s.full_name)}"
        style="white-space:nowrap; border:1px solid #ff4d4f; color:#ff4d4f; background:none; border-radius:8px; padding:6px 10px; font-size:12px; cursor:pointer;">
        Không phải con tôi?
      </button>
    </div>
  `;
}

(async () => {
  const listEl = document.getElementById('linksList');
  try {
    const { parent, students } = await bootParentShell();

    if (!students || students.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Chưa có học sinh nào liên kết với tài khoản này.</div>';
      return;
    }

    // Lay lai du lieu day du (bootParentShell chi tra ve rut gon) - can
    // them created_at cua link + phone cua hoc sinh de hien thi ly do
    // khop, phuc vu muc dich tra soat.
    const { data: links } = await supabase
      .from('parent_student_links')
      .select('relationship, created_at, students(id, full_name, phone, backup_phone, centers(name))')
      .eq('parent_account_id', parent.id)
      .order('created_at', { ascending: false });

    const myPhone = (await supabase.auth.getSession()).data.session?.user?.phone || '';

    listEl.innerHTML = (links || []).map((l) => renderRow(l, myPhone)).join('');

    listEl.querySelectorAll('.btn-unlink').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { id, name } = btn.dataset;
        if (!confirm(`Xác nhận gỡ liên kết với "${name}"? Bạn sẽ không còn xem được điểm số/học phí/ví của học sinh này nữa.`)) return;
        btn.disabled = true; btn.textContent = 'Đang gỡ...';
        try {
          const { error } = await supabase.rpc('parent_unlink_student', { p_student_id: id });
          if (error) throw error;
          location.reload();
        } catch (e) {
          alert(e.message || 'Có lỗi xảy ra, vui lòng thử lại.');
          btn.disabled = false; btn.textContent = 'Không phải con tôi?';
        }
      });
    });
  } catch (e) {
    /* bootParentShell tự điều hướng nếu chưa đăng nhập */
  }
})();