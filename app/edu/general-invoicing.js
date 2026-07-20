import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

const STATUS_LABEL = { draft: 'Chờ chọn hình thức', unpaid: 'Chưa đóng', partially_paid: 'Một phần', paid: 'Đã đóng đủ', void: 'Đã huỷ' };
const STATUS_BADGE = { draft: 'submitted', unpaid: 'rejected', partially_paid: 'submitted', paid: 'active', void: 'unpaid' };

let PROFILE = null;
let ALL_INVOICES = [];
let PENDING_ROWS = [];
let ACTIVE_ROW = null;

function fmtMoney(n) { return new Intl.NumberFormat('vi-VN').format(Math.round(n || 0)); }

// ---------------------------------------------------------------------
// PHAN CHINH — Tong hop hoa don: the thong ke + bang loc day du, thay
// the cho danh sach "cho tao hoa don" gan nhu luon trong tu khi xep lop
// da tu dong tao hoa don ngay (khong con la muc dich chinh cua trang nay
// nua).
// ---------------------------------------------------------------------
async function loadInvoiceSummary() {
  const tbody = document.getElementById('invoiceListBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  let query = supabase.from('invoices_health_view')
    .select('id, student_id, class_id, period_year, period_month, amount_vnd, manual_discount_vnd, status, due_date, students(full_name, center_id, centers(name)), classes(name)')
    .order('due_date', { ascending: false })
    .limit(500);
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('students.center_id', PROFILE.centerId);
  }
  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_INVOICES = data || [];
  await loadStats();
  await loadCenterFilterOptions();
  renderSummary();
}

async function loadStats() {
  const now = new Date();
  const [{ count: draftCount }, { count: unpaidCount }, { count: partialCount }, { data: collectedRows }] = await Promise.all([
    supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'unpaid'),
    supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'partially_paid'),
    supabase.from('debt_ledger').select('amount_vnd').gte('created_at', new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
  ]);
  document.getElementById('statDraft').textContent = draftCount ?? '—';
  document.getElementById('statUnpaid').textContent = unpaidCount ?? '—';
  document.getElementById('statPartial').textContent = partialCount ?? '—';
  document.getElementById('statCollected').textContent = fmtMoney((collectedRows || []).reduce((s, r) => s + Number(r.amount_vnd), 0)) + ' đ';
}

async function loadCenterFilterOptions() {
  const select = document.getElementById('filterCenter');
  if (select.options.length > 1) return; // da tai roi, khong tai lai
  const { data } = await supabase.from('centers').select('id, name').order('name');
  select.innerHTML = '<option value="">Tất cả trung tâm</option>' + (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function renderSummary() {
  const q = document.getElementById('searchBox').value.trim().toLowerCase();
  const statusFilter = document.getElementById('filterStatus').value;
  const centerFilter = document.getElementById('filterCenter').value;

  const rows = ALL_INVOICES.filter((inv) => {
    if (q && !(inv.students?.full_name || '').toLowerCase().includes(q)) return false;
    if (statusFilter && inv.status !== statusFilter) return false;
    if (centerFilter && inv.students?.center_id !== centerFilter) return false;
    return true;
  });
  document.getElementById('resultCount').textContent = `${rows.length} hoá đơn`;

  const tbody = document.getElementById('invoiceListBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="6" class="empty-cell">Không có hoá đơn phù hợp.</td></tr>'
    : rows.map((inv) => {
        const net = Number(inv.amount_vnd) - Number(inv.manual_discount_vnd || 0);
        return `
          <tr>
            <td><strong>${esc(inv.students?.full_name || '—')}</strong></td>
            <td class="cell-muted">${esc(inv.classes?.name || '—')} · ${esc(inv.students?.centers?.name || '—')}</td>
            <td class="cell-muted">${inv.period_month}/${inv.period_year}</td>
            <td class="mono">${fmtMoney(net)} đ</td>
            <td><span class="badge badge-${STATUS_BADGE[inv.status]}">${STATUS_LABEL[inv.status] || inv.status}</span></td>
            <td><a href="/edu/wallet-invoices.html" class="btn btn-outline btn-sm">Xem chi tiết</a></td>
          </tr>
        `;
      }).join('');
}
document.getElementById('searchBox').addEventListener('input', renderSummary);
document.getElementById('filterStatus').addEventListener('change', renderSummary);
document.getElementById('filterCenter').addEventListener('change', renderSummary);

// ---------------------------------------------------------------------
// PHAN PHU (thu gon) — hoc sinh xep lop nhung chua co hoa don (hiem gap
// tu khi co trigger tu dong, giu lai lam phuong an du phong).
// ---------------------------------------------------------------------
async function loadPendingRows() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  let query = supabase.from('v_pending_invoice_students').select('*').order('class_start_date', { ascending: true });
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('center_id', PROFILE.centerId);
  }
  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  PENDING_ROWS = data || [];
  renderPending();
}

function renderPending() {
  const q = document.getElementById('pendingSearchBox').value.trim().toLowerCase();
  const rows = PENDING_ROWS.filter((r) => !q || r.full_name.toLowerCase().includes(q) || (r.phone || '').includes(q));
  document.getElementById('pendingResultCount').textContent = `${rows.length} học sinh`;

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="6" class="empty-cell">Không còn học sinh nào cần tạo hoá đơn thủ công</td></tr>'
    : rows.map((r) => `
        <tr>
          <td><strong>${esc(r.full_name)}</strong><div class="cell-muted" style="font-size:11px;">${esc(r.student_code || '')} · ${esc(r.phone || 'chưa có SĐT')}</div></td>
          <td class="cell-muted">${esc(r.class_name)}</td>
          <td class="cell-muted">${esc(r.center_name || '—')}</td>
          <td class="cell-muted">${esc(r.consultant_name || '—')}</td>
          <td class="cell-muted" style="font-size:12px;">${r.class_start_date ? new Date(r.class_start_date).toLocaleDateString('vi-VN') : '—'}</td>
          <td><button class="btn btn-accent btn-sm" data-create="${r.student_id}">Tạo hoá đơn</button></td>
        </tr>
      `).join('');

  tbody.querySelectorAll('[data-create]').forEach((btn) => btn.addEventListener('click', () => openCreateModal(btn.dataset.create)));
}
document.getElementById('pendingSearchBox').addEventListener('input', renderPending);

const modal = document.getElementById('createModal');
const errBox = document.getElementById('createError');

function openCreateModal(studentId) {
  ACTIVE_ROW = PENDING_ROWS.find((r) => r.student_id === studentId);
  errBox.classList.remove('show');
  document.getElementById('modalStudentName').textContent = ACTIVE_ROW.full_name;
  document.getElementById('modalPlanInfo').textContent = ACTIVE_ROW.course_id
    ? ''
    : 'Lớp học sinh này chưa gắn Khoá học cụ thể — vào trang Chương trình & Bảng giá khoá học để gắn trước khi tạo hoá đơn.';
  document.getElementById('paymentOption').value = '';
  document.getElementById('pricePreview').textContent = '—';
  document.getElementById('manualDiscountRate').value = 0;
  document.getElementById('specialCategory').value = '';
  document.getElementById('submitCreate').disabled = false;
  modal.classList.add('show');
}

async function previewPrice() {
  const option = document.getElementById('paymentOption').value;
  const previewEl = document.getElementById('pricePreview');
  if (!option || !ACTIVE_ROW?.course_id) { previewEl.textContent = '—'; return; }
  previewEl.textContent = 'Đang tính...';

  const [{ data: baseAmount, error }, { data: programs }] = await Promise.all([
    supabase.rpc('calculate_payment_option_amount_for_course', { p_course_id: ACTIVE_ROW.course_id, p_option: option }),
    supabase.rpc('get_auto_discount_program_for_class', { p_class_id: ACTIVE_ROW.class_id, p_center_id: ACTIVE_ROW.center_id }),
  ]);
  if (error) { previewEl.textContent = `Không tính được: ${error.message}`; return; }

  const program = (programs || [])[0];
  if (program) {
    const netAmount = Math.round(baseAmount * (1 - program.discount_rate));
    previewEl.innerHTML = `${fmtMoney(netAmount)} đ <span class="badge badge-active" style="font-size:10px; margin-left:6px;">${esc(program.program_name)} -${Math.round(program.discount_rate * 100)}%</span>`;
  } else {
    previewEl.textContent = `${fmtMoney(baseAmount)} đ`;
  }
}
document.getElementById('paymentOption').addEventListener('change', previewPrice);

document.getElementById('closeCreateModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelCreateModal').addEventListener('click', () => modal.classList.remove('show'));

document.getElementById('submitCreate').addEventListener('click', async () => {
  errBox.classList.remove('show');
  const option = document.getElementById('paymentOption').value;
  if (!option) { errBox.textContent = 'Vui lòng chọn hình thức đóng học phí.'; errBox.classList.add('show'); return; }
  const manualRate = Number(document.getElementById('manualDiscountRate').value) / 100 || 0;
  const specialCategory = document.getElementById('specialCategory').value || null;

  const btn = document.getElementById('submitCreate');
  btn.disabled = true; btn.textContent = 'Đang tạo...';
  try {
    const { error } = await supabase.rpc('create_invoice_for_payment_option', {
      p_student_id: ACTIVE_ROW.student_id, p_option: option,
      p_manual_discount_rate: manualRate, p_special_category: specialCategory,
    });
    if (error) throw error;
    modal.classList.remove('show');
    await loadPendingRows();
    await loadInvoiceSummary();
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Tạo hoá đơn';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id, departmentCode: emp?.departments?.code };
    await loadInvoiceSummary();
    await loadPendingRows();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
