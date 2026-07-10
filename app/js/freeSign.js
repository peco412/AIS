// =====================================================================
// KÝ SỐ HỒ SƠ TỰ DO — dùng chung 1 lần cho Nhân sự/Kế toán/Truyền thông/CSVC.
// Đúng đề bài: "Ký số hồ sơ (từ Đề xuất nội bộ hoặc có thể TỰ NHẬP FILE,
// ký và tự chọn lưu vào mục tại Kho lưu trữ [phòng ban])".
// Mỗi trang chỉ khác 1 dòng gọi initFreeSign('HR' | 'ACC' | 'MKT' | 'FAC').
// =====================================================================
import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, resolveFileUrl, openFile } from '/js/supabase.js';
import { openPdfEditor } from '/js/pdfEditor.js';

const DEPT_LABEL = { HR: 'Nhân sự', ACC: 'Kế toán', MKT: 'Truyền thông', FAC: 'Cơ sở vật chất', EDU: 'Học vụ' };

// Danh mục kho lưu trữ hợp lệ để lưu file tự ký, theo đúng cơ cấu từng phòng
// (khớp DEPT_CATEGORIES trong js/archive.js).
const DEPT_ARCHIVE_CATEGORIES = {
  HR: ['admin_paper', 'other'],
  ACC: ['other'],
  MKT: ['other'],
  FAC: ['other'],
  EDU: ['other'],
};

export async function initFreeSign(deptCode) {
  let PROFILE = null;
  let DEPT_ID = null;
  let ROWS = [];

  function fmtDate(d) { return d ? new Date(d).toLocaleString('vi-VN') : '—'; }

  function canUse(profile) {
    if (deptCode === 'EDU') {
      // Học vụ không có "trưởng phòng" riêng — người tương đương là Quản lý
      // trung tâm (isCenterManager), theo đúng cơ cấu tổ chức trong đề bài.
      return profile.isCenterManager || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    }
    // Truyền thông + CSVC: đặc tả CHỈ ghi "Trưởng phòng" ký số, KHÔNG có
    // Phó phòng (khác Nhân sự/Kế toán có cả 2) — phải tách riêng theo
    // đúng văn bản, không dùng chung 1 quy tắc cho mọi phòng ban.
    if (deptCode === 'MKT' || deptCode === 'FAC') {
      return (profile.departmentCode === deptCode && profile.roleCode === 'DEPT_HEAD')
        || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    }
    return (profile.departmentCode === deptCode && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode))
      || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
  }

  async function loadRecent() {
    const tbody = document.getElementById('signedTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Đang tải dữ liệu...</td></tr>';
    const { data, error } = await supabase
      .from('archive_files')
      .select('id, file_name, year, month, created_at, file_url, employees(full_name)')
      .eq('department_id', DEPT_ID)
      .eq('related_table', 'free_sign')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
    ROWS = data || [];
    if (ROWS.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Chưa có hồ sơ nào được ký theo cách này.</td></tr>'; return; }

    tbody.innerHTML = ROWS.map((r) => `
      <tr>
        <td>${esc(r.file_name)}</td>
        <td class="cell-muted">${esc(r.employees?.full_name || '—')}</td>
        <td class="cell-muted">${fmtDate(r.created_at)}</td>
        <td><button class="btn btn-outline btn-sm" data-open="${esc(r.file_url)}">Xem</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFile(b.dataset.open)));
  }

  document.getElementById('freeSignFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const errBox = document.getElementById('freeSignError');
    errBox.classList.remove('show');
    if (!file) return;

    if (!PROFILE.signatureUrl) {
      errBox.textContent = 'Bạn chưa có chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước.';
      errBox.classList.add('show');
      e.target.value = '';
      return;
    }

    try {
      const sourcePath = `free-sign/${deptCode}/${PROFILE.id}/${Date.now()}_source_${file.name}`;
      await uploadPrivateFile(sourcePath, file);
      const sourceUrl = await resolveFileUrl(sourcePath, 1800);
      const signatureUrl = await resolveFileUrl(PROFILE.signatureUrl, 1800);

      await openPdfEditor({
        pdfUrl: sourceUrl,
        signatureUrl,
        title: `Ký tự do — ${file.name} (kéo chữ ký/văn bản vào vị trí bất kỳ)`,
        onSave: async (blob) => {
          const signedPath = `free-sign/${deptCode}/${PROFILE.id}/${Date.now()}_signed_${file.name}`;
          await uploadPrivateFile(signedPath, blob, { contentType: 'application/pdf' });

          const now = new Date();
          const { data: archiveRow, error: archiveErr } = await supabase.from('archive_files').insert({
            department_id: DEPT_ID,
            category: DEPT_ARCHIVE_CATEGORIES[deptCode]?.[0] || 'other',
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            file_name: file.name,
            file_url: signedPath,
            related_table: 'free_sign',
            uploaded_by: PROFILE.id,
          }).select('id').single();
          if (archiveErr) throw archiveErr;

          // Ghi log ký số — đúng thiết kế "signature_logs" cho việc tự nhập file rồi ký
          await supabase.from('signature_logs').insert({
            employee_id: PROFILE.id,
            source_file_url: sourcePath,
            signed_file_url: signedPath,
            related_table: 'archive_files',
            related_id: archiveRow.id,
            saved_to_archive_id: archiveRow.id,
          });

          await loadRecent();
        },
      });
    } catch (err) {
      errBox.textContent = err.message || 'Có lỗi xảy ra.';
      errBox.classList.add('show');
    } finally {
      e.target.value = '';
    }
  });

  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('signature_url').eq('id', profile.id).single();
    PROFILE = { ...profile, signatureUrl: emp?.signature_url || null };

    const { data: dept } = await supabase.from('departments').select('id').eq('code', deptCode).single();
    DEPT_ID = dept?.id;

    if (!canUse(PROFILE)) {
      document.querySelector('.main').innerHTML =
        `<div class="empty-cell">🔒 Chỉ trưởng/phó phòng ${esc(DEPT_LABEL[deptCode])}, Ban điều hành, Kỹ thuật mới dùng được trang này.</div>`;
      return;
    }

    await loadRecent();
  } catch (e) { /* bootShell tự điều hướng */ }
}
