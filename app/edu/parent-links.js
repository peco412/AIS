import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let PROFILE = null;
let PROFILE_READY = false;
let ACTIVE_STUDENT = null;
let SEARCH_PARENT_TIMER;
let LOOKED_UP_PARENT = null; // kết quả tra cứu SĐT gần nhất trong modal — null nếu chưa tra hoặc không tìm thấy

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
    supabase.from('wallets').select('id, student_id').in('student_id', studentIds),
  ]);

  const walletByStudent = {};
  (wallets || []).forEach((w) => { walletByStudent[w.student_id] = w.id; });
  const walletIds = Object.values(walletByStudent);
  let balanceByWallet = {};
  if (walletIds.length > 0) {
    const { data: batches } = await supabase.from('wallet_topup_batches').select('wallet_id, coin_remaining').in('wallet_id', walletIds);
    (batches || []).forEach((b) => { balanceByWallet[b.wallet_id] = (balanceByWallet[b.wallet_id] || 0) + Number(b.coin_remaining); });
  }

  tbody.innerHTML = students.map((s) => {
    const studentLinks = (links || []).filter((l) => l.student_id === s.id);
    const parentsText = studentLinks.length === 0
      ? '<span class="cell-muted">Chưa liên kết</span>'
      : studentLinks.map((l) => `${esc(l.parent_accounts?.full_name || '—')} (${esc(l.relationship || '')}) — ${esc(l.parent_accounts?.phone || '')}`).join('<br>');

    const walletId = walletByStudent[s.id];
    const balanceText = walletId ? `${fmtMoney(balanceByWallet[walletId] || 0)} coin` : '<span class="cell-muted">Chưa có ví</span>';

    return `
      <tr>
        <td>${esc(s.full_name)}</td>
        <td class="cell-muted">${esc(s.centers?.name || '—')}</td>
        <td class="mono" style="font-size:12.5px;">${balanceText}</td>
        <td style="font-size:12.5px;">${parentsText}</td>
        <td>
          <button class="btn btn-accent btn-sm" data-link="${s.id}" data-name="${esc(s.full_name)}">+ Liên kết</button>
          <a href="/edu/wallet-invoices.html" class="btn btn-outline btn-sm">💳 Ví</a>
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

  const { data: parent } = await supabase.from('parent_accounts').select('*').eq('phone', phone).maybeSingle();
  LOOKED_UP_PARENT = parent || null;

  box.style.display = 'block';
  if (parent) {
    box.textContent = `✅ Đã có tài khoản: ${parent.full_name} (${parent.phone})${parent.auth_user_id ? '' : ' — chưa từng đăng nhập App'}`;
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

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, center_id, departments(code)').eq('id', profile.id).single();
    PROFILE = { ...profile, centerId: emp?.center_id, departmentCode: emp?.departments?.code };
    PROFILE_READY = true;

    const canUse = PROFILE.isCenterManager || PROFILE.departmentCode === 'ACC' || ['EXECUTIVE', 'TECH'].includes(profile.roleCode);
    if (!canUse) {
      document.querySelector('.main').innerHTML = '<div class="empty-cell">Chỉ Quản lý trung tâm/Kế toán/Ban điều hành mới dùng được trang này.</div>';
      return;
    }
    // Nếu người dùng đã gõ sẵn nội dung tìm kiếm trong lúc chờ tải (trường
    // hợp gây bug trước đây), tự chạy tìm kiếm lại ngay bây giờ.
    if (document.getElementById('searchStudent').value.trim()) searchStudents();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
