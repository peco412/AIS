import { supabase, esc, fmtDateTime, bootSocialShell } from './parentSupabase.js';

let PROFILE = null;
let MY_PROFILE_ID = null;
let PENDING_MEDIA = []; // { file, type: 'image'|'video', previewUrl }

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return fmtDateTime(dateStr);
}

// ---------------------------------------------------------------------
// Chuông thông báo — chấm đỏ báo số chưa đọc
// ---------------------------------------------------------------------
async function refreshNotifBadge() {
  const { data, error } = await supabase.rpc('unread_social_notification_count');
  const badge = document.getElementById('notifBadge');
  if (!error && badge) badge.style.display = (data > 0) ? 'block' : 'none';
}

// ---------------------------------------------------------------------
// Composer — đăng bài (chú thích + NHIỀU ảnh/video)
// ---------------------------------------------------------------------
const photoInput = document.getElementById('photoInput');
const composerText = document.getElementById('composerText');
const btnPost = document.getElementById('btnPost');
const previewGrid = document.getElementById('composerPreviewGrid');

function refreshPostButton() {
  btnPost.disabled = !composerText.value.trim() && PENDING_MEDIA.length === 0;
}
composerText.addEventListener('input', refreshPostButton);

function renderPreviewGrid() {
  previewGrid.style.display = PENDING_MEDIA.length > 0 ? 'grid' : 'none';
  previewGrid.innerHTML = PENDING_MEDIA.map((m, i) => `
    <div class="preview-item">
      ${m.type === 'video' ? `<video src="${m.previewUrl}" muted></video>` : `<img src="${m.previewUrl}" alt="" />`}
      <button type="button" data-remove-media="${i}">✕</button>
    </div>
  `).join('');
  previewGrid.querySelectorAll('[data-remove-media]').forEach((btn) => {
    btn.addEventListener('click', () => {
      PENDING_MEDIA.splice(Number(btn.dataset.removeMedia), 1);
      renderPreviewGrid();
      refreshPostButton();
    });
  });
}

// MỚI — cho phép chọn NHIỀU ảnh/video 1 lần (trước đây chỉ 1 ảnh duy
// nhất). Giới hạn 8 file/bài, đủ dùng và tránh tải lên quá nặng.
photoInput.addEventListener('change', () => {
  const files = [...photoInput.files].slice(0, 8 - PENDING_MEDIA.length);
  files.forEach((file) => {
    const type = file.type.startsWith('video') ? 'video' : 'image';
    PENDING_MEDIA.push({ file, type, previewUrl: URL.createObjectURL(file) });
  });
  photoInput.value = '';
  renderPreviewGrid();
  refreshPostButton();
});

btnPost.addEventListener('click', async () => {
  btnPost.disabled = true; btnPost.textContent = 'Đang đăng...';
  try {
    const mediaUrls = [];
    for (const m of PENDING_MEDIA) {
      const ext = m.file.name.split('.').pop() || (m.type === 'video' ? 'mp4' : 'jpg');
      const path = `${PROFILE.defaultCenterId || 'chung'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('social-media').upload(path, m.file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('social-media').getPublicUrl(path);
      mediaUrls.push({ url: urlData.publicUrl, type: m.type });
    }
    const row = {
      center_id: PROFILE.defaultCenterId,
      caption: composerText.value.trim() || null,
      image_url: mediaUrls[0]?.url || null, // ảnh đầu tiên giữ ở cột cũ để tương thích ngược
    };
    if (PROFILE.type === 'parent') row.author_parent_id = PROFILE.id;
    else row.author_employee_id = PROFILE.id;

    const { data: inserted, error } = await supabase.from('social_posts').insert(row).select('id').single();
    if (error) throw error;

    // MỚI — lưu TOÀN BỘ ảnh/video (kể cả ảnh đầu) vào social_post_media
    // để hiện dạng lưới nhiều ảnh — image_url ở trên chỉ để tương thích
    // ngược với chỗ nào còn đọc trực tiếp cột cũ.
    if (mediaUrls.length > 0) {
      const mediaRows = mediaUrls.map((m, i) => ({ post_id: inserted.id, media_url: m.url, media_type: m.type, sort_order: i }));
      await supabase.from('social_post_media').insert(mediaRows);
    }

    composerText.value = '';
    PENDING_MEDIA = [];
    photoInput.value = '';
    renderPreviewGrid();
    await loadFeed();
  } catch (err) {
    alert('Đăng bài thất bại: ' + err.message);
  } finally {
    btnPost.textContent = 'Đăng';
    refreshPostButton();
  }
});

// ---------------------------------------------------------------------
// Tìm kiếm bài viết theo nội dung
// ---------------------------------------------------------------------
let searchDebounce = null;
let activeSearchQuery = '';
document.getElementById('postSearchInput').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { activeSearchQuery = e.target.value.trim(); loadFeed(); }, 300);
});

// ---------------------------------------------------------------------
// Bảng tin
// ---------------------------------------------------------------------
async function fetchProfilesMap(parentIds, employeeIds) {
  const map = new Map();
  if (parentIds.length === 0 && employeeIds.length === 0) return map;
  const { data, error } = await supabase.rpc('get_social_profiles_batch', { p_parent_ids: parentIds, p_employee_ids: employeeIds });
  if (error) { console.warn('Không lấy được hồ sơ hiển thị:', error.message); return map; }
  (data || []).forEach((r) => {
    const key = `${r.owner_type}:${r.owner_id}`;
    map.set(key, { name: r.display_name, avatar: r.avatar_url, profileId: r.profile_id });
  });
  return map;
}
function profileFor(map, parentId, employeeId) {
  const key = parentId ? `parent:${parentId}` : `employee:${employeeId}`;
  return map.get(key) || { name: parentId ? 'Phụ huynh' : 'Nhân viên', avatar: null, profileId: null };
}

function mediaGridHtml(mediaList) {
  if (!mediaList || mediaList.length === 0) return '';
  const n = Math.min(mediaList.length, 4);
  return `
    <div class="post-card__media-grid count-${n}">
      ${mediaList.slice(0, 4).map((m) => m.media_type === 'video'
        ? `<video src="${esc(m.media_url)}" controls></video>`
        : `<img src="${esc(m.media_url)}" alt="Ảnh bài đăng" loading="lazy" />`
      ).join('')}
    </div>
  `;
}

async function loadFeed() {
  const feedList = document.getElementById('feedList');

  if (!MY_PROFILE_ID) {
    const { data: myId } = await supabase.rpc('get_my_social_profile_id');
    MY_PROFILE_ID = myId;
  }

  let query = supabase
    .from('social_posts')
    .select(`
      id, caption, image_url, created_at, shared_post_id,
      author_parent_id, author_employee_id,
      centers:center_id(name)
    `)
    .order('created_at', { ascending: false })
    .limit(50);
  if (activeSearchQuery) query = query.ilike('caption', `%${activeSearchQuery}%`);
  const { data: posts, error } = await query;

  if (error) { feedList.innerHTML = `<div class="empty-state">Không tải được bảng tin: ${esc(error.message)}</div>`; return; }
  if (!posts || posts.length === 0) { feedList.innerHTML = `<div class="empty-state">${activeSearchQuery ? 'Không tìm thấy bài viết phù hợp.' : 'Chưa có bài đăng nào — hãy là người đầu tiên chia sẻ!'}</div>`; return; }

  // MỚI — nạp ảnh/video (nhiều file/bài) + bài gốc (nếu là bài chia sẻ lại)
  const { data: mediaRows } = await supabase.from('social_post_media').select('post_id, media_url, media_type, sort_order').in('post_id', posts.map((p) => p.id)).order('sort_order');
  const mediaByPost = {};
  (mediaRows || []).forEach((m) => { (mediaByPost[m.post_id] = mediaByPost[m.post_id] || []).push(m); });

  const sharedIds = [...new Set(posts.filter((p) => p.shared_post_id).map((p) => p.shared_post_id))];
  let sharedPostsMap = {};
  if (sharedIds.length > 0) {
    const { data: sharedPosts } = await supabase.from('social_posts').select('id, caption, image_url, author_parent_id, author_employee_id').in('id', sharedIds);
    sharedPostsMap = Object.fromEntries((sharedPosts || []).map((sp) => [sp.id, sp]));
  }

  const profilesMap = await fetchProfilesMap(
    [...new Set(posts.filter((p) => p.author_parent_id).map((p) => p.author_parent_id))],
    [...new Set(posts.filter((p) => p.author_employee_id).map((p) => p.author_employee_id))]
  );
  const sharedProfilesMap = await fetchProfilesMap(
    [...new Set(Object.values(sharedPostsMap).filter((p) => p.author_parent_id).map((p) => p.author_parent_id))],
    [...new Set(Object.values(sharedPostsMap).filter((p) => p.author_employee_id).map((p) => p.author_employee_id))]
  );

  const authorProfileIds = [...new Set(posts.map((p) => profileFor(profilesMap, p.author_parent_id, p.author_employee_id).profileId).filter(Boolean))];
  const { data: friendStatuses } = authorProfileIds.length > 0
    ? await supabase.rpc('get_friendship_statuses', { p_profile_ids: authorProfileIds })
    : { data: [] };
  const friendStatusMap = new Map((friendStatuses || []).map((f) => [f.other_profile_id, f.status]));

  const { data: likeRows } = await supabase.from('social_post_likes').select('post_id, liker_parent_id, liker_employee_id').in('post_id', posts.map((p) => p.id));
  const likeCounts = {};
  const myLikes = new Set();
  (likeRows || []).forEach((l) => {
    likeCounts[l.post_id] = (likeCounts[l.post_id] || 0) + 1;
    const isMine = (PROFILE.type === 'parent' && l.liker_parent_id === PROFILE.id) || (PROFILE.type === 'employee' && l.liker_employee_id === PROFILE.id);
    if (isMine) myLikes.add(l.post_id);
  });

  feedList.innerHTML = posts.map((p) => {
    const authorProfile = profileFor(profilesMap, p.author_parent_id, p.author_employee_id);
    const authorName = authorProfile.name;
    const isStaffAuthor = !!p.author_employee_id;
    const liked = myLikes.has(p.id);
    const count = likeCounts[p.id] || 0;
    const isMyOwnPost = (PROFILE.type === 'parent' && p.author_parent_id === PROFILE.id) || (PROFILE.type === 'employee' && p.author_employee_id === PROFILE.id);
    const isFriendBtnTarget = authorProfile.profileId && authorProfile.profileId !== MY_PROFILE_ID;
    const friendStatus = authorProfile.profileId ? friendStatusMap.get(authorProfile.profileId) : null;
    let friendBtnHtml = '';
    if (isFriendBtnTarget) {
      if (friendStatus === 'accepted') friendBtnHtml = '<span class="post-card__friendbtn is-friend">✓ Bạn bè</span>';
      else if (friendStatus === 'pending') friendBtnHtml = '<span class="post-card__friendbtn is-pending">Đã gửi lời mời</span>';
      else friendBtnHtml = `<button class="post-card__friendbtn" data-quick-friend="${authorProfile.profileId}">+ Kết bạn</button>`;
    }

    // MỚI — khung lồng bài gốc, nếu đây là bài chia sẻ lại
    let sharedHtml = '';
    if (p.shared_post_id) {
      const sp = sharedPostsMap[p.shared_post_id];
      if (sp) {
        const spProfile = profileFor(sharedProfilesMap, sp.author_parent_id, sp.author_employee_id);
        sharedHtml = `
          <div class="shared-post-embed">
            <div class="shared-post-embed__head">
              <div class="shared-post-embed__avatar">${spProfile.avatar ? `<img src="${esc(spProfile.avatar)}" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" />` : esc(initials(spProfile.name))}</div>
              <div class="shared-post-embed__name">${esc(spProfile.name)}</div>
            </div>
            ${sp.caption ? `<div class="shared-post-embed__caption">${esc(sp.caption)}</div>` : ''}
            ${sp.image_url ? `<img class="post-card__img" src="${esc(sp.image_url)}" alt="" loading="lazy" />` : ''}
          </div>
        `;
      } else {
        sharedHtml = '<div class="shared-post-embed"><div class="shared-post-embed__deleted">Bài viết gốc đã bị xoá.</div></div>';
      }
    }

    // MỚI — menu "..." cho bài KHÔNG PHẢI của mình: Báo cáo/Chặn.
    const otherMenuHtml = !isMyOwnPost ? `
      <div class="post-card__ownmenu">
        <button class="post-card__ownmenu-btn" data-toggle-ownmenu="${p.id}">⋯</button>
        <div class="post-card__ownmenu-list" id="ownmenu-${p.id}" style="display:none;">
          <button data-report-post="${p.id}">🚩 Báo cáo bài viết</button>
          ${authorProfile.profileId ? `<button data-block-user="${authorProfile.profileId}" data-block-name="${esc(authorName)}">🚫 Chặn ${esc(authorName)}</button>` : ''}
        </div>
      </div>
    ` : '';

    return `
      <div class="post-card" data-post="${p.id}">
        <div class="post-card__head">
          <a href="${authorProfile.profileId ? `view-profile.html?id=${authorProfile.profileId}` : '#'}" class="post-card__avatar" style="text-decoration:none;">${authorProfile.avatar ? `<img src="${esc(authorProfile.avatar)}" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" />` : esc(initials(authorName))}</a>
          <div style="flex:1;">
            <a href="${authorProfile.profileId ? `view-profile.html?id=${authorProfile.profileId}` : '#'}" class="post-card__name" style="text-decoration:none; display:block;">${esc(authorName)}${isStaffAuthor ? '<span class="post-card__badge">Nhân viên</span>' : ''}</a>
            <div class="post-card__meta">${timeAgo(p.created_at)}${p.centers?.name ? ` · 📍 ${esc(p.centers.name)}` : ''}</div>
          </div>
          ${friendBtnHtml}
          ${isMyOwnPost ? `
            <div class="post-card__ownmenu">
              <button class="post-card__ownmenu-btn" data-toggle-ownmenu="${p.id}">⋯</button>
              <div class="post-card__ownmenu-list" id="ownmenu-${p.id}" style="display:none;">
                <button data-edit-post="${p.id}">✏️ Sửa</button>
                <button data-delete-post="${p.id}">🗑️ Xoá</button>
              </div>
            </div>
          ` : otherMenuHtml}
        </div>
        <div class="post-card__caption-view" id="caption-view-${p.id}">
          ${p.caption ? `<div class="post-card__caption">${esc(p.caption)}</div>` : ''}
          ${mediaGridHtml(mediaByPost[p.id]) || (p.image_url ? `<img class="post-card__img" src="${esc(p.image_url)}" alt="Ảnh bài đăng" loading="lazy" />` : '')}
          ${sharedHtml}
        </div>
        <div class="post-card__caption-edit" id="caption-edit-${p.id}" style="display:none; padding:0 16px 12px;">
          <textarea class="post-edit-textarea" id="edit-textarea-${p.id}" rows="2">${esc(p.caption || '')}</textarea>
          <div style="display:flex; gap:8px; margin-top:6px; justify-content:flex-end;">
            <button class="btn-cancel-edit" data-cancel-edit="${p.id}">Huỷ</button>
            <button class="btn-save-edit" data-save-edit="${p.id}">Lưu</button>
          </div>
        </div>
        <div class="post-card__actions">
          <button class="post-card__actionbtn ${liked ? 'is-liked' : ''}" data-like="${p.id}">
            <svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
            <span data-like-count>${count}</span>
          </button>
          <button class="post-card__actionbtn" data-toggle-comments="${p.id}">
            <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 20l1-5.5a8.5 8.5 0 1 1 17-3z"/></svg>
            <span>Bình luận</span>
          </button>
          <button class="post-card__actionbtn" data-share-post="${p.id}">
            <svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>
            <span>Chia sẻ</span>
          </button>
        </div>
        <div class="comments-box" id="comments-${p.id}">
          <div class="comments-list" id="comments-list-${p.id}"></div>
          <div class="comment-input-row">
            <input type="text" placeholder="Viết bình luận..." data-comment-input="${p.id}" />
            <button data-comment-submit="${p.id}">Gửi</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  feedList.querySelectorAll('[data-like]').forEach((btn) => btn.addEventListener('click', () => toggleLike(btn)));
  feedList.querySelectorAll('[data-quick-friend]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Đang gửi...';
      const { error } = await supabase.rpc('send_friend_request', { p_addressee_profile_id: btn.dataset.quickFriend });
      if (error) { alert('Không gửi được lời mời: ' + error.message); btn.disabled = false; btn.textContent = '+ Kết bạn'; return; }
      btn.outerHTML = '<span class="post-card__friendbtn is-pending">Đã gửi lời mời</span>';
    });
  });
  feedList.querySelectorAll('[data-toggle-comments]').forEach((btn) => btn.addEventListener('click', () => toggleComments(btn.dataset.toggleComments)));
  feedList.querySelectorAll('[data-share-post]').forEach((btn) => btn.addEventListener('click', () => shareToFeed(btn.dataset.sharePost)));
  feedList.querySelectorAll('[data-toggle-ownmenu]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById(`ownmenu-${btn.dataset.toggleOwnmenu}`);
      const isOpen = menu.style.display === 'block';
      document.querySelectorAll('.post-card__ownmenu-list').forEach((m) => { m.style.display = 'none'; });
      menu.style.display = isOpen ? 'none' : 'block';
    });
  });
  feedList.querySelectorAll('[data-edit-post]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.editPost;
      document.getElementById(`ownmenu-${id}`).style.display = 'none';
      document.getElementById(`caption-view-${id}`).style.display = 'none';
      document.getElementById(`caption-edit-${id}`).style.display = 'block';
    });
  });
  feedList.querySelectorAll('[data-cancel-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cancelEdit;
      document.getElementById(`caption-edit-${id}`).style.display = 'none';
      document.getElementById(`caption-view-${id}`).style.display = 'block';
    });
  });
  feedList.querySelectorAll('[data-save-edit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.saveEdit;
      const newCaption = document.getElementById(`edit-textarea-${id}`).value.trim();
      btn.disabled = true; btn.textContent = 'Đang lưu...';
      const { error } = await supabase.from('social_posts').update({ caption: newCaption || null, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) { alert('Sửa bài thất bại: ' + error.message); btn.disabled = false; btn.textContent = 'Lưu'; return; }
      await loadFeed();
    });
  });
  feedList.querySelectorAll('[data-delete-post]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Xoá bài đăng này? Không thể hoàn tác.')) return;
      const id = btn.dataset.deletePost;
      const { error } = await supabase.from('social_posts').delete().eq('id', id);
      if (error) { alert('Xoá bài thất bại: ' + error.message); return; }
      await loadFeed();
    });
  });
  feedList.querySelectorAll('[data-report-post]').forEach((btn) => {
    btn.addEventListener('click', () => reportPost(btn.dataset.reportPost));
  });
  feedList.querySelectorAll('[data-block-user]').forEach((btn) => {
    btn.addEventListener('click', () => blockUser(btn.dataset.blockUser, btn.dataset.blockName));
  });
  feedList.querySelectorAll('[data-comment-submit]').forEach((btn) => btn.addEventListener('click', () => submitComment(btn.dataset.commentSubmit)));
  feedList.querySelectorAll('[data-comment-input]').forEach((input) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitComment(input.dataset.commentInput); });
  });
}

// ---------------------------------------------------------------------
// MỚI — Chia sẻ lại bài viết
// ---------------------------------------------------------------------
async function shareToFeed(postId) {
  const caption = prompt('Viết vài dòng cho bài chia sẻ (có thể để trống):', '');
  if (caption === null) return; // bấm Huỷ
  const row = { center_id: PROFILE.defaultCenterId, caption: caption.trim() || null, shared_post_id: postId };
  if (PROFILE.type === 'parent') row.author_parent_id = PROFILE.id; else row.author_employee_id = PROFILE.id;
  const { error } = await supabase.from('social_posts').insert(row);
  if (error) { alert('Chia sẻ thất bại: ' + error.message); return; }
  alert('Đã chia sẻ lên bảng tin của bạn.');
  await loadFeed();
}

// ---------------------------------------------------------------------
// MỚI — Báo cáo vi phạm / Chặn người dùng
// ---------------------------------------------------------------------
async function reportPost(postId) {
  document.querySelectorAll('.post-card__ownmenu-list').forEach((m) => { m.style.display = 'none'; });
  const reason = prompt('Mô tả lý do báo cáo bài viết này (spam, nội dung không phù hợp...):');
  if (!reason || !reason.trim()) return;
  const { error } = await supabase.from('social_reports').insert({
    reporter_profile_id: MY_PROFILE_ID, target_type: 'post', target_post_id: postId, reason: reason.trim(),
  });
  if (error) { alert('Gửi báo cáo thất bại: ' + error.message); return; }
  alert('Đã gửi báo cáo tới bộ phận quản trị. Cảm ơn bạn!');
}

async function blockUser(otherProfileId, otherName) {
  document.querySelectorAll('.post-card__ownmenu-list').forEach((m) => { m.style.display = 'none'; });
  if (!confirm(`Chặn ${otherName}? Bạn sẽ không còn thấy bài viết/bình luận của người này nữa, và họ cũng không thấy được của bạn.`)) return;
  const { error } = await supabase.from('social_blocks').insert({ blocker_profile_id: MY_PROFILE_ID, blocked_profile_id: otherProfileId });
  if (error) { alert('Không chặn được: ' + error.message); return; }
  alert(`Đã chặn ${otherName}.`);
  await loadFeed();
}

// ---------------------------------------------------------------------
// Bình luận — MỚI: hỗ trợ trả lời lồng nhau (reply)
// ---------------------------------------------------------------------
const loadedComments = new Set();
async function toggleComments(postId) {
  const box = document.getElementById(`comments-${postId}`);
  box.classList.toggle('show');
  if (box.classList.contains('show') && !loadedComments.has(postId)) {
    loadedComments.add(postId);
    await renderComments(postId);
  }
}

async function renderComments(postId) {
  const listEl = document.getElementById(`comments-list-${postId}`);
  const { data: comments, error } = await supabase
    .from('social_comments')
    .select('id, content, created_at, author_parent_id, author_employee_id, parent_comment_id')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) { listEl.innerHTML = `<div class="empty-state" style="padding:8px;">${esc(error.message)}</div>`; return; }

  const profilesMap = await fetchProfilesMap(
    [...new Set((comments || []).filter((c) => c.author_parent_id).map((c) => c.author_parent_id))],
    [...new Set((comments || []).filter((c) => c.author_employee_id).map((c) => c.author_employee_id))]
  );

  // MỚI — sắp bình luận gốc trước, mỗi bình luận gốc kèm theo danh sách
  // trả lời (parent_comment_id) NGAY SAU nó — hiện lồng thụt lề 1 cấp,
  // đủ dùng cho hầu hết nhu cầu, không làm phức tạp giao diện quá mức
  // như Facebook (nhiều cấp lồng nhau).
  const roots = (comments || []).filter((c) => !c.parent_comment_id);
  const repliesByParent = {};
  (comments || []).filter((c) => c.parent_comment_id).forEach((c) => { (repliesByParent[c.parent_comment_id] = repliesByParent[c.parent_comment_id] || []).push(c); });

  function renderOne(c, isReply) {
    const profile = profileFor(profilesMap, c.author_parent_id, c.author_employee_id);
    return `
      <div class="comment-row ${isReply ? 'is-reply' : ''}" data-comment="${c.id}">
        <div class="comment-row__avatar">${profile.avatar ? `<img src="${esc(profile.avatar)}" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" />` : esc(initials(profile.name))}</div>
        <div>
          <div class="comment-row__bubble"><div class="comment-row__name">${esc(profile.name)}</div>${esc(c.content)}</div>
          <div class="comment-row__actions"><button data-reply-to="${c.id}">Trả lời</button></div>
        </div>
      </div>
      <div class="reply-input-row" id="reply-input-${c.id}" style="display:none;">
        <input type="text" placeholder="Viết trả lời..." data-reply-input="${c.id}" />
        <button data-reply-submit="${c.id}" data-reply-post="${postId}">Gửi</button>
      </div>
    `;
  }

  listEl.innerHTML = roots.map((c) => renderOne(c, false) + (repliesByParent[c.id] || []).map((r) => renderOne(r, true)).join('')).join('')
    || '<div style="font-size:12px; color:var(--muted); padding:4px 0;">Chưa có bình luận nào.</div>';

  listEl.querySelectorAll('[data-reply-to]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const box = document.getElementById(`reply-input-${btn.dataset.replyTo}`);
      box.style.display = box.style.display === 'none' ? 'flex' : 'none';
      if (box.style.display === 'flex') box.querySelector('input').focus();
    });
  });
  listEl.querySelectorAll('[data-reply-submit]').forEach((btn) => {
    btn.addEventListener('click', () => submitComment(btn.dataset.replyPost, btn.dataset.replySubmit));
  });
  listEl.querySelectorAll('[data-reply-input]').forEach((input) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitComment(postId, input.dataset.replyInput); });
  });
}

async function submitComment(postId, parentCommentId) {
  const input = parentCommentId
    ? document.querySelector(`[data-reply-input="${parentCommentId}"]`)
    : document.querySelector(`[data-comment-input="${postId}"]`);
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  const row = { post_id: postId, content };
  if (parentCommentId) row.parent_comment_id = parentCommentId;
  if (PROFILE.type === 'parent') row.author_parent_id = PROFILE.id; else row.author_employee_id = PROFILE.id;
  const { error } = await supabase.from('social_comments').insert(row);
  if (error) { alert('Gửi bình luận thất bại: ' + error.message); return; }
  await renderComments(postId);
}

async function toggleLike(btn) {
  const postId = btn.dataset.like;
  const isLiked = btn.classList.contains('is-liked');
  const countEl = btn.querySelector('[data-like-count]');
  btn.disabled = true;
  try {
    if (isLiked) {
      const filterCol = PROFILE.type === 'parent' ? 'liker_parent_id' : 'liker_employee_id';
      await supabase.from('social_post_likes').delete().eq('post_id', postId).eq(filterCol, PROFILE.id);
      btn.classList.remove('is-liked');
      countEl.textContent = Math.max(0, Number(countEl.textContent) - 1);
    } else {
      const row = { post_id: postId };
      if (PROFILE.type === 'parent') row.liker_parent_id = PROFILE.id; else row.liker_employee_id = PROFILE.id;
      await supabase.from('social_post_likes').insert(row);
      btn.classList.add('is-liked');
      countEl.textContent = Number(countEl.textContent) + 1;
    }
  } catch (err) {
    console.error('Lỗi thích bài viết:', err.message);
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('click', () => {
  document.querySelectorAll('.post-card__ownmenu-list').forEach((m) => { m.style.display = 'none'; });
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

(async () => {
  try {
    PROFILE = await bootSocialShell();
    if (PROFILE.type === 'employee') {
      document.querySelectorAll('.nav-parent-only').forEach((el) => { el.style.display = 'none'; });
    }
    await loadFeed();
    await refreshNotifBadge();
  } catch (e) {
    document.getElementById('feedList').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
})();
