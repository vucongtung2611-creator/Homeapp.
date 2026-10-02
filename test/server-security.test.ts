import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from '../server/app.js';
import { Client, houseOf, testServer } from './server-helpers.js';

test('ids from another household are a 404, never a 500 or a leak', async () => {
  const server = testServer();
  const a = await houseOf(server, ['Linh', 'An']);
  const b = await houseOf(server, ['Mai', 'Son']);
  const note = await b.clients[0]!.post(`/api/households/${b.hid}/items`, { title: 'Bí mật nhà B' });
  const bill = (await b.clients[0]!.post(`/api/households/${b.hid}/bills`, { amount: 100 })).data.bills[0];
  const linh = a.clients[0]!;
  assert.equal((await linh.patch(`/api/households/${a.hid}/items/${note.data.id}`, { title: 'x' })).status, 404);
  assert.equal((await linh.del(`/api/households/${a.hid}/items/${note.data.id}`)).status, 404);
  assert.equal((await linh.post(`/api/households/${a.hid}/bills/${bill.id}/pay`)).status, 404);
  assert.equal((await linh.del(`/api/households/${a.hid}/money/${bill.id}`)).status, 404);
  assert.equal((await linh.del(`/api/households/${a.hid}/items/does-not-exist`)).status, 404);
});

test('oversized JSON bodies are refused', async () => {
  const server = testServer();
  const { hid, clients } = await houseOf(server, ['Linh']);
  const res = await clients[0]!.post(`/api/households/${hid}/items`, { title: 'x', body: 'a'.repeat(300 * 1024) });
  assert.equal(res.status, 413);
});

test('chat only accepts images; documents belong in the library', async () => {
  const server = testServer();
  const { hid, clients } = await houseOf(server, ['Linh']);
  const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF');
  const up = await clients[0]!.req('POST', `/api/households/${hid}/files`, pdf);
  assert.equal(up.data.mime, 'application/pdf');
  assert.equal((await clients[0]!.post(`/api/households/${hid}/messages`, { fileId: up.data.id })).data.error, 'chat_images_only');
  // PDFs are always served as downloads.
  const res = await clients[0]!.get(up.data.url);
  assert.match(res.headers.get('content-disposition')!, /^attachment/);
});

test('behind a proxy: spoofed X-Forwarded-For cannot dodge the login limit; Secure cookies on HTTPS', async () => {
  const server = createServer({ dataDir: mkdtempSync(join(tmpdir(), 'homeapp-proxy-')), trustProxy: true });
  const attempt = (spoof: string) =>
    server.app.request('http://app.internal/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'homeapp',
        // The attacker controls the first entry; our proxy appends the real IP.
        'X-Forwarded-For': `${spoof}, 203.0.113.9`,
      },
      body: JSON.stringify({ email: 'victim@example.com', password: 'guess guess' }),
    });
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await attempt(`10.0.0.${i}`)).status;
  assert.equal(last, 429);

  const signup = await server.app.request('http://app.internal/api/auth/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'homeapp',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'homeapp.example',
      'X-Forwarded-For': '198.51.100.7',
      Origin: 'https://homeapp.example',
    },
    body: JSON.stringify({ name: 'A', email: 'a@example.com', password: 'long enough' }),
  });
  assert.equal(signup.status, 201);
  assert.match(signup.headers.get('set-cookie')!, /Secure/);
});

test('settling up and paying bills is announced in the chat', async () => {
  const server = testServer();
  const { hid, clients, users } = await houseOf(server, ['Linh', 'An']);
  const [linh, an] = clients as [Client, Client];
  const bill = (await linh.post(`/api/households/${hid}/bills`, { amount: 200, label: 'Internet', category: 'internet' })).data.bills[0];
  await linh.post(`/api/households/${hid}/bills/${bill.id}/pay`);
  await an.post(`/api/households/${hid}/settlements`, { from: users[1]!.id, to: users[0]!.id, amount: 100 });
  const texts = (await linh.get(`/api/households/${hid}/messages`)).data.messages.map((m: { text: string }) => m.text);
  assert.ok(texts.some((t: string) => /Linh đã trả hóa đơn "Internet"/.test(t)), texts.join('\n'));
  assert.ok(texts.some((t: string) => /An đã chuyển .* cho Linh/.test(t)), texts.join('\n'));
});
