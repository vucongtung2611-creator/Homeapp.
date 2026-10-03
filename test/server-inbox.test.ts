import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, houseOf, inviteToken, testServer, type Server } from './server-helpers.js';

async function person(server: Server, name: string) {
  const c = new Client(server);
  await c.signup(name);
  return c;
}
type Event = { kind: string; actorName: string | null; subjectName: string | null; unread: boolean; label: string | null };
const inbox = async (c: Client, hid: string) => (await c.get(`/api/households/${hid}/inbox`)).data.events as Event[];
const kinds = async (c: Client, hid: string) => (await inbox(c, hid)).map((e) => e.kind);
const unread = async (c: Client, hid: string) => (await c.get(`/api/households/${hid}`)).data.unreadInbox as number;

test('the owner’s inbox shows invites, requests and who joined; housemates only see who came and went', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh']);
  const [tom, linh] = clients as [Client, Client];
  await tom.post(`/api/households/${hid}/inbox/read`);
  await linh.post(`/api/households/${hid}/inbox/read`);
  assert.equal(await unread(tom, hid), 0);

  const { token } = await inviteToken(tom, hid, { label: 'Bao' });
  assert.equal(await unread(tom, hid), 0, 'your own actions are not news to you');
  const bao = await person(server, 'Bao');
  await bao.post(`/api/invites/${token}/accept`);
  assert.equal(await unread(tom, hid), 1);
  assert.equal(await unread(linh, hid), 0, 'requests are for the owner');
  const requested = (await inbox(tom, hid)).find((e) => e.kind === 'join_requested')!;
  assert.deepEqual([requested.subjectName, requested.unread], ['Bao', true]);

  const [request] = (await tom.get(`/api/households/${hid}/requests`)).data.requests;
  await tom.post(`/api/households/${hid}/requests/${request.id}/approve`);
  assert.equal(await unread(linh, hid), 1, 'everyone hears that Bao moved in');
  const joined = (await inbox(linh, hid)).find((e) => e.kind === 'member_joined' && e.subjectName === 'Bao')!;
  assert.equal(joined.actorName, 'Tom');
  assert.ok(!(await kinds(linh, hid)).some((k) => ['invite_created', 'join_requested'].includes(k)));
  assert.equal((await inbox(bao, hid)).find((e) => e.subjectName === 'Bao')?.unread, false, 'your own arrival is not unread');

  await linh.post(`/api/households/${hid}/inbox/read`);
  assert.equal(await unread(linh, hid), 0);

  // Leaving and being removed are announced to everyone.
  await bao.del(`/api/households/${hid}/members/${(await bao.get('/api/me')).data.user.id}`);
  const linhId = (await linh.get('/api/me')).data.user.id;
  await tom.del(`/api/households/${hid}/members/${linhId}`);
  const tomKinds = await kinds(tom, hid);
  assert.ok(tomKinds.includes('member_left') && tomKinds.includes('member_removed'));
  const removed = (await inbox(tom, hid)).find((e) => e.kind === 'member_removed')!;
  assert.deepEqual([removed.actorName, removed.subjectName], ['Tom', 'Linh']);
  assert.equal((await linh.get(`/api/households/${hid}/inbox`)).status, 404, 'gone means gone');
  assert.equal((await (await person(server, 'Stranger')).get(`/api/households/${hid}/inbox`)).status, 404);
});

test('invite and code changes are logged for the owner', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom']);
  const tom = clients[0]!;
  const { id } = await inviteToken(tom, hid, { label: 'An' });
  await tom.del(`/api/households/${hid}/invites/${id}`);
  await tom.post(`/api/households/${hid}/code`);
  await tom.del(`/api/households/${hid}/code`);
  await tom.patch(`/api/households/${hid}`, { approveJoins: false });
  assert.deepEqual((await kinds(tom, hid)).slice(0, 5), ['approval_off', 'code_revoked', 'code_created', 'invite_revoked', 'invite_created']);
  assert.equal((await inbox(tom, hid)).find((e) => e.kind === 'invite_revoked')?.label, 'An');
});

test('the person asking is told when they are let in or turned down', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom']);
  const tom = clients[0]!;
  const { code } = (await tom.post(`/api/households/${hid}/code`)).data;
  const ana = await person(server, 'Ana');
  const kim = await person(server, 'Kim');
  await ana.post('/api/join', { invite: code });
  await kim.post('/api/join', { invite: code });
  const requests = (await tom.get(`/api/households/${hid}/requests`)).data.requests as { id: string; name: string }[];
  await tom.post(`/api/households/${hid}/requests/${requests.find((r) => r.name === 'Ana')!.id}/approve`);
  await tom.post(`/api/households/${hid}/requests/${requests.find((r) => r.name === 'Kim')!.id}/decline`);

  const [anaNews] = (await ana.get('/api/me')).data.requests;
  assert.deepEqual([anaNews.status, anaNews.householdId, anaNews.householdName], ['approved', hid, 'Nhà test']);
  await ana.del(`/api/join-requests/${anaNews.id}`);
  assert.equal((await ana.get('/api/me')).data.requests.length, 0, 'seen once, then gone');

  const [kimNews] = (await kim.get('/api/me')).data.requests;
  assert.deepEqual([kimNews.status, kimNews.householdId], ['declined', undefined]);
  await kim.del(`/api/join-requests/${kimNews.id}`);
  assert.equal((await kim.get('/api/me')).data.requests.length, 0);
  assert.equal((await kim.post('/api/join', { invite: code })).data.error, 'request_declined');

  // Cancelling a waiting request tells the owner.
  const lan = await person(server, 'Lan');
  await lan.post('/api/join', { invite: code });
  await lan.del(`/api/join-requests/${(await lan.get('/api/me')).data.requests[0].id}`);
  assert.equal((await kinds(tom, hid))[0], 'request_cancelled');
  assert.equal((await tom.get(`/api/households/${hid}`)).data.pendingRequests, 0);
});

test('sent invites say whether the person is waiting, got in, or was turned down', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom']);
  const tom = clients[0]!;
  const outcomes = async () =>
    Object.fromEntries(((await tom.get(`/api/households/${hid}/invites`)).data.links as { label: string; outcome: string | null; usedBy: string | null }[]).map((l) => [l.label, [l.outcome, l.usedBy]]));
  const forAn = await inviteToken(tom, hid, { label: 'An' });
  const forKim = await inviteToken(tom, hid, { label: 'Kim' });
  await inviteToken(tom, hid, { label: 'Unused' });
  const an = await person(server, 'An');
  const kim = await person(server, 'Kim');
  await an.post(`/api/invites/${forAn.token}/accept`);
  await kim.post(`/api/invites/${forKim.token}/accept`);
  assert.deepEqual(await outcomes(), { An: ['waiting', 'An'], Kim: ['waiting', 'Kim'], Unused: [null, null] });
  const requests = (await tom.get(`/api/households/${hid}/requests`)).data.requests as { id: string; name: string }[];
  await tom.post(`/api/households/${hid}/requests/${requests.find((r) => r.name === 'An')!.id}/approve`);
  await tom.post(`/api/households/${hid}/requests/${requests.find((r) => r.name === 'Kim')!.id}/decline`);
  assert.deepEqual(await outcomes(), { An: ['accepted', 'An'], Kim: ['declined', 'Kim'], Unused: [null, null] });
});
