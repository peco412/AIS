// =====================================================================
// GOOGLE CALENDAR — tự sinh sự kiện + link Google Meet cho lịch họp trực tuyến
// =====================================================================
// CẤU HÌNH BẮT BUỘC trước khi dùng:
// 1. Vào https://console.cloud.google.com/ → tạo OAuth Client ID loại
//    "Web application", thêm domain deploy (vd. https://your-app.vercel.app)
//    vào "Authorized JavaScript origins".
// 2. Bật "Google Calendar API" cho project đó.
// 3. Điền GOOGLE_CLIENT_ID bên dưới (an toàn để public trên frontend,
//    đây là OAuth Client ID chứ không phải secret).
// =====================================================================

const GOOGLE_CLIENT_ID = window.__ENV__?.GOOGLE_CLIENT_ID || '799232695798-k3cto6uncd7a96ml51ds6jcfnnehhcq1.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

let gisLoaded = null;
let tokenClient = null;
let accessToken = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Không tải được ' + src));
    document.head.appendChild(s);
  });
}

async function ensureGis() {
  if (!gisLoaded) {
    gisLoaded = loadScript('https://accounts.google.com/gsi/client');
  }
  await gisLoaded;
}

/**
 * Yêu cầu người dùng đăng nhập Google (popup) và trả về access token.
 * Token chỉ tồn tại trong phiên hiện tại, không lưu lại (an toàn hơn).
 */
export async function requestGoogleAccessToken() {
  await ensureGis();
  return new Promise((resolve, reject) => {
    if (GOOGLE_CLIENT_ID.startsWith('YOUR-')) {
      reject(new Error('Chưa cấu hình GOOGLE_CLIENT_ID trong js/googleCalendar.js'));
      return;
    }
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error) { reject(new Error(resp.error)); return; }
          accessToken = resp.access_token;
          resolve(accessToken);
        },
      });
    }
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

/**
 * Tạo sự kiện Google Calendar kèm Google Meet, trả về { eventId, meetLink }.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.description
 * @param {string} opts.date - 'yyyy-mm-dd'
 * @param {string} opts.startTime - 'HH:mm'
 * @param {string} opts.endTime - 'HH:mm'
 * @param {string[]} [opts.attendeeEmails] - danh sách email người được mời
 */
export async function createGoogleMeetEvent({ title, description, date, startTime, endTime, attendeeEmails = [] }) {
  const token = accessToken || await requestGoogleAccessToken();

  const body = {
    summary: title,
    description: description || '',
    start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Ho_Chi_Minh' },
    end: { dateTime: `${date}T${endTime}:00`, timeZone: 'Asia/Ho_Chi_Minh' },
    attendees: attendeeEmails.map((email) => ({ email })),
    conferenceData: {
      createRequest: { requestId: 'ais-' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
  };

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Không tạo được sự kiện Google Calendar.');
  }

  const event = await res.json();
  return {
    eventId: event.id,
    meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || null,
  };
}
