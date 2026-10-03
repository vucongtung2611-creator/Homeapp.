import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, houseOf, inviteToken, JPEG, testServer } from './server-helpers.js';

type Item = { id: string; title: string; visibility: string; collection: string | null; sample: boolean; attachments: { url: string }[] };

test('everyone has one personal space: only theirs, not a home, nothing to share', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh']);
  const [tom, linh] = clients as [Client, Client];
  const mine = (await tom.get('/api/me/personal')).data.id as string;
  assert.equal((await tom.get('/api/me/personal')).data.id, mine, 'the same space every time');
  assert.notEqual((await linh.get('/api/me/personal')).data.id, mine);
  assert.deepEqual(((await tom.get('/api/me')).data.households as { id: string }[]).map((h) => h.id), [hid], 'not listed as a home');
  assert.equal((await tom.get(`/api/households/${mine}`)).data.personal, true);

  // Items there are private, whatever was asked for; files work.
  const photo = await tom.req('POST', `/api/households/${mine}/files`, JPEG, { 'X-File-Name': 'passport.jpg' });
  const item = (await tom.post(`/api/households/${mine}/items`, { title: 'Passport', visibility: 'home', attachmentIds: [photo.data.id] })).data as Item;
  assert.equal(item.visibility, 'me');
  assert.equal((await tom.get(item.attachments[0]!.url)).status, 200);
  // Nobody else gets in, and it can't be shared or handed over.
  assert.equal((await linh.get(`/api/households/${mine}/items`)).status, 404);
  assert.equal((await linh.get(item.attachments[0]!.url)).status, 404);
  assert.equal((await tom.post(`/api/households/${mine}/invites`, {})).data.error, 'personal_space');
  assert.equal((await tom.post(`/api/households/${mine}/code`)).data.error, 'personal_space');
  assert.equal((await tom.post(`/api/households/${mine}/transfer`, { to: 'x' })).data.error, 'personal_space');
  assert.equal((await tom.del(`/api/households/${mine}`)).data.error, 'personal_space');
  assert.equal((await tom.post(`/api/households/${mine}/samples`, { collection: 'recipes' })).data.error, 'personal_space');
});

test('who sees an item: only me, the whole home, or owners and managers', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh', 'An']);
  const [tom, linh, an] = clients as [Client, Client, Client];
  await tom.patch(`/api/households/${hid}/members/${(await linh.get('/api/me')).data.user.id}`, { role: 'manager' });
  await tom.patch(`/api/households/${hid}`, { approveJoins: false });
  const { token } = await inviteToken(tom, hid, { role: 'guest', guestDays: 3 });
  const guest = new Client(server);
  await guest.signup('Guest');
  await guest.post(`/api/invites/${token}/accept`);

  const doc = await tom.req('POST', `/api/households/${hid}/files`, JPEG, { 'X-File-Name': 'bond.jpg' });
  await tom.post(`/api/households/${hid}/items`, { title: 'Bond receipt', visibility: 'managers', attachmentIds: [doc.data.id] });
  await tom.post(`/api/households/${hid}/items`, { title: 'Wi-Fi', visibility: 'home' });
  await tom.post(`/api/households/${hid}/items`, { title: 'Diary', visibility: 'me' });
  const titles = async (c: Client) => ((await c.get(`/api/households/${hid}/items`)).data.items as Item[]).map((i) => `${i.title}:${i.visibility}`).sort();
  assert.deepEqual(await titles(tom), ['Bond receipt:managers', 'Diary:me', 'Wi-Fi:home']);
  assert.deepEqual(await titles(linh), ['Bond receipt:managers', 'Wi-Fi:home'], 'a manager sees managers’ items');
  assert.deepEqual(await titles(an), ['Wi-Fi:home'], 'a resident does not');
  assert.deepEqual(await titles(guest), ['Wi-Fi:home']);
  const bond = ((await tom.get(`/api/households/${hid}/items`)).data.items as Item[]).find((i) => i.title === 'Bond receipt')!;
  assert.equal((await an.get(bond.attachments[0]!.url)).status, 404, 'its files stay hidden too');
  assert.equal((await linh.get(bond.attachments[0]!.url)).status, 200);
  // Only the creator changes who sees it.
  assert.equal((await linh.patch(`/api/households/${hid}/items/${bond.id}`, { visibility: 'home' })).status, 403);
  assert.equal((await tom.patch(`/api/households/${hid}/items/${bond.id}`, { visibility: 'home' })).data.visibility, 'home');
  assert.ok((await titles(an)).includes('Bond receipt:home'));
});

test('empty shelves can be filled with realistic, removable examples', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'An']);
  const [tom, an] = clients as [Client, Client];
  const added = await an.post(`/api/households/${hid}/samples`, { collection: 'rental', locale: 'vi' });
  assert.equal(added.data.added, 2);
  const rental = ((await tom.get(`/api/households/${hid}/items?collection=rental`)).data.items as (Item & { expiresOn: string; docType: string; body: string })[]);
  assert.deepEqual(rental.map((i) => i.docType).sort(), ['condition_report', 'lease']);
  assert.ok(rental.every((i) => i.sample && i.body.length > 100), 'long, real-looking examples, marked as samples');
  assert.ok(rental.some((i) => i.title.startsWith('Hợp đồng')), 'in the reader’s language');
  assert.equal((await an.post(`/api/households/${hid}/samples`, { collection: 'rental' })).data.error, 'shelf_not_empty');
  assert.equal((await tom.del(`/api/households/${hid}/samples`)).status, 200);
  assert.equal(((await tom.get(`/api/households/${hid}/items?collection=rental`)).data.items as Item[]).length, 0, 'cleared in one go');

  // A new home with samples gets every shelf filled.
  const fresh = (await tom.post('/api/households', { name: 'Fresh', samples: true, locale: 'en' })).data.id;
  const counts = (await tom.get(`/api/households/${fresh}/items`)).data.collections;
  assert.deepEqual(counts, { recipes: 1, wishlist: 1, shopping: 1, contacts: 1, house_rules: 1, rental: 2 });
});
