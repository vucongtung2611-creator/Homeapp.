import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { houseOf, testServer, type Client, type Server } from './server-helpers.js';

/** Open the live stream and collect its events until it closes (or `ms` passes). */
async function listen(server: Server, client: Client, hid: string, ms: number) {
  const res = await server.app.request(`http://localhost/api/households/${hid}/events`, { headers: { Cookie: client.cookie } });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let closed = false;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), sleep(Math.max(1, deadline - Date.now())).then(() => 'timeout' as const)]);
    if (chunk === 'timeout') break;
    if (chunk.done) {
      closed = true;
      break;
    }
    text += decoder.decode(chunk.value);
  }
  if (!closed) await reader.cancel();
  return { text, closed, events: [...text.matchAll(/^event: (\w+)/gm)].map((m) => m[1]) };
}

test('the server reports the idle timeout to the app', async () => {
  const server = await testServer({ chatIdleMs: 3 * 60_000 });
  const { clients } = await houseOf(server, ['Linh']);
  assert.deepEqual((await clients[0]!.get('/api/me')).data.config, { chatIdleMinutes: 3 });
});

test('an idle chat connection is told it is idle and closed', async () => {
  const server = await testServer({ chatIdleMs: 300 });
  const { hid, clients } = await houseOf(server, ['Linh']);
  const started = Date.now();
  const stream = await listen(server, clients[0]!, hid, 3000);
  assert.equal(stream.closed, true, 'stream closed by the server');
  assert.deepEqual(stream.events, ['ready', 'idle']);
  assert.ok(Date.now() - started >= 300, 'not before the idle time');
  assert.match(stream.text, /"idleMs":300/);
});

test('presence pings and normal requests keep the connection open', async () => {
  const server = await testServer({ chatIdleMs: 400 });
  const { hid, clients } = await houseOf(server, ['Linh', 'An']);
  const [linh, an] = clients as [Client, Client];
  let keepAlive = true;
  const pinger = (async () => {
    let i = 0;
    while (keepAlive) {
      // Alternate between a presence ping and an ordinary request (reading messages).
      if (i++ % 2) await linh.post(`/api/households/${hid}/presence`);
      else await linh.get(`/api/households/${hid}/messages`);
      await sleep(100);
    }
  })();
  setTimeout(() => void an.post(`/api/households/${hid}/messages`, { text: 'hello while you are here' }), 500);
  const stream = await listen(server, linh, hid, 1500);
  keepAlive = false;
  await pinger;
  assert.equal(stream.closed, false, 'still open after 1.5 s of activity');
  assert.ok(!stream.events.includes('idle'));
  assert.ok(stream.events.includes('message'), 'messages still arrive');
});

test('reconnecting after idle can fetch the messages that were missed', async () => {
  const server = await testServer({ chatIdleMs: 200 });
  const { hid, clients } = await houseOf(server, ['Linh', 'An']);
  const [linh, an] = clients as [Client, Client];
  const before = (await linh.get(`/api/households/${hid}/messages`)).data.messages;
  const lastSeq = before.at(-1).seq;
  const first = await listen(server, linh, hid, 2000);
  assert.deepEqual(first.events, ['ready', 'idle']);
  await an.post(`/api/households/${hid}/messages`, { text: 'you missed this' });
  await an.post(`/api/households/${hid}/messages`, { text: 'and this' });
  // What the app does on return: reconnect, then ask for everything after the last message it had.
  const missed = (await linh.get(`/api/households/${hid}/messages?after=${lastSeq}`)).data.messages.map((m: { text: string }) => m.text);
  assert.deepEqual(missed, ['you missed this', 'and this']);
  const again = await listen(server, linh, hid, 100);
  assert.deepEqual(again.events, ['ready']);
});

test('presence requires membership', async () => {
  const server = await testServer();
  const { hid } = await houseOf(server, ['Linh']);
  const { clients } = await houseOf(server, ['Mallory']);
  assert.equal((await clients[0]!.post(`/api/households/${hid}/presence`)).status, 404);
});
