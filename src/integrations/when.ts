/**
 * Spot a day (and maybe a time) in a chat message, so the app can offer
 * "Add to the home calendar". Rule-based and small on purpose: it only
 * answers when a day is clearly named — "tomorrow 7pm", "thứ 6 lúc 19h",
 * "7/10", "demain à 18h", "am Freitag um 8", "zaterdag 10:30".
 * No Node dependencies: the browser uses the same code.
 */
export interface When {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm, when a time was given */
  time?: string;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Weekday words → 0 (Sunday) … 6 (Saturday). Vietnamese "thứ 2" … "thứ 7" handled separately. */
const WEEKDAYS: [RegExp, number][] = [
  [/\b(sunday|sun|chu nhat|cn|dimanche|sonntag|zondag)\b/, 0],
  [/\b(monday|mon|lundi|montag|maandag)\b/, 1],
  [/\b(tuesday|tue|tues|mardi|dienstag|dinsdag)\b/, 2],
  [/\b(wednesday|wed|mercredi|mittwoch|woensdag)\b/, 3],
  [/\b(thursday|thu|thurs|jeudi|donnerstag|donderdag)\b/, 4],
  [/\b(friday|fri|vendredi|freitag|vrijdag)\b/, 5],
  [/\b(saturday|sat|samedi|samstag|zaterdag)\b/, 6],
];

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janvier: 1, januar: 1, januari: 1,
  feb: 2, february: 2, fevrier: 2, februar: 2, februari: 2,
  mar: 3, march: 3, mars: 3, marz: 3, maart: 3,
  apr: 4, april: 4, avril: 4,
  may: 5, mai: 5, mei: 5,
  jun: 6, june: 6, juin: 6, juni: 6,
  jul: 7, july: 7, juillet: 7, juli: 7,
  aug: 8, august: 8, aout: 8, augustus: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10, oktober: 10, okt: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12, dezember: 12, dez: 12,
};

function validDate(y: number, m: number, d: number): Date | undefined {
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : undefined;
}

/** The next date with this day/month (this year, or next year if it has passed). */
function upcoming(now: Date, month: number, day: number, year?: number): Date | undefined {
  if (year) return validDate(year < 100 ? 2000 + year : year, month, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisYear = validDate(now.getFullYear(), month, day);
  if (thisYear && thisYear >= today) return thisYear;
  return validDate(now.getFullYear() + 1, month, day);
}

function findDay(s: string, now: Date): Date | undefined {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Day after tomorrow first ("ngày kia", "overmorgen"…), then tomorrow, then today.
  if (/\b(day after tomorrow|ngay kia|ngay mot|apres-demain|apres demain|ubermorgen|overmorgen)\b/.test(s)) return addDays(today, 2);
  if (/\b(tomorrow|ngay mai|sang mai|toi mai|chieu mai|demain|morgen)\b/.test(s)) return addDays(today, 1);
  if (/\b(today|tonight|this evening|hom nay|toi nay|chieu nay|sang nay|aujourd'hui|ce soir|heute|heute abend|vandaag|vanavond)\b/.test(s)) return today;

  // 7/10, 07/10/2026, 7-10, 7.10.26 (day first)
  const dm = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?\b/.exec(s);
  if (dm) {
    const date = upcoming(now, Number(dm[2]), Number(dm[1]), dm[3] ? Number(dm[3]) : undefined);
    if (date) return date;
  }
  // "7 thang 10", "ngay 7 thang 10"
  const vi = /\b(\d{1,2})\s*thang\s*(\d{1,2})\b/.exec(s);
  if (vi) {
    const date = upcoming(now, Number(vi[2]), Number(vi[1]));
    if (date) return date;
  }
  // "7 oct", "7. Oktober", "oct 7"
  const dMonth = /\b(\d{1,2})\.?\s+([a-z]{3,9})\b/.exec(s);
  if (dMonth && MONTHS[dMonth[2]!]) return upcoming(now, MONTHS[dMonth[2]!]!, Number(dMonth[1]));
  const monthD = /\b([a-z]{3,9})\s+(\d{1,2})\b/.exec(s);
  if (monthD && MONTHS[monthD[1]!]) return upcoming(now, MONTHS[monthD[1]!]!, Number(monthD[2]));

  // Weekdays: Vietnamese "thứ 2" … "thứ 7" / "thứ hai" …, then named days. Next occurrence, today included.
  const viDay = /\bthu\s*(2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)\b/.exec(s);
  const viMap: Record<string, number> = { '2': 1, hai: 1, '3': 2, ba: 2, '4': 3, tu: 3, '5': 4, nam: 4, '6': 5, sau: 5, '7': 6, bay: 6 };
  let weekday = viDay ? viMap[viDay[1]!] : undefined;
  if (weekday === undefined) for (const [re, n] of WEEKDAYS) if (re.test(s)) weekday = n;
  if (weekday !== undefined) return addDays(today, (weekday - today.getDay() + 7) % 7);
  return undefined;
}

function findTime(s: string): string | undefined {
  // 19:00, 7:30pm, 19h30, 7h, 7 gio, 7pm, 8 uhr, um 8, à 18h
  const m =
    /\b(\d{1,2})(?::|h|\.)(\d{2})\s*(am|pm)?\b/.exec(s) ??
    /\b(\d{1,2})\s*(?:h|gio|g|uhr)\b(?:\s*(sang|trua|chieu|toi|dem))?/.exec(s) ??
    /\b(\d{1,2})\s*(am|pm)\b/.exec(s) ??
    /\b(?:at|um|a|om|luc)\s+(\d{1,2})\b(?!\s*[/.-]\d)/.exec(s);
  if (!m) return undefined;
  let h = Number(m[1]);
  const minutes = m[2] && /^\d{2}$/.test(m[2]) ? Number(m[2]) : 0;
  const suffix = [m[2], m[3]].find((x) => x && !/^\d+$/.test(x));
  if (suffix === 'pm' && h < 12) h += 12;
  if (suffix === 'am' && h === 12) h = 0;
  // Vietnamese parts of the day: "7 giờ tối" = 19:00, "2 giờ chiều" = 14:00.
  if ((suffix === 'chieu' || suffix === 'toi' || suffix === 'dem') && h < 12) h += 12;
  if (/\b(toi|tonight|ce soir|abend|avond|vanavond)\b/.test(s) && !suffix && h >= 1 && h < 12) h += 12;
  if (h > 23 || minutes > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** A date (and time, if any) named in the text, or undefined. */
export function detectWhen(text: string, now: Date = new Date()): When | undefined {
  const s = fold(text);
  const day = findDay(s, now);
  if (!day) return undefined;
  const time = findTime(s.replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, ' '));
  return time ? { date: iso(day), time } : { date: iso(day) };
}
