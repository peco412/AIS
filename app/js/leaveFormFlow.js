import { bootShell } from '/js/shell.js';
import { supabase, esc, resolveFileUrl, notifyDepartmentHeads, triggerPush } from '/js/supabase.js';
import { t } from '/js/i18n.js';
import { openPdfEditor } from '/js/pdfEditor.js';
import { showConfirm, showPromptDialog } from '/js/confirmDialog.js';

const STATUS_LABEL = new Proxy({}, { get: (_, code) => t('status.leaveform_' + code, code) });

// Gộp lại thành 1 trang duy nhất cho tất cả nhân sự (trước đây tách 2 trang
// riêng theo nhóm gây ra lỗi thiếu đường dẫn menu cho tư vấn viên/quản lý
// trung tâm) — form vẫn tự động lọc đúng 4 loại theo ĐÚNG nhóm của người
// tạo đơn, không hiển thị nhầm loại của nhóm khác.
export const FORM_TYPES = {
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
export const ALL_FORMS = [...FORM_TYPES.office, ...FORM_TYPES.teacher];

// LÀM LẠI 22/08/2026 — theo đúng yêu cầu: "đơn là nơi chứa thông tin để
// có thể duyệt, [mẫu PDF] chỉ là 1 phần trong cái đơn đó". Mỗi loại đơn
// có 1 bảng chi tiết RIÊNG, khớp đúng với bảng biểu trong 6 mẫu Word gốc
// — cấp trên nhìn thấy NGAY trên danh sách/chi tiết đơn, không bắt buộc
// phải mở file PDF mới biết nội dung. null = loại đơn này không cần bảng
// chi tiết (Nghỉ bù — chỉ cần khoảng ngày + lý do, đã có sẵn ở trường
// chung start_date/days/reason_note).
export const DETAIL_SCHEMAS = {
  '06.Donxinhoandoingaynghi': {
    title: 'Hoán đổi ngày nghỉ hàng tuần',
    columns: [
      { key: 'originalDate', label: 'Ngày nghỉ hàng tuần', type: 'date' },
      { key: 'swapDate', label: 'Ngày hoán đổi', type: 'date' },
    ],
  },
  '10.Donxinhoandoilichdaydaybu': {
    title: 'Hoán đổi lịch dạy - dạy bù',
    columns: [
      { key: 'originalSchedule', label: 'Lịch dạy chính thức', type: 'text' },
      { key: 'makeupSchedule', label: 'Lịch dạy bù', type: 'text' },
      { key: 'reason', label: 'Lý do', type: 'text' },
    ],
  },
  '07.Donxinnghiphepcanbo': {
    title: 'Bàn giao công việc trong thời gian nghỉ',
    columns: [
      { key: 'task', label: 'Công việc trong thời gian nghỉ', type: 'text' },
      { key: 'replacement', label: 'Người thay thế', type: 'text' },
    ],
  },
  '09.Donxinnghikhongluongcanbo': {
    title: 'Bàn giao công việc trong thời gian nghỉ',
    columns: [
      { key: 'task', label: 'Công việc trong thời gian nghỉ', type: 'text' },
      { key: 'replacement', label: 'Người thay thế', type: 'text' },
    ],
  },
  '11.Donxinnghiphep': {
    title: 'Bàn giao lớp dạy trong thời gian nghỉ',
    columns: [
      { key: 'className', label: 'Tên lớp', type: 'text' },
      { key: 'schedule', label: 'Lịch dạy', type: 'text' },
      { key: 'contentTaught', label: 'Nội dung sẽ được dạy thế', type: 'text' },
      { key: 'substituteTeacher', label: 'Giáo viên dạy thế', type: 'text' },
    ],
  },
  '13.Donxinnghikhongluonggiaovien': {
    title: 'Bàn giao lớp dạy trong thời gian nghỉ',
    columns: [
      { key: 'className', label: 'Tên lớp', type: 'text' },
      { key: 'schedule', label: 'Lịch dạy', type: 'text' },
      { key: 'contentTaught', label: 'Nội dung sẽ được dạy thế', type: 'text' },
      { key: 'substituteTeacher', label: 'Giáo viên dạy thế', type: 'text' },
    ],
  },
  // 08/12 Nghỉ bù — không cần bảng chi tiết, dùng trường chung có sẵn.
};

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
  // CHUẨN HOÁ 22/08/2026: trước đây EXECUTIVE+TECH đều "vượt cấp" duyệt được
  // cả 3 cấp — theo quyết định của MIA, TECH chỉ xem (đã có qua groupFilterEl
  // bên dưới, không đổi) và dùng công cụ test riêng, KHÔNG thao tác duyệt
  // trong hệ thống thật. Giờ chỉ EXECUTIVE, khớp payment-requests/advance-
  // requests/business-trips/fac-purchase-requests/event-proposals/proposals.
  function canApproveLevel3() { return PROFILE.roleCode === 'EXECUTIVE'; }

  function actionFor(row) {
    if (row.status === 'submitted' && (canApproveLevel1(row) || canApproveLevel3())) return { label: 'Trưởng phòng duyệt (cấp 1)', step: 'level1', next: 'approved_1' };
    if (row.status === 'approved_1' && (canApproveLevel2() || canApproveLevel3())) return { label: 'Nhân sự duyệt (cấp 2)', step: 'level2', next: 'approved_2' };
    if (row.status === 'approved_2' && canApproveLevel3()) return { label: 'Ban điều hành duyệt (cấp 3)', step: 'level3', next: 'approved_3' };
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
      .select('id, code, form_code, start_date, days, return_date, reason_note, detail_items, status, file_url, employee_id, employees!leave_requests_employee_id_fkey(full_name, employee_code, department_id, center_id, departments(code))')
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
    const centerFilter = document.getElementById('filterCenter')?.value || '';
    const rows = ALL_ROWS.filter((r) => (!groupFilter || groupOf(r.form_code) === groupFilter) && (!centerFilter || r.employee_center_id === centerFilter));

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
          <button class="btn btn-outline btn-sm" data-detail="${r.id}">Chi tiết</button>
          ${r.file_url ? `<button class="btn btn-outline btn-sm" data-view="${r.id}">Xem PDF</button>` : ''}
          ${action ? `<button class="btn btn-accent btn-sm" data-approve="${r.id}">${action.label}</button>` : ''}
          ${action ? `<button class="btn btn-danger btn-sm" data-reject="${r.id}">Từ chối</button>` : ''}
          ${action ? `<button class="btn btn-outline btn-sm" data-sign="${r.id}" title="Mở mẫu đơn để ký — TÁCH RIÊNG khỏi việc duyệt dữ liệu, có thể ký trước/sau khi duyệt đều được">✍️ Ký vào mẫu đơn</button>` : ''}
          ${(r.status === 'approved_3') ? `<div><a href="/archive.html" class="cell-muted" style="text-decoration:underline; font-size:11.5px;">↳ Đã lưu vào Kho lưu trữ</a></div>` : ''}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => viewDetail(b.dataset.detail)));
    tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRow(b.dataset.view)));
    tbody.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => approveRow(b.dataset.approve)));
    tbody.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => rejectRow(b.dataset.reject)));
    tbody.querySelectorAll('[data-sign]').forEach((b) => b.addEventListener('click', () => signDocument(b.dataset.sign)));
  }

  // MỚI — xem bảng chi tiết đơn (bàn giao công việc/lớp dạy, hoán đổi
  // ngày nghỉ/lịch dạy...) để duyệt dựa trên dữ liệu thật, không bắt buộc
  // phải mở PDF mới biết nội dung.
  function viewDetail(id) {
    const row = ALL_ROWS.find((r) => r.id === id);
    const schema = DETAIL_SCHEMAS[row.form_code];
    document.getElementById('detailViewTitle').textContent = `${formLabel(row.form_code)} — ${row.code}`;
    const basicInfo = `
      <div class="field-grid-2" style="margin-bottom:14px;">
        <div><div class="cell-muted" style="font-size:11.5px;">Nhân viên</div><div>${esc(row.employees?.full_name || '—')}</div></div>
        <div><div class="cell-muted" style="font-size:11.5px;">Thời gian</div><div>${fmtDate(row.start_date)} (${row.days} ngày)${row.return_date ? ` — đi làm lại ${fmtDate(row.return_date)}` : ''}</div></div>
      </div>
      ${row.reason_note ? `<div style="margin-bottom:14px;"><div class="cell-muted" style="font-size:11.5px;">Lý do</div><div>${esc(row.reason_note)}</div></div>` : ''}
    `;
    let detailHtml = '';
    if (schema && Array.isArray(row.detail_items) && row.detail_items.length > 0) {
      detailHtml = `
        <div class="cell-muted" style="font-size:11.5px; margin-bottom:6px;">${esc(schema.title)}</div>
        <div class="data-table-wrap">
          <table class="data-table" style="min-width:0;">
            <thead><tr>${schema.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
            <tbody>${row.detail_items.map((item) => `<tr>${schema.columns.map((c) => `<td>${esc(item[c.key] || '—')}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      `;
    } else if (schema) {
      detailHtml = '<div class="cell-muted">Chưa có dữ liệu chi tiết.</div>';
    }
    document.getElementById('detailViewBody').innerHTML = basicInfo + detailHtml;
    document.getElementById('detailViewModal').classList.add('show');
  }
  document.getElementById('closeDetailViewModal').addEventListener('click', () => document.getElementById('detailViewModal').classList.remove('show'));

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

  // LÀM LẠI 22/08/2026 — theo đúng yêu cầu: "duyệt dữ liệu" và "ký vào
  // mẫu đơn" là 2 HÀNH ĐỘNG ĐỘC LẬP, không gắn liền làm 1 như trước đây
  // (trước đây bắt buộc mở PDF ký xong mới duyệt được — nếu ai đó chưa
  // cập nhật chữ ký cá nhân thì HOÀN TOÀN không duyệt được, dù dữ liệu
  // đơn không có vấn đề gì). Giờ duyệt chỉ cần xem dữ liệu (đã đủ ở nút
  // "Chi tiết"), ký PDF là việc riêng có thể làm trước/sau khi duyệt.
  async function approveRow(id) {
    const row = ALL_ROWS.find((r) => r.id === id);
    const action = actionFor(row);
    if (!action) return;
    if (!(await showConfirm(`${action.label} cho đơn "${formLabel(row.form_code)}" của ${row.employees?.full_name || ''}?`, { confirmLabel: 'Duyệt' }))) return;

    if (action.step === 'level3') {
      const { error } = await supabase.rpc('finalize_leave_request_v2', { p_leave_id: row.id });
      if (error) { alert('Lỗi: ' + error.message); return; }
      await finalizeArchive(row);
      await loadRows();
      return;
    }

    const nowIso = new Date().toISOString();
    const updatePayload = { status: action.next };
    if (action.step === 'level1') { updatePayload.level1_approver_id = PROFILE.id; updatePayload.level1_approved_at = nowIso; }
    if (action.step === 'level2') { updatePayload.level2_approver_id = PROFILE.id; updatePayload.level2_approved_at = nowIso; }

    const { error } = await supabase.from('leave_requests').update(updatePayload).eq('id', row.id);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadRows();
  }

  // MỚI — trước đây hệ thống KHÔNG có cách từ chối đơn (chỉ có luồng
  // duyệt tiến), dù trạng thái "rejected" đã có sẵn trong database.
  async function rejectRow(id) {
    const row = ALL_ROWS.find((r) => r.id === id);
    const action = actionFor(row);
    if (!action) return;
    const reason = await showPromptDialog(`Lý do từ chối đơn "${formLabel(row.form_code)}" của ${row.employees?.full_name || ''}:`, { title: 'Từ chối đơn', required: true });
    if (reason === null) return;

    const { error } = await supabase.from('leave_requests').update({
      status: 'rejected', reject_reason: reason, rejected_by: PROFILE.id, rejected_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) { alert('Lỗi: ' + error.message); return; }

    const notifPayload = {
      scope: 'personal', target_employee_id: row.employee_id,
      title: `Đơn "${formLabel(row.form_code)}" đã bị từ chối`,
      content: `Đơn ${row.code} bị từ chối. Lý do: ${reason}`,
    };
    await supabase.from('notifications').insert({ ...notifPayload, created_by: PROFILE.id });
    triggerPush(notifPayload);
    await loadRows();
  }

  // MỚI — "Ký vào mẫu đơn" TÁCH RIÊNG khỏi việc duyệt (xem ghi chú ở
  // approveRow phía trên). Mở đúng file đã có (hoặc biểu mẫu gốc nếu đơn
  // này chưa từng được ký lần nào) để ký thêm — KHÔNG đổi status/cấp
  // duyệt, chỉ cập nhật file_url.
  async function signDocument(id) {
    const row = ALL_ROWS.find((r) => r.id === id);
    if (!PROFILE.signatureUrl) { alert('Bạn chưa cập nhật chữ ký cá nhân. Vào Hồ sơ cá nhân để tải lên trước khi ký.'); return; }

    const TEMPLATE = TEMPLATES[row.form_code];
    const sourceUrl = row.file_url || TEMPLATE?.file_url;
    if (!sourceUrl) { alert('Chưa có biểu mẫu để ký — chưa có file đính kèm và cũng chưa có biểu mẫu gốc cho loại đơn này.'); return; }

    let pdfUrl, signatureUrl;
    try {
      pdfUrl = await resolveFileUrl(sourceUrl, 1800);
      signatureUrl = await resolveFileUrl(PROFILE.signatureUrl, 1800);
    } catch (e) {
      alert('Không thể mở file để ký: ' + (e.message || 'Có lỗi xảy ra.'));
      return;
    }

    await openPdfEditor({
      pdfUrl: pdfUrl + (pdfUrl.includes('?') ? '&' : '?') + 't=' + Date.now(),
      signatureUrl,
      title: `Ký vào mẫu đơn — ${row.code}`,
      fieldMap: !row.file_url ? (TEMPLATE?.field_map || []) : undefined, // đơn chưa có file thì lấy vị trí đã thiết kế sẵn của biểu mẫu gốc
      onSave: async (blob) => {
        const newUrl = await overwriteFile(row.id, blob);
        await supabase.from('leave_requests').update({ file_url: newUrl }).eq('id', row.id);
        await loadRows();
      },
    });
  }

  // ---------------------------------------------------------------------
  // Tạo đơn mới — CHỈ hiện đúng 4 loại thuộc nhóm của chính người tạo đơn
  // (cán bộ hay giáo viên), không cho chọn nhầm loại của nhóm khác.
  // ---------------------------------------------------------------------
  const createModal = document.getElementById('createModal');
  const createError = document.getElementById('createError');
  const formCodeSelect = document.getElementById('formCode');
  const detailSection = document.getElementById('detailSection');
  const detailTableHead = document.getElementById('detailTableHead');
  const detailTableBody = document.getElementById('detailTableBody');

  // MỚI — dựng bảng chi tiết động theo đúng loại đơn đang chọn (xem
  // DETAIL_SCHEMAS đầu file). Ẩn hẳn khung này với loại đơn không cần
  // bảng chi tiết (Nghỉ bù).
  function renderDetailSection(formCode) {
    const schema = DETAIL_SCHEMAS[formCode];
    if (!schema) { detailSection.style.display = 'none'; detailTableBody.innerHTML = ''; return; }
    detailSection.style.display = '';
    document.getElementById('detailTitle').textContent = schema.title;
    detailTableHead.innerHTML = schema.columns.map((c) => `<th>${esc(c.label)}</th>`).join('') + '<th></th>';
    detailTableBody.innerHTML = '';
    addDetailRow(); // luôn có sẵn 1 dòng trống để điền ngay, đỡ phải bấm thêm
  }

  function addDetailRow() {
    const schema = DETAIL_SCHEMAS[formCodeSelect.value];
    if (!schema) return;
    const tr = document.createElement('tr');
    tr.innerHTML = schema.columns.map((c) => `<td><input type="${c.type === 'date' ? 'date' : 'text'}" class="text-input" data-key="${c.key}" style="width:100%;" /></td>`).join('')
      + '<td><button type="button" class="btn btn-outline btn-sm" data-remove-row>✕</button></td>';
    tr.querySelector('[data-remove-row]').addEventListener('click', () => tr.remove());
    detailTableBody.appendChild(tr);
  }
  document.getElementById('btnAddDetailRow').addEventListener('click', addDetailRow);

  function collectDetailItems() {
    const schema = DETAIL_SCHEMAS[formCodeSelect.value];
    if (!schema) return null;
    const items = [];
    detailTableBody.querySelectorAll('tr').forEach((tr) => {
      const item = {};
      let hasValue = false;
      tr.querySelectorAll('[data-key]').forEach((input) => {
        if (input.value.trim()) hasValue = true;
        item[input.dataset.key] = input.value.trim();
      });
      if (hasValue) items.push(item);
    });
    return items;
  }

  document.getElementById('btnAdd').addEventListener('click', () => {
    createError.classList.remove('show');
    formCodeSelect.innerHTML = FORM_TYPES[MY_GROUP].map((f) => `<option value="${f.code}">${esc(f.label)}</option>`).join('');
    document.getElementById('startDate').value = '';
    document.getElementById('days').value = '';
    document.getElementById('returnDate').value = '';
    document.getElementById('reasonNote').value = '';
    renderDetailSection(formCodeSelect.value);
    createModal.classList.add('show');
  });
  formCodeSelect.addEventListener('change', () => renderDetailSection(formCodeSelect.value));
  document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
  document.getElementById('cancelCreate').addEventListener('click', () => createModal.classList.remove('show'));

  // LÀM LẠI 22/08/2026 — "Gửi đơn" giờ chỉ gửi DỮ LIỆU (đủ để cấp trên
  // duyệt ngay, xem nút "Chi tiết" trong bảng) — KHÔNG còn bắt buộc phải
  // có sẵn biểu mẫu/chữ ký cá nhân mới tạo được đơn như trước. Ký vào mẫu
  // đơn giờ là việc RIÊNG, làm sau (nút "✍️ Ký vào mẫu đơn" trong bảng).
  document.getElementById('submitCreate').addEventListener('click', async () => {
    createError.classList.remove('show');
    const formCode = formCodeSelect.value;
    const startDate = document.getElementById('startDate').value;
    const days = document.getElementById('days').value;
    if (!startDate || !days) { createError.textContent = 'Vui lòng nhập đầy đủ ngày bắt đầu và số ngày.'; createError.classList.add('show'); return; }

    const detailItems = collectDetailItems();
    const TEMPLATE = TEMPLATES[formCode];

    const { data: inserted, error } = await supabase.from('leave_requests').insert({
      employee_id: PROFILE.id, form_code: formCode, staff_group: MY_GROUP, template_id: TEMPLATE?.id || null,
      leave_type: formCode.includes('nghikhongluong') ? 'unpaid' : 'annual',
      start_date: startDate, days: Number(days),
      return_date: document.getElementById('returnDate').value || null,
      reason_note: document.getElementById('reasonNote').value || null,
      detail_items: detailItems && detailItems.length > 0 ? detailItems : null,
      status: 'submitted',
    }).select('id').single();
    if (error) { createError.textContent = 'Lỗi: ' + error.message; createError.classList.add('show'); return; }

    createModal.classList.remove('show');

    const deptCode = MY_GROUP === 'teacher' ? 'EDU' : (PROFILE.departmentCode || 'HR');
    notifyDepartmentHeads(deptCode, `Có đơn "${formLabel(formCode)}" mới cần duyệt`,
      `${PROFILE.fullName} vừa gửi đơn ${formLabel(formCode)} — vào duyệt ngay.`, location.pathname, PROFILE.id);

    await loadRows();

    if (!TEMPLATE) {
      alert(`Đơn đã gửi thành công. Lưu ý: chưa có biểu mẫu PDF cho loại đơn "${formLabel(formCode)}" trong Kho lưu trữ > Biểu mẫu — khi cần ký, liên hệ bộ phận kỹ thuật để tải mẫu lên trước.`);
    }
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
    const canSeeAll = IS_HR || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (groupFilterEl) groupFilterEl.style.display = canSeeAll ? '' : 'none';

    // MỚI — Bộ lọc "Đơn vị" (trung tâm), cùng điều kiện hiện với bộ lọc
    // Nhóm nhân sự — theo yêu cầu "các chức năng ở phòng ban nên có bộ
    // lọc theo đơn vị để dễ kiểm soát và xử lý nhanh chóng".
    const centerFilterEl = document.getElementById('filterCenter');
    if (centerFilterEl) {
      centerFilterEl.style.display = canSeeAll ? '' : 'none';
      if (canSeeAll) {
        const { data: centers } = await supabase.from('centers').select('id, name').eq('is_active', true).order('name');
        centerFilterEl.innerHTML = '<option value="">Tất cả đơn vị</option>' + (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
        centerFilterEl.addEventListener('change', render);
      }
    }

    await loadTemplates();
    await loadRows();
  } catch (e) { /* bootShell tự điều hướng */ }
}
