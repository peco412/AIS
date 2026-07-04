// =====================================================================
// GOOGLE MAPS — tự động đo quãng đường cho Đơn công tác (Distance Matrix)
// =====================================================================
// CẤU HÌNH BẮT BUỘC trước khi dùng:
// 1. Vào https://console.cloud.google.com/ -> bật "Maps JavaScript API"
//    và "Places API" cho project.
// 2. Tạo API key, giới hạn (restrict) theo domain deploy (HTTP referrer)
//    để tránh bị người khác lấy key dùng ké — đây là API key public phía
//    frontend, KHÔNG phải secret, tương tự Google Client ID ở googleCalendar.js.
// 3. Điền GOOGLE_MAPS_API_KEY bên dưới (hoặc qua window.__ENV__ khi deploy).
//
// LƯU Ý: Distance Matrix REST API (server-side) chặn CORS khi gọi thẳng
// từ trình duyệt, nên bắt buộc dùng Maps JavaScript SDK (DistanceMatrixService)
// như dưới đây, không gọi fetch() trực tiếp tới maps.googleapis.com.
// =====================================================================

const GOOGLE_MAPS_API_KEY = window.__ENV__?.GOOGLE_MAPS_API_KEY || 'YOUR-GOOGLE-MAPS-API-KEY';

let mapsLoaded = null;

function loadMapsScript() {
  if (!mapsLoaded) {
    mapsLoaded = new Promise((resolve, reject) => {
      if (window.google?.maps?.DistanceMatrixService) { resolve(); return; }
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Không tải được Google Maps API. Kiểm tra lại API key.'));
      document.head.appendChild(s);
    });
  }
  return mapsLoaded;
}

/**
 * Gắn Google Places Autocomplete vào 1 ô input text, giúp người dùng chọn
 * đúng địa điểm thay vì gõ tay tự do (đúng ý "nhập đúng vị trí thông qua map").
 */
export async function attachPlaceAutocomplete(inputEl) {
  try {
    await loadMapsScript();
    if (!window.google?.maps?.places) return;
    new google.maps.places.Autocomplete(inputEl, { fields: ['formatted_address', 'name'] });
  } catch (e) {
    console.warn('Không bật được Places Autocomplete:', e.message);
  }
}

/**
 * Tính quãng đường lái xe (km) giữa 2 địa chỉ dạng text.
 * Trả về null nếu không tính được (API lỗi, thiếu key, không tìm thấy tuyến).
 */
export async function computeDrivingDistanceKm(originText, destinationText) {
  if (!originText || !destinationText) return null;
  try {
    await loadMapsScript();
    if (!window.google?.maps?.DistanceMatrixService) return null;

    const service = new google.maps.DistanceMatrixService();
    const result = await new Promise((resolve, reject) => {
      service.getDistanceMatrix({
        origins: [originText],
        destinations: [destinationText],
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.METRIC,
      }, (response, status) => {
        if (status === 'OK') resolve(response);
        else reject(new Error('Không tính được quãng đường (status: ' + status + ')'));
      });
    });

    const element = result.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') return null;
    return Math.round((element.distance.value / 1000) * 10) / 10; // mét -> km, làm tròn 1 số lẻ
  } catch (e) {
    console.warn('computeDrivingDistanceKm lỗi:', e.message);
    return null;
  }
}
