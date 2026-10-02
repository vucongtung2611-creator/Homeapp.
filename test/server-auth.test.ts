import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, houseOf, testServer } from './server-helpers.js';

test('signup, session cookie, logout', async () => {
  const server = await testServer();
  const c = new Client(server);
  const res = await c.post('/api/auth/signup', { name: 'Linh', email: ' Linh@Example.com ', password: 'mật khẩu dài' });
  assert.equal(res.status, 201);
  assert.equal(res.data.user.email, 'linh@example.com');
  const cookie = res.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  assert.equal((await c.get('/api/me')).data.user.name, 'Linh');
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).data.user, null);
});

test('login: right password works, wrong password and unknown email give the same error', async () => {
  const server = await testServer();
  await new Client(server).signup('An', 'an@example.com', 'super secret 1');
  const c = new Client(server);
  const wrong = await c.post('/api/auth/login', { email: 'an@example.com', password: 'nope nope nope' });
  const unknown = await c.post('/api/auth/login', { email: 'ghost@example.com', password: 'nope nope nope' });
  assert.deepEqual([wrong.status, wrong.data], [401, { error: 'invalid_credentials' }]);
  assert.deepEqual([unknown.status, unknown.data], [401, { error: 'invalid_credentials' }]);
  const ok = await c.post('/api/auth/login', { email: 'AN@example.com', password: 'super secret 1' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/me')).data.user.name, 'An');
});

test('signup validation and duplicate emails', async () => {
  const server = await testServer();
  const c = new Client(server);
  assert.equal((await c.post('/api/auth/signup', { name: 'X', email: 'bad', password: 'long enough' })).data.error, 'invalid_email');
  assert.equal((await c.post('/api/auth/signup', { name: 'X', email: 'x@x.io', password: 'short' })).data.error, 'password_too_short');
  assert.equal((await c.post('/api/auth/signup', { name: ' ', email: 'x@x.io', password: 'long enough' })).data.error, 'invalid_name');
  await c.signup('X', 'x@x.io');
  const dup = await new Client(server).post('/api/auth/signup', { name: 'Y', email: 'X@x.io', password: 'long enough' });
  assert.equal(dup.status, 409);
});

test('passwords are stored hashed, sessions stored as hashes', async () => {
  const server = await testServer();
  const c = new Client(server);
  await c.signup('Linh', 'linh@example.com', 'plain text password');
  const row = (await server.db.get<{ password_hash: string }>('SELECT password_hash FROM users'))!;
  assert.match(row.password_hash, /^scrypt\$/);
  assert.doesNotMatch(row.password_hash, /plain text/);
  const session = (await server.db.get<{ token_hash: string }>('SELECT token_hash FROM sessions'))!;
  assert.notEqual(`sid=${session.token_hash}`, c.cookie);
});

test('login is rate limited per IP and email', async () => {
  const server = await testServer();
  const c = new Client(server);
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await c.post('/api/auth/login', { email: 'a@b.co', password: 'wrong wrong' })).status;
  assert.equal(last, 429);
});

test('state-changing requests need the app header (CSRF) and a foreign Origin is refused', async () => {
  const server = await testServer();
  const c = new Client(server);
  const noHeader = await server.app.request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'A', email: 'a@a.io', password: 'long enough' }),
  });
  assert.equal(noHeader.status, 403);
  const foreign = await c.req('POST', '/api/auth/signup', { name: 'A', email: 'a@a.io', password: 'long enough' }, { Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
});

test('expired sessions are rejected', async () => {
  const server = await testServer();
  const c = new Client(server);
  await c.signup('Linh');
  await server.db.run("UPDATE sessions SET expires_at = '2000-01-01T00:00:00Z'");
  assert.equal((await c.get('/api/me')).data.user, null);
});

test('invite links: join once, regenerate retires the old link, bad tokens fail', async () => {
  const server = await testServer();
  const { hid, clients, token } = await houseOf(server, ['Linh', 'An']);
  const preview = await new Client(server).get(`/api/invites/${token}`);
  assert.deepEqual(Object.keys(preview.data).sort(), ['alreadyMember', 'householdName', 'inviterName']);

  const member = (await clients[0]!.get(`/api/households/${hid}`)).data.members;
  assert.deepEqual(member.map((m: { name: string; role: string }) => [m.name, m.role]), [['Linh', 'owner'], ['An', 'tenant']]);

  // Joining twice is harmless.
  assert.equal((await clients[1]!.post(`/api/invites/${token}/accept`)).status, 200);
  assert.equal((await clients[0]!.get(`/api/households/${hid}`)).data.members.length, 2);

  await clients[0]!.post(`/api/households/${hid}/invite`); // new link
  const late = new Client(server);
  await late.signup('Late');
  assert.equal((await late.post(`/api/invites/${token}/accept`)).status, 404);
  assert.equal((await late.get('/api/invites/not-a-real-token-at-all-xx')).status, 404);

  // Expired links fail.
  const fresh = await clients[0]!.post(`/api/households/${hid}/invite`);
  await server.db.run("UPDATE invites SET expires_at = '2000-01-01T00:00:00Z'");
  const freshToken = new URL(fresh.data.url).pathname.split('/').pop()!;
  assert.equal((await late.post(`/api/invites/${freshToken}/accept`)).status, 404);

  // Accepting needs an account.
  assert.equal((await new Client(server).post(`/api/invites/${freshToken}/accept`)).status, 403);
});
