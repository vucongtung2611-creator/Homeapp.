/**
 * iCalendar (RFC 5545) for the home calendar, so Google Calendar, Apple
 * Calendar and Outlook can show it — as a one-off .ics file or a
 * subscription they refresh by themselves. Times are "floating" (no time
 * zone): 19:00 stays 19:00 wherever the calendar is opened, like on the
 * fridge.
 */
export interface IcsEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm, or null for all day */
  time: string | null;
  endTime: string | null;
  note: string;
  /** Who it's for, as names. */
  people: string[];
  tag: string | null;
  updatedAt: string;
}

const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 bytes are folded (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  for (const ch of line) {
    if (bytes.encode(current + ch).length > (out.length ? 74 : 75)) {
      out.push(current);
      current = ch;
    } else current += ch;
  }
  out.push(current);
  return out.join('\r\n ');
}

const compactDate = (iso: string) => iso.replace(/-/g, '');
const nextDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const n = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return n.toISOString().slice(0, 10);
};
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function toIcs(calendarName: string, events: IcsEvent[], now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MATE//Home calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(calendarName)}`,
    // Ask subscribers to check back every few hours (most apps decide for themselves).
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
  ];
  for (const e of events) {
    const description = [e.people.length ? `👥 ${e.people.join(', ')}` : '', e.note].filter(Boolean).join('\n\n');
    lines.push('BEGIN:VEVENT', `UID:${e.id}@mate`, `DTSTAMP:${stamp(e.updatedAt || now.toISOString())}`);
    if (e.time) {
      const start = `${compactDate(e.date)}T${e.time.replace(':', '')}00`;
      lines.push(`DTSTART:${start}`);
      if (e.endTime) lines.push(`DTEND:${compactDate(e.date)}T${e.endTime.replace(':', '')}00`);
      else lines.push('DURATION:PT1H');
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${compactDate(nextDay(e.date))}`);
    }
    lines.push(`SUMMARY:${escape(e.title)}`);
    if (description) lines.push(`DESCRIPTION:${escape(description)}`);
    if (e.tag) lines.push(`CATEGORIES:${escape(e.tag)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
