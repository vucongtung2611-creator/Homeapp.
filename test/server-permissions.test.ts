import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, JPEG, houseOf, testServer } from './server-helpers.js';

test('outsiders cannot see or touch a household (404, not 403)', async () => {
  const server = testServer();
  const { hid } = await houseOf(server, ['Linh', 'An']);
  const stranger = new Client(server);
  await stranger.signup('Mallory');
  for (const path of ['', '/messages', '/items', '/money', '/events']) {
    assert.equal((await stranger.get(`/api/households/${hid}${path}`)).status, 404, path);
  }
  assert.equal((await stranger.post(`/api/households/${hid}/messages`, { text: 'hi' })).status, 404);
  assert.equal((await stranger.post(`/api/households/${hid}/invite`)).status, 404);
  assert.equal((await new Client(server).get(`/api/households/${hid}`)).status, 403); // not signed in
});

test('private library items stay with their creator', async () => {
  const server = testServer();
  const { hid, clients } = await houseOf(server, ['Linh', 'An']);
  const [linh, an] = clients as [Client, Client];
  const secret = await an.post(`/api/households/${hid}/items`, { title: 'Nhật ký', body: 'bí mật', private: true });
  const shared = await an.post(`/api/households/${hid}/items`, { title: 'Wi-Fi', body: 'pass', tags: ['nhà'] });
  assert.equal(secret.status, 201);

  const linhSees = (await linh.get(`/api/households/${hid}/items`)).data.items.map((i: { title: string }) => i.title);
  assert.deepEqual(linhSees, ['Wi-Fi']);
  assert.deepEqual((await linh.get(`/api/households/${hid}/items?q=bi mat`)).data.items, []);
  assert.equal((await linh.patch(`/api/households/${hid}/items/${secret.data.id}`, { title: 'x' })).status, 403);
  assert.equal((await linh.del(`/api/households/${hid}/items/${secret.data.id}`)).status, 403);
  // Only the creator flips privacy.
  assert.equal((await linh.patch(`/api/households/${hid}/items/${shared.data.id}`, { private: true })).status, 403);
  // Search is accent-insensitive for the owner.
  assert.equal((await an.get(`/api/households/${hid}/items?q=nhat ky`)).data.items.length, 1);
});

test('uploads: only real images/PDFs, and files follow the privacy of what they are attached to', async () => {
  const server = testServer();
  const { hid, clients } = await houseOf(server, ['Linh', 'An']);
  const [linh, an] = clients as [Client, Client];
  const outsider = new Client(server);
  await outsider.signup('Mallory');

  const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
  assert.equal((await an.req('POST', `/api/households/${hid}/files`, html, { 'Content-Type': 'image/jpeg' })).status, 415);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await an.req('POST', `/api/households/${hid}/files`, svg, { 'Content-Type': 'image/svg+xml' })).status, 415);
  assert.equal((await an.req('POST', `/api/households/${hid}/files`, new Uint8Array(11 * 1024 * 1024).fill(0xff))).status, 413);

  const up = await an.req('POST', `/api/households/${hid}/files`, JPEG, { 'Content-Type': 'text/html', 'X-File-Name': encodeURIComponent('../../etc/passwd<x>.jpg') });
  assert.equal(up.status, 201);
  assert.equal(up.data.mime, 'image/jpeg');
  assert.equal(up.data.name, '....etcpasswdx.jpg');
  const url = up.data.url as string;

  // Unattached upload: only the uploader.
  assert.equal((await an.get(url)).status, 200);
  assert.equal((await linh.get(url)).status, 404);

  // Attached to a private item: still only the uploader.
  await an.post(`/api/households/${hid}/items`, { title: 'Hộ chiếu', attachmentIds: [up.data.id], private: true });
  assert.equal((await linh.get(url)).status, 404);
  // Linh cannot borrow An's upload into her own item to read it.
  assert.equal((await linh.post(`/api/households/${hid}/items`, { title: 'x', attachmentIds: [up.data.id] })).data.error, 'attachment_invalid');
  assert.equal((await linh.post(`/api/households/${hid}/messages`, { fileId: up.data.id })).data.error, 'attachment_invalid');

  // Sent to the chat: every member, nobody else.
  const photo = await an.req('POST', `/api/households/${hid}/files`, JPEG);
  await an.post(`/api/households/${hid}/messages`, { text: 'ảnh nè', fileId: photo.data.id });
  const res = await linh.get(photo.data.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.match(res.headers.get('content-security-policy')!, /sandbox/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await outsider.get(photo.data.url)).status, 404);
  assert.equal((await new Client(server).get(photo.data.url)).status, 403);
});

test('removed members lose access immediately; only the owner removes others', async () => {
  const server = testServer();
  const { hid, clients, users } = await houseOf(server, ['Linh', 'An', 'Bao']);
  const [linh, an, bao] = clients as [Client, Client, Client];
  assert.equal((await an.del(`/api/households/${hid}/members/${users[2]!.id}`)).status, 403);
  assert.equal((await linh.del(`/api/households/${hid}/members/${users[0]!.id}`)).data.error, 'owner_cannot_leave');
  assert.equal((await linh.del(`/api/households/${hid}/members/${users[2]!.id}`)).status, 200);
  assert.equal((await bao.get(`/api/households/${hid}/messages`)).status, 404);
  assert.deepEqual((await bao.get('/api/me')).data.households, []);
  // Members can leave on their own.
  assert.equal((await an.del(`/api/households/${hid}/members/${users[1]!.id}`)).status, 200);
});

test('chat: members only, own messages deletable, history paginates', async () => {
  const server = testServer();
  const { hid, clients } = await houseOf(server, ['Linh', 'An']);
  const [linh, an] = clients as [Client, Client];
  const m = await an.post(`/api/households/${hid}/messages`, { text: 'Tối nay ăn gì?' });
  assert.equal(m.data.userName, 'An');
  assert.equal((await linh.del(`/api/households/${hid}/messages/${m.data.id}`)).status, 403);
  assert.equal((await an.post(`/api/households/${hid}/messages`, { text: '   ' })).data.error, 'message_empty');
  const list = await linh.get(`/api/households/${hid}/messages`);
  // System messages carry a key + params (translated on each device); people's text is stored as typed.
  assert.deepEqual(
    list.data.messages.map((x: { text: string; system: unknown }) => x.system ?? x.text),
    [{ key: 'joined', params: { name: 'An' } }, 'Tối nay ăn gì?'],
  );
  assert.equal((await an.del(`/api/households/${hid}/messages/${m.data.id}`)).status, 200);
});

test('messages arrive instantly over the event stream', async () => {
  const server = testServer();
  const { hid, clients } = await houseOf(server, ['Linh', 'An']);
  const [linh, an] = clients as [Client, Client];
  const res = await server.app.request(`http://localhost/api/households/${hid}/events`, { headers: { Cookie: linh.cookie } });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let received = '';
  const until = async (needle: string) => {
    while (!received.includes(needle)) received += decoder.decode((await reader.read()).value);
  };
  await until('event: ready');
  await an.post(`/api/households/${hid}/messages`, { text: 'xin chào' });
  await until('xin chào');
  assert.match(received, /event: message/);
  await reader.cancel();
});
