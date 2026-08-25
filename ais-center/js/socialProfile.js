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
  const { error } = await supabase.rpc('send_friend_request', { p_addressee_profile_id: otherProfileId });
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

// ---------------------------------------------------------------------
// Bai dang cua toi — xem lai, sua nhanh, xoa
// ---------------------------------------------------------------------
async function loadMyPosts() {
  const box = document.getElementById('myPostsList');
  const filterCol = PROFILE.type === 'parent' ? 'author_parent_id' : 'author_employee_id';
  const { data: posts, error } = await supabase
    .from('social_posts')
    .select('id, caption, image_url, created_at')
    .eq(filterCol, PROFILE.id)
    .order('created_at', { ascending: false });

  if (error) { box.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  if (!posts || posts.length === 0) { box.innerHTML = '<div class="empty-state">Bạn chưa đăng bài nào — vào Cộng đồng để chia sẻ khoảnh khắc đầu tiên!</div>'; return; }

  box.innerHTML = posts.map((p) => `
    <div class="my-post-row" data-my-post="${p.id}">
      ${p.image_url ? `<img class="my-post-row__img" src="${esc(p.image_url)}" alt="" />` : '<div class="my-post-row__img"></div>'}
      <div style="flex:1; min-width:0;">
        <div class="my-post-row__caption">${esc(p.caption || '(Không có chú thích)')}</div>
        <div class="my-post-row__meta">${new Date(p.created_at).toLocaleDateString('vi-VN')}</div>
      </div>
      <div class="my-post-row__actions">
        <button data-edit-my-post="${p.id}" data-current-caption="${esc(p.caption || '')}">✏️ Sửa</button>
        <button class="danger" data-delete-my-post="${p.id}">🗑️ Xoá</button>
      </div>
    </div>
  `).join('');

  box.querySelectorAll('[data-edit-my-post]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newCaption = prompt('Sửa chú thích bài đăng:', btn.dataset.currentCaption);
      if (newCaption === null) return; // bam Huy
      const { error } = await supabase.from('social_posts').update({ caption: newCaption.trim() || null, updated_at: new Date().toISOString() }).eq('id', btn.dataset.editMyPost);
      if (error) { alert('Sửa thất bại: ' + error.message); return; }
      loadMyPosts();
    });
  });
  box.querySelectorAll('[data-delete-my-post]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Xoá bài đăng này? Không thể hoàn tác.')) return;
      const { error } = await supabase.from('social_posts').delete().eq('id', btn.dataset.deleteMyPost);
      if (error) { alert('Xoá thất bại: ' + error.message); return; }
      loadMyPosts();
    });
  });
}

async function renderFriendsTab() {
  const box = document.getElementById('friendsTabContent');
  box.innerHTML = '<div class="empty-state">Đang tải...</div>';

  if (activeTab === 'friends') {
    const { data } = await supabase
      .from('social_friendships')
      .select('id, requester_profile_id, addressee_profile_id, requester:requester_profile_id(id, display_name, avatar_url), addressee:addressee_profile_id(id, display_name, avatar_url)')
      .eq('status', 'accepted')
      .or(`requester_profile_id.eq.${MY_PROFILE_ID},addressee_profile_id.eq.${MY_PROFILE_ID}`);
    const friends = (data || []).map((f) => ({ ...(f.requester_profile_id === MY_PROFILE_ID ? f.addressee : f.requester), friendshipId: f.id }));
    box.innerHTML = friends.map((p) => `
      <div class="friend-row">
        <a href="view-profile.html?id=${p.id}" class="friend-row__avatar" style="text-decoration:none;">${avatarHtml(p.avatar_url, p.display_name)}</a>
        <a href="view-profile.html?id=${p.id}" class="friend-row__name" style="text-decoration:none; color:inherit;">${esc(p.display_name)}</a>
        <button class="btn-reject" data-unfriend="${p.friendshipId}" data-unfriend-name="${esc(p.display_name)}">Huỷ kết bạn</button>
      </div>
    `).join('') || '<div class="empty-state">Chưa có bạn bè nào — tìm kiếm ở trên để kết bạn.</div>';

    box.querySelectorAll('[data-unfriend]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Huỷ kết bạn với ${btn.dataset.unfriendName}?`)) return;
        const { error } = await supabase.from('social_friendships').delete().eq('id', btn.dataset.unfriend);
        if (error) { alert('Không huỷ được: ' + error.message); return; }
        renderFriendsTab();
      });
    });
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
        await supabase.rpc('respond_friend_request', { p_friendship_id: btn.dataset.accept, p_accept: true });
        renderFriendsTab();
        updateRequestBadge();
      });
    });
    box.querySelectorAll('[data-reject]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await supabase.rpc('respond_friend_request', { p_friendship_id: btn.dataset.reject, p_accept: false });
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
    // MOI — lay lai profileId qua RPC rieng (dam bao chac chan co gia
    // tri, khong phu thuoc vao ket qua tu bootSocialShell co the vi ly
    // do nao do chua kip co) — day chinh la nguyen nhan that khien
    // "kết bạn" khong hoat dong duoc truoc do.
    const { data: myId, error: myIdErr } = await supabase.rpc('get_my_social_profile_id');
    if (myIdErr || !myId) { alert('Không xác định được hồ sơ của bạn: ' + (myIdErr?.message || 'không rõ nguyên nhân')); return; }
    MY_PROFILE_ID = myId;
    document.getElementById('displayNameInput').value = PROFILE.displayName;
    renderAvatarPreview();
    await loadMyPosts();
    await renderFriendsTab();
    await updateRequestBadge();
    const { data: unreadCount } = await supabase.rpc('unread_social_notification_count');
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = (unreadCount > 0) ? 'block' : 'none';
  } catch (e) {
    alert(e.message);
  }
})();
