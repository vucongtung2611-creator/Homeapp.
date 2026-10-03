import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, houseOf, inviteToken, testServer } from './server-helpers.js';

type Chore = { id: string; title: string; current: string | null; currentName: string | null; due: string | null; done: boolean; repeatDays: number | null; lastDoneBy: string | null; canEdit: boolean };

test('chores: taking turns, repeats, one-offs, who may change them', async () => {
  const server = await testServer();
  const { hid, clients, users } = await houseOf(server, ['Tom', 'Linh', 'An']);
  const [tom, linh, an] = clients;
  const [tomU, linhU, anU] = users;
  const url = `/api/households/${hid}/chores`;
  const list = async (c: Client = tom!) => (await c.get(url)).data.chores as Chore[];

  const bins = await linh!.post(url, { title: 'Đổ rác', assignees: [linhU!.id, anU!.id, tomU!.id], repeatDays: 7, today: '2026-10-05' });
  assert.equal(bins.status, 201);
  assert.deepEqual([bins.data.currentName, bins.data.due, bins.data.repeatDays], ['Linh', '2026-10-05', 7], 'a repeating chore is due from today');
  const wifi = await tom!.post(url, { title: 'Đổi mật khẩu wifi', repeatDays: 90, due: '2026-12-01' });
  assert.deepEqual([wifi.data.current, wifi.data.due], [null, '2026-12-01'], 'no one in particular');
  const fix = await an!.post(url, { title: 'Sửa vòi nước', assignees: [anU!.id] });
  assert.equal(fix.data.due, null);

  // Ticking a repeating chore passes it on and brings it back in 7 days.
  const done1 = await an!.post(`${url}/${bins.data.id}/done`, { today: '2026-10-06' });
  assert.deepEqual([done1.data.currentName, done1.data.due, done1.data.lastDoneBy], ['An', '2026-10-13', 'An']);
  const done2 = await an!.post(`${url}/${bins.data.id}/done`, { today: '2026-10-13' });
  assert.equal(done2.data.currentName, 'Tom');
  assert.equal((await tom!.post(`${url}/${bins.data.id}/done`, { today: '2026-10-20' })).data.currentName, 'Linh', 'back to the start');

  // A one-off is done, moves to the end, and can be reopened.
  await an!.post(`${url}/${fix.data.id}/done`, {});
  assert.deepEqual((await list()).map((c) => [c.title, c.done]), [['Đổ rác', false], ['Đổi mật khẩu wifi', false], ['Sửa vòi nước', true]]);
  assert.equal((await an!.post(`${url}/${fix.data.id}/done`, { undo: true })).data.done, false);

  // Someone who leaves drops out of the turns.
  await tom!.del(`/api/households/${hid}/members/${anU!.id}`);
  const after = (await list()).find((c) => c.title === 'Đổ rác')!;
  assert.equal(after.currentName, 'Linh');

  // Only whoever added it, or owners and managers, change or delete it.
  const guestish = new Client(server);
  await guestish.signup('Hoa');
  const { token } = await inviteToken(tom!, hid, { role: 'guest', guestDays: 3 });
  await guestish.post(`/api/invites/${token}/accept`);
  const req = (await tom!.get(`/api/households/${hid}/requests`)).data.requests[0];
  await tom!.post(`/api/households/${hid}/requests/${req.id}/approve`);
  assert.equal((await guestish.get(url)).data.canAdd, false);
  assert.equal((await guestish.post(url, { title: 'x' })).status, 403);
  assert.equal((await guestish.post(`${url}/${bins.data.id}/done`, {})).status, 403);
  assert.equal((await linh!.patch(`${url}/${wifi.data.id}`, { title: 'x' })).status, 403);
  assert.equal((await tom!.patch(`${url}/${bins.data.id}`, { repeatDays: 14 })).data.repeatDays, 14);
  assert.equal((await tom!.post(url, { title: 'x', repeatDays: 5 })).data.error, 'repeatDays_invalid');
  assert.equal((await tom!.post(url, { title: 'x', assignees: ['nobody'] })).data.error, 'people_invalid');
  assert.equal((await linh!.del(`${url}/${bins.data.id}`)).status, 200);

  // MATE's suggestions mention a chore that's my turn.
  await tom!.post(url, { title: 'Lau nhà tắm', assignees: [tomU!.id], repeatDays: 7, today: '2026-10-02' });
  await tom!.post(`/api/households/${hid}/messages`, { text: 'gợi ý', conversation: 'bot:tom', localTime: '2026-10-02T09:00' });
  const reply = ((await tom!.get(`/api/households/${hid}/messages?conversation=bot:tom`)).data.messages as { bot: { params: { items: { k: string; title: string }[] } } | null }[]).at(-1)!;
  assert.ok(reply.bot!.params.items.some((i) => i.k === 'chore' && i.title === 'Lau nhà tắm'));
});

test('pinned notes: shown in the group chat, only notes the whole home sees', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh']);
  const [tom, linh] = clients;
  const items = `/api/households/${hid}/items`;
  const wifi = (await linh!.post(items, { title: 'Wi‑Fi', body: 'caphe123' })).data;
  const secret = (await linh!.post(items, { title: 'Secret', visibility: 'me' })).data;
  const mgr = (await tom!.post(items, { title: 'Owners only', visibility: 'managers' })).data;
  const tomNote = (await tom!.post(items, { title: 'Rules' })).data;

  assert.equal(wifi.canPin, true);
  assert.equal((await linh!.post(`${items}/${wifi.id}/pin`, { pinned: true })).data.pinned, true);
  assert.equal((await linh!.post(`${items}/${secret.id}/pin`, { pinned: true })).data.error, 'pin_private');
  assert.equal((await tom!.post(`${items}/${mgr.id}/pin`, { pinned: true })).data.error, 'pin_private');
  assert.equal((await linh!.post(`${items}/${tomNote.id}/pin`, { pinned: true })).status, 403, 'only its creator or an owner/manager');
  assert.equal((await tom!.post(`${items}/${tomNote.id}/pin`, { pinned: true })).status, 200);
  const pinned = async (c: Client) => ((await c.get(`${items}?pinned=1`)).data.items as { title: string }[]).map((i) => i.title).sort();
  assert.deepEqual(await pinned(tom!), ['Rules', 'Wi‑Fi']);
  assert.deepEqual(await pinned(linh!), ['Rules', 'Wi‑Fi']);
  // Made private later → no longer shown.
  await linh!.patch(`${items}/${wifi.id}`, { visibility: 'me' });
  assert.deepEqual(await pinned(tom!), ['Rules']);
  await tom!.post(`${items}/${tomNote.id}/pin`, { pinned: false });
  assert.deepEqual(await pinned(tom!), []);
});
