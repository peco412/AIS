import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let ACTIVE_STUDENT = null;
let ACTIVE_WALLET_ID = null;
let ACTIVE_INVOICE = null;
let CAN_EDIT = false;
let CAN_REFUND = false;

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '—'; }

const HEALTH_LABEL = { good: 'Tốt', fair: 'Trung bình', poor: 'Xấu' };
const HEALTH_BADGE = { good: 'active', fair: 'submitted', poor: 'rejected' };
const STATUS_LABEL = { draft: 'Chờ chọn hình thức', unpaid: 'Chưa đóng', partially_paid: 'Một phần', paid: 'Đã đóng đủ', void: 'Đã huỷ' };
const STATUS_BADGE = { draft: 'submitted', unpaid: 'rejected', partially_paid: 'submitted', paid: 'active', void: 'unpaid' };
const PLAN_LABEL = { level: 'Trọn cấp độ', program: 'Trọn chương trình' };

// ---------------------------------------------------------------------
// MỚI — Gộp "Tổng hợp hoá đơn" (trang riêng trước đây) làm chế độ xem
// mặc định của trang này — thẻ thống kê + danh sách lọc được đầy đủ,
// bấm 1 dòng là mở luôn panel hành động bên dưới, không cần đổi trang.
// ---------------------------------------------------------------------
let ALL_INVOICES = [];

function showOverview() {
  document.getElementById('overviewPanel').style.display = 'block';
  document.getElementById('rosterPanel').style.display = 'none';
  document.getElementById('studentPanel').style.display = 'none';
  ACTIVE_STUDENT = null;
  unsubscribeRealtime();
}

document.getElementById('btnBackToOverview').addEventListener('click', () => {
  showOverview();
  loadOverview();
});

async function loadOverview() {
  const tbody = document.getElementById('overviewBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  let query = supabase.from('invoices_health_view')
    .select('id, student_id, class_id, period_year, period_month, amount_vnd, manual_discount_vnd, status, due_date, invoice_code, students!inner(full_name, center_id, centers(name)), classes(name)')
    .order('due_date', { ascending: false })
    .limit(500);
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('students.center_id', PROFILE.centerId);
  }
  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  ALL_INVOICES = data || [];
  await loadOverviewStats();
  await loadCenterFilterOptions();
  renderOverview();
}

async function loadOverviewStats() {
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
  if (select.options.length > 1) return;
  const { data } = await supabase.from('centers').select('id, name').order('name');
  select.innerHTML = '<option value="">Tất cả trung tâm</option>' + (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function renderOverview() {
  const q = document.getElementById('searchStudent').value.trim().toLowerCase();
  const statusFilter = document.getElementById('filterStatus').value;
  const centerFilter = document.getElementById('filterCenter').value;

  const rows = ALL_INVOICES.filter((inv) => {
    if (q && !(inv.students?.full_name || '').toLowerCase().includes(q)) return false;
    if (statusFilter && inv.status !== statusFilter) return false;
    if (centerFilter && inv.students?.center_id !== centerFilter) return false;
    return true;
  });

  const tbody = document.getElementById('overviewBody');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="6" class="empty-cell">Không có hoá đơn phù hợp.</td></tr>'
    : rows.map((inv) => {
        const net = Number(inv.amount_vnd) - Number(inv.manual_discount_vnd || 0);
        return `
          <tr>
            <td><strong>${esc(inv.students?.full_name || '—')}</strong><div class="cell-muted mono" style="font-size:10.5px;">${esc(inv.invoice_code || '—')}</div></td>
            <td class="cell-muted">${esc(inv.classes?.name || '—')} · ${esc(inv.students?.centers?.name || '—')}</td>
            <td class="cell-muted">${inv.period_month}/${inv.period_year}</td>
            <td class="mono">${fmtMoney(net)} đ</td>
            <td><span class="badge badge-${STATUS_BADGE[inv.status]}">${STATUS_LABEL[inv.status] || inv.status}</span></td>
            <td>
              <a href="/edu/invoice-print.html?id=${inv.id}" target="_blank" class="btn btn-outline btn-sm">Xem</a>
              <button class="btn btn-accent btn-sm" data-open-student="${inv.student_id}">Xử lý</button>
            </td>
          </tr>
        `;
      }).join('');

  tbody.querySelectorAll('[data-open-student]').forEach((btn) => btn.addEventListener('click', async () => {
    const { data: student } = await supabase.from('students').select('id, full_name, center_id, class_id, phone, parent_name, centers(name)').eq('id', btn.dataset.openStudent).maybeSingle();
    if (student) await selectStudent(student);
  }));
}
document.getElementById('filterStatus').addEventListener('change', renderOverview);
document.getElementById('filterCenter').addEventListener('change', renderOverview);

// ---------------------------------------------------------------------
// MỚI — Đồng bộ với app: khi phụ huynh tự đóng qua Ví trong app (hoặc
// nhân viên khác vừa thu tiền), tự động tải lại đúng học sinh đang xem,
// không cần bấm F5 mới thấy cập nhật.
// ---------------------------------------------------------------------
let REALTIME_CHANNEL = null;
function unsubscribeRealtime() {
  if (REALTIME_CHANNEL) { supabase.removeChannel(REALTIME_CHANNEL); REALTIME_CHANNEL = null; }
}
function subscribeRealtimeForStudent(studentId) {
  unsubscribeRealtime();
  REALTIME_CHANNEL = supabase
    .channel(`wallet-invoices-${studentId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'debt_ledger' }, () => {
      if (ACTIVE_STUDENT?.id === studentId) loadInvoices();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `student_id=eq.${studentId}` }, () => {
      if (ACTIVE_STUDENT?.id === studentId) loadInvoices();
    })
    .subscribe();
}

// ---------------------------------------------------------------------
// Tìm & chọn học sinh
// ---------------------------------------------------------------------
let searchTimer;
document.getElementById('searchStudent').addEventListener('input', () => {
  // Go la LOC ngay danh sach tong hop (khong tu nhay trang giua chung —
  // tranh bat ngo dieu huong di trong khi dang go chu tim) — muon nhay
  // thang toi dung 1 hoc sinh thi bam Enter (xem duoi).
  if (document.getElementById('overviewPanel').style.display !== 'none') renderOverview();
});
document.getElementById('searchStudent').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clearTimeout(searchTimer); searchAndPick(); }
});

// Tim nhanh theo MA HOA DON — gop chuc nang cua trang invoice-detail.html
// truoc day vao thang day, tranh 2 trang cung lam gan giong nhau. Nhap
// dung ma la tu dong tim ra hoc sinh + tai san danh sach hoa don cua ho.
async function searchByInvoiceCode() {
  const code = document.getElementById('searchInvoiceCode').value.trim();
  const feedback = document.getElementById('searchFeedback');
  if (!code) return;

  feedback.textContent = 'Đang tìm mã hoá đơn...';
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_code, students(id, full_name, center_id, class_id, centers(name))')
    .eq('invoice_code', code.toUpperCase())
    .maybeSingle();

  if (error) { feedback.textContent = `Lỗi: ${error.message}`; return; }
  if (!data || !data.students) {
    feedback.textContent = `Không tìm thấy hoá đơn với mã "${code}". Kiểm tra lại chính tả (VD: HD-00001).`;
    return;
  }

  feedback.textContent = '';
  document.getElementById('searchInvoiceCode').value = '';
  await selectStudent(data.students);
}
document.getElementById('searchInvoiceCode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchByInvoiceCode();
});

async function searchAndPick() {
  if (!PROFILE) return; // chờ tải xong hồ sơ trước khi tìm, tránh lỗi
  const q = document.getElementById('searchStudent').value.trim();
  const feedback = document.getElementById('searchFeedback');
  const resultsList = document.getElementById('searchResultsList');
  if (!q) { feedback.textContent = ''; resultsList.style.display = 'none'; return; }

  feedback.textContent = 'Đang tìm...';
  resultsList.style.display = 'none';

  let query = supabase.from('students').select('id, full_name, center_id, class_id, phone, parent_name, centers(name)').or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`).limit(8);
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('center_id', PROFILE.centerId);
  }
  const { data, error } = await query;

  if (error) { feedback.textContent = `Lỗi tìm kiếm: ${error.message}`; return; }
  if (!data || data.length === 0) {
    feedback.textContent = `Không tìm thấy học sinh nào tên "${q}". Kiểm tra lại chính tả hoặc học sinh có thuộc đúng trung tâm của bạn không.`;
    return;
  }
  if (data.length === 1) {
    feedback.textContent = '';
    await selectStudent(data[0]);
    return;
  }

  // Nhieu ket qua trung ten — de nhan vien tu chon dung nguoi, tranh chon
  // NHAM hoc sinh do truoc day tu dong lay ket qua dau tien.
  feedback.textContent = `Tìm thấy ${data.length} học sinh — chọn đúng người:`;
  resultsList.style.display = 'block';
  resultsList.innerHTML = data.map((s) => `
    <button type="button" class="btn btn-outline btn-sm" data-pick="${s.id}" style="margin: 2px 6px 2px 0;">
      ${esc(s.full_name)} ${s.phone ? `(${esc(s.phone)})` : ''} — ${esc(s.centers?.name || 'chưa gắn trung tâm')}
    </button>
  `).join('');
  resultsList.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const picked = data.find((s) => s.id === btn.dataset.pick);
      resultsList.style.display = 'none';
      feedback.textContent = '';
      await selectStudent(picked);
    });
  });
}

async function selectStudent(student) {
  ACTIVE_STUDENT = student;
  document.getElementById('overviewPanel').style.display = 'none';
  document.getElementById('rosterPanel').style.display = 'none';
  document.getElementById('studentPanel').style.display = 'block';
  document.getElementById('studentName').textContent = student.full_name;
  document.getElementById('studentCenter').textContent = student.centers?.name || '—';
  subscribeRealtimeForStudent(student.id);

  // "Lop hien tai" — dung dac ta yeu cau hien ro lop hoc sinh dang hoc
  // ngay tai day, truoc day thieu hoan toan truong nay.
  const classEl = document.getElementById('studentClass');
  if (student.class_id) {
    const { data: cls } = await supabase.from('classes').select('name').eq('id', student.class_id).maybeSingle();
    classEl.textContent = cls?.name ? `Lớp: ${cls.name}` : 'Chưa xếp lớp';
  } else {
    classEl.textContent = 'Chưa xếp lớp';
  }

  const { data: links } = await supabase.from('parent_student_links').select('relationship, parent_accounts(full_name, phone)').eq('student_id', student.id);
  const parentEl = document.getElementById('studentParent');
  parentEl.textContent = (links || []).length > 0
    ? links.map((l) => `${l.parent_accounts?.full_name || '—'} (${l.relationship || ''}) — ${l.parent_accounts?.phone || '—'}`).join(' · ')
    : 'Chưa liên kết phụ huynh nào';

  // SUA LOI THIET KE: "So du vi" o day CHI la thong tin THAM KHAO them
  // cho nhan vien khi thu hoc phi tai cho (biet hoc sinh co san tien
  // trong vi hay khong) — KHONG PHAI dieu kien bat buoc de trang hoat
  // dong. Truoc day code TU Y TAO VI MOI neu chua co (thao tac GHI,
  // khong can thiet, va thuong bi chan boi quyen han) roi return SOM
  // neu that bai, khien ca phan DANH SACH HOA DON (chuc nang CHINH cua
  // trang nay) cung khong tai duoc theo — 2 viec khong lien quan gi
  // nhau bi troi vao 1. Gio CHI DOC (khong tao), va KHONG BAO GIO chan
  // loadInvoices() du vi co loi gi di nua.
  const { data: wallet, error: walletErr } = await supabase.from('wallet_students').select('wallet_id').eq('student_id', student.id).maybeSingle();
  if (walletErr) {
    document.getElementById('walletBalance').textContent = '—';
    console.warn('Không tải được số dư ví (không ảnh hưởng thu học phí tại chỗ):', walletErr.message);
  } else if (!wallet) {
    document.getElementById('walletBalance').textContent = 'Chưa có ví';
    ACTIVE_WALLET_ID = null;
  } else {
    ACTIVE_WALLET_ID = wallet.wallet_id;
    const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining').eq('wallet_id', wallet.wallet_id);
    const balance = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);
    document.getElementById('walletBalance').textContent = `${fmtMoney(balance)} coin`;
  }

  // Luon chay, bat ke phan vi ben tren co loi hay khong — day moi la
  // chuc nang CHINH cua trang "Thu hoc phi".
  await loadInvoices();
}

// ---------------------------------------------------------------------
// Bảng khoản thu — GỘP hoá đơn thường + gói đã mua vào 1 bảng duy nhất
// (trước đây tách 2 bảng riêng gây rối mắt).
// ---------------------------------------------------------------------
async function loadInvoices() {
  const tbody = document.getElementById('invoiceBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Đang tải...</td></tr>';

  const [{ data: invoices, error }, { data: plans }] = await Promise.all([
    supabase.from('invoices_health_view').select('*').eq('student_id', ACTIVE_STUDENT.id).order('due_date', { ascending: false }),
    supabase.from('payment_plan_purchases').select('*').eq('student_id', ACTIVE_STUDENT.id),
  ]);
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!invoices || invoices.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có khoản thu nào — bấm "Tạo khoản thu mới".</td></tr>'; return; }

  const planByInvoice = {};
  (plans || []).forEach((p) => { if (p.invoice_id) planByInvoice[p.invoice_id] = p; });

  const invoiceIds = invoices.map((i) => i.id);
  const { data: ledgerRows } = await supabase.from('debt_ledger').select('invoice_id, amount_vnd').in('invoice_id', invoiceIds);

  tbody.innerHTML = invoices.map((inv) => {
    const paid = (ledgerRows || []).filter((l) => l.invoice_id === inv.id).reduce((s, l) => s + Number(l.amount_vnd), 0);
    const netAmount = Number(inv.amount_vnd) - Number(inv.manual_discount_vnd || 0);
    const remaining = netAmount - paid;
    const plan = planByInvoice[inv.id];
    const healthBadge = inv.health_status ? `<div style="margin-top:3px;"><span class="badge badge-${HEALTH_BADGE[inv.health_status]}" style="font-size:10px;">${HEALTH_LABEL[inv.health_status]}</span></div>` : '';
    const discountTypeLabel = { program: 'ưu đãi chương trình', special: 'diện đặc biệt', case: 'theo trường hợp' }[inv.discount_type] || 'theo trường hợp';
    // SUA: hien DUNG TEN chuong trinh uu dai da ap dung (vd "Ưu đãi hè
    // 2026") thay vi chi hien nhan chung chung "ưu đãi chương trình" —
    // theo dung gop y tranh nham lan khong biet dang ap dung uu dai nao.
    const discountNote = inv.manual_discount_vnd > 0
      ? `<div class="cell-muted" style="font-size:11px;">- ${fmtMoney(inv.manual_discount_vnd)} đ (${inv.applied_discount_program_name ? esc(inv.applied_discount_program_name) : discountTypeLabel})</div>`
      : '';

    let actions = '';
    if (plan && plan.status === 'active' && CAN_REFUND) {
      actions = `<button class="btn btn-outline btn-sm" data-refund="${plan.id}" data-total="${plan.total_courses}" data-amount="${plan.total_amount_vnd}">Hoàn phí</button>`;
    }
    const isBulkPlan = inv.chosen_plan_type === 'FULL_SUB_LEVEL' || (inv.chosen_plan_type || '').startsWith('COMBO_');
    if (inv.status === 'paid' && isBulkPlan) {
      actions += `<a href="/edu/refund-requests.html" class="btn btn-outline btn-sm">Hoàn phí</a>`;
    }
    // SUA LOI THAT: dieu kien cu "if (inv.status !== 'paid')" cho hien nut
    // Uu dai/Thu tien CHO CA hoa don DA HUY (void), vi 'void' cung khac
    // 'paid' — hoa don da huy khong nen thao tac gi duoc nua. Gio kiem
    // tra dung: chi hien khi con CAN thu (draft/unpaid/partially_paid).
    if (['draft', 'unpaid', 'partially_paid'].includes(inv.status)) {
      actions += `<button class="btn btn-outline btn-sm" data-adjust="${inv.id}" data-current="${inv.manual_discount_vnd || 0}">Ưu đãi</button>`;
      actions += `<button class="btn btn-accent btn-sm" data-collect="${inv.id}" data-remaining="${remaining}">Thu tiền</button>`;
    }
    // Hoa don da huy: khong xoa duoc nua (da la lich su, giu lai de doi
    // soat) — chi hoa don CHUA co dong nao VA CHUA huy moi cho xoa.
    if (paid === 0 && inv.status !== 'void') {
      actions += `<button class="btn btn-outline btn-sm" data-delete="${inv.id}" data-code="${esc(inv.invoice_code || '')}" title="Xoá hoá đơn"><svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg></button>`;
    }

    return `
      <tr>
        <td>
          <span class="mono cell-code">${esc(inv.invoice_code || '—')}</span>
          <div>${inv.period_month}/${inv.period_year}${plan ? `<div class="cell-muted" style="font-size:11px;">${PLAN_LABEL[plan.plan_type]}</div>` : ''}</div>
        </td>
        <td class="mono">${fmtMoney(inv.amount_vnd)} đ${discountNote}</td>
        <td class="mono" style="color:var(--success);">${fmtMoney(paid)} đ</td>
        <td class="mono" style="color:var(--danger); font-weight:600;">${fmtMoney(remaining)} đ</td>
        <td><span class="badge badge-${STATUS_BADGE[inv.status]}">${STATUS_LABEL[inv.status]}</span>${healthBadge}</td>
        <td style="white-space:nowrap;">${actions}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-collect]').forEach((btn) => btn.addEventListener('click', () => openCollectModal(invoices.find((i) => i.id === btn.dataset.collect), Number(btn.dataset.remaining))));
  tbody.querySelectorAll('[data-adjust]').forEach((btn) => btn.addEventListener('click', () => openAdjustDiscount(btn.dataset.adjust, Number(btn.dataset.current))));
  tbody.querySelectorAll('[data-refund]').forEach((btn) => btn.addEventListener('click', () => openPlanRefund(btn.dataset.refund, Number(btn.dataset.total), Number(btn.dataset.amount))));
  tbody.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(`Xoá hoá đơn ${btn.dataset.code || ''}? Không thể hoàn tác.`)) return;
    const { error } = await supabase.from('invoices').delete().eq('id', btn.dataset.delete);
    if (error) { alert('Không xoá được — hoá đơn này đã có giao dịch gắn với nó:\n' + error.message); return; }
    await loadInvoices();
  }));
}

// ---------------------------------------------------------------------
// Tạo khoản thu mới — 3 hình thức + nhập tay, chọn bằng radio rõ ràng
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Ưu đãi hoá đơn — chỉ 1 trong 2 (theo trường hợp / theo chương trình)
// ---------------------------------------------------------------------
async function openAdjustDiscount(invoiceId, currentDiscount) {
  const choice = prompt(
    'Chọn loại ưu đãi cho khoản thu này (chỉ được chọn 1):\n' +
    '1 = Giảm theo trường hợp (nhập tay số tiền + lý do)\n' +
    '2 = Áp dụng ưu đãi chương trình đang có cho trung tâm\n' +
    '3 = Diện ưu đãi đặc biệt (con/cháu HĐQT, con hiệu trưởng...)\n' +
    '0 = Bỏ ưu đãi\n\nNhập 0, 1, 2 hoặc 3:'
  );
  if (choice === null) return;

  try {
    if (choice === '1') {
      const amountStr = prompt('Số tiền ưu đãi (VNĐ):', currentDiscount || 0);
      if (amountStr === null) return;
      const amount = Number(amountStr);
      if (isNaN(amount) || amount < 0) { alert('Số tiền không hợp lệ.'); return; }
      const reason = prompt('Lý do (bắt buộc):');
      if (!reason) { alert('Cần nhập lý do.'); return; }
      const { error } = await supabase.rpc('apply_case_discount_to_invoice', { p_invoice_id: invoiceId, p_amount_vnd: amount, p_note: reason });
      if (error) throw error;
    } else if (choice === '2') {
      const { error } = await supabase.rpc('apply_program_discount_to_invoice', { p_invoice_id: invoiceId, p_approver_id: PROFILE.id });
      if (error) throw error;
    } else if (choice === '3') {
      const catChoice = prompt('Chọn diện ưu đãi:\n1 = Con HĐQT\n2 = Cháu HĐQT\n3 = Con hiệu trưởng\n4 = Khác\n\nNhập 1-4:');
      const catMap = { '1': 'board_child', '2': 'board_grandchild', '3': 'principal_child', '4': 'other' };
      const category = catMap[catChoice];
      if (!category) return;
      const amountStr = prompt('Số tiền ưu đãi (VNĐ):', currentDiscount || 0);
      if (amountStr === null) return;
      const amount = Number(amountStr);
      if (isNaN(amount) || amount < 0) { alert('Số tiền không hợp lệ.'); return; }
      const { error } = await supabase.rpc('apply_case_discount_to_invoice', { p_invoice_id: invoiceId, p_amount_vnd: amount, p_note: 'Diện ưu đãi đặc biệt', p_special_category: category });
      if (error) throw error;
    } else if (choice === '0') {
      const { error } = await supabase.rpc('apply_case_discount_to_invoice', { p_invoice_id: invoiceId, p_amount_vnd: 0, p_note: null });
      if (error) throw error;
    } else {
      return;
    }
    await selectStudent(ACTIVE_STUDENT);
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// ---------------------------------------------------------------------
// Hoàn phí gói (đã sửa công thức — không nhân chiết khấu 2 lần)
// ---------------------------------------------------------------------
async function openPlanRefund(purchaseId, totalCourses, totalAmount) {
  const completedStr = prompt(`Gói này gồm ${totalCourses} khoá, đã thu ${fmtMoney(totalAmount)} đ.\nXác nhận học viên đã học xong bao nhiêu khoá (0-${totalCourses})?`, '0');
  if (completedStr === null) return;
  const completed = Number(completedStr);
  if (isNaN(completed) || completed < 0 || completed > totalCourses) { alert('Số khoá không hợp lệ.'); return; }

  const perCourse = totalAmount / totalCourses;
  const refund = totalAmount - completed * perCourse;
  if (!confirm(`Giá trị 1 khoá: ${fmtMoney(perCourse)} đ\nSố tiền hoàn: ${fmtMoney(refund)} đ\n\nXác nhận hoàn phí? Không hoàn tác được.`)) return;

  const { error } = await supabase.rpc('process_plan_refund', { p_purchase_id: purchaseId, p_courses_completed: completed, p_approver_id: PROFILE.id });
  if (error) { alert('Lỗi: ' + error.message); return; }
  alert('Đã ghi nhận hoàn phí. Vui lòng chuyển tiền hoàn thực tế cho phụ huynh theo đúng số tiền trên.');
  await selectStudent(ACTIVE_STUDENT);
}

// ---------------------------------------------------------------------
// Thu tiền — qua Ví (FIFO thật) hoặc tại quầy
// ---------------------------------------------------------------------
const collectModal = document.getElementById('collectModal');
const collectError = document.getElementById('collectError');

async function openCollectModal(invoice, remaining) {
  ACTIVE_INVOICE = invoice;
  collectError.classList.remove('show');

  const planBox = document.getElementById('planChoiceBox');
  const paymentSection = document.getElementById('paymentCollectSection');

  // MOI — hoa don dang 'draft' (chua chon hinh thuc) va phu huynh dang o
  // truc tiep tai quay (khong qua app) — cho nhan vien chon giup hinh
  // thuc dong hoc phi ngay tai day, thay vi bat phu huynh tu vao app.
  if (invoice.status === 'draft') {
    document.getElementById('collectInfo').textContent = `Kỳ ${invoice.period_month}/${invoice.period_year} — chưa chọn hình thức đóng`;
    planBox.style.display = 'block';
    paymentSection.style.display = 'none';
    renderCounterPlanOptions(invoice);
    collectModal.classList.add('show');
    return;
  }
  planBox.style.display = 'none';
  paymentSection.style.display = 'block';

  const isBulkPlan = invoice.chosen_plan_type === 'FULL_SUB_LEVEL' || (invoice.chosen_plan_type || '').startsWith('COMBO_');
  const fullPaymentNote = isBulkPlan
    ? ' — Hình thức này bắt buộc đóng đủ, không nhận đóng từng phần.'
    : '';
  document.getElementById('collectInfo').textContent = `Kỳ ${invoice.period_month}/${invoice.period_year} — còn nợ ${fmtMoney(remaining)} đ${fullPaymentNote}`;

  const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining').eq('wallet_id', ACTIVE_WALLET_ID);
  const balance = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);

  const walletBox = document.getElementById('walletCollectBox');
  if (balance > 0) {
    walletBox.style.display = 'block';
    document.getElementById('walletBalanceDisplay').textContent = `${fmtMoney(balance)} AIScoins`;
    document.getElementById('collectCoin').value = Math.min(balance, remaining);
    document.getElementById('collectCoin').max = balance;
  } else {
    walletBox.style.display = 'none';
  }

  document.getElementById('collectVndCounter').value = remaining;
  collectModal.classList.add('show');
}

function renderCounterPlanOptions(invoice) {
  const box = document.getElementById('counterPlanOptionsList');
  const options = invoice.draft_options || [];
  if (options.length === 0) {
    box.innerHTML = '<div class="empty-cell">Chưa có lựa chọn nào — kiểm tra lại Khoá học của lớp.</div>';
    return;
  }
  box.innerHTML = options.map((opt) => `
    <label class="plan-option-card" data-plan="${esc(opt.plan_type)}">
      <div class="plan-option-card__top">
        <span class="plan-option-card__label">${esc(opt.label)}</span>
        <span class="plan-option-card__price">${fmtMoney(opt.amount_vnd)} đ</span>
      </div>
      ${opt.gets_program_rate && opt.program_name ? `<div class="cell-muted" style="font-size:11px; margin-top:4px;">Áp dụng: ${esc(opt.program_name)}${opt.gift_item_name ? ` — kèm quà: ${esc(opt.gift_item_name)}` : ''}</div>` : (opt.gift_item_name ? `<div class="cell-muted" style="font-size:11px; margin-top:4px;">Kèm quà: ${esc(opt.gift_item_name)}</div>` : '')}
    </label>
  `).join('');
  box.querySelectorAll('[data-plan]').forEach((card) => {
    card.addEventListener('click', async () => {
      card.style.opacity = '0.6';
      const { data, error } = await supabase.rpc('choose_draft_invoice_plan', { p_invoice_id: invoice.id, p_plan_type: card.dataset.plan });
      if (error) { collectError.textContent = error.message; collectError.classList.add('show'); card.style.opacity = '1'; return; }
      // Chon xong -> chuyen thang sang man thu tien binh thuong voi dung
      // so tien vua chon, khong can dong modal roi mo lai.
      await openCollectModal(data, Number(data.amount_vnd) - Number(data.manual_discount_vnd || 0));
    });
  });
}
document.getElementById('closeCollectModal').addEventListener('click', () => collectModal.classList.remove('show'));

document.getElementById('btnCollectWallet').addEventListener('click', async () => {
  collectError.classList.remove('show');
  const coin = Number(document.getElementById('collectCoin').value);
  if (!coin || coin <= 0) { collectError.textContent = 'Vui lòng nhập số AIScoins hợp lệ.'; collectError.classList.add('show'); return; }

  const btn = document.getElementById('btnCollectWallet');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    const { error } = await supabase.rpc('deduct_wallet_fifo', { p_invoice_id: ACTIVE_INVOICE.id, p_coin_to_deduct: coin, p_actor_id: PROFILE.id });
    if (error) throw error;
    alert(`Đã thu ${coin.toLocaleString('vi-VN')} AIScoins qua Ví.`);
    collectModal.classList.remove('show');
    await selectStudent(ACTIVE_STUDENT);
  } catch (err) {
    collectError.textContent = err.message || 'Có lỗi xảy ra.';
    collectError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Thu qua Ví';
  }
});

document.getElementById('btnCollectCounter').addEventListener('click', async () => {
  collectError.classList.remove('show');
  const amount = Number(document.getElementById('collectVndCounter').value);
  const method = document.getElementById('collectMethod').value;
  if (!amount || amount <= 0) { collectError.textContent = 'Vui lòng nhập số tiền hợp lệ.'; collectError.classList.add('show'); return; }

  const btn = document.getElementById('btnCollectCounter');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    const { error } = await supabase.rpc('record_counter_payment', { p_invoice_id: ACTIVE_INVOICE.id, p_source: method, p_amount_vnd: amount, p_actor_id: PROFILE.id });
    if (error) throw error;
    alert('Đã ghi nhận thu tiền tại quầy.');
    collectModal.classList.remove('show');
    await selectStudent(ACTIVE_STUDENT);
  } catch (err) {
    collectError.textContent = err.message || 'Có lỗi xảy ra.';
    collectError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Thu tại quầy';
  }
});

// ---------------------------------------------------------------------
// MỚI — Xem theo lớp: duyệt nhanh cả 1 lớp thay vì phải tìm từng học sinh
// — dễ quản lý hơn khi cần rà cả lớp xem ai đã đóng/chưa đóng.
// ---------------------------------------------------------------------
async function loadClassListForRoster() {
  let query = supabase.from('classes').select('id, name').order('name');
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('center_id', PROFILE.centerId);
  }
  const { data } = await query;
  const select = document.getElementById('rosterClassSelect');
  select.innerHTML = '<option value="">— Xem theo lớp —</option>' + (data || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadRoster(classId) {
  const panel = document.getElementById('rosterPanel');
  const tbody = document.getElementById('rosterBody');
  if (!classId) { panel.style.display = 'none'; document.getElementById('overviewPanel').style.display = 'block'; return; }
  panel.style.display = 'block';
  document.getElementById('overviewPanel').style.display = 'none';
  document.getElementById('studentPanel').style.display = 'none';
  tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Đang tải dữ liệu...</td></tr>';

  const { data: students } = await supabase
    .from('students').select('id, full_name, center_id, class_id, phone, parent_name, centers(name)')
    .eq('class_id', classId).eq('status', 'studying').order('full_name');

  if (!students || students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Lớp này chưa có học sinh nào.</td></tr>';
    return;
  }

  const now = new Date();
  const { data: invoices } = await supabase
    .from('invoices').select('student_id, status, amount_vnd, manual_discount_vnd')
    .in('student_id', students.map((s) => s.id))
    .eq('period_year', now.getFullYear()).eq('period_month', now.getMonth() + 1)
    .neq('status', 'void');
  const invoiceByStudent = {};
  (invoices || []).forEach((i) => { invoiceByStudent[i.student_id] = i; });

  tbody.innerHTML = students.map((s) => {
    const inv = invoiceByStudent[s.id];
    const statusHtml = !inv
      ? '<span class="badge rejected">Chưa có hoá đơn</span>'
      : inv.status === 'draft'
        ? '<span class="badge submitted">Chờ chọn hình thức</span>'
        : `<span class="badge ${STATUS_BADGE[inv.status]}">${STATUS_LABEL[inv.status]} — ${fmtMoney(inv.amount_vnd - (inv.manual_discount_vnd || 0))} đ</span>`;
    return `
      <tr>
        <td><strong>${esc(s.full_name)}</strong></td>
        <td class="cell-muted">${esc(s.parent_name || '—')} ${s.phone ? '· ' + esc(s.phone) : ''}</td>
        <td>${statusHtml}</td>
        <td><button class="btn btn-outline btn-sm" data-roster-view="${s.id}">Xem</button></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-roster-view]').forEach((btn) => btn.addEventListener('click', () => {
    const s = students.find((x) => x.id === btn.dataset.rosterView);
    document.getElementById('rosterPanel').style.display = 'none';
    document.getElementById('rosterClassSelect').value = '';
    selectStudent(s);
  }));
}
document.getElementById('rosterClassSelect').addEventListener('change', (e) => loadRoster(e.target.value));

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id, departmentCode: emp?.departments?.code };
    await loadClassListForRoster();

    // Ma tran: Thu hoc phi tai cho la nghiep vu hang ngay cua Quan ly
    // trung tam/Ke toan/Tu van vien - BDH/Ky thuat chi con quyen xem (R),
    // khong tu thu ho duoc nua (khac voi truoc day duoc ghi de toan quyen).
    CAN_EDIT = PROFILE.isCenterManager || PROFILE.departmentCode === 'ACC'
      || profile.roleCode === 'CONSULTANT';
    // Hoàn phí là nghiệp vụ hoàn tiền thật, cố tình KHÔNG mở cho Tư vấn viên
    // (giống chốt quyền ở tầng database — process_plan_refund()), và BDH/Ky
    // thuat cung chi con quyen xem theo dung ma tran.
    CAN_REFUND = PROFILE.departmentCode === 'ACC';

    // BDH/Ky thuat van XEM duoc trang nay (R) - chi khong ghi (W) duoc,
    // nen KHONG chan ca trang nhu truoc, chi an cac nut/thao tac ghi qua
    // CAN_EDIT/CAN_REFUND o cac cho render tuong ung.
    const canView = CAN_EDIT || CAN_REFUND || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canView) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Bạn không có quyền dùng trang này.</div>';
      return;
    }

    // MOI — cho phep nhay THANG toi 1 hoc sinh cu the qua URL (vd tu
    // link trong thong bao) — khong thi mac dinh hien Tong hop.
    const params = new URLSearchParams(window.location.search);
    const preselectId = params.get('student');
    if (preselectId) {
      const { data: preselectStudent } = await supabase.from('students').select('id, full_name, center_id, class_id, phone, parent_name, centers(name)').eq('id', preselectId).maybeSingle();
      if (preselectStudent) await selectStudent(preselectStudent);
      else await loadOverview();
    } else {
      await loadOverview();
    }
  } catch (e) { /* bootShell tự điều hướng */ }
})();
