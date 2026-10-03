import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_PASSWORD, seedDemo } from '../server/demo.js';
import { Client, testServer } from './server-helpers.js';

for (const lang of ['vi', 'en'] as const) {
  test(`demo home (${lang}): four people, chat, Library, a parsed and paid bill`, async () => {
    const server = await testServer();
    const demo = await seedDemo('http://localhost', lang, new Date(), (url, init) => Promise.resolve(server.app.request(url, init)));
    assert.equal(demo.people.length, 4);
    assert.equal(demo.bill.kind, 'bill');
    assert.equal(demo.bill.category, 'electricity');
    assert.ok(demo.bill.dueDate && demo.bill.periodStart && demo.bill.periodEnd);

    const as = async (email: string) => {
      const c = new Client(server);
      const res = await c.post('/api/auth/login', { email, password: DEMO_PASSWORD });
      assert.equal(res.status, 200);
      return Object.assign(c, { userId: res.data.user.id as string });
    };
    const [tom, other] = [await as(demo.people[0]!.email), await as(demo.people[1]!.email)];
    const hid = demo.householdId;
    const messages = (await tom.get(`/api/households/${hid}/messages`)).data.messages as { file: unknown }[];
    assert.ok(messages.length >= 8);
    assert.ok(messages.some((m) => m.file), 'a photo in the chat');

    // The private note is only Tom's.
    const tomItems = (await tom.get(`/api/households/${hid}/items`)).data.items as unknown[];
    const otherItems = (await other.get(`/api/households/${hid}/items`)).data.items as unknown[];
    assert.equal(tomItems.length, 9);
    assert.equal(otherItems.length, 8);

    const money = (await tom.get(`/api/households/${hid}/money`)).data;
    assert.equal(money.bills.length, 2);
    assert.ok(money.bills.some((b: { status: string; payerId?: string }) => b.status === 'paid' && b.payerId === other.userId));
  });
}
