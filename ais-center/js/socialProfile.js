import { supabase, esc, bootSocialShell } from './parentSupabase.js';

let PROFILE = null;
let MY_PROFILE_ID = null;

function initials(name) { return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase(); }
function avatarHtml(url, name) {
  return url ? `<img src="${esc(url)}" alt="" />` : esc(initials(name));
}

// ---------------------------------------------------------------------
// Sua ho so — ten hien thi + avatar
// ---------------------------------------------------------------------
function renderAvatarPreview() {
  document.getElementById('avatarPreview').innerHTML = avatarHtml(PROFILE.avatarUrl, PROFILE.displayName);
}

document.getElementById('avatarInput').addEventListener('change', async () => {
  const file = document.getElementById('avatarInput').files[0];
  if (!file) return;
  const msg = document.getElementById('saveMsg');
  msg.textContent = 'Đang tải ảnh lên...'; msg.style.color = 'var(--muted)';
  try {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `avatars/${MY_PROFILE_ID}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('social-media').upload(path, file, { upsert: true });
    if (upErr) throw upErr;
    const { data: urlData } = supabase.storage.from('social-media').getPublicUrl(path);
    const { error } = await supabase.from('social_profiles').update({ avatar_url: urlData.publicUrl }).eq('id', MY_PROFILE_ID);
    if (error) throw error;
    PROFILE.avatarUrl = urlData.publicUrl;
    renderAvatarPreview();
    msg.textContent = '✓ Đã cập nhật ảnh đại diện.'; msg.style.color = 'var(--success, green)';
  } catch (err) {
    msg.textContent = 'Lỗi: ' + err.message; msg.style.color = 'var(--danger, red)';
  }
});

document.getElementById('btnSaveProfile').addEventListener('click', async () => {
  const name = document.getElementById('displayNameInput').value.trim();
  const msg = document.getElementById('saveMsg');
  if (!name) { msg.textContent = 'Vui lòng nhập tên hiển thị.'; msg.style.color = 'var(--danger, red)'; return; }
  const { error } = await supabase.from('social_profiles').update({ display_name: name }).eq('id', MY_PROFILE_ID);
  if (error) { msg.textContent = 'Lỗi: ' + error.message; msg.style.color = 'var(--danger, red)'; return; }
  msg.textContent = '✓ Đã lưu.'; msg.style.color = 'var(--success, green)';
});

// ---------------------------------------------------------------------
// Tim va ket ban
// ---------------------------------------------------------------------
let searchDebounce = null;
document.getElementById('friendSearchInput').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  const box = document.getElementById('friendSearchResults');
  if (q.length < 2) { box.innerHTML = ''; return; }
  searchDebounce = setTimeout(() => searchPeople(q), 250);
});

async function searchPeople(q) {
  const box = document.getElementById('friendSearchResults');
  const { data } = await supabase.from('social_profiles').select('id, display_name, avatar_url').ilike('display_name', `%${q}%`).neq('id', MY_PROFILE_ID).limit(10);
  const { data: existing } = await supabase.from('social_friendships').select('requester_profile_id, addressee_profile_id, status').or(`requester_profile_id.eq.${MY_PROFILE_ID},addressee_profile_id.eq.${MY_PROFILE_ID}`);
  const statusMap = new Map();
  (existing || []).forEach((f) => {
    const otherId = f.requester_profile_id === MY_PROFILE_ID ? f.addressee_profile_id : f.requester_profile_id;
    statusMap.set(otherId, f.status);
  });

  box.innerHTML = (data || []).map((p) => {
    const status = statusMap.get(p.id);
    let btnHtml;
    if (status === 'accepted') btnHtml = '<button class="btn-pending" disabled>✓ Bạn bè</button>';
    else if (status === 'pending') btnHtml = '<button class="btn-pending" disabled>Đã gửi lời mời</button>';
    else btnHtml = `<button class="btn-add-friend" data-add-friend="${p.id}">+ Kết bạn</button>`;
    return `
      <div class="friend-row">
        <div class="friend-row__avatar">${avatarHtml(p.avatar_url, p.display_name)}</div>
        <div class="friend-row__name">${esc(p.display_name)}</div>
        ${btnHtml}
      </div>
    `;
  }).join('') || '<div class="empty-state">Không tìm thấy ai phù hợp.</div>';

  box.querySelectorAll('[data-add-friend]').forEach((btn) => {
    btn.addEventListener('click', () => sendFriendRequest(btn.dataset.addFriend, btn));
  });
}

async function sendFriendRequest(otherProfileId, btn) {
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  const { error } = await supabase.from('social_friendships').insert({ requester_profile_id: MY_PROFILE_ID, addressee_profile_id: otherProfileId });
  if (error) { alert('Không gửi được lời mời: ' + error.message); btn.disabled = false; btn.textContent = '+ Kết bạn'; return; }
  btn.className = 'btn-pending'; btn.textContent = 'Đã gửi lời mời';
}

// ---------------------------------------------------------------------
// Tab Ban be / Loi moi
// ---------------------------------------------------------------------
let activeTab = 'friends';
document.querySelectorAll('.friend-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.friend-tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    renderFriendsTab();
  });
});

async function renderFriendsTab() {
  const box = document.getElementById('friendsTabContent');
  box.innerHTML = '<div class="empty-state">Đang tải...</div>';

  if (activeTab === 'friends') {
    const { data } = await supabase
      .from('social_friendships')
      .select('id, requester_profile_id, addressee_profile_id, requester:requester_profile_id(id, display_name, avatar_url), addressee:addressee_profile_id(id, display_name, avatar_url)')
      .eq('status', 'accepted')
      .or(`requester_profile_id.eq.${MY_PROFILE_ID},addressee_profile_id.eq.${MY_PROFILE_ID}`);
    const friends = (data || []).map((f) => f.requester_profile_id === MY_PROFILE_ID ? f.addressee : f.requester);
    box.innerHTML = friends.map((p) => `
      <div class="friend-row">
        <div class="friend-row__avatar">${avatarHtml(p.avatar_url, p.display_name)}</div>
        <div class="friend-row__name">${esc(p.display_name)}</div>
      </div>
    `).join('') || '<div class="empty-state">Chưa có bạn bè nào — tìm kiếm ở trên để kết bạn.</div>';
  } else {
    const { data } = await supabase
      .from('social_friendships')
      .select('id, requester:requester_profile_id(id, display_name, avatar_url)')
      .eq('status', 'pending')
      .eq('addressee_profile_id', MY_PROFILE_ID);
    box.innerHTML = (data || []).map((f) => `
      <div class="friend-row">
        <div class="friend-row__avatar">${avatarHtml(f.requester.avatar_url, f.requester.display_name)}</div>
        <div class="friend-row__name">${esc(f.requester.display_name)}</div>
        <button class="btn-accept" data-accept="${f.id}">Chấp nhận</button>
        <button class="btn-reject" data-reject="${f.id}">Từ chối</button>
      </div>
    `).join('') || '<div class="empty-state">Không có lời mời kết bạn nào.</div>';

    box.querySelectorAll('[data-accept]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await supabase.from('social_friendships').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', btn.dataset.accept);
        renderFriendsTab();
        updateRequestBadge();
      });
    });
    box.querySelectorAll('[data-reject]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await supabase.from('social_friendships').delete().eq('id', btn.dataset.reject);
        renderFriendsTab();
        updateRequestBadge();
      });
    });
  }
}

async function updateRequestBadge() {
  const { count } = await supabase.from('social_friendships').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('addressee_profile_id', MY_PROFILE_ID);
  document.getElementById('requestBadge').textContent = count > 0 ? `(${count})` : '';
}

(async () => {
  try {
    PROFILE = await bootSocialShell();
    MY_PROFILE_ID = PROFILE.profileId;
    document.getElementById('displayNameInput').value = PROFILE.displayName;
    renderAvatarPreview();
    await renderFriendsTab();
    await updateRequestBadge();
  } catch (e) {
    alert(e.message);
  }
})();
