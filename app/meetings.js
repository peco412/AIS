import { bootShell } from '/js/shell.js';
import { supabase, esc } from '/js/supabase.js';
import { createGoogleMeetEvent } from '/js/googleCalendar.js';
import { attachPlaceAutocomplete } from '/js/googleMaps.js';

let GENERATED_MEET_LINK = null;
let GENERATED_EVENT_ID = null;

let PROFILE = null;
let ALL_EMPLOYEES = [];
let SELECTED_PARTICIPANTS = new Set();
let ALL_MEETINGS = [];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : ''; }

async function loadEmployees() {
  const { data } = await supabase.from('employees').select('id, full_name, email').neq('id', PROFILE.id).order('full_name');
  ALL_EMPLOYEES = data || [];
  renderPicker();
}

function renderPicker() {
  const filter = document.getElementById('participantFilter').value.trim().toLowerCase();
  const box = document.getElementById('participantPicker');
  const list = ALL_EMPLOYEES.filter((e) => !filter || e.full_name.toLowerCase().includes(filter));
  box.innerHTML = list.map((e) => `
    <label>
      <input type="checkbox" value="${e.id}" ${SELECTED_PARTICIPANTS.has(e.id) ? 'checked' : ''} />
      ${esc(e.full_name)}
    </label>
  `).join('') || '<div class="cell-muted">Không tìm thấy.</div>';

  box.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) SELECTED_PARTICIPANTS.add(cb.value); else SELECTED_PARTICIPANTS.delete(cb.value);
    });
  });
}
document.getElementById('participantFilter').addEventListener('input', renderPicker);

async function loadMeetings() {
  const list = document.getElementById('meetingList');
  list.innerHTML = '<div class="empty-cell">Đang tải dữ liệu...</div>';
  const scope = document.getElementById('viewScope').value;

  const { data: participantRows } = await supabase.from('meeting_participants').select('meeting_id').eq('employee_id', PROFILE.id);
  const myMeetingIds = (participantRows || []).map((r) => r.meeting_id);

  let query = supabase.from('meetings').select('*').order('meeting_date', { ascending: true });
  const { data, error } = await query;
  if (error) { list.innerHTML = `<div class="empty-cell">Lỗi: ${error.message}</div>`; return; }

  const today = new Date().toISOString().slice(0, 10);
  let rows = (data || []).filter((m) => m.created_by === PROFILE.id || myMeetingIds.includes(m.id));
  if (scope === 'mine') rows = rows.filter((m) => m.created_by === PROFILE.id);
  else if (scope === 'upcoming') rows = rows.filter((m) => m.meeting_date >= today);
  else if (scope === 'past') rows = rows.filter((m) => m.meeting_date < today);

  ALL_MEETINGS = rows;
  render();
}

function render() {
  document.getElementById('resultCount').textContent = `${ALL_MEETINGS.length} cuộc họp`;
  const list = document.getElementById('meetingList');
  if (ALL_MEETINGS.length === 0) { list.innerHTML = '<div class="empty-cell">Không có cuộc họp nào.</div>'; return; }

  list.innerHTML = ALL_MEETINGS.map((m) => `
    <div class="meeting-card">
      <h4>${esc(m.title)} ${m.kind === 'online' ? '🌐' : ''}</h4>
      <div class="meta">${fmtDate(m.meeting_date)} · ${esc(m.start_time?.slice(0,5))} - ${esc(m.end_time?.slice(0,5))} ${m.location ? '· 📍 ' + esc(m.location) : ''}</div>
      ${m.description ? `<div class="desc">${esc(m.description)}</div>` : ''}
      ${m.google_meet_link ? `<div style="margin-top:8px;"><a href="${esc(m.google_meet_link)}" target="_blank" class="btn btn-outline btn-sm">Vào Google Meet →</a></div>` : ''}
    </div>
  `).join('');
}

document.getElementById('viewScope').addEventListener('change', loadMeetings);

// ---------------------------------------------------------------------
// Tạo lịch họp
// ---------------------------------------------------------------------
const modal = document.getElementById('meetingModal');
const form = document.getElementById('meetingForm');
const formError = document.getElementById('formError');

document.getElementById('btnAdd').addEventListener('click', () => {
  form.reset();
  SELECTED_PARTICIPANTS = new Set();
  GENERATED_MEET_LINK = null;
  GENERATED_EVENT_ID = null;
  document.getElementById('meetLink').value = '';
  toggleKindFields();
  renderPicker();
  formError.classList.remove('show');
  modal.classList.add('show');
});

function toggleKindFields() {
  const isOnline = document.getElementById('kind').value === 'online';
  document.getElementById('locationField').style.display = isOnline ? 'none' : 'block';
  document.getElementById('meetLinkField').style.display = isOnline ? 'block' : 'none';
}
document.getElementById('kind').addEventListener('change', toggleKindFields);

document.getElementById('btnGenerateLink').addEventListener('click', async () => {
  formError.classList.remove('show');
  const title = document.getElementById('title').value.trim();
  const date = document.getElementById('meetingDate').value;
  const startTime = document.getElementById('startTime').value;
  const endTime = document.getElementById('endTime').value;
  if (!title || !date || !startTime || !endTime) {
    formError.textContent = 'Vui lòng điền Tiêu đề, Ngày, Giờ bắt đầu/kết thúc trước khi tạo link.';
    formError.classList.add('show');
    return;
  }

  const btn = document.getElementById('btnGenerateLink');
  btn.disabled = true; btn.textContent = 'Đang tạo...';
  try {
    const attendeeEmails = Array.from(SELECTED_PARTICIPANTS)
      .map((id) => ALL_EMPLOYEES.find((e) => e.id === id)?.email)
      .filter(Boolean);
    const { eventId, meetLink } = await createGoogleMeetEvent({
      title, description: document.getElementById('description').value,
      date, startTime, endTime, attendeeEmails,
    });
    GENERATED_MEET_LINK = meetLink;
    GENERATED_EVENT_ID = eventId;
    document.getElementById('meetLink').value = meetLink || 'Đã tạo sự kiện nhưng chưa có link Meet.';
  } catch (err) {
    formError.textContent = err.message || 'Không tạo được link Google Meet.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Tạo link';
  }
});

document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('cancelModal').addEventListener('click', () => modal.classList.remove('show'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.remove('show');

  const kind = document.getElementById('kind').value;
  if (kind === 'online' && !GENERATED_MEET_LINK) {
    formError.textContent = 'Vui lòng bấm "Tạo link" để sinh link Google Meet trước khi lưu.';
    formError.classList.add('show');
    return;
  }

  const btn = document.getElementById('submitMeeting');
  btn.disabled = true; btn.textContent = 'Đang tạo...';
  try {
    const { data: meeting, error } = await supabase.from('meetings').insert({
      kind,
      title: document.getElementById('title').value.trim(),
      description: document.getElementById('description').value || null,
      meeting_date: document.getElementById('meetingDate').value,
      start_time: document.getElementById('startTime').value,
      end_time: document.getElementById('endTime').value,
      location: kind === 'offline' ? (document.getElementById('location').value || null) : null,
      google_meet_link: kind === 'online' ? GENERATED_MEET_LINK : null,
      google_event_id: kind === 'online' ? GENERATED_EVENT_ID : null,
      created_by: PROFILE.id,
    }).select('id, title').single();
    if (error) throw error;

    const participantIds = Array.from(SELECTED_PARTICIPANTS);
    if (participantIds.length > 0) {
      await supabase.from('meeting_participants').insert(
        participantIds.map((id) => ({ meeting_id: meeting.id, employee_id: id }))
      );
      await supabase.from('notifications').insert(
        participantIds.map((id) => ({
          scope: 'personal', target_employee_id: id,
          title: `Bạn được mời họp: ${meeting.title}`,
          content: `Vào lúc ${document.getElementById('startTime').value} ngày ${document.getElementById('meetingDate').value}.`,
          created_by: PROFILE.id,
        }))
      );
    }

    modal.classList.remove('show');
    await loadMeetings();
  } catch (err) {
    formError.textContent = err.message || 'Có lỗi xảy ra.';
    formError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Tạo lịch họp';
  }
});

(async () => {
  try {
    const { profile } = await bootShell();
    PROFILE = profile;
    attachPlaceAutocomplete(document.getElementById('location'));
    await loadEmployees();
    await loadMeetings();
  } catch (e) { /* bootShell tự điều hướng */ }
})();
