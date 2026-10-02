import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PermissionDeniedError } from '../src/index.js';
import { shareHouse } from './fixtures.js';

test('property manager sees maintenance only — not finance, wardrobe or private data', () => {
  const { app, hh, bathroom } = shareHouse();
  const issue = app.maintenance.reportIssue('an', hh, {
    title: 'Leaking tap',
    description: 'Drips all night',
    roomId: bathroom.id,
    photos: ['blob://tap.jpg'],
  });
  const bill = app.finance.recordBill('linh', hh, { category: 'electricity', amount: 120 });
  const shirt = app.wardrobe.addGarment('an', hh, { name: 'Linen shirt', category: 'top', colour: 'white' });
  const groceries = app.finance.recordExpense('an', hh, { description: 'Snacks', amount: 9, category: 'food' });

  const acl = app.platform.acl;
  assert.equal(acl.canRead('minh', issue), true);
  assert.equal(acl.canWrite('minh', issue), true);
  assert.equal(acl.canRead('minh', bill), false);
  assert.equal(acl.canRead('minh', shirt), false);
  assert.equal(acl.canRead('minh', groceries), false);
  // Tenants don't see each other's private spending or wardrobes either.
  assert.equal(acl.canRead('linh', groceries), false);
  assert.equal(acl.canRead('linh', shirt), false);

  // Context assembled for the manager stops at the maintenance boundary.
  const labels = app.butler.context('minh', issue.id, 3).nodes.map((n) => n.label);
  assert.ok(labels.includes('Leaking tap'));
  assert.ok(labels.includes('Issue photo'));
  assert.ok(!labels.includes('Electricity bill'));
});

test('contractor only sees issues assigned to them', () => {
  const { app, hh, bathroom, kitchenRoom } = shareHouse();
  const tap = app.maintenance.reportIssue('an', hh, { title: 'Leaking tap', description: '', roomId: bathroom.id, photos: ['p1'] });
  const oven = app.maintenance.reportIssue('an', hh, { title: 'Oven door', description: '', roomId: kitchenRoom.id });
  assert.deepEqual(app.maintenance.issues('bao', hh), []);
  app.maintenance.assign('minh', tap.id, 'bao');
  assert.deepEqual(app.maintenance.issues('bao', hh).map((i) => i.label), ['Leaking tap']);
  assert.equal(app.platform.acl.canRead('bao', oven), false);
  const photo = app.platform.graph.neighbors(tap.id, { relation: 'evidenced_by' })[0]!;
  assert.equal(app.platform.acl.canRead('bao', photo), true);
  app.maintenance.updateStatus('bao', tap.id, 'resolved', 'Replaced washer');
  assert.equal(app.platform.graph.requireNode(tap.id).props.status, 'resolved');
});

test('explicit sharing grants read access to a private node but not write', () => {
  const { app, hh } = shareHouse();
  const shirt = app.wardrobe.addGarment('an', hh, { name: 'Jacket', category: 'outerwear', colour: 'navy' });
  app.platform.graph.share(shirt.id, 'linh');
  assert.equal(app.platform.acl.canRead('linh', shirt), true);
  assert.equal(app.platform.acl.canWrite('linh', shirt), false);
});

test('guests and outsiders cannot create household data', () => {
  const { app, hh } = shareHouse();
  assert.throws(() => app.finance.recordBill('chi', hh, { category: 'water', amount: 50 }), PermissionDeniedError);
  assert.throws(
    () => app.kitchen.addInventory('stranger', hh, { name: 'Eggs', quantity: 6, unit: 'pcs', location: 'fridge' }),
    PermissionDeniedError,
  );
  assert.throws(() => app.maintenance.reportIssue('minh', 'other-household', { title: 'x', description: '' }), PermissionDeniedError);
});
