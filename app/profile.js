import { bootShell } from '/js/shell.js';
import { supabase, esc, uploadPrivateFile, resolveFileUrl, openFile } from '/js/supabase.js';
import { isPushSupported, getPushPermissionState, isPushEnabledOnThisDevice, enablePush, disablePush } from '/js/pushNotifications.js';

const DOC_TYPE_LABEL = { degree: 'Bằng cấp', certificate: 'Chứng chỉ', cv: 'CV' };
let PROFILE = null;
let EMP = null;

function initials(name) { return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase(); }

async function loadEmployee() {
  const { data } = await supabase.from('employees').select('*').eq('id', PROFILE.id).single();
  EMP = data;

  document.getElementById('pFullName').textContent = EMP.full_name;
  document.getElementById('pPosition').textContent = PROFILE.positionName || PROFILE.roleName;
  document.getElementById('pCode').textContent = EMP.employee_code;

  const avatarBox = document.getElementById('avatarBox');
  if (EMP.avatar_url) {
    try {
      const url = await resolveFileUrl(EMP.avatar_url, 1800);
      avatarBox.innerHTML = `<img src="${esc(url)}" />`;
    } catch { avatarBox.innerHTML = esc(initials(EMP.full_name)); }
  } else {
    avatarBox.innerHTML = esc(initials(EMP.full_name));
  }

  document.getElementById('phone').value = EMP.phone || '';
  document.getElementById('email').value = EMP.email || '';

  document.getElementById('sysCode').value = EMP.employee_code;
  document.getElementById('sysRole').value = PROFILE.roleName;
  document.getElementById('dob').value = EMP.dob || '';
  document.getElementById('hometown').value = EMP.hometown || '';
  document.getElementById('idCard').value = EMP.id_card_number || '';
  document.getElementById('address').value = EMP.address || '';
  document.getElementById('emergencyName').value = EMP.emergency_contact_name || '';
  document.getElementById('emergencyPhone').value = EMP.emergency_contact_phone || '';

  const sigBox = document.getElementById('signaturePreview');
  if (EMP.signature_url) {
    try {
      const url = await resolveFileUrl(EMP.signature_url, 1800);
      sigBox.innerHTML = `<img src="${esc(url)}" />`;
    } catch { sigBox.innerHTML = 'Không thể tải chữ ký.'; }
  } else {
    sigBox.innerHTML = 'Chưa có chữ ký';
  }
}

async function loadDocs() {
  const { data, error } = await supabase.from('employee_documents').select('*').eq('employee_id', PROFILE.id).order('uploaded_at', { ascending: false });
  const box = document.getElementById('docsList');
  if (error) { box.innerHTML = `Lỗi tải dữ liệu: ${error.message}`; return; }
  if (!data || data.length === 0) { box.innerHTML = 'Chưa có tài liệu nào.'; return; }
  box.innerHTML = data.map((d) => `
    <div class="doc-item">
      <span>${esc(DOC_TYPE_LABEL[d.doc_type])} — ${esc(d.file_name || 'file.pdf')}</span>
      <button class="btn btn-outline btn-sm" data-open="${esc(d.file_url)}">Xem</button>
    </div>
  `).join('');
  box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFile(b.dataset.open)));
}

document.getElementById('generalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.from('employees').update({
    phone: document.getElementById('phone').value || null,
    email: document.getElementById('email').value || null,
  }).eq('id', PROFILE.id);
  if (error) { alert('Lỗi: ' + error.message); return; }
  alert('Đã lưu thông tin chung.');
});

document.getElementById('systemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.from('employees').update({
    dob: document.getElementById('dob').value || null,
    hometown: document.getElementById('hometown').value || null,
    id_card_number: document.getElementById('idCard').value || null,
    address: document.getElementById('address').value || null,
    emergency_contact_name: document.getElementById('emergencyName').value || null,
    emergency_contact_phone: document.getElementById('emergencyPhone').value || null,
  }).eq('id', PROFILE.id);
  if (error) { alert('Lỗi: ' + error.message); return; }
  alert('Đã lưu thông tin hệ thống.');
});

document.getElementById('avatarFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const path = `avatars/${PROFILE.id}.png`;
  try {
    await uploadPrivateFile(path, file, { upsert: true });
    const { error } = await supabase.from('employees').update({ avatar_url: path }).eq('id', PROFILE.id);
    if (error) throw error;
    await loadEmployee();
  } catch (err) {
    alert('Lỗi tải ảnh: ' + (err.message || 'Có lỗi xảy ra.'));
  }
});

document.getElementById('signatureFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const path = `signatures/${PROFILE.id}.png`;
  try {
    await uploadPrivateFile(path, file, { upsert: true });
    const { error } = await supabase.from('employees').update({ signature_url: path }).eq('id', PROFILE.id);
    if (error) throw error;
    alert('Đã cập nhật chữ ký cá nhân. Chữ ký này sẽ dùng để ký các phiếu điện tử.');
    await loadEmployee();
  } catch (err) {
    alert('Lỗi tải chữ ký: ' + (err.message || 'Có lỗi xảy ra.'));
  }
});

document.getElementById('btnUploadDoc').addEventListener('click', async () => {
  const file = document.getElementById('docFile').files[0];
  const docType = document.getElementById('docType').value;
  if (!file) { alert('Vui lòng chọn file PDF.'); return; }

  const btn = document.getElementById('btnUploadDoc');
  btn.disabled = true; btn.textContent = 'Đang tải lên...';
  try {
    const path = `employee-docs/${PROFILE.id}/${Date.now()}_${file.name}`;
    await uploadPrivateFile(path, file, { upsert: true });
    const { error } = await supabase.from('employee_documents').insert({
      employee_id: PROFILE.id, doc_type: docType, file_url: path, file_name: file.name,
    });
    if (error) throw error;
    document.getElementById('docFile').value = '';
    await loadDocs();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Tải lên';
  }
});

document.getElementById('btnChangePassword').addEventListener('click', async () => {
  const pwError = document.getElementById('pwError');
  pwError.classList.remove('show');
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (newPassword.length < 6) { pwError.textContent = 'Mật khẩu phải có ít nhất 6 ký tự.'; pwError.classList.add('show'); return; }
  if (newPassword !== confirmPassword) { pwError.textContent = 'Mật khẩu xác nhận không khớp.'; pwError.classList.add('show'); return; }

  const btn = document.getElementById('btnChangePassword');
  btn.disabled = true; btn.textContent = 'Đang cập nhật...';
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  btn.disabled = false; btn.textContent = 'Đổi mật khẩu';
  if (error) { pwError.textContent = error.message; pwError.classList.add('show'); return; }
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  alert('Đã đổi mật khẩu thành công.');
});

// ---------------------------------------------------------------------
// Thông báo đẩy (Web Push)
// ---------------------------------------------------------------------
async function refreshPushUI() {
  const statusEl = document.getElementById('pushStatus');
  const btnEnable = document.getElementById('btnEnablePush');
  const btnDisable = document.getElementById('btnDisablePush');

  if (!isPushSupported()) {
    statusEl.textContent = 'Trình duyệt này không hỗ trợ thông báo đẩy.';
    btnEnable.style.display = 'none';
    btnDisable.style.display = 'none';
    return;
  }

  const permission = getPushPermissionState();
  if (permission === 'denied') {
    statusEl.textContent = 'Bạn đã chặn quyền thông báo cho trang này. Vào cài đặt trình duyệt để bật lại.';
    btnEnable.style.display = 'none';
    btnDisable.style.display = 'none';
    return;
  }

  const enabled = await isPushEnabledOnThisDevice();
  statusEl.textContent = enabled ? '✅ Đang bật trên thiết bị này.' : 'Chưa bật trên thiết bị này.';
  btnEnable.style.display = enabled ? 'none' : 'inline-flex';
  btnDisable.style.display = enabled ? 'inline-flex' : 'none';
}

document.getElementById('btnEnablePush').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const errBox = document.getElementById('pushError');
  errBox.classList.remove('show');
  btn.disabled = true; btn.textContent = 'Đang bật...';
  try {
    await enablePush(supabase, PROFILE.id);
    await refreshPushUI();
  } catch (err) {
    errBox.textContent = err.message || 'Không bật được thông báo đẩy.';
    errBox.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Bật thông báo đẩy trên thiết bị này';
  }
});

document.getElementById('btnDisablePush').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = 'Đang tắt...';
  try {
    await disablePush(supabase);
    await refreshPushUI();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Tắt thông báo đẩy trên thiết bị này';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    await loadEmployee();
    await loadDocs();
    await refreshPushUI();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
