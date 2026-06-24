const { google } = require('googleapis');

const TIMEZONE = 'America/Sao_Paulo';
const UTC_OFFSET = '-03:00'; // Brasília não observa horário de verão atualmente
const DEFAULT_DURATION_MIN = 120;

function getAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oAuth2Client;
}

function getCalendar() {
  return google.calendar({ version: 'v3', auth: getAuthClient() });
}

function calendarId() {
  return process.env.THERAPIST_CALENDAR_ID || 'primary';
}

function toRFC3339(date, time) {
  return `${date}T${time}:00${UTC_OFFSET}`;
}

function addMinutes(date, time, minutes) {
  const instant = new Date(toRFC3339(date, time));
  instant.setUTCMinutes(instant.getUTCMinutes() + minutes);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const map = {};
  for (const part of parts) map[part.type] = part.value;

  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}` };
}

function formatTimeFromISO(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
}

function formatDateFromISO(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('pt-BR', { timeZone: TIMEZONE });
}

async function listEventsForRange(startDate, endDate) {
  const calendar = getCalendar();
  const { data } = await calendar.events.list({
    calendarId: calendarId(),
    timeMin: toRFC3339(startDate, '00:00'),
    timeMax: toRFC3339(endDate, '23:59'),
    singleEvents: true,
    orderBy: 'startTime',
  });
  return data.items || [];
}

async function listEventsForDay(date) {
  return listEventsForRange(date, date);
}

async function checkAvailability(date, time, durationMinutes = DEFAULT_DURATION_MIN) {
  const events = await listEventsForDay(date);
  const start = new Date(toRFC3339(date, time)).getTime();
  const end = new Date(toRFC3339(...Object.values(addMinutes(date, time, durationMinutes)))).getTime();

  const conflict = events.find((ev) => {
    if (!ev.start?.dateTime || !ev.end?.dateTime) return false;
    const evStart = new Date(ev.start.dateTime).getTime();
    const evEnd = new Date(ev.end.dateTime).getTime();
    return start < evEnd && end > evStart;
  });

  return { available: !conflict, conflictingEvent: conflict || null };
}

async function suggestFreeSlots(date, fromTime = '08:00', count = 3, durationMinutes = DEFAULT_DURATION_MIN) {
  const slots = [];
  let cursor = fromTime;
  const endOfDay = '18:00';

  while (slots.length < count) {
    const { date: nextDate } = addMinutes(date, cursor, durationMinutes);
    if (nextDate !== date || cursor >= endOfDay) break;

    const { available } = await checkAvailability(date, cursor, durationMinutes);
    if (available) {
      slots.push(cursor);
      cursor = addMinutes(date, cursor, durationMinutes).time;
    } else {
      cursor = addMinutes(date, cursor, 10).time;
    }
  }

  return slots;
}

async function createEvent({ patientName, date, time, duration = DEFAULT_DURATION_MIN, notes }) {
  const calendar = getCalendar();
  const { date: endDate, time: endTime } = addMinutes(date, time, duration);

  const { data } = await calendar.events.insert({
    calendarId: calendarId(),
    requestBody: {
      summary: `Consulta: ${patientName}`,
      description: notes || '',
      start: { dateTime: toRFC3339(date, time), timeZone: TIMEZONE },
      end: { dateTime: toRFC3339(endDate, endTime), timeZone: TIMEZONE },
    },
  });

  return data;
}

async function findEventsByPatientAndDate(patientName, date) {
  const events = await listEventsForDay(date);
  const normalized = patientName.trim().toLowerCase();
  return events.filter((ev) => (ev.summary || '').toLowerCase().includes(normalized));
}

async function findUpcomingEventsByPatient(patientName, daysAhead = 60) {
  const today = todayISO();
  const until = addDaysISO(today, daysAhead);
  const events = await listEventsForRange(today, until);
  const normalized = patientName.trim().toLowerCase();
  return events.filter((ev) => (ev.summary || '').toLowerCase().includes(normalized));
}

async function cancelEvent(eventId) {
  const calendar = getCalendar();
  await calendar.events.delete({ calendarId: calendarId(), eventId });
}

async function rescheduleEvent(eventId, newDate, newTime, durationMinutes = DEFAULT_DURATION_MIN) {
  const calendar = getCalendar();
  const { date: endDate, time: endTime } = addMinutes(newDate, newTime, durationMinutes);

  const { data } = await calendar.events.patch({
    calendarId: calendarId(),
    eventId,
    requestBody: {
      start: { dateTime: toRFC3339(newDate, newTime), timeZone: TIMEZONE },
      end: { dateTime: toRFC3339(endDate, endTime), timeZone: TIMEZONE },
    },
  });

  return data;
}

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

function addDaysISO(date, days) {
  const d = new Date(`${date}T00:00:00${UTC_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  TIMEZONE,
  todayISO,
  addDaysISO,
  listEventsForRange,
  listEventsForDay,
  checkAvailability,
  suggestFreeSlots,
  createEvent,
  findEventsByPatientAndDate,
  findUpcomingEventsByPatient,
  cancelEvent,
  rescheduleEvent,
  formatTimeFromISO,
  formatDateFromISO,
  addMinutes,
};
