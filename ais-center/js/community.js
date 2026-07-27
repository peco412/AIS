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
      const path = `${PROFILE.defaultCenterId || 'chung'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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
// MOI — social_posts tham chieu THANG toi parent_accounts/employees
// (khong phai social_profiles), nen khong the JOIN truc tiep ra ten
// hien thi cong khai — phai truy van social_profiles RIENG roi ghep
// lai o client. Dung 1 ham chung cho ca bang tin lan binh luan.
async function fetchProfilesMap(parentIds, employeeIds) {
  const map = new Map();
  if (parentIds.length === 0 && employeeIds.length === 0) return map;
  // SUA — truoc day truy van THANG social_profiles, neu ai chua tung
  // vao trang nay 1 lan (chua tu tao ho so) se bi ROI VAO GIA TRI DU
  // PHONG chung chung "Nhân viên"/"Phụ huynh" thay vi ten that. Gio goi
  // 1 ham rieng TU DONG LAY TEN THAT tu bang goc (va tao luon ho so
  // cho lan sau), dam bao luon co ten dung.
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

async function loadFeed() {
  const feedList = document.getElementById('feedList');
  const { data: posts, error } = await supabase
    .from('social_posts')
    .select(`
      id, caption, image_url, created_at,
      author_parent_id, author_employee_id,
      centers:center_id(name)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { feedList.innerHTML = `<div class="empty-state">Không tải được bảng tin: ${esc(error.message)}</div>`; return; }
  if (!posts || posts.length === 0) { feedList.innerHTML = '<div class="empty-state">Chưa có bài đăng nào — hãy là người đầu tiên chia sẻ!</div>'; return; }

  const profilesMap = await fetchProfilesMap(
    [...new Set(posts.filter((p) => p.author_parent_id).map((p) => p.author_parent_id))],
    [...new Set(posts.filter((p) => p.author_employee_id).map((p) => p.author_employee_id))]
  );

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
    return `
      <div class="post-card" data-post="${p.id}">
        <div class="post-card__head">
          <div class="post-card__avatar">${authorProfile.avatar ? `<img src="${esc(authorProfile.avatar)}" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" />` : esc(initials(authorName))}</div>
          <div>
            <div class="post-card__name">${esc(authorName)}${isStaffAuthor ? '<span class="post-card__badge">Nhân viên</span>' : ''}</div>
            <div class="post-card__meta">${timeAgo(p.created_at)}${p.centers?.name ? ` · 📍 ${esc(p.centers.name)}` : ''}</div>
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
    .select('id, content, created_at, author_parent_id, author_employee_id')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) { listEl.innerHTML = `<div class="empty-state" style="padding:8px;">${esc(error.message)}</div>`; return; }

  const profilesMap = await fetchProfilesMap(
    [...new Set((comments || []).filter((c) => c.author_parent_id).map((c) => c.author_parent_id))],
    [...new Set((comments || []).filter((c) => c.author_employee_id).map((c) => c.author_employee_id))]
  );

  listEl.innerHTML = (comments || []).map((c) => {
    const profile = profileFor(profilesMap, c.author_parent_id, c.author_employee_id);
    return `
      <div class="comment-row">
        <div class="comment-row__avatar">${profile.avatar ? `<img src="${esc(profile.avatar)}" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" />` : esc(initials(profile.name))}</div>
        <div class="comment-row__bubble"><div class="comment-row__name">${esc(profile.name)}</div>${esc(c.content)}</div>
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
    // MOI — an cac muc "Trang chu/Vi AIScoins/Tai khoan" (chi danh cho
    // phu huynh) khoi thanh dieu huong khi dang la phien NHAN VIEN —
    // bam vao se dan toi trang chi phu huynh moi dung duoc, gay nham lan.
    if (PROFILE.type === 'employee') {
      document.querySelectorAll('.nav-parent-only').forEach((el) => { el.style.display = 'none'; });
    }
    // MOI — bang tin va cong cu dang bai gio KHONG con phu thuoc vao co
    // gan trung tam hay khong nua — ai dang nhap duoc cung dang bai
    // duoc, dung dinh nghia mang xa hoi mo, khong khoa theo trung tam.
    await loadFeed();
  } catch (e) {
    document.getElementById('feedList').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
})();
