import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let PROFILE_READY = false;
let ACTIVE_STUDENT = null;
let SEARCH_PARENT_TIMER;
let LOOKED_UP_PARENT = null; // kết quả tra cứu SĐT gần nhất trong modal — null nếu chưa tra hoặc không tìm thấy
let CAN_SEE_BALANCE = false; // MOI — chi Ke toan/Ban dieu hanh/Ky thuat moi thay so du vi that

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

// ---------------------------------------------------------------------
// Tìm học sinh — hiện luôn kèm số dư ví ngay trong bảng để không phải
// mở thêm trang khác mới biết ví đã có tiền hay chưa (gọn hơn theo đúng
// yêu cầu).
// ---------------------------------------------------------------------
async function searchStudents() {
  // BUG ĐÃ SỬA: trước đây hàm này có thể chạy khi PROFILE còn null (nếu
  // người dùng gõ tìm kiếm ngay lúc trang vừa mở, trước khi bootShell()
  // tải xong) -> lỗi "Cannot read properties of null". Giờ tự chờ.
  if (!PROFILE_READY) return;

  const q = document.getElementById('searchStudent').value.trim();
  const tbody = document.getElementById('tableBody');
  if (!q) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Nhập tên học sinh để tìm kiếm...</td></tr>'; return; }

  tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Đang tìm...</td></tr>';

  let query = supabase.from('students').select('id, full_name, centers(name)').ilike('full_name', `%${q}%`).limit(20);
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('center_id', PROFILE.centerId);
  }
  const { data: students, error } = await query;

  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }
  if (!students || students.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Không tìm thấy học sinh nào.</td></tr>'; return; }

  const studentIds = students.map((s) => s.id);
  const [{ data: links }, { data: wallets }] = await Promise.all([
    supabase.from('parent_student_links').select('student_id, relationship, parent_accounts(full_name, phone)').in('student_id', studentIds),
    supabase.from('wallet_students').select('wallet_id, student_id').in('student_id', studentIds),
  ]);

  const walletByStudent = {};
  (wallets || []).forEach((w) => { walletByStudent[w.student_id] = w.wallet_id; });
  const walletIds = [...new Set(Object.values(walletByStudent))];
  let balanceByWallet = {};
  if (walletIds.length > 0 && CAN_SEE_BALANCE) {
    const { data: batches } = await supabase.from('wallet_topup_batches').select('wallet_id, coin_remaining').in('wallet_id', walletIds);
    (batches || []).forEach((b) => { balanceByWallet[b.wallet_id] = (balanceByWallet[b.wallet_id] || 0) + Number(b.coin_remaining); });
  }

  tbody.innerHTML = students.map((s) => {
    const studentLinks = (links || []).filter((l) => l.student_id === s.id);
    const parentsText = studentLinks.length === 0
      ? '<span class="cell-muted">Chưa liên kết</span>'
      : studentLinks.map((l) => `${esc(l.parent_accounts?.full_name || '—')} (${esc(l.relationship || '')}) — ${esc(l.parent_accounts?.phone || '')}`).join('<br>');

    const walletId = walletByStudent[s.id];
    // SUA: chi Ke toan/Ban dieu hanh/Ky thuat moi thay dung so du — vai
    // tro khac (vd Quan ly trung tam) chi biet "co vi hay chua", khong
    // can biet chinh xac con bao nhieu tien, tranh lo thong tin tai
    // chinh khong can thiet.
    let balanceText;
    if (!walletId) {
      balanceText = '<span class="cell-muted">Chưa có ví</span>';
    } else if (CAN_SEE_BALANCE) {
      balanceText = `${fmtMoney(balanceByWallet[walletId] || 0)} coin`;
    } else {
      balanceText = '<span class="cell-muted">Đã có ví — chỉ Kế toán xem được số dư</span>';
    }

    return `
      <tr>
        <td>${esc(s.full_name)}</td>
        <td class="cell-muted">${esc(s.centers?.name || '—')}</td>
        <td class="mono" style="font-size:12.5px;">${balanceText}</td>
        <td style="font-size:12.5px;">${parentsText}</td>
        <td>
          <button class="btn btn-accent btn-sm" data-link="${s.id}" data-name="${esc(s.full_name)}">+ Liên kết</button>
          <a href="/edu/wallet-invoices.html" class="btn btn-outline btn-sm">Ví</a>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-link]').forEach((btn) => {
    btn.addEventListener('click', () => openLinkModal(btn.dataset.link, btn.dataset.name));
  });
}

let searchTimer;
document.getElementById('searchStudent').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchStudents, 350);
});

// ---------------------------------------------------------------------
// Modal liên kết — GỌN LẠI thành 1 luồng duy nhất: gõ SĐT tự tra cứu
// ngay (debounce), không cần bấm "Tìm" riêng; 1 nút "Liên kết" duy nhất
// luôn hiện sẵn, tự biết tạo mới hay dùng hồ sơ có sẵn.
// ---------------------------------------------------------------------
const modal = document.getElementById('linkModal');
const formError = document.getElementById('formError');

function openLinkModal(studentId, studentName) {
  ACTIVE_STUDENT = studentId;
  LOOKED_UP_PARENT = null;
  formError.classList.remove('show');
  document.getElementById('linkStudentInfo').textContent = `Học sinh: ${studentName}`;
  document.getElementById('parentPhone').value = '';
  document.getElementById('parentName').value = '';
  document.getElementById('foundParentBox').style.display = 'none';
  document.getElementById('newParentFields').style.display = 'none';
  modal.classList.add('show');
  document.getElementById('parentPhone').focus();
}
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

async function lookupParentByPhone(phone) {
  const box = document.getElementById('foundParentBox');
  const nameFields = document.getElementById('newParentFields');

  if (!phone) { box.style.display = 'none'; nameFields.style.display = 'none'; LOOKED_UP_PARENT = null; return; }

  const { data: parent } = await supabase.rpc('search_parent_by_phone', { p_phone: phone }).maybeSingle();
  LOOKED_UP_PARENT = parent || null;

  box.style.display = 'block';
  if (parent) {
    box.textContent = `Đã có tài khoản: ${parent.full_name} (${parent.phone})${parent.auth_user_id ? '' : ' — chưa từng đăng nhập App'}`;
    nameFields.style.display = 'none';
  } else {
    box.textContent = 'Chưa có tài khoản với SĐT này — sẽ tự tạo hồ sơ mới khi bạn bấm "Liên kết".';
    nameFields.style.display = 'block';
  }
}

document.getElementById('parentPhone').addEventListener('input', (e) => {
  clearTimeout(SEARCH_PARENT_TIMER);
  const phone = e.target.value.trim();
  SEARCH_PARENT_TIMER = setTimeout(() => lookupParentByPhone(phone), 400);
});

document.getElementById('btnConfirmLink').addEventListener('click', async () => {
  formError.classList.remove('show');
  const phone = document.getElementById('parentPhone').value.trim();
  const relationship = document.getElementById('relationship').value;
  if (!phone) { formError.textContent = 'Vui lòng nhập số điện thoại.'; formError.classList.add('show'); return; }

  const btn = document.getElementById('btnConfirmLink');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    let parentId = LOOKED_UP_PARENT?.id;

    if (!parentId) {
      const name = document.getElementById('parentName').value.trim();
      if (!name) throw new Error('Vui lòng nhập họ tên phụ huynh.');
      const { data: created, error: createErr } = await supabase.from('parent_accounts')
        .insert({ full_name: name, phone }).select('id').single();
      if (createErr) throw createErr;
      parentId = created.id;
    }

    const { error: linkErr } = await supabase.from('parent_student_links')
      .insert({ parent_account_id: parentId, student_id: ACTIVE_STUDENT, relationship });
    if (linkErr) throw linkErr;

    modal.classList.remove('show');
    await searchStudents();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Liên kết';
  }
});

// ---------------------------------------------------------------------
// MỚI — Tổng hợp liên kết ví: nhóm học sinh đang dùng CHUNG 1 ví (anh chị
// em ruột) — chỉ hiện nhóm có từ 2 học sinh trở lên (ví 1 học sinh không
// cần xem lại ở đây), giúp phát hiện nhanh trường hợp ví bị thiếu liên
// kết (đã gặp và sửa nhiều lần trước đây).
// ---------------------------------------------------------------------
async function loadWalletGroups() {
  const tbody = document.getElementById('walletGroupsBody');
  let query = supabase.from('wallet_students').select('wallet_id, students!inner(full_name, center_id, centers(name))');
  if (PROFILE.centerId && !['EXECUTIVE', 'TECH'].includes(PROFILE.roleCode) && PROFILE.departmentCode !== 'ACC') {
    query = query.eq('students.center_id', PROFILE.centerId);
  }
  const { data, error } = await query;
  if (error) { tbody.innerHTML = `<tr><td colspan="2" class="empty-cell">Lỗi: ${esc(error.message)}</td></tr>`; return; }

  const groups = {};
  (data || []).forEach((row) => {
    if (!row.students) return; // bi loc boi inner filter tren, hoac du lieu mo coi
    groups[row.wallet_id] = groups[row.wallet_id] || [];
    groups[row.wallet_id].push(row.students);
  });
  const sharedGroups = Object.entries(groups).filter(([, students]) => students.length > 1);

  if (sharedGroups.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-cell">Chưa có nhóm anh/chị em nào dùng chung ví.</td></tr>';
    return;
  }

  let balanceByWallet = {};
  if (CAN_SEE_BALANCE) {
    const { data: batches } = await supabase.from('wallet_topup_batches').select('wallet_id, coin_remaining').in('wallet_id', sharedGroups.map(([id]) => id));
    (batches || []).forEach((b) => { balanceByWallet[b.wallet_id] = (balanceByWallet[b.wallet_id] || 0) + Number(b.coin_remaining); });
  }

  tbody.innerHTML = sharedGroups.map(([walletId, students]) => `
    <tr>
      <td>${students.map((s) => `${esc(s.full_name)} <span class="cell-muted" style="font-size:11px;">(${esc(s.centers?.name || '—')})</span>`).join(', ')}</td>
      <td class="mono">${CAN_SEE_BALANCE ? `${fmtMoney(balanceByWallet[walletId] || 0)} coin` : ''}</td>
    </tr>
  `).join('');
}

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id, departmentCode: emp?.departments?.code };
    PROFILE_READY = true;
    CAN_SEE_BALANCE = PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    document.getElementById('balanceColHeader').textContent = CAN_SEE_BALANCE ? 'Số dư ví' : 'Tình trạng ví';
    document.getElementById('groupBalanceColHeader').textContent = CAN_SEE_BALANCE ? 'Số dư' : '';

    const canUse = PROFILE.isCenterManager || PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Quản lý trung tâm/Kế toán/Ban điều hành mới dùng được trang này.</div>';
      return;
    }
    // Nếu người dùng đã gõ sẵn nội dung tìm kiếm trong lúc chờ tải (trường
    // hợp gây bug trước đây), tự chạy tìm kiếm lại ngay bây giờ.
    if (document.getElementById('searchStudent').value.trim()) searchStudents();
    await loadWalletGroups();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
