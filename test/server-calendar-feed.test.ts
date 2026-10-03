import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toIcs } from '../src/integrations/ics.js';
import { Client, houseOf, testServer } from './server-helpers.js';

const text = (data: unknown) => new TextDecoder().decode(data as ArrayBuffer);

test('ics: all-day and timed events, escaping, long lines folded', () => {
  const ics = toIcs('MATE · Nhà', [
    { id: 'a', title: 'Họp phụ huynh, lớp 3B; mang sổ', date: '2026-10-07', time: '19:00', endTime: '20:30', note: 'Phòng 3B\nTầng 2', people: ['Linh', 'Bin'], tag: 'Bin', updatedAt: '2026-10-01T10:00:00.000Z' },
    { id: 'b', title: 'Sinh nhật mẹ', date: '2026-12-31', time: null, endTime: null, note: '', people: [], tag: null, updatedAt: '2026-10-01T10:00:00.000Z' },
    { id: 'c', title: 'x'.repeat(200), date: '2026-10-08', time: '08:00', endTime: null, note: '', people: [], tag: null, updatedAt: '2026-10-01T10:00:00.000Z' },
  ]);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART:20261007T190000\r\nDTEND:20261007T203000'));
  assert.ok(ics.includes('SUMMARY:Họp phụ huynh\\, lớp 3B\\; mang sổ'));
  assert.ok(ics.includes('DESCRIPTION:👥 Linh\\, Bin\\n\\nPhòng 3B\\nTầng 2'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101'), 'all day ends the next day, across the year');
  assert.ok(ics.includes('DTSTART:20261008T080000\r\nDURATION:PT1H'));
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `folded: ${line.slice(0, 20)}`);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3);
});

test('calendar in other apps: .ics download and a secret, renewable subscription link', async () => {
  const server = await testServer();
  const { hid, clients, users } = await houseOf(server, ['Tom', 'Linh']);
  const [tom, linh] = clients;
  await tom!.post(`/api/households/${hid}/calendar`, { title: 'Dentist', date: '2026-10-09', time: '15:00' });
  await tom!.post(`/api/households/${hid}/calendar`, { title: 'Surprise party', date: '2026-10-10', visibility: 'me' });

  const file = await linh!.get(`/api/households/${hid}/calendar.ics`);
  assert.equal(file.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.match(file.headers.get('content-disposition') ?? '', /attachment; filename="mate-calendar.ics"/);
  assert.ok(text(file.data).includes('SUMMARY:Dentist'));
  assert.ok(!text(file.data).includes('Surprise party'), 'only what Linh may see');
  assert.equal((await new Client(server).get(`/api/households/${hid}/calendar.ics`)).status, 403);

  assert.deepEqual((await linh!.get(`/api/households/${hid}/calendar-feed`)).data.active, false);
  const made = await linh!.post(`/api/households/${hid}/calendar-feed`);
  assert.equal(made.status, 201);
  assert.match(made.data.url, /^http:\/\/localhost\/api\/feeds\/[A-Za-z0-9_-]{40,}\.ics$/);
  assert.ok(made.data.webcal.startsWith('webcal://localhost/api/feeds/'));
  const path = new URL(made.data.url).pathname;

  // No sign-in needed: calendar apps fetch it with the secret link alone.
  const anonymous = new Client(server);
  const feed = await anonymous.get(path);
  assert.equal(feed.status, 200);
  assert.ok(text(feed.data).includes('SUMMARY:Dentist') && !text(feed.data).includes('Surprise party'));
  const status = (await linh!.get(`/api/households/${hid}/calendar-feed`)).data;
  assert.equal(status.active, true);
  assert.ok(status.lastUsedAt);
  assert.equal((await anonymous.get('/api/feeds/not-a-real-token-at-all-xxxxxxxx.ics')).status, 404);

  // Making a new link turns the old one off; so does turning it off, or leaving the home.
  const again = await linh!.post(`/api/households/${hid}/calendar-feed`);
  assert.equal((await anonymous.get(path)).status, 404);
  const path2 = new URL(again.data.url).pathname;
  assert.equal((await anonymous.get(path2)).status, 200);
  await linh!.del(`/api/households/${hid}/calendar-feed`);
  assert.equal((await anonymous.get(path2)).status, 404);
  const path3 = new URL((await linh!.post(`/api/households/${hid}/calendar-feed`)).data.url).pathname;
  assert.equal((await tom!.del(`/api/households/${hid}/members/${users[1]!.id}`)).status, 200);
  assert.equal((await anonymous.get(path3)).status, 404);
});
