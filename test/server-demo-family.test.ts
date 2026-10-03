import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_PASSWORD } from '../server/demo.js';
import { seedFamily } from '../server/demo-family.js';
import { Client, testServer } from './server-helpers.js';

test('Williams House demo: three people, private and shared calendars, chores, Library, chats', async () => {
  const server = await testServer();
  const demo = await seedFamily('http://localhost', (url, init) => Promise.resolve(server.app.request(url, init)));
  assert.equal(demo.people.length, 3);
  const as = async (email: string) => {
    const c = new Client(server);
    const res = await c.post('/api/auth/login', { email, password: DEMO_PASSWORD });
    assert.equal(res.status, 200);
    return Object.assign(c, { userId: res.data.user.id as string });
  };
  const [tom, james, ella] = [await as(demo.people[0]!.email), await as(demo.people[1]!.email), await as(demo.people[2]!.email)];
  const hid = demo.householdId;

  const cal = async (c: Client) => (await c.get(`/api/households/${hid}/calendar`)).data.events as { title: string; visibility: string }[];
  const [t, j, e] = [await cal(tom), await cal(james), await cal(ella)];
  assert.ok(t.length > j.length - 1 && t.length >= 12, 'Tom sees his own plus the house');
  const shared = (list: typeof t) => list.filter((x) => x.visibility === 'home').length;
  assert.equal(shared(t), 8);
  assert.equal(shared(j), 8);
  assert.equal(shared(e), 8);
  assert.ok(!e.some((x) => x.title.includes('Academy')), "Ella cannot see Tom's private events");
  assert.ok(!j.some((x) => x.title.includes('Visite virtuelle')), "James cannot see Ella's private events");

  const chores = (await tom.get(`/api/households/${hid}/chores`)).data.chores as unknown[];
  assert.equal(chores.length, 6);

  const group = (await tom.get(`/api/households/${hid}/messages`)).data.messages as { text: string }[];
  assert.ok(group.length >= 20);
  assert.ok(group.some((m) => /Bonjour tout le monde/.test(m.text)), 'Ella writes French');
  const dm = (await tom.get(`/api/households/${hid}/messages?conversation=dm:${ella.userId}`)).data.messages as unknown[];
  assert.ok(dm.length >= 3);
  const mate = (await tom.get(`/api/households/${hid}/messages?conversation=bot:tom`)).data.messages as unknown[];
  assert.ok(mate.length >= 2);
  const other = (await james.get(`/api/households/${hid}/messages?conversation=dm:${ella.userId}`)).data.messages as unknown[];
  assert.ok(other.length >= 2);
});
