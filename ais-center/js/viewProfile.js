import { supabase, esc, bootSocialShell } from './parentSupabase.js';

let PROFILE = null;
let MY_PROFILE_ID = null;
let TARGET_PROFILE = null; // { id, display_name, avatar_url, parent_account_id, employee_id }

function initials(name) { return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase(); }

async function loadProfile(targetId) {
  const { data, error } = await supabase.from('social_profiles').select('id, display_name, avatar_url, parent_account_id, employee_id').eq('id', targetId).single();
  if (error || !data) { document.getElementById('heroName').textContent = 'Không tìm thấy hồ sơ này.'; return null; }
  return data;
}

function renderHero() {
  document.getElementById('heroAvatar').innerHTML = TARGET_PROFILE.avatar_url
    ? `<img src="${esc(TARGET_PROFILE.avatar_url)}" alt="" />`
    : esc(initials(TARGET_PROFILE.display_name));
  document.getElementById('heroName').textContent = TARGET_PROFILE.display_name;
}

async function renderActions() {
  const box = document.getElementById('heroActions');
  const otherType = TARGET_PROFILE.parent_account_id ? 'parent' : 'employee';
  const otherId = TARGET_PROFILE.parent_account_id || TARGET_PROFILE.employee_id;

  const { data: friendship } = await supabase
    .from('social_friendships')
    .select('id, status, requester_profile_id, addressee_profile_id')
    .or(`and(requester_profile_id.eq.${MY_PROFILE_ID},addressee_profile_id.eq.${TARGET_PROFILE.id}),and(requester_profile_id.eq.${TARGET_PROFILE.id},addressee_profile_id.eq.${MY_PROFILE_ID})`)
    .maybeSingle();

  let friendBtnHtml;
  if (!friendship) {
    friendBtnHtml = `<button class="btn-friend-primary" id="btnSendFriend">+ Kết bạn</button>`;
  } else if (friendship.status === 'accepted') {
    friendBtnHtml = `<button class="btn-friend-danger" id="btnUnfriend" data-fid="${friendship.id}">Huỷ kết bạn</button>`;
  } else if (friendship.requester_profile_id === MY_PROFILE_ID) {
    friendBtnHtml = `<button class="btn-friend-outline" disabled>Đã gửi lời mời</button>`;
  } else {
    friendBtnHtml = `<button class="btn-friend-primary" id="btnAcceptFriend" data-fid="${friendship.id}">Chấp nhận lời mời</button>`;
  }

  box.innerHTML = `
    ${friendBtnHtml}
    <button class="btn-friend-outline" id="btnMessage">💬 Nhắn tin</button>
    <div class="profile-more-menu">
      <button class="profile-more-btn" id="btnMoreMenu">⋯</button>
      <div class="profile-more-list" id="moreMenuList">
        <button id="btnReportProfile">🚩 Báo cáo hồ sơ này</button>
        <button id="btnBlockProfile">🚫 Chặn người này</button>
      </div>
    </div>
  `;

  document.getElementById('btnSendFriend')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Đang gửi...';
    const { error } = await supabase.rpc('send_friend_request', { p_addressee_profile_id: TARGET_PROFILE.id });
    if (error) { alert('Không gửi được lời mời: ' + error.message); e.target.disabled = false; e.target.textContent = '+ Kết bạn'; return; }
    await renderActions();
  });
  document.getElementById('btnAcceptFriend')?.addEventListener('click', async (e) => {
    await supabase.rpc('respond_friend_request', { p_friendship_id: e.target.dataset.fid, p_accept: true });
    await renderActions();
  });
  document.getElementById('btnUnfriend')?.addEventListener('click', async (e) => {
    if (!confirm(`Huỷ kết bạn với ${TARGET_PROFILE.display_name}?`)) return;
    const { error } = await supabase.from('social_friendships').delete().eq('id', e.target.dataset.fid);
    if (error) { alert('Không huỷ được: ' + error.message); return; }
    await renderActions();
  });
  document.getElementById('btnMessage').addEventListener('click', () => {
    const params = new URLSearchParams({ with_type: otherType, with_id: otherId, with_name: TARGET_PROFILE.display_name });
    window.location.href = `messages.html?${params.toString()}`;
  });
  document.getElementById('btnMoreMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('moreMenuList').classList.toggle('show');
  });
  document.getElementById('btnReportProfile').addEventListener('click', async () => {
    document.getElementById('moreMenuList').classList.remove('show');
    const reason = prompt(`Mô tả lý do báo cáo hồ sơ "${TARGET_PROFILE.display_name}":`);
    if (!reason || !reason.trim()) return;
    const { error } = await supabase.from('social_reports').insert({
      reporter_profile_id: MY_PROFILE_ID, target_type: 'profile', target_profile_id: TARGET_PROFILE.id, reason: reason.trim(),
    });
    if (error) { alert('Gửi báo cáo thất bại: ' + error.message); return; }
    alert('Đã gửi báo cáo tới bộ phận quản trị. Cảm ơn bạn!');
  });
  document.getElementById('btnBlockProfile').addEventListener('click', async () => {
    document.getElementById('moreMenuList').classList.remove('show');
    if (!confirm(`Chặn ${TARGET_PROFILE.display_name}? Bạn sẽ không còn thấy bài viết/bình luận của người này nữa, và họ cũng không thấy được của bạn.`)) return;
    const { error } = await supabase.from('social_blocks').insert({ blocker_profile_id: MY_PROFILE_ID, blocked_profile_id: TARGET_PROFILE.id });
    if (error) { alert('Không chặn được: ' + error.message); return; }
    alert(`Đã chặn ${TARGET_PROFILE.display_name}.`);
    window.location.href = 'community.html';
  });
}

document.addEventListener('click', () => { document.getElementById('moreMenuList')?.classList.remove('show'); });

async function loadTheirPosts() {
  const box = document.getElementById('theirPostsList');
  const filterCol = TARGET_PROFILE.parent_account_id ? 'author_parent_id' : 'author_employee_id';
  const otherId = TARGET_PROFILE.parent_account_id || TARGET_PROFILE.employee_id;
  const { data: posts, error } = await supabase
    .from('social_posts')
    .select('id, caption, image_url, created_at')
    .eq(filterCol, otherId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) { box.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  if (!posts || posts.length === 0) { box.innerHTML = '<div class="empty-state">Chưa có bài đăng nào.</div>'; return; }

  box.innerHTML = posts.map((p) => `
    <div class="post-mini">
      ${p.image_url ? `<img class="post-mini__img" src="${esc(p.image_url)}" alt="" />` : '<div class="post-mini__img"></div>'}
      <div style="flex:1; min-width:0;">
        <div class="post-mini__caption">${esc(p.caption || '(Không có chú thích)')}</div>
        <div class="post-mini__meta">${new Date(p.created_at).toLocaleDateString('vi-VN')}</div>
      </div>
    </div>
  `).join('');
}

(async () => {
  try {
    PROFILE = await bootSocialShell();
    const { data: myId } = await supabase.rpc('get_my_social_profile_id');
    MY_PROFILE_ID = myId;

    const targetId = new URLSearchParams(location.search).get('id');
    if (!targetId) { document.getElementById('heroName').textContent = 'Thiếu thông tin hồ sơ cần xem.'; return; }
    if (targetId === MY_PROFILE_ID) { window.location.href = 'social-profile.html'; return; }

    TARGET_PROFILE = await loadProfile(targetId);
    if (!TARGET_PROFILE) return;

    renderHero();
    await renderActions();
    await loadTheirPosts();
  } catch (e) {
    document.getElementById('heroName').textContent = e.message;
  }
})();
