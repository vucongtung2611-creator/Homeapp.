import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import { Client, houseOf, JPEG, testServer } from './server-helpers.js';

/** Read a stored (uncompressed) ZIP and check every entry's checksum. */
function unzip(bytes: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(bytes);
  const out = new Map<string, Buffer>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const crc = buf.readUInt32LE(at + 14);
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8');
    const data = buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    assert.equal(crc32(data) >>> 0, crc, `checksum of ${name}`);
    out.set(name, data);
    at += 30 + nameLen + size;
  }
  assert.equal(buf.readUInt32LE(at), 0x02014b50, 'central directory follows');
  return out;
}

test('the owner downloads the whole home; other people’s private items stay out', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh']);
  const [tom, linh] = clients as [Client, Client];
  const photo = await tom.req('POST', `/api/households/${hid}/files`, JPEG, { 'X-File-Name': 'kitchen.jpg' });
  await tom.post(`/api/households/${hid}/messages`, { text: 'Look!', fileId: photo.data.id });
  await tom.post(`/api/households/${hid}/items`, { title: 'Lease', collection: 'rental', docType: 'lease', expiresOn: '2027-01-31', amount: 1200 });
  await tom.post(`/api/households/${hid}/items`, { title: 'Tom’s secret', private: true });
  await linh.post(`/api/households/${hid}/items`, { title: 'Linh’s diary', private: true });

  const res = await tom.get(`/api/households/${hid}/export`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="mate-nha-test-\d{4}-\d{2}-\d{2}\.zip"/);
  const entries = unzip(new Uint8Array(res.data as ArrayBuffer));
  const data = JSON.parse(entries.get('data.json')!.toString('utf8'));
  assert.equal(data.household.name, 'Nhà test');
  assert.deepEqual(data.members.map((m: { name: string; role: string }) => [m.name, m.role]), [['Tom', 'owner'], ['Linh', 'tenant']]);
  const titles = data.library.map((i: { title: string }) => i.title).sort();
  assert.deepEqual(titles, ['Lease', 'Tom’s secret'], 'never another person’s private item');
  const lease = data.library.find((i: { title: string }) => i.title === 'Lease');
  assert.deepEqual([lease.collection, lease.docType, lease.expiresOn, lease.amount], ['rental', 'lease', '2027-01-31', 1200]);
  const withPhoto = data.messages.find((m: { text: string }) => m.text === 'Look!');
  assert.ok(withPhoto.file && entries.has(withPhoto.file), 'the chat photo is in files/');
  assert.deepEqual([...entries.get(withPhoto.file)!], [...JPEG]);
  assert.ok(data.log.some((e: { kind: string }) => e.kind === 'member_joined'));
  assert.ok(entries.has('README.txt'));

  const json = await tom.get(`/api/households/${hid}/export?format=json`);
  assert.equal(json.data.app, 'MATE');

  // Only the owner.
  assert.equal((await linh.get(`/api/households/${hid}/export`)).status, 403);
  await tom.patch(`/api/households/${hid}/members/${(await linh.get('/api/me')).data.user.id}`, { role: 'manager' });
  assert.equal((await linh.get(`/api/households/${hid}/export`)).status, 403);
  assert.equal((await new Client(server).get(`/api/households/${hid}/export`)).status, 403);
});

test('guessing one account’s password from many addresses is slowed down too', async () => {
  const server = await testServer({ trustProxy: true });
  const tom = new Client(server);
  await tom.signup('Tom', 'tom@example.com');
  let last = 0;
  for (let i = 0; i < 31; i++) {
    const res = await new Client(server).req('POST', '/api/auth/login', { email: 'TOM@example.com ', password: `wrong-${i}` }, { 'X-Forwarded-For': `203.0.113.${i}` });
    last = res.status;
    if (i < 30) assert.equal(res.status, 401, `attempt ${i + 1}`);
  }
  assert.equal(last, 429, 'the 31st try in 15 minutes is refused, whatever the address');
});
