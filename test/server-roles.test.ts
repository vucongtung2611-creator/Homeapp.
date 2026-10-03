import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, houseOf, inviteToken, testServer, type Server } from './server-helpers.js';

async function person(server: Server, name: string) {
  const c = new Client(server);
  await c.signup(name);
  return c;
}
const idOf = async (c: Client) => (await c.get('/api/me')).data.user.id as string;
const roleIn = async (c: Client, hid: string, name: string) =>
  ((await c.get(`/api/households/${hid}`)).data.members as { name: string; role: string }[]).find((m) => m.name === name)?.role;

test('a manager lets people in, invites and removes residents — but no more than that', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh', 'An', 'Bao']);
  const [tom, linh, an, bao] = clients as [Client, Client, Client, Client];
  assert.equal((await linh.patch(`/api/households/${hid}/members/${await idOf(an)}`, { role: 'manager' })).status, 403, 'only the owner gives roles');
  assert.equal((await tom.patch(`/api/households/${hid}/members/${await idOf(linh)}`, { role: 'manager' })).status, 200);
  assert.equal(await roleIn(tom, hid, 'Linh'), 'manager');

  // What a manager can do.
  const invites = (await linh.get(`/api/households/${hid}/invites`)).data;
  assert.deepEqual(invites.roles, ['tenant', 'guest'], 'a manager can’t make managers');
  assert.equal((await linh.post(`/api/households/${hid}/invites`, { role: 'manager' })).data.error, 'role_invalid');
  const { token } = await inviteToken(linh, hid, { label: 'Kim' });
  const kim = await person(server, 'Kim');
  await kim.post(`/api/invites/${token}/accept`);
  const [request] = (await linh.get(`/api/households/${hid}/requests`)).data.requests;
  assert.equal((await linh.post(`/api/households/${hid}/requests/${request.id}/approve`)).status, 200);
  assert.equal((await linh.del(`/api/households/${hid}/members/${await idOf(bao)}`)).status, 200, 'removes a resident');

  // What a manager can't.
  assert.equal((await linh.del(`/api/households/${hid}/members/${await idOf(tom)}`)).status, 400, 'not the (last) owner');
  await tom.patch(`/api/households/${hid}/members/${await idOf(an)}`, { role: 'manager' });
  assert.equal((await linh.del(`/api/households/${hid}/members/${await idOf(an)}`)).status, 403, 'not another manager');
  assert.equal((await linh.patch(`/api/households/${hid}`, { approveJoins: false })).status, 403);
  assert.equal((await linh.get(`/api/households/${hid}/log`)).status, 403);
  assert.equal((await linh.post(`/api/households/${hid}/transfer`, { to: await idOf(an) })).status, 403);
  assert.equal((await linh.get(`/api/households/${hid}`)).data.canDelete, false);
  assert.equal((await linh.del(`/api/households/${hid}`)).status, 403);
  // Residents can't manage at all.
  assert.equal((await kim.get(`/api/households/${hid}/invites`)).status, 403);
  assert.equal((await kim.del(`/api/households/${hid}/members/${await idOf(an)}`)).status, 403);
});

test('guests look and chat for a set time: no money, no private items, nothing to edit', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom']);
  const tom = clients[0]!;
  await tom.patch(`/api/households/${hid}`, { approveJoins: false });
  await tom.post(`/api/households/${hid}/items`, { title: 'Wi-Fi', body: 'shared' });
  await tom.post(`/api/households/${hid}/items`, { title: 'My diary', private: true });
  const { token } = await inviteToken(tom, hid, { label: 'Grandma', role: 'guest', guestDays: 3 });
  const guest = await person(server, 'Grandma');
  assert.equal((await guest.post(`/api/invites/${token}/accept`)).data.status, 'joined');

  const home = (await guest.get(`/api/households/${hid}`)).data;
  assert.equal(home.me.role, 'guest');
  const days = (Date.parse(home.me.expiresAt) - Date.now()) / 86_400_000;
  assert.ok(days > 2.9 && days <= 3, `stays 3 days (${days})`);
  assert.equal((await guest.post(`/api/households/${hid}/messages`, { text: 'Hello all!' })).status, 201, 'can chat');
  const titles = ((await guest.get(`/api/households/${hid}/items`)).data.items as { title: string }[]).map((i) => i.title);
  assert.deepEqual(titles, ['Wi-Fi'], 'sees shared items, never private ones');
  assert.equal((await guest.post(`/api/households/${hid}/items`, { title: 'Mine' })).status, 403);
  assert.equal((await guest.get(`/api/households/${hid}/money`)).status, 403);
  assert.equal((await guest.post(`/api/households/${hid}/bills`, { amount: 10, category: 'other' })).status, 403);
  assert.equal((await guest.get(`/api/households/${hid}/invites`)).status, 403);

  // Time's up: they're out the next time they (or anyone) look.
  const guestId = await idOf(guest);
  await server.store.setRole(hid, guestId, 'guest', '2000-01-01T00:00:00.000Z');
  assert.equal((await guest.get(`/api/households/${hid}`)).status, 404);
  assert.deepEqual((await guest.get('/api/me')).data.households, []);
  const events = ((await tom.get(`/api/households/${hid}/inbox`)).data.events as { kind: string; subjectName: string }[]).map((e) => [e.kind, e.subjectName]);
  assert.deepEqual(events[0], ['guest_expired', 'Grandma']);
});

test('roles: the owner changes them, a home always keeps an owner, and ownership can be handed over', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh', 'An']);
  const [tom, linh, an] = clients as [Client, Client, Client];
  const [tomId, linhId, anId] = [await idOf(tom), await idOf(linh), await idOf(an)];

  assert.deepEqual((await tom.get(`/api/households/${hid}`)).data.roles, ['owner', 'tenant', 'manager', 'guest']);
  assert.equal((await tom.patch(`/api/households/${hid}/members/${anId}`, { role: 'child' })).data.error, 'role_invalid', 'no children in a share house');
  assert.equal((await tom.patch(`/api/households/${hid}/members/${tomId}`, { role: 'tenant' })).data.error, 'last_owner');
  assert.equal((await tom.del(`/api/households/${hid}/members/${tomId}`)).data.error, 'owner_cannot_leave');
  await tom.patch(`/api/households/${hid}/members/${anId}`, { role: 'guest', guestDays: 7 });
  assert.equal((await tom.post(`/api/households/${hid}/transfer`, { to: anId })).data.error, 'guest_cannot_own');
  await tom.patch(`/api/households/${hid}/members/${anId}`, { role: 'tenant' });

  // Hand over: Linh owns it, Tom stays as manager.
  assert.equal((await tom.post(`/api/households/${hid}/transfer`, { to: linhId })).status, 200);
  assert.equal(await roleIn(linh, hid, 'Linh'), 'owner');
  assert.equal(await roleIn(linh, hid, 'Tom'), 'manager');
  assert.equal((await tom.patch(`/api/households/${hid}/members/${anId}`, { role: 'manager' })).status, 403, 'Tom no longer owns it');
  assert.equal(((await tom.get('/api/me')).data.households as { role: string }[])[0]!.role, 'manager');

  // Two owners: one may step down or leave.
  await linh.patch(`/api/households/${hid}/members/${anId}`, { role: 'owner' });
  assert.equal((await an.del(`/api/households/${hid}/members/${anId}`)).status, 200, 'a second owner can leave');
  assert.equal((await linh.patch(`/api/households/${hid}/members/${linhId}`, { role: 'manager' })).data.error, 'last_owner');

  // The owner's log has all of it, in order.
  const log = ((await linh.get(`/api/households/${hid}/log`)).data.events as { kind: string; actorName: string; subjectName: string; role: string }[]).map(
    (e) => `${e.kind}:${e.actorName ?? ''}>${e.subjectName ?? ''}:${e.role ?? ''}`,
  );
  assert.deepEqual(log.slice(0, 6), [
    'member_left:>An:',
    'role_changed:Linh>An:owner',
    'owner_transferred:Tom>Linh:',
    'role_changed:Tom>An:tenant',
    'role_changed:Tom>An:guest',
    'member_joined:Tom>An:tenant',
  ]);
  assert.ok(log.some((l) => l.startsWith('invite_created:Tom')));
});
