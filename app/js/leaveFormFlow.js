import { bootShell } from '/js/shell.js';
import { supabase, esc, resolveFileUrl, notifyDepartmentHeads, triggerPush } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { openPdfEditor } from '/js/pdfEditor.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.leaveform_' + code, code) });

// Gộp lại thành 1 trang duy nhất cho tất cả nhân sự (trước đây tách 2 trang
// riêng theo nhóm gây ra lỗi thiếu đường dẫn menu cho tư vấn viên/quản lý
// trung tâm) — form vẫn tự động lọc đúng 4 loại theo ĐÚNG nhóm của người
// tạo đơn, không hiển thị nhầm loại của nhóm khác.
const FORM_TYPES = {
  office: [
    { code: '06.Donxinhoandoingaynghi', label: 'Hoán đổi ngày nghỉ hàng tuần', balanceImpact: 'none' },
    { code: '07.Donxinnghiphepcanbo', label: 'Nghỉ phép', balanceImpact: 'annual' },
    { code: '08.Donxinnghibu', label: 'Nghỉ bù', balanceImpact: 'compensatory' },
    { code: '09.Donxinnghikhongluongcanbo', label: 'Nghỉ không lương', balanceImpact: 'unpaid' },
  ],
  teacher: [
    { code: '10.Donxinhoandoilichdaydaybu', label: 'Hoán đổi lịch dạy / dạy bù', balanceImpact: 'none' },
    { code: '11.Donxinnghiphep', label: 'Nghỉ phép', balanceImpact: 'annual' },
    { code: '12.Donxinnghibu', label: 'Nghỉ bù', balanceImpact: 'compensatory' },
    { code: '13.Donxinnghikhongluonggiaovien', label: 'Nghỉ không lương', balanceImpact: 'unpaid' },
  ],
};
const ALL_FORMS = [...FORM_TYPES.office, ...FORM_TYPES.teacher];

export async function initLeaveFormFlow() {
  let PROFILE = null;
  let MY_GROUP = 'office'; // nhóm CỦA CHÍNH người đăng nhập — quyết định 4 loại đơn được tạo
  let ALL_ROWS = [];
  let TEMPLATES = {};
  let IS_HR = false;

  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }
  function formLabel(code) { return ALL_FORMS.find((f) => f.code === code)?.label || code; }
  function groupOf(formCode) { return formCode?.match(/^0[6-9]\./) ? 'office' : 'teacher'; }

  // "Trưởng phòng" cấp 1: văn phòng dùng DEPT_HEAD/DEPT_DEPUTY cùng phòng;
  // giáo viên/tư vấn dùng Quản lý trung tâm cùng trung tâm (đúng nguyên tắc
  // "trưởng phòng tương đương quản lý trung tâm" cho khối học vụ).
  function canApproveLevel1(row) {
    const rowGroup = groupOf(row.form_code);
    if (rowGroup === 'teacher') {
      return PROFILE.roleCode === 'CENTER_MANAGER' && PROFILE.centerId === row.employee_center_id;
    }
    return PROFILE.departmentCode === row.employee_department_code && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(PROFILE.roleCode);
  }
  function canApproveLevel2() { return IS_HR; }
  function canApproveLevel3() { return ['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode); }

  function actionFor(row) {
    if (row.status === 'submitted' && (canApproveLevel1(row) || canApproveLevel3())) return { label: 'Duyệt cấp 1 (Trưởng phòng)', step: 'level1', next: 'approved_1' };
    if (row.status === 'approved_1' && (canApproveLevel2() || canApproveLevel3())) return { label: 'Duyệt cấp 2 (Nhân sự)', step: 'level2', next: 'approved_2' };
    if (row.status === 'approved_2' && canApproveLevel3()) return { label: 'Duyệt cấp 3 (Ban điều hành)', step: 'level3', next: 'approved_3' };
    return null;
  }

  async function loadTemplates() {
    const codes = ALL_FORMS.map((f) => f.code);
    const { data } = await supabase.from('document_templates').select('*').in('code', codes);
    TEMPLATES = {};
    (data || []).forEach((tpl) => { TEMPLATES[tpl.code] = tpl; });
  }

  async function loadRows() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Đang tải dữ liệu...</td></tr>';
    const scope = document.getElementById('viewScope').value;

    let query = supabase
      .from('leave_requests')
      .select('id, code, form_code, start_date, days, return_date, reason_note, status, file_url, employee_id, employees!leave_requests_employee_id_fkey(full_name, employee_code, department_id, center_id, departments(code))')
      .order('created_at', { ascending: false })
      .limit(300);
    if (scope === 'mine') query = query.eq('employee_id', PROFILE.id);

    const { data, error } = await query;
    if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

    ALL_ROWS = (data || []).map((r) => ({
      ...r,
      employee_department_code: r.employees?.departments?.code,
      employee_center_id: r.employees?.center_id,
    }));
    render();
  }

  function render() {
    const groupFilter = document.getElementById('filterGroup')?.value || '';
    const rows = ALL_ROWS.filter((r) => !groupFilter || groupOf(r.form_code) === groupFilter);

    document.getElementById('resultCount').textContent = `${rows.length} đơn`;
    const tbody = document.getElementById('tableBody');
    if (rows.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Chưa có đơn nào.</td></tr>'; return; }

    tbody.innerHTML = rows.map((r) => {
      const action = actionFor(r);
      return `
      <tr>
        <td class="cell-code">${esc(r.code)}</td>
        <td>${esc(r.employees?.full_name || '—')}<div class="cell-muted" style="font-weight:400;">${groupOf(r.form_code) === 'teacher' ? 'Giáo viên' : 'Cán bộ'}</div></td>
        <td class="cell-muted">${esc(formLabel(r.form_code))}</td>
        <td class="cell-muted">${fmtDate(r.start_date)} (${r.days} ngày)</td>
        <td><span class="badge badge-${r.status}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
        <td class="cell-muted">${esc(r.reason_note || '—')}</td>
        <td>
          ${r.file_url ? `<button class="btn btn-outline btn-sm" data-view="${r.id}">Xem</button>` : ''}
          ${action ? `<button class="btn btn-accent btn-sm" data-act="${r.id}">${action.label}</button>` : ''}
          ${(r.status === 'approved_3') ? `<div><a href="/archive.html" class="cell-muted" style="text-decoration:underline; font-size:11.5px;">↳ Đã lưu vào Kho lưu trữ</a></div>` : ''}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRow(b.dataset.view)));
    tbody.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.act)));
  }

  async function viewRow(id) {
    const row = ALL_ROWS.find((r) => r.id === id);
    if (!row.file_url) return;
    try {
      const url = await resolveFileUrl(row.file_url, 1800);
      openPdfEditor({ pdfUrl: url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), readOnly: true, title: `Xem đơn ${row.code}` });
    } catch (e) {
      alert('Không thể mở file: ' + (e.message || 'Có lỗi xảy ra.'));
    }
  }

  async function overwriteFile(leaveId, blob) {
    const path = `leave-requests-v2/${leaveId}/current.pdf`;
    const { error } = await supabase.storage.from('attachments').upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (error) throw error;
    return path;
  }

  async function finalizeArchive(row) {
    const notifPayload = {
      scope: 'personal', target_employee_id: row.employee_id,
      title: `Đơn "${formLabel(row.form_code)}" đã được duyệt xong`,
      content: `Đơn ${row.code} đã hoàn tất 3 cấp duyệt và lưu vào Kho lưu trữ.`,
    };
    await supabase.from('notifications').insert({ ...notifPayload, created_by: PROFILE.id });
    triggerPush(notifPayload);
    if (row.file_url) {
      const now = new Date();
      await supabase.from('archive_files').insert({
        department_id: row.employees?.department_id, category: 'admin_paper', year: now.getFullYear(), month: now.getMonth() + 1,
        file_name: `${row.code}.pdf`, file_url: row.file_url, related_table: 'leave_requests', related_id: row.id, uploaded_by: PROFILE.id,
      });
    }
  }

  async function runAction(id) {
    const row = ALL_ROWS.find((r) => r.id === id);
    const action = actionFor(row);
    if (!action) return;

    if (!row.file_url) { await applyStatus(row, action, null); return; }
    if (!PROFILE.signatureUrl) { alert('Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước khi ký.'); return; }

    let pdfUrl, signatureUrl;
    try {
      pdfUrl = await resolveFileUrl(row.file_url, 1800);
      signatureUrl = await resolveFileUrl(PROFILE.signatureUrl, 1800);
    } catch (e) {
      alert('Không thể mở file để ký: ' + (e.message || 'Có lỗi xảy ra.'));
      return;
    }

    await openPdfEditor({
      pdfUrl: pdfUrl + (pdfUrl.includes('?') ? '&' : '?') + 't=' + Date.now(),
      signatureUrl,
      title: `${action.label} — ${row.code}`,
      onSave: async (blob) => {
        const newUrl = await overwriteFile(row.id, blob);
        await applyStatus(row, action, newUrl);
      },
    });
  }

  async function applyStatus(row, action, newFileUrl) {
    if (action.step === 'level3') {
      if (newFileUrl) await supabase.from('leave_requests').update({ file_url: newFileUrl }).eq('id', row.id);
      const { error } = await supabase.rpc('finalize_leave_request_v2', { p_leave_id: row.id });
      if (error) { alert('Lỗi: ' + error.message); return; }
      await finalizeArchive({ ...row, file_url: newFileUrl || row.file_url });
      await loadRows();
      return;
    }

    const nowIso = new Date().toISOString();
    const updatePayload = { status: action.next };
    if (newFileUrl) updatePayload.file_url = newFileUrl;
    if (action.step === 'level1') { updatePayload.level1_approver_id = PROFILE.id; updatePayload.level1_approved_at = nowIso; }
    if (action.step === 'level2') { updatePayload.level2_approver_id = PROFILE.id; updatePayload.level2_approved_at = nowIso; }

    const { error } = await supabase.from('leave_requests').update(updatePayload).eq('id', row.id);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadRows();
  }

  // ---------------------------------------------------------------------
  // Tạo đơn mới — CHỈ hiện đúng 4 loại thuộc nhóm của chính người tạo đơn
  // (cán bộ hay giáo viên), không cho chọn nhầm loại của nhóm khác.
  // ---------------------------------------------------------------------
  const createModal = document.getElementById('createModal');
  const createError = document.getElementById('createError');
  const formCodeSelect = document.getElementById('formCode');

  document.getElementById('btnAdd').addEventListener('click', () => {
    createError.classList.remove('show');
    formCodeSelect.innerHTML = FORM_TYPES[MY_GROUP].map((f) => `<option value="${f.code}">${esc(f.label)}</option>`).join('');
    document.getElementById('startDate').value = '';
    document.getElementById('days').value = '';
    document.getElementById('returnDate').value = '';
    document.getElementById('reasonNote').value = '';
    createModal.classList.add('show');
  });
  document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
  document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));

  document.getElementById('openFillEditor').addEventListener('click', async () => {
    createError.classList.remove('show');
    const formCode = formCodeSelect.value;
    const TEMPLATE = TEMPLATES[formCode];
    const startDate = document.getElementById('startDate').value;
    const days = document.getElementById('days').value;
    if (!startDate || !days) { createError.textContent = 'Vui lòng nhập đầy đủ ngày bắt đầu và số ngày.'; createError.classList.add('show'); return; }
    if (!TEMPLATE) { createError.textContent = `Chưa có biểu mẫu "${formCode}" trong Kho lưu trữ > Biểu mẫu — liên hệ bộ phận kỹ thuật để tải lên.`; createError.classList.add('show'); return; }
    if (!PROFILE.signatureUrl) { createError.textContent = 'Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước.'; createError.classList.add('show'); return; }

    createModal.classList.remove('show');

    let pdfUrl, signatureUrl;
    try {
      pdfUrl = await resolveFileUrl(TEMPLATE.file_url, 1800);
      signatureUrl = await resolveFileUrl(PROFILE.signatureUrl, 1800);
    } catch (e) {
      alert('Không thể mở biểu mẫu: ' + (e.message || 'Có lỗi xảy ra.'));
      return;
    }

    await openPdfEditor({
      pdfUrl, signatureUrl,
      title: `Điền & ký: ${formLabel(formCode)}`,
      fieldMap: TEMPLATE.field_map || [],
      onSave: async (blob) => {
        const { data: inserted, error } = await supabase.from('leave_requests').insert({
          employee_id: PROFILE.id, form_code: formCode, staff_group: MY_GROUP, template_id: TEMPLATE.id,
          leave_type: formCode.includes('nghikhongluong') ? 'unpaid' : 'annual',
          start_date: startDate, days: Number(days),
          return_date: document.getElementById('returnDate').value || null,
          reason_note: document.getElementById('reasonNote').value || null,
          status: 'submitted',
        }).select('id').single();
        if (error) throw error;

        const fileUrl = await overwriteFile(inserted.id, blob);
        await supabase.from('leave_requests').update({ file_url: fileUrl }).eq('id', inserted.id);

        const deptCode = MY_GROUP === 'teacher' ? 'EDU' : (PROFILE.departmentCode || 'HR');
        notifyDepartmentHeads(deptCode, `Có đơn "${formLabel(formCode)}" mới cần duyệt`,
          `${PROFILE.fullName} vừa gửi đơn ${formLabel(formCode)} — vào duyệt ngay.`, location.pathname, PROFILE.id);

        await loadRows();
      },
    });
  });

  document.getElementById('viewScope').addEventListener('change', loadRows);
  document.getElementById('filterGroup')?.addEventListener('change', render);

  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('signature_url, department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = {
      ...profile, signatureUrl: emp?.signature_url || null,
      departmentCode: emp?.departments?.code, centerId: emp?.center_id,
    };
    MY_GROUP = profile.isTeacher ? 'teacher' : 'office';
    IS_HR = PROFILE.departmentCode === 'HR' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(profile.roleCode);

    // Bộ lọc "Nhóm nhân sự" — CHỈ hiện ở giao diện Nhân sự (nơi cần rà soát
    // đơn của cả 2 nhóm cùng lúc), theo đúng yêu cầu.
    const groupFilterEl = document.getElementById('filterGroup');
    if (groupFilterEl) groupFilterEl.style.display = (IS_HR || ['EXECUTIVE', 'TECH'].includes(profile.roleCode)) ? '' : 'none';

    await loadTemplates();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
}
