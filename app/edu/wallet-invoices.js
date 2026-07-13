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
  const feedback = document.getElementById('searchFeedback');
  const resultsList = document.getElementById('searchResultsList');
  if (!q) { feedback.textContent = ''; resultsList.style.display = 'none'; return; }

  feedback.textContent = 'Đang tìm...';
  resultsList.style.display = 'none';

  let query = supabase.from('students').select('id, full_name, center_id, class_id, centers(name)').ilike('full_name', `%${q}%`).limit(8);
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
      ${esc(s.full_name)} — ${esc(s.centers?.name || 'chưa gắn trung tâm')}
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
  document.getElementById('studentPanel').style.display = 'block';
  document.getElementById('studentName').textContent = student.full_name;
  document.getElementById('studentCenter').textContent = student.centers?.name || '—';

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
  const { data: wallet, error: walletErr } = await supabase.from('wallets').select('id').eq('student_id', student.id).maybeSingle();
  if (walletErr) {
    document.getElementById('walletBalance').textContent = '—';
    console.warn('Không tải được số dư ví (không ảnh hưởng thu học phí tại chỗ):', walletErr.message);
  } else if (!wallet) {
    document.getElementById('walletBalance').textContent = 'Chưa có ví';
    ACTIVE_WALLET_ID = null;
  } else {
    ACTIVE_WALLET_ID = wallet.id;
    const { data: batches } = await supabase.from('wallet_topup_batches').select('coin_remaining').eq('wallet_id', wallet.id);
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
    const discountNote = inv.manual_discount_vnd > 0 ? `<div class="cell-muted" style="font-size:11px;">- ${fmtMoney(inv.manual_discount_vnd)} đ (${discountTypeLabel})</div>` : '';

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
        <td>
          <a href="/edu/invoice-detail.html?code=${encodeURIComponent(inv.invoice_code || '')}" class="mono cell-code" style="text-decoration:none;" title="Mở trang chi tiết/thanh toán riêng">${esc(inv.invoice_code || '—')}</a>
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
    document.getElementById('planPricePreview').textContent = '';

    const label = document.getElementById('planScopeLabel');
    const select = document.getElementById('planScopeSelect');
    select.innerHTML = '<option value="">Đang tải...</option>';

    if (type === 'sublevel') {
      label.textContent = 'Chọn cấp độ con';
      const { data } = await supabase.from('program_sublevels').select('id, name, program_levels(name, programs(name))').order('display_order');
      select.innerHTML = (data || []).map((s) => `<option value="${s.id}">${esc(s.program_levels?.programs?.name || '')} — ${esc(s.program_levels?.name || '')} — ${esc(s.name)}</option>`).join('');
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

// Gia luon cong don tu tang thap nhat "Khoa" (program_courses) - dung
// cho ca 3 hinh thuc, chi khac nhau o cach loc pham vi (qua 1/2/3 lop
// join tuong ung voi sublevel/level/program).
let PLAN_BASE_PRICE = 0;
let PLAN_TYPE_DISCOUNT_RATE = 0;

async function updatePlanPricePreview() {
  const type = selectedPlanType();
  const scopeId = document.getElementById('planScopeSelect').value;
  const previewEl = document.getElementById('planPricePreview');
  if (!scopeId) { previewEl.textContent = ''; PLAN_BASE_PRICE = 0; PLAN_TYPE_DISCOUNT_RATE = 0; recomputeAmounts(); return; }

  const { data: discountRow } = await supabase.from('payment_plan_discounts').select('discount_rate').eq('plan_type', type).single();
  PLAN_TYPE_DISCOUNT_RATE = discountRow?.discount_rate || 0;

  let basePrice = 0, courseCount = 0;
  if (type === 'sublevel') {
    const { data } = await supabase.from('program_courses').select('price_vnd').eq('sublevel_id', scopeId);
    basePrice = (data || []).reduce((s, x) => s + Number(x.price_vnd || 0), 0);
    courseCount = (data || []).length;
  } else if (type === 'level') {
    const { data: sublevels } = await supabase.from('program_sublevels').select('id').eq('level_id', scopeId);
    const sublevelIds = (sublevels || []).map((s) => s.id);
    const { data } = await supabase.from('program_courses').select('price_vnd').in('sublevel_id', sublevelIds.length ? sublevelIds : ['00000000-0000-0000-0000-000000000000']);
    basePrice = (data || []).reduce((s, x) => s + Number(x.price_vnd || 0), 0);
    courseCount = (data || []).length;
  } else if (type === 'program') {
    const { data: levels } = await supabase.from('program_levels').select('id').eq('program_id', scopeId);
    const levelIds = (levels || []).map((l) => l.id);
    const { data: sublevels } = await supabase.from('program_sublevels').select('id').in('level_id', levelIds.length ? levelIds : ['00000000-0000-0000-0000-000000000000']);
    const sublevelIds = (sublevels || []).map((s) => s.id);
    const { data } = await supabase.from('program_courses').select('price_vnd').in('sublevel_id', sublevelIds.length ? sublevelIds : ['00000000-0000-0000-0000-000000000000']);
    basePrice = (data || []).reduce((s, x) => s + Number(x.price_vnd || 0), 0);
    courseCount = (data || []).length;
  }

  PLAN_BASE_PRICE = basePrice;
  // Xem truoc gop du 3 nguon uu dai (hinh thuc dong + He thong tu dong +
  // tay nhap them, tay nhap se cong sau khi nguoi dung go o duoi) — o day
  // moi hien 2 nguon dau, uu dai tay se cap nhat qua recomputeAmounts().
  const previewRate = Math.min(PLAN_TYPE_DISCOUNT_RATE + AUTO_DISCOUNT_RATE, 1);
  const finalPrice = basePrice * (1 - previewRate);
  previewEl.innerHTML = basePrice > 0
    ? `Gồm ${courseCount} khoá — Giá gốc: ${fmtMoney(basePrice)} đ — Giảm ${(previewRate * 100).toFixed(1)}% (hình thức đóng + hệ thống ưu đãi, chưa gồm ưu đãi tay) — <strong>Thu: ${fmtMoney(finalPrice)} đ</strong>`
    : `<span style="color:var(--danger);">Chưa cấu hình học phí cho khoá nào thuộc phạm vi này.</span>`;
  recomputeAmounts();
}

let AUTO_DISCOUNT_RATE = 0;
let RECEIVED_TOUCHED = false;

document.getElementById('btnNewInvoice').addEventListener('click', async () => {
  document.getElementById('createError').classList.remove('show');
  document.querySelector('input[name="planType"][value="sublevel"]').checked = true;
  document.getElementById('planScopeField').style.display = 'block';
  document.querySelector('input[name="planType"]:checked').dispatchEvent(new Event('change'));
  const now = new Date();
  document.getElementById('invYear').value = now.getFullYear();
  document.getElementById('invMonth').value = now.getMonth() + 1;
  document.getElementById('invDueDate').value = '';
  document.getElementById('manualDiscountRate').value = 0;
  document.getElementById('specialCategory').value = '';
  document.getElementById('invReceivedVnd').value = '';
  document.getElementById('hinhThucThu').value = 'CASH';
  RECEIVED_TOUCHED = false;
  NET_AMOUNT_TOUCHED = false;

  // "Han dong phi" mac dinh = ngay ket khoa cua lop hoc sinh dang hoc.
  if (ACTIVE_STUDENT?.class_id) {
    const { data: cls } = await supabase.from('classes').select('end_date').eq('id', ACTIVE_STUDENT.class_id).single();
    if (cls?.end_date) document.getElementById('invDueDate').value = cls.end_date;
  }

  // "Ưu đãi tự động điền" — quét cấu hình Hệ thống ưu đãi của Kế toán
  // đang áp dụng đúng lớp/trung tâm của học sinh này ngay lúc mở form.
  AUTO_DISCOUNT_RATE = 0;
  document.getElementById('autoDiscountField').style.display = 'none';
  if (ACTIVE_STUDENT?.class_id && ACTIVE_STUDENT?.center_id) {
    const { data } = await supabase.rpc('get_auto_discount_for_class', {
      p_class_id: ACTIVE_STUDENT.class_id, p_center_id: ACTIVE_STUDENT.center_id,
    });
    AUTO_DISCOUNT_RATE = Number(data) || 0;
    if (AUTO_DISCOUNT_RATE > 0) {
      document.getElementById('autoDiscountField').style.display = 'block';
      document.getElementById('autoDiscountDisplay').textContent = `Tự động áp dụng: -${(AUTO_DISCOUNT_RATE * 100).toFixed(1)}%`;
    }
  }
  updateNetAmountPreview();
  createModal.classList.add('show');
});

function updateNetAmountPreview() {
  recomputeAmounts();
}

let NET_AMOUNT_TOUCHED = false;

// Tong tien sau uu dai = Gia goc x (1 - Uu dai hinh thuc dong - Uu dai He
// thong tu dong - Uu dai tay nhap them) — gop CA 3 nguon uu dai lam 1,
// ap dung chung cho ca 3 hinh thuc thu (Theo khoa/Cap do/Chuong trinh).
// Van la 1 O NHAP THUC SU (khong khoa cung) — tu dong goi y gia tinh san
// nhung nhan vien van sua duoc, vi khong phai luc nao gia cau hinh san
// cung dung 100% voi tinh huong thuc te (thoa thuan rieng, gia chua
// duoc cau hinh du cho khoa do...).
function recomputeAmounts() {
  const manualRate = Number(document.getElementById('manualDiscountRate').value) / 100 || 0;
  const totalRate = Math.min(PLAN_TYPE_DISCOUNT_RATE + AUTO_DISCOUNT_RATE + manualRate, 1);
  const suggested = PLAN_BASE_PRICE * (1 - totalRate);
  if (!NET_AMOUNT_TOUCHED) document.getElementById('netAmountInput').value = suggested ? Math.round(suggested) : '';
  const net = Number(document.getElementById('netAmountInput').value) || 0;
  // Mac dinh "Tien nhan" = du Tong tien (truong hop thuong gap nhat: dong
  // du 1 lan) — nhung neu nhan vien da tu tay sua o thi khong ghi de nua,
  // de ho tu do ghi dung so tien thuc nhan khi phu huynh dong 1 phan.
  if (!RECEIVED_TOUCHED) document.getElementById('invReceivedVnd').value = net || '';
  const received = Number(document.getElementById('invReceivedVnd').value) || 0;
  const remaining = Math.max(net - received, 0);
  document.getElementById('remainingPreview').textContent = `${remaining.toLocaleString('vi-VN')} đ`;
  document.getElementById('remainingPreview').style.color = remaining > 0 ? 'var(--danger)' : 'var(--success)';
}
document.getElementById('manualDiscountRate').addEventListener('input', recomputeAmounts);
document.getElementById('netAmountInput').addEventListener('input', () => { NET_AMOUNT_TOUCHED = true; recomputeAmounts(); });
document.getElementById('invReceivedVnd').addEventListener('input', () => { RECEIVED_TOUCHED = true; recomputeAmounts(); });
document.getElementById('closeCreateModal').addEventListener('click', () => createModal.classList.remove('show'));
document.getElementById('cancelCreateModal').addEventListener('click', () => createModal.classList.remove('show'));

document.getElementById('btnSubmitInvoice').addEventListener('click', async () => {
  const errBox = document.getElementById('createError');
  errBox.classList.remove('show');
  const type = selectedPlanType();
  const scopeId = document.getElementById('planScopeSelect').value;
  if (!scopeId) { errBox.textContent = 'Vui lòng chọn phạm vi.'; errBox.classList.add('show'); return; }

  try {
    const manualRate = Number(document.getElementById('manualDiscountRate').value) / 100 || 0;
    const specialCategory = document.getElementById('specialCategory').value || null;
    const { data: newInvoice, error } = await supabase.rpc('create_payment_plan_invoice', {
      p_student_id: ACTIVE_STUDENT.id, p_plan_type: type, p_scope_id: scopeId,
      p_manual_discount_rate: manualRate, p_special_category: specialCategory,
    });
    if (error) throw error;

    // Neu nhan vien tu sua "Tong tien" khac voi gia he thong tu tinh (vd
    // gia chua cau hinh du, thoa thuan rieng...) — ghi de lai dung theo
    // so ho go, giu nguyen gia goc de con audit, chi dieu chinh lai phan
    // uu dai cho khop dung so cuoi cung ho muon thu.
    const typedNet = Number(document.getElementById('netAmountInput').value) || 0;
    if (newInvoice?.id && typedNet > 0) {
      const computedNet = Number(newInvoice.amount_vnd) - Number(newInvoice.manual_discount_vnd || 0);
      if (Math.round(typedNet) !== Math.round(computedNet)) {
        const newDiscount = Number(newInvoice.amount_vnd) - typedNet;
        const { error: adjErr } = await supabase.from('invoices').update({ manual_discount_vnd: newDiscount }).eq('id', newInvoice.id);
        if (adjErr) throw adjErr;
      }
    }

    // "Tien nhan" — ghi nhan NGAY luon phan da thu duoc trong cung 1 thao
    // tac. SUA LOI THAT QUAN TRONG: truoc day insert THANG vao debt_ledger
    // + goi rieng refresh_invoice_status — BO QUA HOAN TOAN buoc ghi so
    // tai chinh (append_financial_log), khien khoan thu nay KHONG BAO GIO
    // vao duoc Bao cao tai chinh lan So cai. Da co san dung 1 ham lam CA
    // 3 viec cung luc (record_counter_payment) — dung lai cho dung, giong
    // y het luong "thu tiep hoa don da co san" ben duoi dang dung dung.
    const receivedVnd = Math.min(Number(document.getElementById('invReceivedVnd').value) || 0, PLAN_BASE_PRICE);
    const hinhThucThu = document.getElementById('hinhThucThu').value;
    if (receivedVnd > 0 && newInvoice?.id) {
      const { error: paymentErr } = await supabase.rpc('record_counter_payment', {
        p_invoice_id: newInvoice.id, p_source: hinhThucThu, p_amount_vnd: receivedVnd, p_actor_id: PROFILE.id,
      });
      if (paymentErr) throw paymentErr;
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
      const catMap = { '1': 'child_of_board', '2': 'grandchild_of_board', '3': 'child_of_principal', '4': 'other' };
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
    }
  } catch (e) { /* bootShell tự điều hướng */ }
})();
