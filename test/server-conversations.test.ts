import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIntent } from '../server/bots.js';
import { Client, JPEG, houseOf, testServer } from './server-helpers.js';

type Msg = { id: string; text: string; userId: string | null; conversation: string | null; bot: { bot: string; key: string; params?: any } | null };
const texts = (r: { data: { messages: Msg[] } }) => r.data.messages.map((m) => m.text || m.bot?.key);

test('private chats: only the two people see them — not the owner, not in the group, not in the export', async () => {
  const server = await testServer();
  const { hid, clients, users } = await houseOf(server, ['Tom', 'Linh', 'An']);
  const [tom, linh, an] = clients;
  const [tomU, linhU, anU] = users;
  const msgs = `/api/households/${hid}/messages`;

  await tom!.post(msgs, { text: 'For everyone' });
  const dm = await linh!.post(msgs, { text: 'Just between us', conversation: `dm:${anU!.id}` });
  assert.equal(dm.status, 201);
  assert.equal(dm.data.conversation, `dm:${[linhU!.id, anU!.id].sort().join(':')}`);
  await an!.post(msgs, { text: 'Sure', conversation: `dm:${linhU!.id}` });

  assert.deepEqual(texts(await an!.get(`${msgs}?conversation=dm:${linhU!.id}`)), ['Just between us', 'Sure']);
  assert.deepEqual(texts(await linh!.get(`${msgs}?conversation=dm:${anU!.id}`)), ['Just between us', 'Sure']);
  // The group chat doesn't show it; the owner's chat with Linh is a different, empty conversation.
  assert.ok(!texts(await tom!.get(msgs)).includes('Just between us'));
  assert.deepEqual(texts(await tom!.get(`${msgs}?conversation=dm:${linhU!.id}`)), []);
  assert.equal((await tom!.get(`${msgs}?conversation=dm:${tomU!.id}`)).status, 400, 'no chatting with yourself');

  // A photo in a private chat can't be opened by the owner.
  const up = await linh!.req('POST', `/api/households/${hid}/files`, JPEG, { 'Content-Type': 'image/jpeg', 'X-File-Name': 'p.jpg' });
  await linh!.post(msgs, { fileId: up.data.id, conversation: `dm:${anU!.id}` });
  assert.equal((await an!.get(`/api/files/${up.data.id}`)).status, 200);
  assert.equal((await tom!.get(`/api/files/${up.data.id}`)).status, 404);

  // The owner's export has the group chat only.
  const parsed = (await tom!.get(`/api/households/${hid}/export?format=json`)).data;
  assert.ok(parsed.messages.some((m: { text: string }) => m.text === 'For everyone'));
  assert.ok(!parsed.messages.some((m: { text: string }) => m.text === 'Just between us' || m.text === 'Sure'));

  // Only people in this home; a stranger can't be messaged.
  const stranger = new Client(server);
  const s = await stranger.signup('Stranger');
  assert.equal((await tom!.post(msgs, { text: 'hi', conversation: `dm:${s.id}` })).data.error, 'conversation_invalid');
  assert.equal((await tom!.post(msgs, { text: 'hi', conversation: 'bot:robocop' })).data.error, 'conversation_invalid');

  // The list of conversations shows last messages to the right people only.
  const anList = (await an!.get(`/api/households/${hid}/conversations`)).data;
  assert.equal(anList.people.find((p: { id: string }) => p.id === linhU!.id).last.text, '');
  assert.equal(anList.group.last.text, 'For everyone');
  const tomList = (await tom!.get(`/api/households/${hid}/conversations`)).data;
  assert.equal(tomList.people.find((p: { id: string }) => p.id === linhU!.id).last, null);
  assert.deepEqual(tomList.bots.map((b: { id: string }) => b.id), ['tom', 'james', 'timothy', 'ella', 'nolan']);
});

test('people from my other homes show up as contacts; their chat lives in the home we share', async () => {
  const server = await testServer();
  const { hid: home1, clients, users } = await houseOf(server, ['Tom', 'Linh']);
  const tom = clients[0]!;
  const kim = new Client(server);
  const kimU = await kim.signup('Kim');
  const home2 = (await kim.post('/api/households', { name: 'Kim home', currency: 'VND' })).data.id;
  const invite = await kim.post(`/api/households/${home2}/invites`, { label: 'Tom' });
  await tom.post(`/api/invites/${new URL(invite.data.url).pathname.split('/').pop()}/accept`);
  const req = (await kim.get(`/api/households/${home2}/requests`)).data.requests[0];
  await kim.post(`/api/households/${home2}/requests/${req.id}/approve`);
  const list = (await tom.get(`/api/households/${home1}/conversations`)).data;
  assert.deepEqual(list.people.map((p: { name: string }) => p.name), ['Linh']);
  assert.deepEqual(list.elsewhere, [{ householdId: home2, householdName: 'Kim home', id: kimU.id, name: 'Kim', avatar: list.elsewhere[0].avatar }]);
  assert.equal(users.length, 2);
});

test('MATE and the characters: notes, appointments, recall, suggestions — rule-based, private to me', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh']);
  const [tom, linh] = clients;
  const msgs = `/api/households/${hid}/messages`;
  const say = async (who: Client, text: string, bot = 'ella') => {
    await who.post(msgs, { text, conversation: `bot:${bot}`, localTime: '2026-10-02T10:00' });
    const list = (await who.get(`${msgs}?conversation=bot:${bot}`)).data.messages as Msg[];
    return list.at(-1)!.bot!;
  };

  const saved = await say(tom!, 'ghi chú: Mật khẩu wifi là caphe123');
  assert.deepEqual([saved.key, saved.params.title, saved.bot], ['noteSaved', 'Mật khẩu wifi là caphe123', 'ella']);
  const items = (await linh!.get(`/api/households/${hid}/items`)).data.items as { title: string }[];
  assert.ok(items.some((i) => i.title === 'Mật khẩu wifi là caphe123'), 'saved to the home library, shared');
  assert.equal((await say(tom!, 'ghi riêng: số tài khoản 0123')).key, 'noteSavedPrivate');
  assert.ok(!((await linh!.get(`/api/households/${hid}/items`)).data.items as { title: string }[]).some((i) => i.title.includes('0123')));

  const added = await say(tom!, 'lịch: thứ 7 lúc 9h đưa Bin đi tiêm', 'james');
  assert.deepEqual([added.key, added.params.date, added.params.time], ['eventAdded', '2026-10-03', '09:00']);
  const cal = (await linh!.get(`/api/households/${hid}/calendar?from=2026-10-01&to=2026-10-31`)).data.events as { title: string }[];
  assert.deepEqual(cal.map((e) => e.title), ['thứ 7 lúc 9h đưa Bin đi tiêm']);
  assert.equal((await say(tom!, 'nhắc tôi đi chợ')).key, 'needDate');

  const found = await say(tom!, 'tìm wifi');
  assert.equal(found.key, 'found');
  assert.deepEqual(found.params.items.map((i: { title: string }) => i.title), ['Mật khẩu wifi là caphe123']);
  assert.equal((await say(tom!, 'tìm Bin')).params.items[0].type, 'event');
  assert.equal((await say(tom!, 'find unicorn')).key, 'notFound');
  assert.equal((await say(tom!, 'Sắp tới có gì?')).key, 'upcoming');
  const suggest = await say(tom!, 'gợi ý giúp mình');
  assert.equal(suggest.key, 'suggest');
  assert.equal((await say(tom!, 'chào Nolan', 'nolan')).key, 'hello');
  assert.equal((await say(tom!, 'blah blah', 'nolan')).key, 'help');

  // Nobody else sees my chat with a character — not even in theirs.
  assert.deepEqual(texts(await linh!.get(`${msgs}?conversation=bot:ella`)), []);
  assert.ok(!texts(await linh!.get(msgs)).includes('tìm wifi'));
});

test('bot commands in all five languages', () => {
  const now = new Date(2026, 9, 2, 10, 0);
  const kinds = (texts: string[]) => texts.map((t) => parseIntent(t, now).kind);
  assert.deepEqual(kinds(['note: buy milk', 'Ghi chú: mua sữa', 'note : acheter du lait', 'Notiz: Milch kaufen', 'noteer: melk kopen']), Array(5).fill('note'));
  assert.deepEqual(kinds(['private: pin 1234', 'ghi riêng: pin', 'privé : code', 'privat: Code', 'privé: code']), Array(5).fill('note'));
  assert.equal((parseIntent('private: pin 1234', now) as { private: boolean }).private, true);
  assert.deepEqual(
    ['calendar: dentist tomorrow 3pm', 'lịch: mai 3 giờ chiều nha sĩ', 'rdv : dentiste demain à 15h', 'Termin: Zahnarzt morgen um 15 Uhr', 'afspraak: tandarts morgen om 15:00'].map((t) => {
      const i = parseIntent(t, now) as { kind: string; date?: string; time?: string };
      return [i.kind, i.date, i.time];
    }),
    Array(5).fill(['event', '2026-10-03', '15:00']),
  );
  assert.deepEqual(kinds(['find lease', 'tìm hợp đồng', 'cherche bail', 'suche Mietvertrag', 'zoek huurcontract']), Array(5).fill('find'));
  assert.equal((parseIntent('Tìm: hợp đồng?', now) as { query: string }).query, 'hợp đồng');
  assert.deepEqual(kinds(["what's next?", 'sắp tới', 'à venir ?', 'Was steht an?', 'binnenkort']), Array(5).fill('upcoming'));
  assert.deepEqual(kinds(['any suggestions?', 'gợi ý đi', 'que faire ?', 'Vorschlag?', 'suggesties?']), Array(5).fill('suggest'));
  assert.deepEqual(kinds(['hello', 'chào', 'bonjour', 'hallo', 'hoi']), Array(5).fill('hello'));
  assert.deepEqual(kinds(['🙂', 'lalala']), ['help', 'help']);
  // The examples the app shows, as typed on a phone (curly apostrophes, spaces before colons).
  assert.deepEqual(kinds(['what’s next?', 'privé : mon code', 'Notiz: WLAN', 'noteer: wifi', 'suche Mietvertrag']), ['upcoming', 'note', 'note', 'note', 'find']);
  assert.deepEqual(parseIntent('afspraak: zaterdag 9 uur zwemmen', now), { kind: 'event', title: 'zaterdag 9 uur zwemmen', date: '2026-10-03', time: '09:00' });
  assert.deepEqual(parseIntent('rdv : samedi 9h piscine', now), { kind: 'event', title: 'samedi 9h piscine', date: '2026-10-03', time: '09:00' });
});
