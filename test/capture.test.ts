import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RuleBasedExtractor } from '../src/index.js';
import { shareHouse } from './fixtures.js';

const extractor = new RuleBasedExtractor();

test('extracts carrier-specific tracking numbers', () => {
  const facts = extractor.extract({
    source: 'email',
    body: 'Your UPS parcel 1Z999AA10123456784 is on its way. Royal Mail item AB123456789GB too.',
  });
  assert.deepEqual(
    facts.map((f) => f.kind === 'tracking' && [f.carrier, f.trackingNumber]),
    [
      ['UPS', '1Z999AA10123456784'],
      ['Royal Mail', 'AB123456789GB'],
    ],
  );
});

test('plain-digit formats need the carrier to be named', () => {
  assert.equal(extractor.extract({ source: 'email', body: 'Call us on 0412345678' }).length, 0);
  const dhl = extractor.extract({ source: 'email', body: 'DHL Express waybill 1234567890' });
  assert.deepEqual(dhl, [{ kind: 'tracking', trackingNumber: '1234567890', carrier: 'DHL' }]);
});

test('understands receipts and bills', () => {
  const [receipt] = extractor.extract({
    source: 'email',
    from: 'orders@dyson.com.au',
    subject: 'Your order confirmation',
    body: 'Order #DY-88213\nHot+Cool heater\nOrder total: $1,049.00',
  });
  assert.deepEqual(receipt, { kind: 'receipt', retailer: 'Dyson', orderNumber: 'DY-88213', total: 1049, currency: 'AUD' });

  const [bill] = extractor.extract({
    source: 'email',
    subject: 'Your electricity bill is ready',
    body: 'Billing period 1 Jul – 30 Sep. Amount due: $312.45. Payment due by 2026-10-20.',
  });
  assert.deepEqual(bill, {
    kind: 'bill',
    category: 'electricity',
    amount: 312.45,
    currency: 'AUD',
    dueDate: '2026-10-20',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
  });
});

test('an order email becomes order + receipt + private transaction + household-visible parcel', () => {
  const { app, hh } = shareHouse();
  const result = app.capture.ingest('linh', hh, {
    source: 'email',
    from: 'orders@dyson.com.au',
    subject: 'Dyson order shipped',
    body: 'Thank you for shopping with Dyson. Order #DY-88213. Order total: $1,049.00. UPS tracking 1Z999AA10123456784.',
  });
  assert.equal(result.actions.length, 2);

  const parcels = app.delivery.parcels('linh', hh);
  assert.equal(parcels.length, 1);
  assert.equal(parcels[0]!.retailer, 'Dyson');
  assert.equal(parcels[0]!.recipient, 'Linh');

  // Housemate sees the parcel is coming, but not what was bought or for how much.
  const anView = app.delivery.parcels('an', hh);
  assert.equal(anView.length, 1);
  assert.equal(anView[0]!.order, undefined);
  assert.equal(anView[0]!.retailer, undefined);
  assert.equal(app.finance.monthlyReport('an', hh, '2026-10').total, 0);
  assert.equal(app.finance.monthlyReport('linh', hh, '2026-10').total, 1049);

  // Re-ingesting the same email doesn't duplicate the parcel.
  app.capture.ingest('linh', hh, { source: 'email', body: 'UPS update: 1Z999AA10123456784 out for delivery' });
  assert.equal(app.delivery.parcels('linh', hh).length, 1);
});

test('a bill email creates a split bill and payment tasks for residents', () => {
  const { app, hh } = shareHouse();
  const result = app.capture.ingest('linh', hh, {
    source: 'email',
    subject: 'Internet bill',
    body: 'Your broadband invoice. Amount due: $89.99, due on 2026-10-15',
  });
  const bill = result.created[0]!;
  assert.deepEqual(bill.props.shares, { linh: 45, an: 44.99 });
  assert.deepEqual(app.coordination.tasksFor('an', hh).map((t) => t.label), ['Pay internet bill']);
  assert.deepEqual(app.coordination.tasksFor('minh', hh), []);
});

test('integration scopes limit what a connector may write', () => {
  const { app, hh } = shareHouse();
  const courier = app.integrations.connect('linh', hh, { kind: 'delivery', provider: 'AusPost' });
  const result = app.capture.ingest(
    'linh',
    hh,
    { source: 'delivery', body: 'Parcel AB123456789AU. Electricity bill amount due: $50' },
    courier.id,
  );
  assert.deepEqual(result.facts.map((f) => f.kind), ['tracking']);
  assert.match(result.actions.join('\n'), /Skipped bill/);
  assert.equal(app.finance.monthlyReport('linh', hh, '2026-10').total, 0);
});
