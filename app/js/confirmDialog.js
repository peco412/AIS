// =====================================================================
// HỘP THOẠI XÁC NHẬN / NHẬP LIỆU DÙNG CHUNG
// -----------------------------------------------------------------------
// VẤN ĐỀ ĐANG SỬA: ~26 chỗ dùng confirm() và ~11 chỗ dùng prompt() gốc của
// trình duyệt trên toàn hệ thống (nút Xoá/Từ chối/Duyệt...). Hộp thoại gốc
// trình duyệt là giao diện HỆ ĐIỀU HÀNH (không phải web) — không theo màu
// thương hiệu, không bo góc, không responsive đúng kiểu, đặc biệt xấu và
// khó bấm trên điện thoại — phá vỡ hoàn toàn sự đồng bộ UI/UX mà toàn bộ
// phần còn lại của hệ thống đã xây rất kỹ (modal riêng, tokens.css...).
//
// File này thay thế bằng 2 hàm dùng Promise, gọi y hệt cú pháp cũ (chỉ
// thêm "await"), dùng lại ĐÚNG các class .modal-overlay/.modal-box/
// .modal-actions đã có sẵn trong module.css — nên tự động đúng theme,
// đúng khoảng cách, đúng cỡ chữ chống zoom trên điện thoại như mọi modal
// khác trong hệ thống, không cần thêm CSS riêng.
//
// CÁCH DÙNG (thay cho confirm()/prompt() gốc):
//   if (!(await showConfirm('Xoá bản ghi này?'))) return;
//   const reason = await showPromptDialog('Nhập lý do từ chối:');
//   if (reason === null) return; // người dùng bấm Huỷ
// =====================================================================

let dialogRoot = null;

function ensureRoot() {
  if (dialogRoot) return dialogRoot;
  dialogRoot = document.createElement('div');
  dialogRoot.id = 'sharedDialogRoot';
  document.body.appendChild(dialogRoot);
  return dialogRoot;
}

// Nhiều chỗ gọi cũ dùng confirm()/prompt() gốc với "\n" để xuống dòng (vì đó
// là cách DUY NHẤT xuống dòng được trong hộp thoại hệ điều hành). Modal mới
// render bằng innerHTML nên: (1) phải escape để không bị lỗi/rủi ro với tên
// người dùng nhập có ký tự đặc biệt, (2) tự đổi "\n" thành "<br>" để giữ
// đúng cách xuống dòng như cũ mà không phải sửa lại từng câu ở 26 file gọi.
function toSafeHtml(text) {
  const escaped = String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/\n/g, '<br>');
}

function baseModal({ title, bodyHtml, danger }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px;" role="dialog" aria-modal="true">
      <h3>${title}</h3>
      ${bodyHtml}
      <div class="modal-actions" data-dialog-actions></div>
    </div>
  `;
  return overlay;
}

/**
 * Thay cho window.confirm(message). Trả về Promise<boolean>.
 * options.danger = true -> nút xác nhận màu cảnh báo (dùng cho Xoá/Từ chối).
 * options.confirmLabel / options.cancelLabel -> đổi chữ trên nút nếu cần.
 */
export function showConfirm(message, options = {}) {
  const { danger = false, confirmLabel = 'Xác nhận', cancelLabel = 'Huỷ' } = options;
  return new Promise((resolve) => {
    const overlay = baseModal({
      title: options.title || (danger ? 'Xác nhận thao tác' : 'Xác nhận'),
      bodyHtml: `<p class="modal-sub" style="margin-bottom:20px; color:var(--ink); font-size:14px; line-height:1.5;">${toSafeHtml(message)}</p>`,
    });
    const actions = overlay.querySelector('[data-dialog-actions]');
    actions.innerHTML = `
      <button type="button" class="btn btn-outline" data-cancel>${cancelLabel}</button>
      <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-accent'}" data-ok>${confirmLabel}</button>
    `;
    function close(result) {
      overlay.remove();
      resolve(result);
    }
    actions.querySelector('[data-cancel]').addEventListener('click', () => close(false));
    actions.querySelector('[data-ok]').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    ensureRoot().appendChild(overlay);
    actions.querySelector('[data-ok]').focus();
  });
}

/**
 * Thay cho window.prompt(message). Trả về Promise<string|null> (null = Huỷ,
 * y hệt hành vi prompt() gốc, để chỗ gọi không cần đổi logic kiểm tra null).
 */
export function showPromptDialog(message, options = {}) {
  const { placeholder = '', defaultValue = '', required = false, confirmLabel = 'Xác nhận', cancelLabel = 'Huỷ', multiline = false } = options;
  return new Promise((resolve) => {
    const inputId = 'sharedDialogInput_' + Math.random().toString(36).slice(2, 8);
    const overlay = baseModal({
      title: options.title || 'Nhập thông tin',
      bodyHtml: `
        <p class="modal-sub" style="margin-bottom:10px; color:var(--ink); font-size:14px; line-height:1.5;">${toSafeHtml(message)}</p>
        <div class="field">
          ${multiline
            ? `<textarea id="${inputId}" rows="3" placeholder="${toSafeHtml(placeholder)}">${toSafeHtml(defaultValue)}</textarea>`
            : `<input type="text" id="${inputId}" placeholder="${toSafeHtml(placeholder)}" value="${toSafeHtml(defaultValue)}" />`}
        </div>
      `,
    });
    const actions = overlay.querySelector('[data-dialog-actions]');
    actions.innerHTML = `
      <button type="button" class="btn btn-outline" data-cancel>${cancelLabel}</button>
      <button type="button" class="btn btn-accent" data-ok>${confirmLabel}</button>
    `;
    const input = overlay.querySelector(`#${inputId}`);
    function close(result) {
      overlay.remove();
      resolve(result);
    }
    function submit() {
      const val = input.value.trim();
      if (required && !val) { input.focus(); input.style.borderColor = 'var(--danger)'; return; }
      close(val);
    }
    actions.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    actions.querySelector('[data-ok]').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) submit(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    ensureRoot().appendChild(overlay);
    input.focus();
  });
}
