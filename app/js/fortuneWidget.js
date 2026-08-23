// =====================================================================
// WIDGET TỬ VI / XIN QUẺ (mới, 22/08/2026) — thuần vui/giải trí, tăng
// tính tương tác trên Trang chủ, không gọi API/bảng dữ liệu nào, toàn bộ
// nội dung random phía JS. Tách file riêng để không làm phình
// worldSelect.js vốn đã rất dài.
// =====================================================================

const ZODIAC_SIGNS = [
  { name: 'Ma Kết', icon: '♑', from: [12, 22], to: [1, 19] },
  { name: 'Bảo Bình', icon: '♒', from: [1, 20], to: [2, 18] },
  { name: 'Song Ngư', icon: '♓', from: [2, 19], to: [3, 20] },
  { name: 'Bạch Dương', icon: '♈', from: [3, 21], to: [4, 19] },
  { name: 'Kim Ngưu', icon: '♉', from: [4, 20], to: [5, 20] },
  { name: 'Song Tử', icon: '♊', from: [5, 21], to: [6, 20] },
  { name: 'Cự Giải', icon: '♋', from: [6, 21], to: [7, 22] },
  { name: 'Sư Tử', icon: '♌', from: [7, 23], to: [8, 22] },
  { name: 'Xử Nữ', icon: '♍', from: [8, 23], to: [9, 22] },
  { name: 'Thiên Bình', icon: '♎', from: [9, 23], to: [10, 22] },
  { name: 'Thiên Yết', icon: '♏', from: [10, 23], to: [11, 21] },
  { name: 'Nhân Mã', icon: '♐', from: [11, 22], to: [12, 21] },
];

function getZodiacSign(dob) {
  const d = new Date(dob);
  const month = d.getUTCMonth() + 1, day = d.getUTCDate();
  return ZODIAC_SIGNS.find((z) => {
    const fm = z.from[0], fd = z.from[1], tm = z.to[0], td = z.to[1];
    if (fm === tm) return month === fm && day >= fd && day <= td;
    if (fm < tm) return (month === fm && day >= fd) || (month === tm && day <= td) || (month > fm && month < tm);
    // Ma Kết vắt qua năm mới (22/12 - 19/1)
    return (month === fm && day >= fd) || (month === tm && day <= td);
  }) || ZODIAC_SIGNS[0];
}

const HOROSCOPE_POOL = [
  'Hôm nay là ngày hợp để bắt đầu 1 việc mới — đừng ngại đề xuất ý tưởng của bạn.',
  'Năng lượng dồi dào, thích hợp để giải quyết những việc còn tồn đọng lâu nay.',
  'Một tin vui nho nhỏ có thể đến từ đồng nghiệp thân thiết — hãy để ý xung quanh.',
  'Hôm nay nên ưu tiên lắng nghe hơn là tranh luận, mọi việc sẽ suôn sẻ hơn.',
  'Vận may tài chính khá ổn — nhưng vẫn nên cân nhắc kỹ trước khi chi tiêu lớn.',
  'Thích hợp để kết nối lại với 1 người bạn/đồng nghiệp lâu ngày chưa liên lạc.',
  'Sự kiên nhẫn hôm nay sẽ được đền đáp — đừng vội vàng với những quyết định lớn.',
  'Một chút sáng tạo sẽ giúp công việc hôm nay trôi chảy hơn bình thường.',
  'Ngày phù hợp để nghỉ ngơi, nạp lại năng lượng cho những ngày bận rộn sắp tới.',
  'Cẩn thận lời ăn tiếng nói hôm nay — dễ bị hiểu lầm nếu không rõ ràng.',
  'Cơ hội hợp tác mới có thể xuất hiện — hãy cởi mở đón nhận.',
  'Sức khoẻ cần được chú ý hơn 1 chút — đừng quên nghỉ ngơi giữa giờ làm.',
];

function renderHoroscope(dob) {
  const body = document.getElementById('fortuneBody');
  if (!body) return;
  if (!dob) {
    body.innerHTML = '<div class="fortune-result"><div class="fortune-result__icon">❓</div><div class="fortune-result__text">Hồ sơ của bạn chưa có ngày sinh nên chưa xem được tử vi. Cập nhật ở trang Hồ sơ cá nhân nhé!</div></div>';
    return;
  }
  const zodiac = getZodiacSign(dob);
  const zIdx = ZODIAC_SIGNS.indexOf(zodiac);
  const dayKey = new Date().toISOString().slice(0, 10); // yyyy-mm-dd — cùng ngày ra cùng câu, sang ngày mới sẽ đổi
  let seed = 0;
  const seedSrc = dayKey + zIdx;
  for (let i = 0; i < seedSrc.length; i++) seed = (seed * 31 + seedSrc.charCodeAt(i)) % 100000;
  const msg = HOROSCOPE_POOL[seed % HOROSCOPE_POOL.length];
  body.innerHTML = `
    <div class="fortune-result">
      <div class="fortune-result__icon">${zodiac.icon}</div>
      <div class="fortune-result__level">${zodiac.name}</div>
      <div class="fortune-result__text">${msg}</div>
    </div>
  `;
}

const QUE_XAM_POOL = [
  { level: '🀄 Thượng Thượng — Đại cát', text: 'Vạn sự như ý, việc gì cũng thuận. Đây là lúc tốt để tiến hành những dự định ấp ủ đã lâu.' },
  { level: '🎋 Thượng — Cát', text: 'Công việc hanh thông, quý nhân phù trợ. Cứ mạnh dạn tiến bước.' },
  { level: '🍀 Trung Bình — Bình an', text: 'Mọi việc diễn ra bình thường, không có gì đột biến. Giữ vững phong độ hiện tại là tốt nhất.' },
  { level: '🌿 Trung — Cẩn thận', text: 'Có chút trở ngại nhỏ nhưng không đáng ngại, chỉ cần kiên trì sẽ vượt qua.' },
  { level: '⛅ Hạ — Nên thận trọng', text: 'Không nên vội vàng quyết định việc lớn lúc này, hãy quan sát thêm trước khi hành động.' },
  { level: '🌤️ Trung Cát — Hoà hợp', text: 'Thời điểm tốt để hàn gắn quan hệ, hợp tác cùng người khác sẽ mang lại kết quả tốt.' },
  { level: '🎐 Thượng — Tài lộc', text: 'Tài vận đang lên, nhưng chi tiêu vẫn nên có kế hoạch để giữ được lâu dài.' },
];

function renderQueXam() {
  const body = document.getElementById('fortuneBody');
  if (!body) return;
  const q = QUE_XAM_POOL[Math.floor(Math.random() * QUE_XAM_POOL.length)];
  body.innerHTML = `
    <div class="fortune-result">
      <div class="fortune-result__icon">🎋</div>
      <div class="fortune-result__level">${q.level}</div>
      <div class="fortune-result__text">${q.text}</div>
    </div>
    <button type="button" class="fortune-redraw" id="btnRedrawQue">🎲 Xin quẻ khác</button>
  `;
  document.getElementById('btnRedrawQue').addEventListener('click', renderQueXam);
}

export function initFortuneWidget(dob) {
  const fab = document.getElementById('fortuneFab');
  const popup = document.getElementById('fortunePopup');
  if (!fab || !popup) return;

  fab.addEventListener('click', () => {
    popup.classList.toggle('show');
    if (popup.classList.contains('show')) {
      const activeTab = document.querySelector('.fortune-tab.is-active');
      if (activeTab?.dataset.tab === 'quẻ') renderQueXam(); else renderHoroscope(dob);
    }
  });
  document.getElementById('fortuneClose').addEventListener('click', () => popup.classList.remove('show'));
  document.querySelectorAll('.fortune-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.fortune-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      if (tab.dataset.tab === 'quẻ') renderQueXam(); else renderHoroscope(dob);
    });
  });
  // Bấm ra ngoài popup thì tự đóng lại — đúng hành vi popup thông thường.
  document.addEventListener('click', (e) => {
    if (popup.classList.contains('show') && !popup.contains(e.target) && e.target !== fab) popup.classList.remove('show');
  });
}
