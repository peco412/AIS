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
export async function openPdfEditor({
  pdfUrl, signatureUrl = null, readOnly = false, title = 'Xem / điền / ký PDF', onSave,
  fieldMap = null, isTemplateDesigner = false, onSaveFieldMap = null,
}) {
  await ensureLibs();

  const overlay = document.createElement('div');
  overlay.className = 'pdfed-overlay';
  overlay.innerHTML = `
    <div class="pdfed-toolbar">
      <span class="title">${title}</span>
      ${readOnly ? '' : `
        <button type="button" id="pdfedAddText">📝 Thêm văn bản</button>
        <button type="button" id="pdfedAddSig" ${signatureUrl ? '' : 'disabled title="Bạn chưa có chữ ký cá nhân — cập nhật ở Hồ sơ cá nhân"'}>✍️ Chèn chữ ký</button>
        ${isTemplateDesigner ? '<button type="button" id="pdfedSaveFieldMap">📐 Lưu vị trí mẫu</button>' : ''}
        <span class="hint" id="pdfedHint"></span>
      `}
      <button type="button" id="pdfedCancel">Đóng</button>
      ${readOnly || isTemplateDesigner ? '' : '<button type="button" id="pdfedSave" class="primary">Lưu</button>'}
    </div>
    <div class="pdfed-pagenav" id="pdfedPageNav" style="display:none;">
      <button type="button" id="pdfedPrevPage">‹ Trang trước</button>
      <span id="pdfedPageIndicator">Trang 1</span>
      <button type="button" id="pdfedNextPage">Trang sau ›</button>
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

  function addOverlayItem(pageEl, pageIndex, x, y, type, opts = {}) {
    const el = document.createElement('div');
    el.className = 'pdfed-overlay-item';
    const w = opts.width || (type === 'signature' ? 150 : 200);
    const h = opts.height || (type === 'signature' ? 60 : 30);
    // opts.exact = true -> x/y đã là toạ độ góc trên-trái thật (dùng khi đặt
    // sẵn theo field_map), false -> x/y là điểm click, cần trừ nửa kích
    // thước để item nằm giữa đúng điểm bấm (hành vi đặt tay như cũ).
    if (opts.exact) {
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    } else {
      el.style.left = Math.max(0, x - w / 2) + 'px';
      el.style.top = Math.max(0, y - h / 2) + 'px';
    }
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    if (opts.fieldKey) el.dataset.fieldKey = opts.fieldKey;

    if (type === 'signature') {
      const img = document.createElement('img');
      img.src = signatureUrl;
      el.appendChild(img);
    } else {
      const ta = document.createElement('textarea');
      ta.placeholder = opts.label || 'Nhập nội dung...';
      if (opts.textValue) ta.value = opts.textValue;
      el.appendChild(ta);
    }
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.type = 'button';
    removeBtn.innerHTML = '<svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
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

  // Đặt sẵn các ô ký/điền theo đúng vị trí đã lưu trong field_map của biểu
  // mẫu (nếu có) — field_map lưu toạ độ dạng PHẦN TRĂM theo kích thước
  // trang (không phải pixel tuyệt đối) nên áp dụng đúng dù màn hình to nhỏ
  // khác nhau (khớp với cơ chế scale co giãn theo màn hình đã có).
  function applyFieldMap(fieldMap, pageEls) {
    (fieldMap || []).forEach((f) => {
      const pageEl = pageEls[f.page];
      if (!pageEl) return;
      const w = pageEl.offsetWidth, h = pageEl.offsetHeight;
      addOverlayItem(pageEl, f.page, (f.xPct / 100) * w, (f.yPct / 100) * h, f.type, {
        exact: true,
        width: (f.wPct / 100) * w,
        height: (f.hPct / 100) * h,
        label: f.label,
        fieldKey: f.key,
      });
    });
  }

  // Chế độ "thiết kế mẫu": TECH/HR đặt sẵn vị trí 1 lần cho cả mẫu, lưu lại
  // field_map để những lần điền/ký sau tự động có sẵn đúng chỗ, không phải
  // kéo-thả lại từ đầu mỗi lần.
  function collectFieldMap(pageEls) {
    return overlays.map((o) => {
      const pageEl = o.pageEl;
      const w = pageEl.offsetWidth, h = pageEl.offsetHeight;
      return {
        page: pageEls.indexOf(pageEl),
        type: o.type,
        xPct: (o.el.offsetLeft / w) * 100,
        yPct: (o.el.offsetTop / h) * 100,
        wPct: (o.el.offsetWidth / w) * 100,
        hPct: (o.el.offsetHeight / h) * 100,
        label: o.el.querySelector('textarea')?.placeholder || undefined,
        key: o.el.dataset.fieldKey || undefined,
      };
    });
  }

  overlay.querySelector('#pdfedAddText')?.addEventListener('click', () => setArmed(armedTool === 'text' ? null : 'text'));
  overlay.querySelector('#pdfedAddSig')?.addEventListener('click', () => setArmed(armedTool === 'signature' ? null : 'signature'));
  overlay.querySelector('#pdfedSaveFieldMap')?.addEventListener('click', async () => {
    const pageEls = Array.from(body.querySelectorAll('.pdfed-page'));
    const fieldMap = collectFieldMap(pageEls);
    try {
      await onSaveFieldMap(fieldMap);
      alert('Đã lưu vị trí mẫu. Từ lần sau, biểu mẫu này sẽ tự có sẵn đúng vị trí ký/điền.');
    } catch (err) {
      alert('Không lưu được vị trí mẫu: ' + (err.message || 'Có lỗi xảy ra.'));
    }
  });

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

    // Tính tỉ lệ hiển thị theo đúng bề rộng khung xem thực tế (thay vì
    // scale cố định 1.3 trước đây) — mới hiện đúng khổ A4 vừa khít trên
    // mọi kích thước màn hình, kể cả điện thoại (trước đây trang A4 tràn
    // ra ngoài màn hình nhỏ, phải cuộn ngang mới xem hết).
    const firstPage = await pdf.getPage(1);
    const baseViewport = firstPage.getViewport({ scale: 1 });
    const availableWidth = body.clientWidth - 32; // trừ padding 2 bên
    let displayScale = availableWidth / baseViewport.width;
    displayScale = Math.min(Math.max(displayScale, 0.35), 1.6); // giới hạn hợp lý, không quá nhỏ/quá to

    // Render nét trên màn hình retina/điện thoại: canvas thật vẽ ở độ phân
    // giải cao hơn (scale × devicePixelRatio) nhưng kích thước CSS hiển thị
    // vẫn đúng displayScale -> hình không bị mờ mà cũng không tràn màn hình.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = i === 1 ? firstPage : await pdf.getPage(i);
      const viewport = page.getViewport({ scale: displayScale });
      const renderViewport = page.getViewport({ scale: displayScale * pixelRatio });

      const canvas = document.createElement('canvas');
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

      const pageEl = document.createElement('div');
      pageEl.className = 'pdfed-page';
      pageEl.style.width = viewport.width + 'px';
      pageEl.style.height = viewport.height + 'px';
      pageEl.appendChild(canvas);
      body.appendChild(pageEl);

      // Nếu có nhiều trang cần điền, đánh số trang rõ ràng để dễ theo dõi
      // đang ở trang nào khi cuộn qua form dài.
      if (pdf.numPages > 1) {
        const badge = document.createElement('div');
        badge.className = 'pdfed-page-badge';
        badge.textContent = `Trang ${i} / ${pdf.numPages}`;
        pageEl.appendChild(badge);
      }

      pageEl.addEventListener('click', (e) => {
        if (!armedTool || e.target !== canvas) return;
        const rect = pageEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        addOverlayItem(pageEl, i - 1, x, y, armedTool);
        setArmed(null);
      });
    }

    // Nếu biểu mẫu đã có sẵn field_map (vị trí ký/điền đã lưu từ trước),
    // tự động đặt sẵn các ô đúng vị trí đó — không cần kéo-thả lại từ đầu.
    if (fieldMap && fieldMap.length > 0) {
      const pageEls = Array.from(body.querySelectorAll('.pdfed-page'));
      applyFieldMap(fieldMap, pageEls);
    }

    // Thanh điều hướng trang — chỉ hiện khi biểu mẫu có từ 2 trang trở lên,
    // giúp không phải cuộn dài tay trên điện thoại khi form nhiều trang.
    if (pdf.numPages > 1) {
      const pageNav = overlay.querySelector('#pdfedPageNav');
      const indicator = overlay.querySelector('#pdfedPageIndicator');
      const pageEls = Array.from(body.querySelectorAll('.pdfed-page'));
      let currentPageIdx = 0;
      pageNav.style.display = 'flex';

      function updateIndicator() {
        indicator.textContent = `Trang ${currentPageIdx + 1} / ${pdf.numPages}`;
        overlay.querySelector('#pdfedPrevPage').disabled = currentPageIdx === 0;
        overlay.querySelector('#pdfedNextPage').disabled = currentPageIdx === pdf.numPages - 1;
      }
      function goToPage(idx) {
        currentPageIdx = Math.max(0, Math.min(pdf.numPages - 1, idx));
        pageEls[currentPageIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
        updateIndicator();
      }
      overlay.querySelector('#pdfedPrevPage').addEventListener('click', () => goToPage(currentPageIdx - 1));
      overlay.querySelector('#pdfedNextPage').addEventListener('click', () => goToPage(currentPageIdx + 1));

      // Cập nhật số trang hiện tại theo đúng vị trí đang cuộn tới (không chỉ
      // theo nút bấm) — dùng IntersectionObserver, nhẹ và chính xác.
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            currentPageIdx = pageEls.indexOf(entry.target);
            updateIndicator();
          }
        });
      }, { root: body, threshold: 0.5 });
      pageEls.forEach((el) => observer.observe(el));

      updateIndicator();
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
      saveBtn.textContent = 'Lưu';
    }
  });
}