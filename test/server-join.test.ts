import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, houseOf, inviteToken, testServer, type Server } from './server-helpers.js';

async function owned(server: Server, name: string, opts: { samples?: boolean; kind?: string } = {}) {
  const c = new Client(server);
  await c.signup(name);
  const hid = (await c.post('/api/households', { name: `${name}'s home`, samples: opts.samples ?? false, kind: opts.kind })).data.id as string;
  return { c, hid };
}
async function person(server: Server, name: string) {
  const c = new Client(server);
  await c.signup(name);
  return c;
}
const requestsOf = async (owner: Client, hid: string) => (await owner.get(`/api/households/${hid}/requests`)).data.requests as { id: string; name: string; role: string; via: string; inviteLabel: string }[];

test('personal link: the newcomer asks, sees they are waiting, and the owner lets them in with a role', async () => {
  const server = await testServer();
  const { c: tom, hid } = await owned(server, 'Tom', { kind: 'family' });
  const { token, id } = await inviteToken(tom, hid, { label: 'Linh', role: 'family_member' });

  const preview = await new Client(server).get(`/api/invites/${token}`);
  assert.deepEqual(preview.data, { householdName: "Tom's home", inviterName: 'Tom', label: 'Linh', needsApproval: true, alreadyMember: false });

  const linh = await person(server, 'Linh');
  assert.deepEqual((await linh.post(`/api/invites/${token}/accept`)).data, { status: 'pending', householdName: "Tom's home" });
  assert.equal((await linh.get(`/api/households/${hid}`)).status, 404, 'nothing visible before approval');
  assert.equal((await linh.get('/api/me')).data.requests[0].status, 'pending');
  assert.equal((await linh.post(`/api/invites/${token}/accept`)).data.status, 'pending', 'coming back to the link just shows the wait');

  assert.equal((await tom.get(`/api/households/${hid}`)).data.pendingRequests, 1);
  const [request] = await requestsOf(tom, hid);
  assert.deepEqual([request!.name, request!.role, request!.via, request!.inviteLabel], ['Linh', 'family_member', 'link', 'Linh']);
  assert.equal((await tom.post(`/api/households/${hid}/requests/${request!.id}/approve`, { role: 'owner' })).data.error, 'role_invalid');
  assert.equal((await tom.post(`/api/households/${hid}/requests/${request!.id}/approve`, { role: 'child' })).status, 200);

  const members = (await linh.get(`/api/households/${hid}`)).data.members as { name: string; role: string }[];
  assert.deepEqual(members.find((m) => m.name === 'Linh')?.role, 'child', 'the owner’s choice of role wins');
  assert.equal((await linh.get('/api/me')).data.requests[0].status, 'approved', 'told once that they got in');
  assert.equal((await linh.post(`/api/invites/${token}/accept`)).data.status, 'member');
  const links = (await tom.get(`/api/households/${hid}/invites`)).data.links as { id: string; status: string; usedBy: string; url: string | null }[];
  assert.deepEqual(links.map((l) => [l.id, l.status, l.usedBy, l.url]), [[id, 'used', 'Linh', null]]);
});

test('a link works once: a second person is turned away', async () => {
  const server = await testServer();
  const { c: tom, hid } = await owned(server, 'Tom');
  const { token, url } = await inviteToken(tom, hid);
  const first = await person(server, 'First');
  const second = await person(server, 'Second');
  assert.equal((await first.post('/api/join', { invite: `Come join: ${url}` })).data.status, 'pending');
  const again = await second.post(`/api/invites/${token}/accept`);
  assert.equal(again.status, 410);
  assert.equal(again.data.error, 'invite_used');
  assert.equal((await second.get(`/api/invites/${token}`)).data.error, 'invite_used');
  assert.equal((await requestsOf(tom, hid)).length, 1);
});

test('without approval a link joins straight away — still only once', async () => {
  const server = await testServer();
  const { c: tom, hid } = await owned(server, 'Tom');
  assert.equal((await tom.patch(`/api/households/${hid}`, { approveJoins: false })).status, 200);
  const { token } = await inviteToken(tom, hid);
  const ana = await person(server, 'Ana');
  const joined = await ana.post(`/api/invites/${token}/accept`);
  assert.deepEqual(joined.data, { status: 'joined', householdId: hid, householdName: "Tom's home" });
  assert.equal((await ana.get(`/api/households/${hid}`)).status, 200);
  assert.equal((await (await person(server, 'Ben')).post(`/api/invites/${token}/accept`)).status, 410);
});

test('expired, cancelled and made-up links fail; the invite list shows why', async () => {
  const server = await testServer();
  const { c: tom, hid } = await owned(server, 'Tom');
  const old = await inviteToken(tom, hid, { label: 'Old' });
  const cancelled = await inviteToken(tom, hid, { label: 'Cancelled' });
  await server.db.run('UPDATE invites SET expires_at = ? WHERE id = ?', '2000-01-01T00:00:00Z', old.id);
  assert.equal((await tom.del(`/api/households/${hid}/invites/${cancelled.id}`)).status, 200);

  const ana = await person(server, 'Ana');
  assert.equal((await ana.post(`/api/invites/${old.token}/accept`)).data.error, 'invite_expired');
  assert.equal((await ana.post(`/api/invites/${cancelled.token}/accept`)).data.error, 'invite_expired');
  assert.equal((await ana.get('/api/invites/not-a-real-token-at-all-xx')).status, 404);
  assert.equal((await ana.post('/api/join', { invite: 'hello' })).data.error, 'invite_invalid');
  const statuses = Object.fromEntries(((await tom.get(`/api/households/${hid}/invites`)).data.links as { label: string; status: string }[]).map((l) => [l.label, l.status]));
  assert.deepEqual(statuses, { Old: 'expired', Cancelled: 'revoked' });
  assert.equal((await ana.get(`/api/households/${hid}`)).status, 404);
});

test('the shared code only ever asks to join; remaking it retires the old one', async () => {
  const server = await testServer();
  const { c: tom, hid } = await owned(server, 'Tom');
  await tom.patch(`/api/households/${hid}`, { approveJoins: false }); // even then, the code only asks
  const first = (await tom.post(`/api/households/${hid}/code`)).data;
  assert.match(first.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal((await tom.get(`/api/households/${hid}/invites`)).data.code.code, first.code);

  const bao = await person(server, 'Bao');
  assert.deepEqual((await bao.post('/api/join', { invite: first.code.toLowerCase().replace('-', ' ') })).data, { status: 'pending', householdName: "Tom's home" });
  assert.equal((await bao.post('/api/join', { invite: first.code })).data.status, 'pending', 'asking again does not duplicate');
  assert.equal((await requestsOf(tom, hid)).length, 1);
  assert.equal((await bao.get(`/api/households/${hid}`)).status, 404);

  const second = (await tom.post(`/api/households/${hid}/code`)).data;
  const kim = await person(server, 'Kim');
  assert.equal((await kim.post('/api/join', { invite: first.code })).data.error, 'invite_invalid');
  assert.equal((await kim.post('/api/join', { invite: second.code })).data.status, 'pending');
  await tom.del(`/api/households/${hid}/code`);
  assert.equal((await tom.get(`/api/households/${hid}/invites`)).data.code, null);
  assert.equal((await (await person(server, 'Lan')).post('/api/join', { invite: second.code })).data.error, 'invite_invalid');
});

test('declined: the person is told, and can’t ask again for a day', async () => {
  const server = await testServer();
  const { c: tom, hid } = await owned(server, 'Tom');
  const { code } = (await tom.post(`/api/households/${hid}/code`)).data;
  const kim = await person(server, 'Kim');
  await kim.post('/api/join', { invite: code });
  const [request] = await requestsOf(tom, hid);
  assert.equal((await tom.post(`/api/households/${hid}/requests/${request!.id}/decline`)).status, 200);
  assert.equal((await kim.get(`/api/households/${hid}`)).status, 404);
  assert.equal((await kim.get('/api/me')).data.requests[0].status, 'declined');
  assert.equal((await kim.post('/api/join', { invite: code })).data.error, 'request_declined');
  await kim.del(`/api/join-requests/${request!.id}`);
  assert.equal((await kim.get('/api/me')).data.requests.length, 0);
  assert.equal((await kim.post('/api/join', { invite: code })).data.error, 'request_declined', 'hiding it does not reset the wait');
  assert.equal((await tom.post(`/api/households/${hid}/requests/${request!.id}/approve`)).status, 404, 'decided once');
});

test('wrong links and codes lock out after 10 tries', async () => {
  const server = await testServer();
  const { c: tom, hid } = await owned(server, 'Tom');
  const { code } = (await tom.post(`/api/households/${hid}/code`)).data;
  const guesser = await person(server, 'Guesser');
  for (let i = 0; i < 10; i++) assert.equal((await guesser.post('/api/join', { invite: `ZZZZ-Z${'23456789'[i % 8]}${'23456789'[(i + 3) % 8]}Z` })).status, 404);
  const blocked = await guesser.post('/api/join', { invite: code });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error, 'too_many_attempts');
  assert.equal((await new Client(server).post('/api/join', { invite: code })).data.error, 'not_signed_in');
});

test('who can do what: only the owner invites and lets people in; strangers see nothing', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh']);
  const [tom, linh] = clients as [Client, Client];
  const stranger = await person(server, 'Stranger');
  const { code } = (await tom.post(`/api/households/${hid}/code`)).data;
  await stranger.post('/api/join', { invite: code });
  const [request] = await requestsOf(tom, hid);

  for (const [who, expected] of [[linh, 403], [stranger, 404]] as const) {
    assert.equal((await who.get(`/api/households/${hid}/invites`)).status, expected);
    assert.equal((await who.post(`/api/households/${hid}/invites`, {})).status, expected);
    assert.equal((await who.post(`/api/households/${hid}/code`)).status, expected);
    assert.equal((await who.get(`/api/households/${hid}/requests`)).status, expected);
    assert.equal((await who.post(`/api/households/${hid}/requests/${request!.id}/approve`)).status, expected);
    assert.equal((await who.patch(`/api/households/${hid}`, { approveJoins: false })).status, expected);
  }
  assert.equal((await linh.get(`/api/households/${hid}`)).data.pendingRequests, 0);
  assert.equal((await linh.get(`/api/households/${hid}`)).data.canInvite, false);
  assert.equal((await stranger.get(`/api/households/${hid}`)).status, 404);
  assert.equal((await stranger.get(`/api/households/${hid}/messages`)).status, 404);
});

test('someone stuck in an empty home of their own joins Tom and deletes the empty one', async () => {
  const server = await testServer();
  const { c: tom, hid: tomHome } = await owned(server, 'Tom');
  const { c: friend, hid: emptyHome } = await owned(server, 'Friend', { samples: true });
  const { url } = await inviteToken(tom, tomHome);
  assert.equal((await friend.post('/api/join', { invite: url })).data.status, 'pending');
  const [request] = await requestsOf(tom, tomHome);
  await tom.post(`/api/households/${tomHome}/requests/${request!.id}/approve`);
  assert.deepEqual(((await friend.get('/api/me')).data.households as { id: string }[]).map((h) => h.id).sort(), [tomHome, emptyHome].sort());

  assert.equal((await friend.get(`/api/households/${emptyHome}`)).data.canDelete, true);
  assert.equal((await friend.del(`/api/households/${emptyHome}`)).status, 200);
  assert.deepEqual(((await friend.get('/api/me')).data.households as { id: string }[]).map((h) => h.id), [tomHome]);
  assert.equal((await friend.get(`/api/households/${emptyHome}`)).status, 404);
  assert.equal((await friend.get('/api/me')).data.user.name, 'Friend', 'the account stays');

  // Not deletable: someone else is in it, it holds real content, or you're not the owner.
  assert.equal((await tom.get(`/api/households/${tomHome}`)).data.canDelete, false);
  assert.equal((await tom.del(`/api/households/${tomHome}`)).data.error, 'home_not_empty');
  assert.equal((await friend.del(`/api/households/${tomHome}`)).status, 403);
  const { c: chatty, hid: chattyHome } = await owned(server, 'Chatty');
  await chatty.post(`/api/households/${chattyHome}/messages`, { text: 'hi' });
  assert.equal((await chatty.get(`/api/households/${chattyHome}`)).data.canDelete, false);
  assert.equal((await chatty.del(`/api/households/${chattyHome}`)).status, 400);
  const { c: noted, hid: notedHome } = await owned(server, 'Noted');
  await noted.post(`/api/households/${notedHome}/items`, { title: 'A real note' });
  assert.equal((await noted.del(`/api/households/${notedHome}`)).status, 400);
});
