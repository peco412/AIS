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
const STATUS_LABEL = { unpaid: 'Chưa đóng', partially_paid: 'Một phần', paid: 'Đã đóng đủ' };
const STATUS_BADGE = { unpaid: 'rejected', partially_paid: 'submitted', paid: 'active' };
const PLAN_LABEL = { level: 'Trọn cấp độ', program: 'Trọn chương trình' };

// ---------------------------------------------------------------------
// Tìm & chọn học sinh
// ---------------------------------------------------------------------
let searchTimer;
document.getElementById('searchStudent').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchAndPick, 350);
});

async function searchAndPick() {
  if (!PROFILE) return; // chờ tải xong hồ sơ trước khi tìm, tránh lỗi
  const q = document.getElementById('searchStudent').value.trim();
  if (!q) return;

  let query = supabase.from('students').select('id, full_name, center_id, centers(name)').ilike('full_name', `%${q}%`).limit(5);
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('center_id', PROFILE.centerId);
  }
  const { data } = await query;
  if (!data || data.length === 0) return;
  await selectStudent(data[0]);
}

async function selectStudent(student) {
  ACTIVE_STUDENT = student;
  document.getElementById('studentPanel').style.display = 'block';
  document.getElementById('studentName').textContent = student.full_name;
  document.getElementById('studentCenter').textContent = student.centers?.name || '—';

  let { data: wallet } = await supabase.from('wallets').select('id').eq('student_id', student.id).maybeSingle();
  if (!wallet) {
    const { data: created } = await supabase.from('wallets').insert({ student_id: student.id }).select('id').single();
    wallet = created;
  }
  ACTIVE_WALLET_ID = wallet.id;

  const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining').eq('wallet_id', wallet.id);
  const balance = (batches || []).reduce((s, b) => s + Number(b.coin_remaining), 0);
  document.getElementById('walletBalance').textContent = `${fmtMoney(balance)} coin`;

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
    const discountNote = inv.manual_discount_vnd > 0 ? `<div class="cell-muted" style="font-size:11px;">- ${fmtMoney(inv.manual_discount_vnd)} đ (${inv.discount_type === 'program' ? 'ưu đãi chương trình' : 'theo trường hợp'})</div>` : '';

    let actions = '';
    if (plan && plan.status === 'active' && CAN_REFUND) {
      actions = `<button class="btn btn-outline btn-sm" data-refund="${plan.id}" data-total="${plan.total_courses}" data-amount="${plan.total_amount_vnd}">Hoàn phí</button>`;
    }
    if (inv.status !== 'paid') {
      actions += `<button class="btn btn-outline btn-sm" data-adjust="${inv.id}" data-current="${inv.manual_discount_vnd || 0}">Ưu đãi</button>`;
      actions += `<button class="btn btn-accent btn-sm" data-collect="${inv.id}" data-remaining="${remaining}">Thu tiền</button>`;
    }

    return `
      <tr>
        <td>${inv.period_month}/${inv.period_year}${plan ? `<div class="cell-muted" style="font-size:11px;">${PLAN_LABEL[plan.plan_type]}</div>` : ''}</td>
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
}

// ---------------------------------------------------------------------
// Tạo khoản thu mới — 3 hình thức + nhập tay, chọn bằng radio rõ ràng
// ---------------------------------------------------------------------
const createModal = document.getElementById('createInvoiceModal');

function selectedPlanType() {
  return document.querySelector('input[name="planType"]:checked').value;
}

document.querySelectorAll('input[name="planType"]').forEach((radio) => {
  radio.addEventListener('change', async () => {
    const type = selectedPlanType();
    document.getElementById('manualFields').style.display = type === 'manual' ? 'block' : 'none';
    document.getElementById('planScopeField').style.display = type === 'manual' ? 'none' : 'block';
    document.getElementById('planPricePreview').textContent = '';
    if (type === 'manual') return;

    const label = document.getElementById('planScopeLabel');
    const select = document.getElementById('planScopeSelect');
    select.innerHTML = '<option value="">Đang tải...</option>';

    if (type === 'sublevel') {
      label.textContent = 'Chọn cấp độ con';
      const { data } = await supabase.from('program_sublevels').select('id, name, price_vnd, program_levels(name, programs(name))').order('display_order');
      select.innerHTML = (data || []).map((s) => `<option value="${s.id}" data-price="${s.price_vnd || 0}">${esc(s.program_levels?.programs?.name || '')} — ${esc(s.program_levels?.name || '')} — ${esc(s.name)}</option>`).join('');
    } else if (type === 'level') {
      label.textContent = 'Chọn cấp độ';
      const { data } = await supabase.from('program_levels').select('id, name, programs(name)').order('display_order');
      select.innerHTML = (data || []).map((l) => `<option value="${l.id}">${esc(l.programs?.name || '')} — ${esc(l.name)}</option>`).join('');
    } else if (type === 'program') {
      label.textContent = 'Chọn chương trình';
      const { data } = await supabase.from('programs').select('id, name').order('display_order');
      select.innerHTML = (data || []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    }
    updatePlanPricePreview();
  });
});

document.getElementById('planScopeSelect').addEventListener('change', updatePlanPricePreview);

async function updatePlanPricePreview() {
  const type = selectedPlanType();
  const scopeId = document.getElementById('planScopeSelect').value;
  const previewEl = document.getElementById('planPricePreview');
  if (type === 'manual' || !scopeId) { previewEl.textContent = ''; return; }

  const { data: discountRow } = await supabase.from('payment_plan_discounts').select('discount_rate').eq('plan_type', type).single();
  const discountRate = discountRow?.discount_rate || 0;

  let basePrice = 0, courseCount = 0;
  if (type === 'sublevel') {
    const opt = document.getElementById('planScopeSelect').selectedOptions[0];
    basePrice = Number(opt?.dataset.price || 0);
    courseCount = 1;
  } else if (type === 'level') {
    const { data } = await supabase.from('program_sublevels').select('price_vnd').eq('level_id', scopeId);
    basePrice = (data || []).reduce((s, x) => s + Number(x.price_vnd || 0), 0);
    courseCount = (data || []).length;
  } else if (type === 'program') {
    const { data: levels } = await supabase.from('program_levels').select('id').eq('program_id', scopeId);
    const levelIds = (levels || []).map((l) => l.id);
    const { data } = await supabase.from('program_sublevels').select('price_vnd').in('level_id', levelIds.length ? levelIds : ['00000000-0000-0000-0000-000000000000']);
    basePrice = (data || []).reduce((s, x) => s + Number(x.price_vnd || 0), 0);
    courseCount = (data || []).length;
  }

  const finalPrice = basePrice * (1 - discountRate);
  previewEl.innerHTML = basePrice > 0
    ? `Gồm ${courseCount} cấp độ con — Giá gốc: ${fmtMoney(basePrice)} đ — Giảm ${(discountRate * 100).toFixed(0)}% — <strong>Thu: ${fmtMoney(finalPrice)} đ</strong>`
    : `<span style="color:var(--danger);">Chưa cấu hình học phí cho cấp độ con thuộc phạm vi này.</span>`;
}

document.getElementById('btnNewInvoice').addEventListener('click', () => {
  document.getElementById('createError').classList.remove('show');
  document.querySelector('input[name="planType"][value="sublevel"]').checked = true;
  document.getElementById('manualFields').style.display = 'none';
  document.getElementById('planScopeField').style.display = 'block';
  document.querySelector('input[name="planType"]:checked').dispatchEvent(new Event('change'));
  const now = new Date();
  document.getElementById('invYear').value = now.getFullYear();
  document.getElementById('invMonth').value = now.getMonth() + 1;
  document.getElementById('invAmountVnd').value = '';
  document.getElementById('invDueDate').value = '';
  createModal.classList.add('show');
});
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreateModal').addEventListener('click', () => createModal.classList.remove('show'));

document.getElementById('btnSubmitInvoice').addEventListener('click', async () => {
  const errBox = document.getElementById('createError');
  errBox.classList.remove('show');
  const type = selectedPlanType();

  try {
    if (type === 'manual') {
      const payload = {
        student_id: ACTIVE_STUDENT.id,
        period_year: Number(document.getElementById('invYear').value),
        period_month: Number(document.getElementById('invMonth').value),
        amount_vnd: Number(document.getElementById('invAmountVnd').value),
        amount_aiscoin: Number(document.getElementById('invAmountVnd').value),
        due_date: document.getElementById('invDueDate').value,
        status: 'unpaid',
      };
      if (!payload.amount_vnd || !payload.due_date) { errBox.textContent = 'Vui lòng nhập đủ số tiền và hạn chót.'; errBox.classList.add('show'); return; }
      const { error } = await supabase.from('invoices').insert(payload);
      if (error) throw error;
    } else {
      const scopeId = document.getElementById('planScopeSelect').value;
      if (!scopeId) { errBox.textContent = 'Vui lòng chọn phạm vi.'; errBox.classList.add('show'); return; }
      const { error } = await supabase.rpc('create_payment_plan_invoice', { p_student_id: ACTIVE_STUDENT.id, p_plan_type: type, p_scope_id: scopeId });
      if (error) throw error;
    }
    createModal.classList.remove('show');
    await selectStudent(ACTIVE_STUDENT);
  } catch (err) {
    errBox.textContent = err.message || 'Có lỗi xảy ra.';
    errBox.classList.add('show');
  }
});

// ---------------------------------------------------------------------
// Ưu đãi hoá đơn — chỉ 1 trong 2 (theo trường hợp / theo chương trình)
// ---------------------------------------------------------------------
async function openAdjustDiscount(invoiceId, currentDiscount) {
  const choice = prompt(
    'Chọn loại ưu đãi cho khoản thu này (chỉ được chọn 1):\n' +
    '1 = Giảm theo trường hợp (nhập tay số tiền + lý do)\n' +
    '2 = Áp dụng ưu đãi chương trình đang có cho trung tâm\n' +
    '0 = Bỏ ưu đãi\n\nNhập 0, 1 hoặc 2:'
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
  document.getElementById('collectInfo').textContent = `Kỳ ${invoice.period_month}/${invoice.period_year} — còn nợ ${fmtMoney(remaining)} đ`;

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
    btn.disabled = false; btn.textContent = '💳 Thu qua Ví';
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
    btn.disabled = false; btn.textContent = '🧾 Thu tại quầy';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id, departmentCode: emp?.departments?.code };

    // Thêm Nhân viên tư vấn được thao tác (trước đây chỉ Kế toán/Quản lý
    // trung tâm), vì tư vấn viên cũng cần thu học phí lúc ghi danh mới.
    CAN_EDIT = PROFILE.isCenterManager || PROFILE.departmentCode === 'ACC'
      || profile.roleCode === 'CONSULTANT' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    // Hoàn phí là nghiệp vụ hoàn tiền thật, cố tình KHÔNG mở cho Tư vấn viên
    // (giống chốt quyền ở tầng database — process_plan_refund()).
    CAN_REFUND = PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);

    if (!CAN_EDIT) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Quản lý trung tâm/Kế toán/Tư vấn viên/Ban điều hành mới dùng được trang này.</div>';
    }
  } catch (e) { /* bootShell tự điều hướng */ }
})();
