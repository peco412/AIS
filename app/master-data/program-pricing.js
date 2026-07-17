import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let CAN_EDIT = false;
let LOADED_PROGRAMS = []; // cache du lieu da sap xep, dung de tinh anh/chi em khi bam mui ten (khong can doc lai DOM)

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN'); }

// Sinh "code" tu ten (bat buoc, duy nhat) cho bang programs — bo dau,
// viet hoa, thay khoang trang bang gach duoi, dung theo dung yeu cau
// schema (code text not null unique).
function slugifyCode(name) {
  const noAccent = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
  return noAccent.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'CT';
}

async function loadPricing() {
  const container = document.getElementById('programGroups');
  container.innerHTML = '<div class="empty-cell">Đang tải dữ liệu...</div>';

  const { data: programs, error } = await supabase
    .from('programs')
    .select(`
      id, name, display_order,
      program_levels (
        id, name, display_order,
        program_sublevels (
          id, name, display_order,
          program_courses ( id, name, price_vnd, display_order )
        )
      )
    `)
    .order('display_order');

  if (error) { container.innerHTML = `<div class="empty-cell">Lỗi: ${esc(error.message)}</div>`; return; }

  // Sap xep san moi tang (Supabase khong dam bao sap xep long nhau qua
  // .order() cho cac bang con) — cache lai de dung khi tinh mui ten.
  LOADED_PROGRAMS = (programs || []).slice().sort((a, b) => a.display_order - b.display_order);
  LOADED_PROGRAMS.forEach((p) => {
    p.program_levels = (p.program_levels || []).slice().sort((a, b) => a.display_order - b.display_order);
    p.program_levels.forEach((l) => {
      l.program_sublevels = (l.program_sublevels || []).slice().sort((a, b) => a.display_order - b.display_order);
      l.program_sublevels.forEach((sl) => {
        sl.program_courses = (sl.program_courses || []).slice().sort((a, b) => a.display_order - b.display_order);
      });
    });
  });

  container.innerHTML = LOADED_PROGRAMS.length > 0
    ? LOADED_PROGRAMS.map((prog) => renderProgram(prog)).join('')
    : '<div class="empty-cell">Chưa có chương trình học nào.</div>';

  wireEvents(container);
}

// Nut mui ten len/xuong — dung CHUNG cho ca 4 tang, disabled dung o dau/
// cuoi danh sach anh/chi em (khong can chuyen JS rieng cho tung tang).
function arrowButtons(type, id, isFirst, isLast) {
  if (!CAN_EDIT) return '';
  return `
    <button type="button" class="btn-arrow" data-move-up="${id}" data-move-type="${type}" ${isFirst ? 'disabled' : ''} title="Đưa lên trên">▲</button>
    <button type="button" class="btn-arrow" data-move-down="${id}" data-move-type="${type}" ${isLast ? 'disabled' : ''} title="Đưa xuống dưới">▼</button>
  `;
}

function renderProgram(prog) {
  const levels = prog.program_levels;
  let programTotal = 0;

  const levelsHtml = levels.map((level, levelIdx) => {
    const sublevels = level.program_sublevels;
    let levelTotal = 0;

    const sublevelsHtml = sublevels.map((sl, slIdx) => {
      const courses = sl.program_courses;
      const slTotal = courses.reduce((s, c) => s + Number(c.price_vnd || 0), 0);
      levelTotal += slTotal;

      const coursesHtml = courses.map((c, cIdx) => `
        <div class="course-row" data-id="${c.id}">
          <span class="course-row__name">${esc(c.name)}</span>
          ${CAN_EDIT
            ? `<span class="course-row__actions">
                 ${arrowButtons('course', c.id, cIdx === 0, cIdx === courses.length - 1)}
                 <input type="number" class="price-input" data-course="${c.id}" data-original="${c.price_vnd || 0}" value="${c.price_vnd || 0}" />
                 <button type="button" class="chip-del" data-del-course="${c.id}" title="Xoá khoá này"><svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
               </span>`
            : `<strong class="mono">${fmtMoney(c.price_vnd)} đ</strong>`}
        </div>
      `).join('');

      return `
        <div class="sublevel-wrap" data-id="${sl.id}">
          <div class="sublevel-row">
            <span class="sublevel-row__name">↳ ${esc(sl.name)}</span>
            <span style="display:flex; align-items:center; gap:10px;">
              ${courses.length > 1 ? `<span class="mono cell-muted">Tổng: ${fmtMoney(slTotal)} đ</span>` : ''}
              ${CAN_EDIT ? `
                ${arrowButtons('sublevel', sl.id, slIdx === 0, slIdx === sublevels.length - 1)}
                <button type="button" class="btn-mini" data-add-course="${sl.id}">+ Khoá</button>
                <button type="button" class="btn-mini btn-mini--danger" data-del-sublevel="${sl.id}" data-name="${esc(sl.name)}">🗑️ Xoá cấp độ con</button>
              ` : ''}
            </span>
          </div>
          <div class="course-list">${coursesHtml}</div>
        </div>
      `;
    }).join('');

    programTotal += levelTotal;

    return `
      <div class="level-wrap" data-id="${level.id}">
        <div class="level-block__title" style="display:flex; justify-content:space-between; align-items:center;">
          <span>${esc(level.name)} <span class="cell-muted" style="text-transform:none; font-weight:400;">— trọn cấp độ: ${fmtMoney(levelTotal)} đ</span></span>
          ${CAN_EDIT ? `
            <span>
              ${arrowButtons('level', level.id, levelIdx === 0, levelIdx === levels.length - 1)}
              <button type="button" class="btn-mini" data-add-sublevel="${level.id}">+ Cấp độ con</button>
              <button type="button" class="btn-mini btn-mini--danger" data-del-level="${level.id}" data-name="${esc(level.name)}">🗑️ Xoá cấp độ</button>
            </span>
          ` : ''}
        </div>
        ${sublevelsHtml}
      </div>
    `;
  }).join('');

  const progIdx = LOADED_PROGRAMS.findIndex((p) => p.id === prog.id);

  return `
    <details class="program-group" data-id="${prog.id}">
      <summary>
        <span class="name">${esc(prog.name)}</span>
        <span style="display:flex; align-items:center; gap:10px;">
          <span class="total">Trọn chương trình: ${fmtMoney(programTotal)} đ</span>
          ${CAN_EDIT ? `
            ${arrowButtons('program', prog.id, progIdx === 0, progIdx === LOADED_PROGRAMS.length - 1)}
            <button type="button" class="btn-mini" data-add-level="${prog.id}">+ Cấp độ</button>
            <button type="button" class="btn-mini btn-mini--danger" data-del-program="${prog.id}" data-name="${esc(prog.name)}">🗑️ Xoá chương trình</button>
          ` : ''}
        </span>
      </summary>
      ${levelsHtml}
    </details>
  `;
}

const REORDER_TABLE = { program: 'programs', level: 'program_levels', sublevel: 'program_sublevels', course: 'program_courses' };

// Doi cho VOI DUNG 1 anh/chi em ke ben (len hoac xuong) — chi hoan doi
// display_order giua 2 dong, KHONG dung toi cau truc DOM long nhau nen
// khong co rui ro "bo lai noi dung con" nhu kieu keo-tha HTML truoc day.
function findSiblingsAndIndex(type, id) {
  if (type === 'program') return { siblings: LOADED_PROGRAMS, idx: LOADED_PROGRAMS.findIndex((p) => p.id === id) };
  for (const prog of LOADED_PROGRAMS) {
    if (type === 'level') {
      const idx = prog.program_levels.findIndex((l) => l.id === id);
      if (idx !== -1) return { siblings: prog.program_levels, idx };
    }
    for (const level of prog.program_levels) {
      if (type === 'sublevel') {
        const idx = level.program_sublevels.findIndex((sl) => sl.id === id);
        if (idx !== -1) return { siblings: level.program_sublevels, idx };
      }
      for (const sl of level.program_sublevels) {
        if (type === 'course') {
          const idx = sl.program_courses.findIndex((c) => c.id === id);
          if (idx !== -1) return { siblings: sl.program_courses, idx };
        }
      }
    }
  }
  return { siblings: [], idx: -1 };
}

async function moveItem(type, id, direction) {
  const { siblings, idx } = findSiblingsAndIndex(type, id);
  if (idx === -1) return;
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;

  const a = siblings[idx];
  const b = siblings[swapIdx];
  const table = REORDER_TABLE[type];

  const [r1, r2] = await Promise.all([
    supabase.from(table).update({ display_order: b.display_order }).eq('id', a.id),
    supabase.from(table).update({ display_order: a.display_order }).eq('id', b.id),
  ]);
  if (r1.error || r2.error) {
    alert('Lỗi khi đổi thứ tự: ' + (r1.error?.message || r2.error?.message));
    return;
  }
  await loadPricing();
}

// Thanh "Luu thay doi" TONG THE cho GIA — hien khi co it nhat 1 o gia da
// sua so voi gia tri goc (data-original), an di khi khong con gi thay doi.
function updateSaveBarVisibility() {
  const dirtyInputs = Array.from(document.querySelectorAll('.price-input')).filter(
    (i) => Number(i.value) !== Number(i.dataset.original)
  );
  const bar = document.getElementById('saveBar');
  if (dirtyInputs.length > 0) {
    bar.style.display = 'flex';
    document.getElementById('saveBarCount').textContent = `${dirtyInputs.length} giá đã sửa, chưa lưu`;
  } else {
    bar.style.display = 'none';
  }
}

async function saveAllPrices() {
  const dirtyInputs = Array.from(document.querySelectorAll('.price-input')).filter(
    (i) => Number(i.value) !== Number(i.dataset.original)
  );
  if (dirtyInputs.length === 0) return;

  const btn = document.getElementById('btnSaveAll');
  btn.disabled = true; btn.textContent = 'Đang lưu...';

  const results = await Promise.all(dirtyInputs.map((input) =>
    supabase.from('program_courses').update({ price_vnd: Number(input.value) || 0 }).eq('id', input.dataset.course)
  ));
  const failed = results.filter((r) => r.error);

  btn.disabled = false; btn.textContent = 'Lưu tất cả thay đổi';
  if (failed.length > 0) {
    alert(`Lỗi khi lưu (${failed.length}/${dirtyInputs.length} thất bại): ${failed[0].error.message}`);
  }
  await loadPricing();
}

function wireEvents(container) {
  if (!CAN_EDIT) return;

  container.querySelectorAll('[data-move-up]').forEach((btn) => btn.addEventListener('click', () => moveItem(btn.dataset.moveType, btn.dataset.moveUp, -1)));
  container.querySelectorAll('[data-move-down]').forEach((btn) => btn.addEventListener('click', () => moveItem(btn.dataset.moveType, btn.dataset.moveDown, 1)));

  container.querySelectorAll('.price-input').forEach((input) => {
    input.addEventListener('input', updateSaveBarVisibility);
  });

  container.querySelectorAll('[data-add-course]').forEach((btn) => btn.addEventListener('click', async () => {
    const name = prompt('Tên khoá học mới:');
    if (!name?.trim()) return;
    const price = prompt('Học phí gốc (VNĐ):', '0');
    const { error } = await supabase.from('program_courses').insert({ sublevel_id: btn.dataset.addCourse, name: name.trim(), price_vnd: Number(price) || 0 });
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadPricing();
  }));

  container.querySelectorAll('[data-add-sublevel]').forEach((btn) => btn.addEventListener('click', async () => {
    const name = prompt('Tên cấp độ con mới (VD: "Movers 1"):');
    if (!name?.trim()) return;
    const { error } = await supabase.from('program_sublevels').insert({ level_id: btn.dataset.addSublevel, name: name.trim() });
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadPricing();
  }));

  container.querySelectorAll('[data-add-level]').forEach((btn) => btn.addEventListener('click', async () => {
    const name = prompt('Tên cấp độ mới (VD: "Movers"):');
    if (!name?.trim()) return;
    const { error } = await supabase.from('program_levels').insert({ program_id: btn.dataset.addLevel, name: name.trim() });
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadPricing();
  }));

  container.querySelectorAll('[data-del-course]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Xoá khoá học này? Không ảnh hưởng học sinh đã đóng phí trước đó, chỉ ẩn khỏi bảng giá từ giờ về sau.')) return;
    const { error } = await supabase.from('program_courses').delete().eq('id', btn.dataset.delCourse);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadPricing();
  }));

  container.querySelectorAll('[data-del-sublevel]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(`Xoá cấp độ con "${btn.dataset.name}"? TẤT CẢ khoá học bên trong sẽ bị xoá theo. Không thể hoàn tác.`)) return;
    const { error } = await supabase.from('program_sublevels').delete().eq('id', btn.dataset.delSublevel);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadPricing();
  }));

  container.querySelectorAll('[data-del-level]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(`Xoá cấp độ "${btn.dataset.name}"? TẤT CẢ cấp độ con và khoá học bên trong sẽ bị xoá theo. Không thể hoàn tác.`)) return;
    const { error } = await supabase.from('program_levels').delete().eq('id', btn.dataset.delLevel);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadPricing();
  }));

  container.querySelectorAll('[data-del-program]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(`XOÁ TOÀN BỘ chương trình "${btn.dataset.name}"? Toàn bộ cấp độ/cấp độ con/khoá học bên trong sẽ mất hết. Không thể hoàn tác. Gõ đúng tên chương trình để xác nhận.`)) return;
    const typed = prompt(`Gõ lại chính xác "${btn.dataset.name}" để xác nhận xoá:`);
    if (typed !== btn.dataset.name) { alert('Tên không khớp, đã huỷ thao tác xoá.'); return; }
    const { error } = await supabase.from('programs').delete().eq('id', btn.dataset.delProgram);
    if (error) { alert('Lỗi: ' + error.message); return; }
    await loadPricing();
  }));
}

document.getElementById('btnAddProgram')?.addEventListener('click', async () => {
  const name = prompt('Tên chương trình học mới (VD: "Tiếng Anh Thiếu Nhi"):');
  if (!name?.trim()) return;
  const { error } = await supabase.from('programs').insert({ name: name.trim(), code: slugifyCode(name.trim()) + '_' + Date.now().toString(36).toUpperCase() });
  if (error) { alert('Lỗi: ' + error.message); return; }
  await loadPricing();
});

document.getElementById('btnSaveAll').addEventListener('click', saveAllPrices);

(async () => {
  try {
    const { profile } = await bootShell();
    const { data: emp } = await supabase.from('employees').select('department_id, departments(code)').eq('id', profile.id).single();
    // Ma tran: trang gia khoa hoc thuoc "Cau hinh Master Data" - Ky thuat
    // duoc sua, rieng BDH (EXECUTIVE) chi con quyen xem (khong sua duoc).
    CAN_EDIT = emp?.departments?.code === 'ACC' || profile.roleCode === 'TECH';
    if (CAN_EDIT) document.getElementById('btnAddProgram').style.display = '';
    await loadPricing();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
