import assert from 'node:assert/strict';
import { test } from 'node:test';
import { houseOf, testServer } from './server-helpers.js';

type Item = { id: string; title: string; collection: string | null; docType: string | null; date: string | null; expiresOn: string | null; amount: number | null };
type Listing = { items: Item[]; collections: Record<string, number>; expiring: Item[] };

test('collections and rental records: shelves, details, reminders, search', async () => {
  const server = await testServer();
  const { hid, clients } = await houseOf(server, ['Tom', 'Linh']);
  const [tom, linh] = clients;
  const list = async (query = '') => (await tom!.get(`/api/households/${hid}/items?today=2026-10-01${query}`)).data as Listing;

  const lease = await tom!.post(`/api/households/${hid}/items`, {
    kind: 'document', title: 'Lease 2026', collection: 'rental', docType: 'lease', date: '2025-11-01', expiresOn: '2026-10-20', amount: 850000,
  });
  assert.equal(lease.status, 201);
  assert.deepEqual([lease.data.collection, lease.data.docType, lease.data.expiresOn, lease.data.amount], ['rental', 'lease', '2026-10-20', 850000]);
  await tom!.post(`/api/households/${hid}/items`, { title: 'Phở', body: 'Ingredients…', collection: 'recipes', amount: 5, docType: 'lease' });
  await tom!.post(`/api/households/${hid}/items`, { title: 'Bond receipt', collection: 'rental', docType: 'deposit', expiresOn: '2027-06-01' });
  await tom!.post(`/api/households/${hid}/items`, { title: 'Insurance', collection: 'rental', docType: 'other', expiresOn: '2026-09-01', private: true });
  await tom!.post(`/api/households/${hid}/items`, { title: 'Plain note' });

  const all = await list();
  assert.deepEqual(all.collections, { recipes: 1, wishlist: 0, shopping: 0, contacts: 0, house_rules: 0, rental: 3 });
  const recipe = all.items.find((i) => i.title === 'Phở')!;
  assert.deepEqual([recipe.docType, recipe.amount], [null, null], 'record details only on rental records');
  assert.deepEqual((await list('&collection=rental')).items.map((i) => i.title).sort(), ['Bond receipt', 'Insurance', 'Lease 2026']);
  // Expired (Insurance) and due within 30 days (Lease) — soonest first; next June isn't due yet.
  assert.deepEqual(all.expiring.map((i) => i.title), ['Insurance', 'Lease 2026']);
  // Private records stay private, reminders included.
  const linhView = (await linh!.get(`/api/households/${hid}/items?today=2026-10-01`)).data as Listing;
  assert.deepEqual(linhView.expiring.map((i) => i.title), ['Lease 2026']);
  assert.equal(linhView.collections.rental, 2);

  // Search finds details, and filters combine.
  assert.deepEqual((await list('&q=850000')).items.map((i) => i.title), ['Lease 2026']);
  assert.deepEqual((await list('&q=2026-10-20')).items.map((i) => i.title), ['Lease 2026']);
  assert.deepEqual((await list('&collection=rental&kind=document')).items.map((i) => i.title), ['Lease 2026']);

  // Editing: move to another shelf (record details go), clear the expiry.
  const moved = await tom!.patch(`/api/households/${hid}/items/${lease.data.id}`, { collection: 'house_rules' });
  assert.deepEqual([moved.data.collection, moved.data.docType, moved.data.amount, moved.data.expiresOn], ['house_rules', null, null, '2026-10-20']);
  const cleared = await tom!.patch(`/api/households/${hid}/items/${lease.data.id}`, { expiresOn: null, collection: null });
  assert.deepEqual([cleared.data.collection, cleared.data.expiresOn], [null, null]);

  // Bad input is refused with a clear reason.
  assert.equal((await tom!.post(`/api/households/${hid}/items`, { title: 'x', collection: 'cars' })).data.error, 'collection_invalid');
  assert.equal((await tom!.post(`/api/households/${hid}/items`, { title: 'x', collection: 'rental', docType: 'car' })).data.error, 'docType_invalid');
  assert.equal((await tom!.post(`/api/households/${hid}/items`, { title: 'x', expiresOn: '31/12/2026' })).data.error, 'expiresOn_invalid');
  assert.equal((await tom!.get(`/api/households/${hid}/items?collection=cars`)).data.error, 'collection_invalid');
});
