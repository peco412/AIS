import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';

let CAN_EDIT = false;

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

  container.innerHTML = (programs && programs.length > 0)
    ? programs.map((prog) => renderProgram(prog)).join('')
    : '<div class="empty-cell">Chưa có chương trình học nào.</div>';

  wireEvents(container);
}

function renderProgram(prog) {
  const levels = (prog.program_levels || []).sort((a, b) => a.display_order - b.display_order);
  let programTotal = 0;

  const levelsHtml = levels.map((level) => {
    const sublevels = (level.program_sublevels || []).sort((a, b) => a.display_order - b.display_order);
    let levelTotal = 0;

    const sublevelsHtml = sublevels.map((sl) => {
      const courses = (sl.program_courses || []).sort((a, b) => a.display_order - b.display_order);
      const slTotal = courses.reduce((s, c) => s + Number(c.price_vnd || 0), 0);
      levelTotal += slTotal;

      const coursesHtml = courses.map((c) => `
        <span class="course-chip" data-id="${c.id}" data-type="course" data-parent="${sl.id}" ${CAN_EDIT ? 'draggable="true"' : ''}>
          ${CAN_EDIT ? '<span class="drag-handle" title="Kéo để đổi thứ tự">⠿</span>' : ''}
          ${esc(c.name)}:
          ${CAN_EDIT
            ? `<input type="number" class="price-input" data-course="${c.id}" value="${c.price_vnd || 0}" draggable="false" />
               <button type="button" class="chip-save" data-save-price="${c.id}" title="Lưu giá này" draggable="false">💾</button>
               <button type="button" class="chip-del" data-del-course="${c.id}" title="Xoá khoá này" draggable="false">✕</button>`
            : `<strong class="mono">${fmtMoney(c.price_vnd)} đ</strong>`}
        </span>
      `).join('');

      return `
        <div class="sublevel-row" data-id="${sl.id}" data-type="sublevel" data-parent="${level.id}" ${CAN_EDIT ? 'draggable="true"' : ''}>
          <span class="sublevel-row__name">${CAN_EDIT ? '<span class="drag-handle" title="Kéo để đổi thứ tự">⠿</span> ' : ''}↳ ${esc(sl.name)}</span>
          <span style="display:flex; align-items:center; gap:10px;">
            ${courses.length > 1 ? `<span class="mono cell-muted">Tổng: ${fmtMoney(slTotal)} đ</span>` : ''}
            ${CAN_EDIT ? `
              <button type="button" class="btn-mini" data-add-course="${sl.id}">+ Khoá</button>
              <button type="button" class="btn-mini btn-mini--danger" data-del-sublevel="${sl.id}" data-name="${esc(sl.name)}">🗑️ Xoá cấp độ con</button>
            ` : ''}
          </span>
        </div>
        <div class="course-list">${coursesHtml}</div>
      `;
    }).join('');

    programTotal += levelTotal;

    return `
      <div class="level-block">
        <div class="level-block__title" data-id="${level.id}" data-type="level" data-parent="${prog.id}" style="display:flex; justify-content:space-between; align-items:center;" ${CAN_EDIT ? 'draggable="true"' : ''}>
          <span>${CAN_EDIT ? '<span class="drag-handle" title="Kéo để đổi thứ tự">⠿</span> ' : ''}${esc(level.name)} <span class="cell-muted" style="text-transform:none; font-weight:400;">— trọn cấp độ: ${fmtMoney(levelTotal)} đ</span></span>
          ${CAN_EDIT ? `
            <span>
              <button type="button" class="btn-mini" data-add-sublevel="${level.id}">+ Cấp độ con</button>
              <button type="button" class="btn-mini btn-mini--danger" data-del-level="${level.id}" data-name="${esc(level.name)}">🗑️ Xoá cấp độ</button>
            </span>
          ` : ''}
        </div>
        ${sublevelsHtml}
      </div>
    `;
  }).join('');

  return `
    <details class="program-group" data-id="${prog.id}" data-type="program">
      <summary data-id="${prog.id}" data-type="program" data-parent="root" ${CAN_EDIT ? 'draggable="true"' : ''}>
        ${CAN_EDIT ? '<span class="drag-handle" title="Kéo để đổi thứ tự">⠿</span>' : ''}
        <span class="name">${esc(prog.name)}</span>
        <span style="display:flex; align-items:center; gap:10px;">
          <span class="total">Trọn chương trình: ${fmtMoney(programTotal)} đ</span>
          ${CAN_EDIT ? `
            <button type="button" class="btn-mini" data-add-level="${prog.id}">+ Cấp độ</button>
            <button type="button" class="btn-mini btn-mini--danger" data-del-program="${prog.id}" data-name="${esc(prog.name)}">🗑️ Xoá chương trình</button>
          ` : ''}
        </span>
      </summary>
      ${levelsHtml}
    </details>
  `;
}

// Kéo-thả đổi thứ tự — dung 1 co che CHUNG cho ca 4 tang (Chuong trinh/
// Cap do/Cap do con/Khoa hoc), chi khac nhau o BANG can update va DIEU
// KIEN cung nhom cha (data-parent) — chi cho phep tha vao dung ANH/CHI
// EM cung cha, tranh keo lung tung giua cac nhom khac nhau gay sai du lieu.
const REORDER_TABLE = { program: 'programs', level: 'program_levels', sublevel: 'program_sublevels', course: 'program_courses' };

function wireDragReorder(container) {
  let draggedEl = null;

  container.addEventListener('dragstart', (e) => {
    const el = e.target.closest('[draggable="true"]');
    if (!el) return;
    draggedEl = el;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => el.classList.add('dragging'), 0);
  });

  container.addEventListener('dragend', (e) => {
    const el = e.target.closest('[draggable="true"]');
    el?.classList.remove('dragging');
    draggedEl = null;
  });

  container.addEventListener('dragover', (e) => {
    const target = e.target.closest('[draggable="true"]');
    if (!target || !draggedEl || target === draggedEl) return;
    // Chi cho tha vao dung PHAN TU CUNG LOAI + CUNG NHOM CHA (vd Khoa hoc
    // chi doi cho voi Khoa hoc khac trong CUNG 1 Cap do con).
    if (target.dataset.type !== draggedEl.dataset.type || target.dataset.parent !== draggedEl.dataset.parent) return;
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    target.parentNode.insertBefore(draggedEl, before ? target : target.nextSibling);
  });

  container.addEventListener('drop', async (e) => {
    const target = e.target.closest('[draggable="true"]');
    if (!target || !draggedEl) return;
    e.preventDefault();
    await persistNewOrder(draggedEl.dataset.type, draggedEl.dataset.parent);
  });
}

async function persistNewOrder(type, parentId) {
  const table = REORDER_TABLE[type];
  // Lay lai DUNG THU TU tren man hinh SAU KHI tha (DOM da tu sap xep lai
  // qua buoc dragover o tren) — lay tat ca phan tu cung loai+cung nhom
  // cha, theo dung thu tu hien tai trong DOM.
  const container = document.getElementById('programGroups');
  const items = Array.from(container.querySelectorAll(`[data-type="${type}"][data-parent="${parentId}"]`));
  const updates = items.map((el, idx) => ({ id: el.dataset.id, display_order: idx }));

  // SUA LOI THAT: supabase-js KHONG throw loi cho cac truy van that bai
  // (chi tra ve {error} trong ket qua) — try/catch o day TRUOC GIO
  // KHONG BAO GIO bat duoc loi thuc su, khien viec luu that bai bi NUOT
  // AM THAM, roi tai lai (loadPricing) hien dung thu tu CU trong database
  // — nhin giong nhu "keo xong lai ve cho cu". Gio kiem tra dung {error}
  // tra ve tu MOI cau update, bao ro neu co bat ky cai nao that bai.
  const results = await Promise.all(updates.map((u) => supabase.from(table).update({ display_order: u.display_order }).eq('id', u.id)));
  const failed = results.filter((r) => r.error);
  if (failed.length > 0) {
    alert(`Lỗi khi lưu thứ tự mới (${failed.length}/${updates.length} dòng thất bại): ${failed[0].error.message}`);
  }
  await loadPricing(); // tai lai de dam bao khop 100% voi database (khong tin DOM mai mai)
}

function wireEvents(container) {
  if (!CAN_EDIT) return;
  wireDragReorder(container);

  // SUA THEO YEU CAU: bo han kieu "tu luu ngay khi roi o nhap" (change
  // event) — du da sua loi draggable, van co the con nguyen nhan khac
  // gay gian doan luc go so. Gio CHI luu khi bam nut 💾 ro rang, khong
  // co gi xay ra trong luc go — an toan tuyet doi, khong con kha nang
  // bi "nhay" trang giua chung.
  container.querySelectorAll('[data-save-price]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const courseId = btn.dataset.savePrice;
      const input = container.querySelector(`.price-input[data-course="${courseId}"]`);
      const newPrice = Number(input.value) || 0;
      btn.disabled = true; btn.textContent = '⏳';
      const { error } = await supabase.from('program_courses').update({ price_vnd: newPrice }).eq('id', courseId);
      if (error) { alert('Lỗi: ' + error.message); btn.disabled = false; btn.textContent = '💾'; return; }
      await loadPricing();
    });
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
