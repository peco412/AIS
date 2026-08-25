import { supabase, esc, bootSocialShell } from './parentSupabase.js';

let PROFILE = null;
let CURRENT_CONVERSATION_ID = null;
let CURRENT_OTHER_NAME = '';

function initials(name) { return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase(); }
function timeShort(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

// ---------------------------------------------------------------------
// MOI — "Giao vien phu trach" — de phu huynh nhan tin nhanh cho dung
// giao vien cua con minh, khong phai tu go ten tim kiem thu cong.
// ---------------------------------------------------------------------
async function loadTeacherShortcuts() {
  if (PROFILE.type !== 'parent') return; // chi phu huynh moi can loi tat nay
  const box = document.getElementById('teacherShortcuts');

  const { data: links } = await supabase
    .from('parent_student_links')
    .select('students(full_name, classes(id, name, teacher_id, employees:teacher_id(id, full_name, positions(name))))')
    .eq('parent_account_id', PROFILE.id);

  const teacherMap = new Map();
  (links || []).forEach((l) => {
    const cls = l.students?.classes;
    const teacher = cls?.employees;
    if (!teacher) return;
    if (!teacherMap.has(teacher.id)) teacherMap.set(teacher.id, { id: teacher.id, name: teacher.full_name, position: teacher.positions?.name, classNames: new Set(), studentNames: new Set() });
    teacherMap.get(teacher.id).classNames.add(cls.name);
    teacherMap.get(teacher.id).studentNames.add(l.students.full_name);
  });

  if (teacherMap.size === 0) { box.innerHTML = ''; return; }

  box.innerHTML = `
    <div class="teacher-shortcuts">
      <div class="teacher-shortcuts__title">👩‍🏫 Giáo viên phụ trách</div>
      ${[...teacherMap.values()].map((t) => `
        <div class="teacher-chip">
          <div class="teacher-chip__avatar">${esc(initials(t.name))}</div>
          <div>
            <div class="teacher-chip__name">${esc(t.name)}</div>
            <div class="teacher-chip__sub">Lớp ${esc([...t.classNames].join(', '))} — con: ${esc([...t.studentNames].join(', '))}</div>
          </div>
          <button class="teacher-chip__btn" data-msg-teacher="${t.id}" data-teacher-name="${esc(t.name)}">Nhắn tin</button>
        </div>
      `).join('')}
    </div>
  `;
  box.querySelectorAll('[data-msg-teacher]').forEach((btn) => {
    btn.addEventListener('click', () => startConversationWith('employee', btn.dataset.msgTeacher, btn.dataset.teacherName));
  });
}

// ---------------------------------------------------------------------
// Danh sach hoi thoai
// ---------------------------------------------------------------------

// MOI — social_conversation_participants tham chieu THANG toi
// parent_accounts/employees (khong phai social_profiles), nen phai
// truy van social_profiles RIENG de lay dung ten hien thi cong khai —
// giong het cach da sua ben community.js.
async function fetchProfilesMap(parentIds, employeeIds) {
  const map = new Map();
  if (parentIds.length === 0 && employeeIds.length === 0) return map;
  const { data, error } = await supabase.rpc('get_social_profiles_batch', { p_parent_ids: parentIds, p_employee_ids: employeeIds });
  if (error) { console.warn('Không lấy được hồ sơ hiển thị:', error.message); return map; }
  (data || []).forEach((r) => {
    const key = `${r.owner_type}:${r.owner_id}`;
    map.set(key, { name: r.display_name, avatar: r.avatar_url });
  });
  return map;
}
function profileFor(map, parentId, employeeId) {
  const key = parentId ? `parent:${parentId}` : `employee:${employeeId}`;
  return map.get(key) || { name: parentId ? 'Phụ huynh' : 'Nhân viên', avatar: null };
}

async function loadConversations() {
  const list = document.getElementById('convList');
  const myFilterCol = PROFILE.type === 'parent' ? 'participant_parent_id' : 'participant_employee_id';

  const { data: myParts, error } = await supabase
    .from('social_conversation_participants')
    .select('conversation_id, social_conversations(id, last_message_at)')
    .eq(myFilterCol, PROFILE.id);

  if (error) { list.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  if (!myParts || myParts.length === 0) { list.innerHTML = '<div class="empty-state">Chưa có cuộc trò chuyện nào — tìm tên ở trên để bắt đầu nhắn tin.</div>'; return; }

  const convIds = myParts.map((p) => p.conversation_id);
  const { data: allParts } = await supabase
    .from('social_conversation_participants')
    .select('conversation_id, participant_parent_id, participant_employee_id')
    .in('conversation_id', convIds);

  const profilesMap = await fetchProfilesMap(
    [...new Set((allParts || []).filter((p) => p.participant_parent_id).map((p) => p.participant_parent_id))],
    [...new Set((allParts || []).filter((p) => p.participant_employee_id).map((p) => p.participant_employee_id))]
  );

  const { data: lastMsgs } = await supabase
    .from('social_messages')
    .select('conversation_id, content, created_at')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false });

  const lastMsgByConv = {};
  (lastMsgs || []).forEach((m) => { if (!lastMsgByConv[m.conversation_id]) lastMsgByConv[m.conversation_id] = m; });

  const rows = myParts.map((p) => {
    const others = (allParts || []).filter((ap) => ap.conversation_id === p.conversation_id && !(
      (PROFILE.type === 'parent' && ap.participant_parent_id === PROFILE.id) ||
      (PROFILE.type === 'employee' && ap.participant_employee_id === PROFILE.id)
    ));
    const otherName = others.map((o) => profileFor(profilesMap, o.participant_parent_id, o.participant_employee_id).name).filter(Boolean).join(', ') || 'Cuộc trò chuyện';
    const last = lastMsgByConv[p.conversation_id];
    return {
      id: p.conversation_id,
      name: otherName,
      lastMessageAt: p.social_conversations?.last_message_at,
      preview: last?.content || 'Chưa có tin nhắn',
    };
  }).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

  list.innerHTML = rows.map((r) => `
    <div class="conv-row" data-conv="${r.id}" data-name="${esc(r.name)}">
      <div class="conv-row__avatar">${esc(initials(r.name))}</div>
      <div style="flex:1; min-width:0;">
        <div class="conv-row__name">${esc(r.name)}</div>
        <div class="conv-row__preview">${esc(r.preview)}</div>
      </div>
      <div class="conv-row__time">${r.lastMessageAt ? timeShort(r.lastMessageAt) : ''}</div>
    </div>
  `).join('');

  list.querySelectorAll('[data-conv]').forEach((row) => {
    row.addEventListener('click', () => openThread(row.dataset.conv, row.dataset.name));
  });
}

// ---------------------------------------------------------------------
// Tim nguoi de bat dau hoi thoai moi (tim trong ca phu huynh va nhan
// vien cung trung tam)
// ---------------------------------------------------------------------
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
let searchDebounce = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (q.length < 2) { searchResults.classList.remove('show'); return; }
  searchDebounce = setTimeout(() => runSearch(q), 250);
});

async function runSearch(q) {
  // SUA — truoc day tim thang trong parent_accounts.full_name, nhung
  // bang do CHI cho xem ten CHINH MINH (RLS bao ve rieng tu ERP) — hau
  // het nguoi tim se KHONG RA KET QUA NAO ca. Gio tim trong
  // social_profiles.display_name (mo doc cho moi nguoi dang nhap),
  // dung cho DUNG muc dich tim de nhan tin.
  const { data: profiles } = await supabase.from('social_profiles').select('id, display_name, parent_account_id, employee_id').ilike('display_name', `%${q}%`).limit(15);

  const results = (profiles || [])
    .filter((p) => !(PROFILE.type === 'parent' && p.parent_account_id === PROFILE.id) && !(PROFILE.type === 'employee' && p.employee_id === PROFILE.id))
    .map((p) => ({ type: p.parent_account_id ? 'parent' : 'employee', id: p.parent_account_id || p.employee_id, name: p.display_name }));

  if (results.length === 0) { searchResults.innerHTML = '<div class="search-result-row">Không tìm thấy ai phù hợp.</div>'; searchResults.classList.add('show'); return; }

  searchResults.innerHTML = results.map((r) => `
    <div class="search-result-row" data-type="${r.type}" data-id="${r.id}" data-name="${esc(r.name)}">
      <div class="conv-row__avatar" style="width:30px;height:30px;font-size:11px;">${esc(initials(r.name))}</div>
      ${esc(r.name)} ${r.type === 'employee' ? '<span style="color:var(--muted); font-size:11px;">(nhân viên)</span>' : ''}
    </div>
  `).join('');
  searchResults.classList.add('show');
  searchResults.querySelectorAll('[data-type]').forEach((row) => {
    row.addEventListener('click', () => startConversationWith(row.dataset.type, row.dataset.id, row.dataset.name));
  });
}

async function startConversationWith(otherType, otherId, otherName) {
  searchResults.classList.remove('show');
  searchInput.value = '';

  // SUA — truoc day tu ghep 3 buoc insert rieng le o client, moi buoc
  // phai tu dung dung dieu kien RLS — de sai va gay loi "vi pham RLS"
  // kho do nguyen nhan. Gio goi 1 ham xu ly san tren server (RPC), lam
  // toan bo trong 1 buoc chac chan dung.
  const { data: convId, error } = await supabase.rpc('start_or_get_conversation', { p_other_type: otherType, p_other_id: otherId });
  if (error) { alert('Không tạo được cuộc trò chuyện: ' + error.message); return; }

  openThread(convId, otherName);
}

// ---------------------------------------------------------------------
// Man hinh chat (thread)
// ---------------------------------------------------------------------
async function openThread(conversationId, otherName) {
  CURRENT_CONVERSATION_ID = conversationId;
  CURRENT_OTHER_NAME = otherName;
  document.getElementById('threadName').textContent = otherName;
  document.getElementById('threadView').classList.add('show');
  await loadMessages();
  subscribeRealtimeMessages(conversationId);
}

async function loadMessages() {
  const box = document.getElementById('threadMessages');
  const { data: msgs, error } = await supabase
    .from('social_messages')
    .select('id, content, created_at, sender_parent_id, sender_employee_id')
    .eq('conversation_id', CURRENT_CONVERSATION_ID)
    .order('created_at', { ascending: true });

  if (error) { box.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }

  box.innerHTML = (msgs || []).map((m) => {
    const isMine = (PROFILE.type === 'parent' && m.sender_parent_id === PROFILE.id) || (PROFILE.type === 'employee' && m.sender_employee_id === PROFILE.id);
    return `<div class="msg-bubble ${isMine ? 'mine' : 'theirs'}">${esc(m.content)}<div class="msg-time">${timeShort(m.created_at)}</div></div>`;
  }).join('') || '<div class="empty-state">Chưa có tin nhắn nào — gửi lời chào đầu tiên!</div>';
  box.scrollTop = box.scrollHeight;
}

// MOI — dung Supabase Realtime thay cho tu tai lai theo vong lap: tin
// nhan moi (ke ca cua nguoi kia gui toi) hien LEN NGAY khi vua co, dung
// 1 kenh RIENG cho tung hoi thoai dang mo, huy dang ky khi doi/dong
// thread de tranh giu nhieu kenh cung luc.
let realtimeChannel = null;
function subscribeRealtimeMessages(conversationId) {
  if (realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
  realtimeChannel = supabase
    .channel(`social_messages:${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'social_messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      appendMessageBubble(payload.new);
    })
    .subscribe();
}

function appendMessageBubble(m) {
  const box = document.getElementById('threadMessages');
  const isMine = (PROFILE.type === 'parent' && m.sender_parent_id === PROFILE.id) || (PROFILE.type === 'employee' && m.sender_employee_id === PROFILE.id);
  const emptyNotice = box.querySelector('.empty-state');
  if (emptyNotice) emptyNotice.remove();
  box.insertAdjacentHTML('beforeend', `<div class="msg-bubble ${isMine ? 'mine' : 'theirs'}">${esc(m.content)}<div class="msg-time">${timeShort(m.created_at)}</div></div>`);
  box.scrollTop = box.scrollHeight;
}

function unsubscribeRealtimeMessages() {
  if (realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
}

document.getElementById('btnBackToList').addEventListener('click', () => {
  document.getElementById('threadView').classList.remove('show');
  CURRENT_CONVERSATION_ID = null;
  unsubscribeRealtimeMessages();
  loadConversations();
});

async function sendMessage() {
  const input = document.getElementById('msgInput');
  const content = input.value.trim();
  if (!content || !CURRENT_CONVERSATION_ID) return;
  input.value = '';
  const row = { conversation_id: CURRENT_CONVERSATION_ID, content };
  if (PROFILE.type === 'parent') row.sender_parent_id = PROFILE.id; else row.sender_employee_id = PROFILE.id;
  const { error } = await supabase.from('social_messages').insert(row);
  if (error) { alert('Gửi tin nhắn thất bại: ' + error.message); return; }
  // Khong can tu tai lai nua — kenh Realtime da dang ky se tu dua tin
  // nhan vua gui nay ve NGAY (ke ca voi chinh nguoi gui, Supabase mac
  // dinh broadcast lai cho ca nguoi vua thao tac).
}
document.getElementById('btnSendMsg').addEventListener('click', sendMessage);
document.getElementById('msgInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

(async () => {
  try {
    PROFILE = await bootSocialShell();
    // MOI — an cac muc "Trang chu/Vi AIScoins/Tai khoan" (chi danh cho
    // phu huynh) khoi thanh dieu huong khi dang la phien NHAN VIEN.
    if (PROFILE.type === 'employee') {
      document.querySelectorAll('.nav-parent-only').forEach((el) => { el.style.display = 'none'; });
    }
    await loadTeacherShortcuts();
    await loadConversations();

    // MỚI — cho phép mở thẳng 1 hội thoại từ trang khác (VD nút "Nhắn
    // tin" ở trang xem hồ sơ người khác) qua URL, không cần tự tìm kiếm
    // lại trong danh sách.
    const params = new URLSearchParams(location.search);
    const withType = params.get('with_type');
    const withId = params.get('with_id');
    const withName = params.get('with_name');
    if (withType && withId) {
      await startConversationWith(withType, withId, withName || 'Người dùng');
    }
  } catch (e) {
    document.getElementById('convList').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
})();
