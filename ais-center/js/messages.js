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
// Danh sach hoi thoai
// ---------------------------------------------------------------------
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
    .select('conversation_id, participant_parent_id, participant_employee_id, parent_accounts:participant_parent_id(full_name), employees:participant_employee_id(full_name)')
    .in('conversation_id', convIds);

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
    const otherName = others.map((o) => o.parent_accounts?.full_name || o.employees?.full_name).filter(Boolean).join(', ') || 'Cuộc trò chuyện';
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
  if (!PROFILE.defaultCenterId) return;
  const [{ data: parents }, { data: employees }] = await Promise.all([
    supabase.from('parent_accounts').select('id, full_name, parent_student_links(students(center_id))').ilike('full_name', `%${q}%`).limit(8),
    supabase.from('employees').select('id, full_name, center_id').ilike('full_name', `%${q}%`).limit(8),
  ]);

  const parentResults = (parents || [])
    .filter((p) => p.parent_student_links?.some((l) => l.students?.center_id === PROFILE.defaultCenterId))
    .filter((p) => !(PROFILE.type === 'parent' && p.id === PROFILE.id))
    .map((p) => ({ type: 'parent', id: p.id, name: p.full_name }));
  const employeeResults = (employees || [])
    .filter((e) => !(PROFILE.type === 'employee' && e.id === PROFILE.id))
    .map((e) => ({ type: 'employee', id: e.id, name: e.full_name }));

  const results = [...parentResults, ...employeeResults];
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

  // Tim hoi thoai 1-1 DA CO san giua 2 nguoi nay truoc, tranh tao trung lap.
  const myFilterCol = PROFILE.type === 'parent' ? 'participant_parent_id' : 'participant_employee_id';
  const otherFilterCol = otherType === 'parent' ? 'participant_parent_id' : 'participant_employee_id';

  const { data: myConvs } = await supabase.from('social_conversation_participants').select('conversation_id').eq(myFilterCol, PROFILE.id);
  const myConvIds = (myConvs || []).map((c) => c.conversation_id);
  let existingConvId = null;
  if (myConvIds.length > 0) {
    const { data: match } = await supabase.from('social_conversation_participants').select('conversation_id').eq(otherFilterCol, otherId).in('conversation_id', myConvIds).maybeSingle();
    existingConvId = match?.conversation_id || null;
  }

  if (existingConvId) { openThread(existingConvId, otherName); return; }

  const { data: newConv, error: convErr } = await supabase.from('social_conversations').insert({}).select('id').single();
  if (convErr) { alert('Không tạo được cuộc trò chuyện: ' + convErr.message); return; }

  const myRow = PROFILE.type === 'parent' ? { conversation_id: newConv.id, participant_parent_id: PROFILE.id } : { conversation_id: newConv.id, participant_employee_id: PROFILE.id };
  const otherRow = otherType === 'parent' ? { conversation_id: newConv.id, participant_parent_id: otherId } : { conversation_id: newConv.id, participant_employee_id: otherId };
  await supabase.from('social_conversation_participants').insert([myRow, otherRow]);

  openThread(newConv.id, otherName);
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
    await loadConversations();
  } catch (e) {
    document.getElementById('convList').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
})();
