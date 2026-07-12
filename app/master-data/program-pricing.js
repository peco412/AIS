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
        <span class="course-chip">
          ${esc(c.name)}:
          ${CAN_EDIT
            ? `<input type="number" class="price-input" data-course="${c.id}" value="${c.price_vnd || 0}" />
               <button type="button" class="chip-del" data-del-course="${c.id}" title="Xoá khoá này">✕</button>`
            : `<strong class="mono">${fmtMoney(c.price_vnd)} đ</strong>`}
        </span>
      `).join('');

      return `
        <div class="sublevel-row">
          <span class="sublevel-row__name">↳ ${esc(sl.name)}</span>
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
        <div class="level-block__title" style="display:flex; justify-content:space-between; align-items:center;">
          <span>${esc(level.name)} <span class="cell-muted" style="text-transform:none; font-weight:400;">— trọn cấp độ: ${fmtMoney(levelTotal)} đ</span></span>
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
    <details class="program-group">
      <summary>
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

function wireEvents(container) {
  if (!CAN_EDIT) return;

  container.querySelectorAll('.price-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const { error } = await supabase.from('program_courses').update({ price_vnd: Number(input.value) || 0 }).eq('id', input.dataset.course);
      if (error) { alert('Lỗi: ' + error.message); return; }
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
