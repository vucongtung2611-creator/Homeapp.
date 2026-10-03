import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, testServer } from './server-helpers.js';

type Account = { id: string; name: string; active: boolean };
const accounts = async (c: Client) => ((await c.get('/api/accounts')).data.accounts as Account[]).map((a) => `${a.name}${a.active ? '*' : ''}`);

test('two accounts on one browser: add, switch without signing out, sign one out', async () => {
  const server = await testServer();
  await new Client(server).signup('Tester', 'tester@example.com');
  const browser = new Client(server);
  await browser.signup('Tom', 'tom@example.com');
  assert.deepEqual(await accounts(browser), ['Tom*']);

  // Add the test account next to Tom's.
  const added = await browser.post('/api/auth/login', { email: 'tester@example.com', password: 'correct horse battery', add: true });
  assert.equal(added.status, 200);
  assert.deepEqual(await accounts(browser), ['Tester*', 'Tom']);
  assert.equal((await browser.get('/api/me')).data.user.name, 'Tester');

  // Switch back and forth — no password needed.
  const tomId = ((await browser.get('/api/accounts')).data.accounts as Account[]).find((a) => a.name === 'Tom')!.id;
  assert.equal((await browser.post('/api/accounts/switch', { userId: tomId })).status, 200);
  assert.equal((await browser.get('/api/me')).data.user.name, 'Tom');
  assert.deepEqual(await accounts(browser), ['Tom*', 'Tester']);

  // A brand-new account can be added too (sign up while signed in).
  await browser.post('/api/auth/signup', { name: 'Kid', email: 'kid@example.com', password: 'correct horse battery', add: true });
  assert.deepEqual(await accounts(browser), ['Kid*', 'Tom', 'Tester']);

  // Sign one inactive account out of this browser; the active one stays.
  const testerId = ((await browser.get('/api/accounts')).data.accounts as Account[]).find((a) => a.name === 'Tester')!.id;
  assert.equal((await browser.del(`/api/accounts/${testerId}`)).status, 200);
  assert.deepEqual(await accounts(browser), ['Kid*', 'Tom']);
  assert.equal((await browser.post('/api/accounts/switch', { userId: testerId })).status, 404, 'gone from this browser');

  // Signing out the active account hands over to the next one.
  const out = await browser.post('/api/auth/logout');
  assert.equal(out.data.switchedTo.name, 'Tom');
  assert.deepEqual(await accounts(browser), ['Tom*']);
  assert.equal((await browser.post('/api/auth/logout')).data.switchedTo, null);
  assert.equal((await browser.get('/api/me')).data.user, null);
});

test('switching only works between accounts signed in on this browser', async () => {
  const server = await testServer();
  const victim = new Client(server);
  const victimUser = await victim.signup('Victim', 'victim@example.com');
  const attacker = new Client(server);
  await attacker.signup('Attacker', 'attacker@example.com');
  assert.equal((await attacker.post('/api/accounts/switch', { userId: victimUser.id })).status, 404);
  // A forged "other accounts" cookie with a made-up token is ignored.
  attacker.cookie += '; sids=' + 'x'.repeat(43);
  assert.deepEqual(await accounts(attacker), ['Attacker*']);
  assert.equal((await new Client(server).post('/api/accounts/switch', { userId: victimUser.id })).data.error, 'not_signed_in');
});

test('at most five accounts per browser', async () => {
  const server = await testServer();
  const browser = new Client(server);
  await browser.signup('A0', 'a0@example.com');
  for (let i = 1; i < 5; i++) assert.equal((await browser.post('/api/auth/signup', { name: `A${i}`, email: `a${i}@example.com`, password: 'correct horse battery', add: true })).status, 201);
  const sixth = await browser.post('/api/auth/signup', { name: 'A5', email: 'a5@example.com', password: 'correct horse battery', add: true });
  assert.equal(sixth.data.error, 'too_many_accounts');
  assert.equal((await new Client(server).post('/api/auth/login', { email: 'a5@example.com', password: 'correct horse battery' })).status, 401, 'no account was created');
});
