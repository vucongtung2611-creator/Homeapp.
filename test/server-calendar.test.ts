import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, houseOf, inviteToken, testServer } from './server-helpers.js';

type Ev = { id: string; title: string; date: string; time: string | null; endTime: string | null; people: string[]; tag: string | null; visibility: string; canEdit: boolean };

test('home calendar: add, see by month, who it is for, who sees and edits it', async () => {
  const server = await testServer();
  const { hid, clients, users } = await houseOf(server, ['Tom', 'Linh', 'An']);
  const [tom, linh, an] = clients;
  const url = `/api/households/${hid}/calendar`;
  const month = async (c: Client, from = '2026-10-01', to = '2026-10-31') => (await c.get(`${url}?from=${from}&to=${to}`)).data as { events: Ev[]; tags: string[]; canAdd: boolean };

  const school = await linh!.post(url, { title: 'Họp phụ huynh', date: '2026-10-07', time: '19:00', endTime: '20:30', people: [users[2]!.id], tag: 'Bin', note: 'Phòng 3B' });
  assert.equal(school.status, 201);
  assert.deepEqual([school.data.time, school.data.endTime, school.data.people, school.data.tag], ['19:00', '20:30', [users[2]!.id], 'Bin']);
  await tom!.post(url, { title: 'Partner meeting', date: '2026-10-03', time: '09:30', tag: 'Đối tác', visibility: 'managers' });
  await an!.post(url, { title: 'Sinh nhật mẹ', date: '2026-10-20' });
  await an!.post(url, { title: 'Quà bí mật', date: '2026-10-19', visibility: 'me' });
  await tom!.post(url, { title: 'Next month', date: '2026-11-02' });

  // Sorted by day then time; only this month; private and managers-only stay hidden.
  assert.deepEqual((await month(tom!)).events.map((e) => e.title), ['Partner meeting', 'Họp phụ huynh', 'Sinh nhật mẹ']);
  assert.deepEqual((await month(an!)).events.map((e) => e.title), ['Họp phụ huynh', 'Quà bí mật', 'Sinh nhật mẹ']);
  assert.deepEqual((await month(tom!)).tags, ['Bin', 'Đối tác']);
  assert.deepEqual((await month(tom!, '2026-10-07', '2026-10-07')).events.map((e) => e.title), ['Họp phụ huynh']);

  // Whoever added it, and owners or managers, can change it; others can't.
  const anView = (await month(an!)).events;
  assert.equal(anView.find((e) => e.title === 'Họp phụ huynh')!.canEdit, false);
  assert.equal((await an!.patch(`${url}/${school.data.id}`, { title: 'x' })).status, 403);
  const moved = await tom!.patch(`${url}/${school.data.id}`, { date: '2026-10-08' });
  assert.deepEqual([moved.data.date, moved.data.time, moved.data.tag], ['2026-10-08', '19:00', 'Bin'], 'unsent fields stay');
  assert.equal((await tom!.patch(`${url}/${school.data.id}`, { visibility: 'me' })).status, 403, 'only whoever added it decides who sees it');
  const cleared = await linh!.patch(`${url}/${school.data.id}`, { time: null, endTime: null });
  assert.deepEqual([cleared.data.time, cleared.data.endTime], [null, null]);

  // A private appointment can't even be found by others.
  const secret = (await month(an!)).events.find((e) => e.title === 'Quà bí mật')!;
  assert.equal((await tom!.del(`${url}/${secret.id}`)).status, 404);
  assert.equal((await an!.del(`${url}/${secret.id}`)).status, 200);

  // Bad input gets a clear reason.
  assert.equal((await tom!.post(url, { title: 'x' })).data.error, 'date_required');
  assert.equal((await tom!.post(url, { date: '2026-10-01' })).data.error, 'title_required');
  assert.equal((await tom!.post(url, { title: 'x', date: '2026-10-01', time: '25:00' })).data.error, 'time_invalid');
  assert.equal((await tom!.post(url, { title: 'x', date: '2026-10-01', time: '10:00', endTime: '09:00' })).data.error, 'endTime_invalid');
  assert.equal((await tom!.post(url, { title: 'x', date: '2026-10-01', people: ['u_nobody'] })).data.error, 'people_invalid');
  assert.equal((await tom!.post(url, { title: 'x', date: '2026-10-01', visibility: 'all' })).data.error, 'visibility_invalid');

  // Guests can look but not add.
  const grandma = new Client(server);
  await grandma.signup('Grandma');
  const { token } = await inviteToken(tom!, hid, { label: 'Grandma', role: 'guest', guestDays: 3 });
  await grandma.post(`/api/invites/${token}/accept`);
  const req = (await tom!.get(`/api/households/${hid}/requests`)).data.requests[0];
  await tom!.post(`/api/households/${hid}/requests/${req.id}/approve`);
  const guestView = await month(grandma);
  assert.equal(guestView.canAdd, false);
  assert.deepEqual(guestView.events.map((e) => e.title), ['Họp phụ huynh', 'Sinh nhật mẹ']);
  assert.equal((await grandma.post(url, { title: 'x', date: '2026-10-01' })).status, 403);

  // Outsiders get nothing.
  const stranger = new Client(server);
  await stranger.signup('Stranger');
  assert.equal((await stranger.get(url)).status, 404);

  // A home with appointments in it isn't "empty" any more.
  const solo = new Client(server);
  await solo.signup('Solo');
  const home = (await solo.post('/api/households', { name: 'Mine', currency: 'VND' })).data.id;
  assert.equal((await solo.get(`/api/households/${home}`)).data.canDelete, true);
  await solo.post(`/api/households/${home}/calendar`, { title: 'Dentist', date: '2026-10-09' });
  assert.equal((await solo.get(`/api/households/${home}`)).data.canDelete, false);
});
