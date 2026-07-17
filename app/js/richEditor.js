// =====================================================================
// SOẠN THẢO VĂN BẢN TỰ DO — bản đầu tiên (demo), đi kèm "Ký tự do".
// Cho phép gõ 1 văn bản mới hoàn toàn (không cần có sẵn file PDF mẫu),
// định dạng cơ bản kiểu Word (đậm/nghiêng/gạch chân, tiêu đề, danh sách),
// rồi "Xuất PDF & Ký" — chuyển đúng sang luồng ký số ĐÃ CÓ SẴN
// (openPdfEditor trong pdfEditor.js), không làm lại phần ký/lưu trữ.
//
// GIỚI HẠN Ở BẢN NÀY (nói rõ để không hiểu nhầm là đã hoàn thiện):
// - Dùng document.execCommand() để định dạng — cách làm đơn giản, chạy
//   tốt trên Chrome/Edge/Safari (trình duyệt chính dùng trong hệ thống),
//   nhưng đây là API cũ, một số trình duyệt tương lai có thể ngừng hỗ trợ.
//   Nếu cần bền hơn, bước sau nên chuyển sang 1 thư viện soạn thảo thật
//   (vd Quill) — bản demo này ưu tiên chạy được ngay, ít phụ thuộc.
// - Xuất PDF bằng cách CHỤP ẢNH trang giấy (html2canvas) rồi nhúng ảnh
//   vào PDF (jsPDF) — chữ trong PDF là ẢNH, không phải chữ thật (không
//   copy/paste hay tìm kiếm được trong PDF). Đủ dùng để ký + lưu trữ,
//   nhưng nếu cần PDF với chữ thật (nhẹ hơn, copy được), cần nâng cấp
//   sang cách dựng PDF trực tiếp từ nội dung — phức tạp hơn nhiều.
// - Chưa lưu nháp giữa chừng — đóng trình soạn thảo là mất nội dung chưa
//   xuất PDF. Nếu cần "lưu nháp, quay lại sửa tiếp sau" cần thêm 1 bảng
//   dữ liệu riêng để lưu — chưa làm ở bản demo này.
// =====================================================================

const HTML2CANVAS_VERSION = '1.4.1';
const JSPDF_VERSION = '2.5.1';

let html2canvasReady = null;
let jspdfReady = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Không tải được ' + src));
    document.head.appendChild(s);
  });
}

async function ensureExportLibs() {
  if (!html2canvasReady) {
    html2canvasReady = (async () => {
      if (!window.html2canvas) {
        await loadScript(`https://cdnjs.cloudflare.com/ajax/libs/html2canvas/${HTML2CANVAS_VERSION}/html2canvas.min.js`);
      }
    })();
  }
  if (!jspdfReady) {
    jspdfReady = (async () => {
      if (!window.jspdf) {
        await loadScript(`https://cdnjs.cloudflare.com/ajax/libs/jspdf/${JSPDF_VERSION}/jspdf.umd.min.js`);
      }
    })();
  }
  await Promise.all([html2canvasReady, jspdfReady]);
}

const TOOLBAR_ICONS = {
  bold: '<svg viewBox="0 0 24 24"><path d="M6 4h7a4 4 0 0 1 0 8H6z"/><path d="M6 12h8a4 4 0 0 1 0 8H6z"/></svg>',
  italic: '<svg viewBox="0 0 24 24"><path d="M11 4h6M5 20h6M14 4L9 20"/></svg>',
  underline: '<svg viewBox="0 0 24 24"><path d="M6 4v7a6 6 0 0 0 12 0V4"/><path d="M4 20h16"/></svg>',
  ul: '<svg viewBox="0 0 24 24"><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/><path d="M9 6h11M9 12h11M9 18h11"/></svg>',
  ol: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h1M4 6v3M4.5 14h1.2c.5 0 .8-.4.6-.9L4.5 15.5h1.6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h13"/></svg>',
  center: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M5.5 18h13"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/**
 * Mở trình soạn thảo văn bản tự do.
 * @param {Object} opts
 * @param {string} [opts.title] - Tiêu đề hiện trên toolbar.
 * @param {(pdfBlob: Blob) => Promise<void>} opts.onExportPdf - Gọi khi bấm "Xuất PDF & Ký", nhận vào PDF đã tạo.
 */
export function openRichEditor({ title = 'Soạn thảo văn bản', onExportPdf }) {
  const overlay = document.createElement('div');
  overlay.className = 'rted-overlay';
  overlay.innerHTML = `
    <div class="rted-toolbar">
      <span class="title">${title}</span>
      <button type="button" data-cmd="bold" title="Đậm (Ctrl+B)">${TOOLBAR_ICONS.bold}</button>
      <button type="button" data-cmd="italic" title="Nghiêng (Ctrl+I)">${TOOLBAR_ICONS.italic}</button>
      <button type="button" data-cmd="underline" title="Gạch chân (Ctrl+U)">${TOOLBAR_ICONS.underline}</button>
      <div class="sep"></div>
      <select data-cmd="formatBlock" title="Kiểu chữ">
        <option value="p">Văn bản thường</option>
        <option value="h1">Tiêu đề văn bản</option>
        <option value="h2">Đề mục</option>
      </select>
      <div class="sep"></div>
      <button type="button" data-cmd="insertUnorderedList" title="Danh sách gạch đầu dòng">${TOOLBAR_ICONS.ul}</button>
      <button type="button" data-cmd="insertOrderedList" title="Danh sách đánh số">${TOOLBAR_ICONS.ol}</button>
      <div class="sep"></div>
      <button type="button" data-cmd="justifyLeft" title="Căn trái">${TOOLBAR_ICONS.left}</button>
      <button type="button" data-cmd="justifyCenter" title="Căn giữa">${TOOLBAR_ICONS.center}</button>
      <div class="sep"></div>
      <button type="button" data-cmd="undo" title="Hoàn tác (Ctrl+Z)">${TOOLBAR_ICONS.undo}</button>
      <span class="spacer"></span>
      <span class="hint">Bản soạn thảo — chưa lưu nháp, nhớ xuất PDF trước khi đóng</span>
      <button type="button" class="primary" id="rtedExport">Xuất PDF &amp; Ký</button>
      <button type="button" id="rtedClose" title="Đóng">${TOOLBAR_ICONS.close}</button>
    </div>
    <div class="rted-body">
      <div class="rted-page" id="rtedPage" contenteditable="true" data-placeholder="Bắt đầu gõ nội dung văn bản ở đây..."></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const page = overlay.querySelector('#rtedPage');
  page.focus();

  overlay.querySelectorAll('button[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      page.focus();
      document.execCommand(btn.dataset.cmd, false, null);
    });
  });
  overlay.querySelector('select[data-cmd]').addEventListener('change', (e) => {
    page.focus();
    document.execCommand('formatBlock', false, e.target.value);
  });

  function close() {
    overlay.remove();
  }
  overlay.querySelector('#rtedClose').addEventListener('click', () => {
    if (page.textContent.trim() && !confirm('Đóng trình soạn thảo? Nội dung chưa xuất PDF sẽ bị mất.')) return;
    close();
  });

  overlay.querySelector('#rtedExport').addEventListener('click', async () => {
    if (!page.textContent.trim()) {
      alert('Vui lòng nhập nội dung văn bản trước khi xuất PDF.');
      return;
    }
    const btn = overlay.querySelector('#rtedExport');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Đang tạo PDF...';
    try {
      await ensureExportLibs();

      const canvas = await window.html2canvas(page, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageWidthMm = 210;
      const pageHeightMm = 297;
      const imgHeightMm = (canvas.height * pageWidthMm) / canvas.width;

      if (imgHeightMm <= pageHeightMm) {
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageWidthMm, imgHeightMm);
      } else {
        // Noi dung dai hon 1 trang A4 -> cat canvas thanh nhieu trang theo
        // dung chieu cao thuc, khong bop mo hay cat cut giua dong chu.
        const pxPerMm = canvas.width / pageWidthMm;
        const pageHeightPx = Math.floor(pageHeightMm * pxPerMm);
        let renderedPx = 0;
        let firstPage = true;
        while (renderedPx < canvas.height) {
          const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceHeightPx;
          const ctx = sliceCanvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
          if (!firstPage) pdf.addPage();
          pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageWidthMm, (sliceHeightPx * pageWidthMm) / canvas.width);
          renderedPx += sliceHeightPx;
          firstPage = false;
        }
      }

      const pdfBlob = pdf.output('blob');
      await onExportPdf(pdfBlob);
      close();
    } catch (err) {
      alert('Không tạo được PDF: ' + (err.message || 'Có lỗi xảy ra.'));
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });
}
