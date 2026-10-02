import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, houseOf, testServer } from './server-helpers.js';

test('bill split, payment, who owes whom, settle up — in VND', async () => {
  const server = testServer();
  const { hid, clients, users } = await houseOf(server, ['Linh', 'An', 'Bao']);
  const [linh, an, bao] = clients as [Client, Client, Client];
  const [uLinh, uAn, uBao] = users as unknown as [{ id: string }, { id: string }, { id: string }];

  const created = await an.post(`/api/households/${hid}/bills`, {
    category: 'electricity',
    amount: 1_000_000,
    dueDate: '2026-10-15',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
  });
  assert.equal(created.status, 201);
  const bill = created.data.bills[0];
  assert.deepEqual(bill.shares, { [uLinh.id]: 333_334, [uAn.id]: 333_333, [uBao.id]: 333_333 });
  assert.deepEqual(created.data.transfers, []);

  await an.post(`/api/households/${hid}/bills/${bill.id}/pay`);
  const after = (await linh.get(`/api/households/${hid}/money`)).data;
  assert.deepEqual(after.transfers, [
    { from: uLinh.id, to: uAn.id, amount: 333_334 },
    { from: uBao.id, to: uAn.id, amount: 333_333 },
  ]);
  assert.deepEqual(after.reminders.map((r: { kind: string; to: string; amount: number }) => [r.kind, r.to, r.amount]), [['debt', uAn.id, 333_334]]);

  // Bao pays An back.
  await bao.post(`/api/households/${hid}/settlements`, { from: uBao.id, to: uAn.id, amount: 333_333 });
  assert.deepEqual((await an.get(`/api/households/${hid}/money`)).data.transfers, [{ from: uLinh.id, to: uAn.id, amount: 333_334 }]);
  // Nobody can record a payment between two other people.
  assert.equal((await bao.post(`/api/households/${hid}/settlements`, { from: uLinh.id, to: uAn.id, amount: 1 })).status, 403);
});

test('only expenses marked shared are split; personal ones stay private', async () => {
  const server = testServer();
  const { hid, clients, users } = await houseOf(server, ['Linh', 'An']);
  const [linh, an] = clients as [Client, Client];
  await an.post(`/api/households/${hid}/expenses`, { description: 'Cà phê', amount: 45_000 });
  await an.post(`/api/households/${hid}/expenses`, { description: 'Đi chợ', amount: 300_000, shared: true });
  const linhView = (await linh.get(`/api/households/${hid}/money`)).data;
  assert.deepEqual(linhView.expenses.map((e: { label: string }) => e.label), ['Đi chợ']);
  assert.deepEqual(linhView.transfers, [{ from: users[0]!.id, to: users[1]!.id, amount: 150_000 }]);
  assert.equal((await an.get(`/api/households/${hid}/money`)).data.expenses.length, 2);
});

test('a personal bill is not split and not visible to housemates', async () => {
  const server = testServer();
  const { hid, clients } = await houseOf(server, ['Linh', 'An']);
  const [linh, an] = clients as [Client, Client];
  const res = await an.post(`/api/households/${hid}/bills`, { category: 'phone', amount: 200_000, shared: false });
  assert.equal(res.data.bills[0].shared, false);
  assert.deepEqual((await linh.get(`/api/households/${hid}/money`)).data.bills, []);
});

test('money input validation', async () => {
  const server = testServer();
  const { hid, clients } = await houseOf(server, ['Linh', 'An']);
  const [linh] = clients as [Client];
  const post = (body: unknown) => linh.post(`/api/households/${hid}/bills`, body);
  assert.equal((await post({ amount: -5 })).data.error, 'amount_invalid');
  assert.equal((await post({ amount: 'abc' })).data.error, 'amount_invalid');
  assert.equal((await post({ amount: 10, dueDate: '15/10/2026' })).data.error, 'dueDate_invalid');
  assert.equal((await post({ amount: 10, periodStart: '2026-10-01', periodEnd: '2026-09-01' })).data.error, 'period_invalid');
  assert.equal((await post({ amount: 10, responsible: ['u_stranger'] })).data.error, 'responsible_invalid');
  assert.equal((await post({ amount: 10, category: 'yacht' })).data.error, 'category_invalid');
});

test('sample data: new homes start with samples the owner can clear', async () => {
  const server = testServer();
  const { hid, clients } = await houseOf(server, ['Linh', 'An'], { samples: true });
  const [linh, an] = clients as [Client, Client];
  assert.equal((await linh.get(`/api/households/${hid}/money`)).data.bills[0].sample, true);
  // Linh sees her private sample note; An does not.
  assert.equal((await linh.get(`/api/households/${hid}/items`)).data.items.length, 4);
  assert.equal((await an.get(`/api/households/${hid}/items`)).data.items.length, 3);
  assert.equal((await an.del(`/api/households/${hid}/samples`)).status, 403);
  await linh.del(`/api/households/${hid}/samples`);
  assert.deepEqual((await linh.get(`/api/households/${hid}/items`)).data.items, []);
  assert.deepEqual((await linh.get(`/api/households/${hid}/money`)).data.bills, []);
});

test('sample content follows the creator’s language; avatars are characters', async () => {
  const server = testServer();
  const c = new Client(server);
  const res = await c.post('/api/auth/signup', { name: 'Mai', email: 'mai@example.com', password: 'long enough', avatar: 'grandpa' });
  assert.equal(res.data.user.avatar, 'grandpa');
  assert.equal((await new Client(server).post('/api/auth/signup', { name: 'X', email: 'x@example.com', password: 'long enough', avatar: 'dragon' })).data.error, 'avatar_invalid');
  const en = (await c.post('/api/households', { name: 'A', locale: 'en-AU', currency: 'AUD' })).data.id;
  const vi = (await c.post('/api/households', { name: 'B', locale: 'vi', currency: 'VND' })).data.id;
  const titles = async (hid: string) => (await c.get(`/api/households/${hid}/items`)).data.items.map((i: { title: string }) => i.title).sort();
  assert.ok((await titles(en)).includes('Home Wi-Fi'));
  assert.ok((await titles(vi)).includes('Wi-Fi nhà mình'));
  assert.deepEqual((await c.get(`/api/households/${en}/messages`)).data.messages[0].system, { key: 'welcome' });

  assert.equal((await c.patch('/api/me', { avatar: 'boy' })).data.user.avatar, 'boy');
  assert.equal((await c.patch('/api/me', { avatar: '../../etc' })).status, 400);
  assert.equal((await c.get(`/api/households/${en}`)).data.members[0].avatar, 'boy');
});

test('data survives a server restart', async () => {
  const first = testServer();
  const { hid, clients } = await houseOf(first, ['Linh', 'An']);
  await clients[1]!.post(`/api/households/${hid}/expenses`, { description: 'Gas', amount: 100_000, shared: true });
  const { createServer } = await import('../server/app.js');
  const second = createServer({ dataDir: first.dataDir });
  const linh = new Client({ ...second, dataDir: first.dataDir });
  linh.cookie = clients[0]!.cookie;
  const view = (await linh.get(`/api/households/${hid}/money`)).data;
  assert.equal(view.transfers[0].amount, 50_000);
});
