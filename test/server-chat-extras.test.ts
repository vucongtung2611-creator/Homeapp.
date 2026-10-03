import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, houseOf, testServer } from './server-helpers.js';

test('stickers: sent like a message, only from the built-in set', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh']);
  const [tom, linh] = clients as [Client, Client];
  const sent = await tom.post(`/api/households/${hid}/messages`, { sticker: 'thanks', text: 'ignored' });
  assert.equal(sent.status, 201);
  assert.deepEqual([sent.data.sticker, sent.data.text, sent.data.system], ['thanks', '', null]);
  const seen = (await linh.get(`/api/households/${hid}/messages`)).data.messages as { sticker: string | null; userName: string }[];
  assert.deepEqual(seen.filter((m) => m.sticker).map((m) => [m.userName, m.sticker]), [['Tom', 'thanks']]);
  assert.equal((await tom.post(`/api/households/${hid}/messages`, { sticker: '<img src=x>' })).data.error, 'sticker_invalid');
  // Emoji are just text.
  assert.equal((await tom.post(`/api/households/${hid}/messages`, { text: '🍕🎉' })).data.text, '🍕🎉');
});

test('the group chat can be renamed by the owner or a manager', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh', 'An']);
  const [tom, linh, an] = clients as [Client, Client, Client];
  assert.equal((await an.patch(`/api/households/${hid}/chat`, { name: 'Nope' })).status, 403);
  assert.equal((await tom.patch(`/api/households/${hid}/chat`, { name: 'Nhà mình 🏡' })).data.chatName, 'Nhà mình 🏡');
  assert.equal((await an.get(`/api/households/${hid}`)).data.chatName, 'Nhà mình 🏡');
  const last = ((await an.get(`/api/households/${hid}/messages`)).data.messages as { system: { key: string; params: Record<string, string> } | null }[]).at(-1)!;
  assert.deepEqual(last.system, { key: 'chatRenamed', params: { actor: 'Tom', name: 'Nhà mình 🏡' } });

  await tom.patch(`/api/households/${hid}/members/${(await linh.get('/api/me')).data.user.id}`, { role: 'manager' });
  assert.equal((await linh.patch(`/api/households/${hid}/chat`, { name: '' })).data.chatName, null, 'empty goes back to the home’s name');
  assert.equal((await an.get(`/api/households/${hid}`)).data.chatName, null);
  assert.equal((await tom.patch(`/api/households/${hid}/chat`, { name: 'x'.repeat(61) })).data.error, 'name_too_long');
  const kinds = ((await tom.get(`/api/households/${hid}/log`)).data.events as { kind: string }[]).map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'chat_renamed').length, 2);
});
