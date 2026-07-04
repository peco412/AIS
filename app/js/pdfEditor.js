// =====================================================================
// PDF EDITOR — component dùng chung cho mọi biểu mẫu PDF trong hệ thống
// (Hợp đồng lao động, Phiếu thanh toán, Phiếu tạm ứng, Trình sự kiện,
// Phiếu mua sắm) — đúng yêu cầu: PDF.js để hiển thị + pdf-lib để điền/ký.
//
// Cách dùng (xem ví dụ đầy đủ ở hr/contracts.js):
//
//   import { openPdfEditor } from '/js/pdfEditor.js';
//   openPdfEditor({
//     pdfUrl: 'https://.../bieu-mau.pdf',
//     signatureUrl: profile.signatureUrl,   // null nếu người dùng chưa có chữ ký
//     readOnly: false,
//     onSave: async (blob) => { ...upload blob lên Storage... },
//   });
// =====================================================================

// Lưu ý: pdf.js từ bản 4.x trở đi CHỈ phát hành dạng ES module (pdf.min.mjs),
// không còn file pdf.min.js (script thường) trên cdnjs nữa -> loadScript() bên
// dưới (tạo thẻ <script> thường) sẽ luôn 404 nếu để version 4.x.
// Dùng bản 3.11.174 - bản cuối cùng còn ở dạng script thường (window.pdfjsLib).
const PDFJS_VERSION = '3.11.174';
const PDFLIB_VERSION = '1.17.1';

let pdfjsReady = null;
let pdflibReady = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Không tải được ' + src));
    document.head.appendChild(s);
  });
}

async function ensureLibs() {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      if (!window.pdfjsLib) {
        await loadScript(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`);
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
    })();
  }
  if (!pdflibReady) {
    pdflibReady = (async () => {
      if (!window.PDFLib) {
        await loadScript(`https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/${PDFLIB_VERSION}/pdf-lib.min.js`);
      }
    })();
  }
  await Promise.all([pdfjsReady, pdflibReady]);
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Không tải được file PDF nguồn.');
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Mở trình xem/điền/ký PDF trong 1 modal toàn màn hình.
 * @param {Object} opts
 * @param {string} opts.pdfUrl - URL file PDF nguồn (biểu mẫu hoặc bản nháp)
 * @param {string|null} opts.signatureUrl - ảnh chữ ký PNG của người dùng hiện tại
 * @param {boolean} [opts.readOnly=false] - true = chỉ xem, ẩn công cụ điền/ký
 * @param {string} [opts.title]
 * @param {(blob: Blob) => Promise<void>} opts.onSave - gọi khi người dùng bấm Lưu
 */
export async function openPdfEditor({ pdfUrl, signatureUrl = null, readOnly = false, title = 'Xem / điền / ký PDF', onSave }) {
  await ensureLibs();

  const overlay = document.createElement('div');
  overlay.className = 'pdfed-overlay';
  overlay.innerHTML = `
    <div class="pdfed-toolbar">
      <span class="title">${title}</span>
      ${readOnly ? '' : `
        <button type="button" id="pdfedAddText">📝 Thêm văn bản</button>
        <button type="button" id="pdfedAddSig" ${signatureUrl ? '' : 'disabled title="Bạn chưa có chữ ký cá nhân — cập nhật ở Hồ sơ cá nhân"'}>✍️ Chèn chữ ký</button>
        <span class="hint" id="pdfedHint"></span>
      `}
      <button type="button" id="pdfedCancel">Đóng</button>
      ${readOnly ? '' : '<button type="button" id="pdfedSave" class="primary">💾 Lưu</button>'}
    </div>
    <div class="pdfed-body" id="pdfedBody">
      <div class="pdfed-loading">Đang tải PDF...</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const body = overlay.querySelector('#pdfedBody');
  const hint = overlay.querySelector('#pdfedHint');

  let armedTool = null; // 'text' | 'signature' | null
  const overlays = []; // { pageIndex, el, type, xPct, yPct, wPct, hPct, get text() }
  let originalBytes = null;

  function setArmed(tool) {
    armedTool = tool;
    overlay.querySelectorAll('.pdfed-page').forEach((p) => p.classList.toggle('place-armed', !!tool));
    overlay.querySelector('#pdfedAddText')?.classList.toggle('armed', tool === 'text');
    overlay.querySelector('#pdfedAddSig')?.classList.toggle('armed', tool === 'signature');
    if (hint) hint.textContent = tool ? 'Nhấp vào vị trí trên trang để đặt' : '';
  }

  function makeDraggable(el, pageEl) {
    let dragging = false, startX, startY, origLeft, origTop;
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.remove-btn') || e.target.closest('.resize-handle') || e.target.tagName === 'TEXTAREA') return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      origLeft = el.offsetLeft; origTop = el.offsetTop;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      el.style.left = Math.max(0, origLeft + dx) + 'px';
      el.style.top = Math.max(0, origTop + dy) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // Cho phép kéo góc dưới-phải để đổi kích thước chữ ký/khung văn bản —
  // đúng yêu cầu bổ sung "resize bằng chuột" (trước đây kích thước cố định).
  function makeResizable(el, minW = 40, minH = 24) {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    el.appendChild(handle);

    let resizing = false, startX, startY, origW, origH;
    handle.addEventListener('mousedown', (e) => {
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      origW = el.offsetWidth; origH = el.offsetHeight;
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      el.style.width = Math.max(minW, origW + dx) + 'px';
      el.style.height = Math.max(minH, origH + dy) + 'px';
    });
    window.addEventListener('mouseup', () => { resizing = false; });
  }

  function addOverlayItem(pageEl, pageIndex, x, y, type) {
    const el = document.createElement('div');
    el.className = 'pdfed-overlay-item';
    const w = type === 'signature' ? 150 : 200;
    const h = type === 'signature' ? 60 : 30;
    el.style.left = Math.max(0, x - w / 2) + 'px';
    el.style.top = Math.max(0, y - h / 2) + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';

    if (type === 'signature') {
      const img = document.createElement('img');
      img.src = signatureUrl;
      el.appendChild(img);
    } else {
      const ta = document.createElement('textarea');
      ta.placeholder = 'Nhập nội dung...';
      el.appendChild(ta);
    }
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.type = 'button';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      el.remove();
      const idx = overlays.findIndex((o) => o.el === el);
      if (idx >= 0) overlays.splice(idx, 1);
    });
    el.appendChild(removeBtn);

    pageEl.appendChild(el);
    makeDraggable(el, pageEl);
    makeResizable(el);
    overlays.push({ pageIndex, el, type, pageEl });
  }

  overlay.querySelector('#pdfedAddText')?.addEventListener('click', () => setArmed(armedTool === 'text' ? null : 'text'));
  overlay.querySelector('#pdfedAddSig')?.addEventListener('click', () => setArmed(armedTool === 'signature' ? null : 'signature'));

  function closeEditor() { overlay.remove(); }
  overlay.querySelector('#pdfedCancel').addEventListener('click', closeEditor);

  // ---------------------------------------------------------------------
  // Tải & render PDF bằng PDF.js
  // ---------------------------------------------------------------------
  try {
    originalBytes = await fetchBytes(pdfUrl);
    const loadingTask = window.pdfjsLib.getDocument({ data: originalBytes.slice() });
    const pdf = await loadingTask.promise;
    body.innerHTML = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const pageEl = document.createElement('div');
      pageEl.className = 'pdfed-page';
      pageEl.style.width = viewport.width + 'px';
      pageEl.style.height = viewport.height + 'px';
      pageEl.appendChild(canvas);
      body.appendChild(pageEl);

      pageEl.addEventListener('click', (e) => {
        if (!armedTool || e.target !== canvas) return;
        const rect = pageEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        addOverlayItem(pageEl, i - 1, x, y, armedTool);
        setArmed(null);
      });
    }
  } catch (err) {
    // Log đầy đủ lỗi gốc ra console — alert/nhãn lỗi chỉ hiện được 1 dòng
    // ngắn, còn console mới thấy stack trace + nguyên nhân thật (thường là
    // CORS bị chặn hoặc URL đã hết hạn) để debug được.
    console.error('Lỗi tải PDF:', err);
    const reason = err?.message || err?.error_description || err?.error || 'Không rõ nguyên nhân (xem tab Console để biết chi tiết).';
    body.innerHTML = `<div class="pdfed-loading">Lỗi tải PDF: ${reason}</div>`;
    return;
  }

  // ---------------------------------------------------------------------
  // Lưu: dùng pdf-lib nhúng text/ảnh chữ ký vào đúng toạ độ đã đặt
  // ---------------------------------------------------------------------
  overlay.querySelector('#pdfedSave')?.addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#pdfedSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Đang xử lý...';
    try {
      const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
      const pdfDoc = await PDFDocument.load(originalBytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      let sigImageEmbed = null;
      if (overlays.some((o) => o.type === 'signature')) {
        const sigBytes = await fetchBytes(signatureUrl);
        sigImageEmbed = await pdfDoc.embedPng(sigBytes);
      }

      for (const item of overlays) {
        const pdfPage = pdfDoc.getPage(item.pageIndex);
        const { width: pw, height: ph } = pdfPage.getSize();
        const pageEl = item.pageEl;
        const scaleX = pw / pageEl.offsetWidth;
        const scaleY = ph / pageEl.offsetHeight;

        const xPts = item.el.offsetLeft * scaleX;
        const wPts = item.el.offsetWidth * scaleX;
        const hPts = item.el.offsetHeight * scaleY;
        // Canvas gốc toạ độ trên-trái, PDF gốc toạ độ dưới-trái
        const yPts = ph - (item.el.offsetTop * scaleY) - hPts;

        if (item.type === 'signature' && sigImageEmbed) {
          pdfPage.drawImage(sigImageEmbed, { x: xPts, y: yPts, width: wPts, height: hPts });
        } else if (item.type === 'text') {
          const text = item.el.querySelector('textarea')?.value || '';
          if (text.trim()) {
            pdfPage.drawText(text, {
              x: xPts, y: yPts + hPts - 12, size: 11, font, color: rgb(0.07, 0.09, 0.12),
              maxWidth: wPts, lineHeight: 13,
            });
          }
        }
      }

      const finalBytes = await pdfDoc.save();
      const blob = new Blob([finalBytes], { type: 'application/pdf' });
      await onSave(blob);
      closeEditor();
    } catch (err) {
      console.error('Lỗi khi lưu PDF:', err);
      const reason = err?.message || err?.error_description || err?.error || 'Không rõ nguyên nhân — có thể do CORS bị chặn hoặc phiên làm việc đã hết hạn. Mở tab Console (F12) để xem chi tiết lỗi thật.';
      alert('Lỗi khi lưu PDF: ' + reason);
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Lưu';
    }
  });
}