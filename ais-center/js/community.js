import { supabase, esc, fmtDateTime, bootSocialShell } from './parentSupabase.js';

let PROFILE = null;
let PENDING_PHOTO = null;

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
// Composer — dang bai (chu thich + anh)
// ---------------------------------------------------------------------
const photoInput = document.getElementById('photoInput');
const composerText = document.getElementById('composerText');
const btnPost = document.getElementById('btnPost');

function refreshPostButton() {
  btnPost.disabled = !composerText.value.trim() && !PENDING_PHOTO;
}
composerText.addEventListener('input', refreshPostButton);

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  PENDING_PHOTO = file;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('composerPreviewImg').src = reader.result;
    document.getElementById('composerPreview').style.display = 'block';
  };
  reader.readAsDataURL(file);
  refreshPostButton();
});

document.getElementById('btnRemovePhoto').addEventListener('click', () => {
  PENDING_PHOTO = null;
  photoInput.value = '';
  document.getElementById('composerPreview').style.display = 'none';
  refreshPostButton();
});

btnPost.addEventListener('click', async () => {
  btnPost.disabled = true; btnPost.textContent = 'Đang đăng...';
  try {
    let imageUrl = null;
    if (PENDING_PHOTO) {
      const ext = PENDING_PHOTO.name.split('.').pop() || 'jpg';
      const path = `${PROFILE.defaultCenterId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('social-media').upload(path, PENDING_PHOTO);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('social-media').getPublicUrl(path);
      imageUrl = urlData.publicUrl;
    }
    const row = {
      center_id: PROFILE.defaultCenterId,
      caption: composerText.value.trim() || null,
      image_url: imageUrl,
    };
    if (PROFILE.type === 'parent') row.author_parent_id = PROFILE.id;
    else row.author_employee_id = PROFILE.id;

    const { error } = await supabase.from('social_posts').insert(row);
    if (error) throw error;

    composerText.value = '';
    PENDING_PHOTO = null;
    photoInput.value = '';
    document.getElementById('composerPreview').style.display = 'none';
    await loadFeed();
  } catch (err) {
    alert('Đăng bài thất bại: ' + err.message);
  } finally {
    btnPost.textContent = 'Đăng';
    refreshPostButton();
  }
});

// ---------------------------------------------------------------------
// Bang tin
// ---------------------------------------------------------------------
async function loadFeed() {
  const feedList = document.getElementById('feedList');
  const { data: posts, error } = await supabase
    .from('social_posts')
    .select(`
      id, caption, image_url, created_at,
      author_parent_id, author_employee_id,
      parent_accounts:author_parent_id(full_name),
      employees:author_employee_id(full_name)
    `)
    .eq('center_id', PROFILE.defaultCenterId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { feedList.innerHTML = `<div class="empty-state">Không tải được bảng tin: ${esc(error.message)}</div>`; return; }
  if (!posts || posts.length === 0) { feedList.innerHTML = '<div class="empty-state">Chưa có bài đăng nào — hãy là người đầu tiên chia sẻ!</div>'; return; }

  const { data: likeRows } = await supabase.from('social_post_likes').select('post_id, liker_parent_id, liker_employee_id').in('post_id', posts.map((p) => p.id));
  const likeCounts = {};
  const myLikes = new Set();
  (likeRows || []).forEach((l) => {
    likeCounts[l.post_id] = (likeCounts[l.post_id] || 0) + 1;
    const isMine = (PROFILE.type === 'parent' && l.liker_parent_id === PROFILE.id) || (PROFILE.type === 'employee' && l.liker_employee_id === PROFILE.id);
    if (isMine) myLikes.add(l.post_id);
  });

  feedList.innerHTML = posts.map((p) => {
    const authorName = p.parent_accounts?.full_name || p.employees?.full_name || 'Người dùng';
    const isStaffAuthor = !!p.author_employee_id;
    const liked = myLikes.has(p.id);
    const count = likeCounts[p.id] || 0;
    return `
      <div class="post-card" data-post="${p.id}">
        <div class="post-card__head">
          <div class="post-card__avatar">${esc(initials(authorName))}</div>
          <div>
            <div class="post-card__name">${esc(authorName)}${isStaffAuthor ? '<span class="post-card__badge">Nhân viên</span>' : ''}</div>
            <div class="post-card__meta">${timeAgo(p.created_at)}</div>
          </div>
        </div>
        ${p.caption ? `<div class="post-card__caption">${esc(p.caption)}</div>` : ''}
        ${p.image_url ? `<img class="post-card__img" src="${esc(p.image_url)}" alt="Ảnh bài đăng" loading="lazy" />` : ''}
        <div class="post-card__actions">
          <button class="post-card__actionbtn ${liked ? 'is-liked' : ''}" data-like="${p.id}">
            <svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
            <span data-like-count>${count}</span>
          </button>
          <button class="post-card__actionbtn" data-toggle-comments="${p.id}">
            <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 20l1-5.5a8.5 8.5 0 1 1 17-3z"/></svg>
            <span>Bình luận</span>
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

  feedList.querySelectorAll('[data-like]').forEach((btn) => {
    btn.addEventListener('click', () => toggleLike(btn));
  });
  feedList.querySelectorAll('[data-toggle-comments]').forEach((btn) => {
    btn.addEventListener('click', () => toggleComments(btn.dataset.toggleComments));
  });
  feedList.querySelectorAll('[data-comment-submit]').forEach((btn) => {
    btn.addEventListener('click', () => submitComment(btn.dataset.commentSubmit));
  });
  feedList.querySelectorAll('[data-comment-input]').forEach((input) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitComment(input.dataset.commentInput); });
  });
}

// MOI — binh luan: bam "Binh luan" se mo/dong khung, va TU TAI khi mo
// lan dau (khong tai san moi lan bam vao, tranh goi lai nhieu lan).
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
    .select('id, content, created_at, author_parent_id, author_employee_id, parent_accounts:author_parent_id(full_name), employees:author_employee_id(full_name)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) { listEl.innerHTML = `<div class="empty-state" style="padding:8px;">${esc(error.message)}</div>`; return; }
  listEl.innerHTML = (comments || []).map((c) => {
    const name = c.parent_accounts?.full_name || c.employees?.full_name || 'Người dùng';
    return `
      <div class="comment-row">
        <div class="comment-row__avatar">${esc(initials(name))}</div>
        <div class="comment-row__bubble"><div class="comment-row__name">${esc(name)}</div>${esc(c.content)}</div>
      </div>
    `;
  }).join('') || '<div style="font-size:12px; color:var(--muted); padding:4px 0;">Chưa có bình luận nào.</div>';
}

async function submitComment(postId) {
  const input = document.querySelector(`[data-comment-input="${postId}"]`);
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  const row = { post_id: postId, content };
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

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

(async () => {
  try {
    PROFILE = await bootSocialShell();
    if (!PROFILE.defaultCenterId) {
      document.getElementById('feedList').innerHTML = '<div class="empty-state">Tài khoản của bạn chưa gắn với 1 trung tâm cụ thể nên chưa xem được bảng tin cộng đồng.</div>';
      document.querySelector('.composer').style.display = 'none';
      return;
    }
    // MOI — neu xem duoc nhieu hon 1 trung tam (BDH/Tech/Ke toan, hoac
    // phu huynh co con hoc o nhieu trung tam), hien o chon de doi qua
    // lai, thay vi khoa cung dung 1 trung tam mac dinh.
    if (PROFILE.centerIds.length > 1) {
      const { data: centers } = await supabase.from('centers').select('id, name').in('id', PROFILE.centerIds).order('name');
      const select = document.getElementById('centerSelect');
      select.innerHTML = (centers || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      select.value = PROFILE.defaultCenterId;
      select.style.display = 'inline-block';
      select.addEventListener('change', () => { PROFILE.defaultCenterId = select.value; loadFeed(); });
    }
    await loadFeed();
  } catch (e) {
    document.getElementById('feedList').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
})();
