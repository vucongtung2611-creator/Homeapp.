import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Platform, RuleBasedExtractor, parseDate } from '../src/index.js';
import { NOW, shareHouse } from './fixtures.js';

const ORDER_EMAIL = {
  source: 'email' as const,
  from: 'orders@dyson.com.au',
  subject: 'Your Dyson order has shipped',
  body: 'Thank you for shopping with Dyson. Order #DY-88213. Order total: $1,049.00. UPS tracking 1Z999AA10123456784.',
};

test('housemates see a parcel exists, never its contents, tracking number or retailer', () => {
  const { app, hh } = shareHouse();
  const facts = new RuleBasedExtractor().extract(ORDER_EMAIL).map((f) =>
    f.kind === 'receipt' ? { ...f, description: 'Dyson Hot+Cool' } : f.kind === 'tracking' ? { ...f, publicLabel: 'Đồ riêng' } : f,
  );
  app.capture.apply('linh', hh, facts, ORDER_EMAIL);

  const [mine] = app.delivery.summaries('linh', hh);
  assert.equal(mine!.label, 'Dyson Hot+Cool');
  assert.equal(mine!.trackingNumber, '1Z999AA10123456784');
  assert.equal(mine!.order?.retailer, 'Dyson');
  assert.equal(mine!.order?.canShare, true);

  const [theirs] = app.delivery.summaries('an', hh);
  assert.deepEqual(
    { label: theirs!.label, tracking: theirs!.trackingNumber, order: theirs!.order, recipient: theirs!.recipientName },
    { label: 'Đồ riêng', tracking: undefined, order: undefined, recipient: 'Linh' },
  );
  // Nothing in the household-visible parcel node names the contents.
  assert.doesNotMatch(JSON.stringify(app.platform.graph.requireNode(theirs!.id)), /Dyson|Hot\+Cool/);
  // The property manager does not see deliveries at all.
  assert.deepEqual(app.delivery.summaries('minh', hh), []);

  // Only the recipient can relabel.
  assert.throws(() => app.delivery.setPublicLabel('an', theirs!.id, 'Hmm'));
  app.delivery.setPublicLabel('linh', theirs!.id, 'Quà sinh nhật 🤫');
  assert.equal(app.delivery.summaries('an', hh)[0]!.label, 'Quà sinh nhật 🤫');
  // Anyone at home can mark it received.
  app.delivery.updateStatus('an', theirs!.id, 'delivered');
  assert.equal(app.delivery.summaries('linh', hh, { includeDelivered: true })[0]!.status, 'delivered');
});

test('one tap shares an order (and its receipt) with the household, and back', () => {
  const { app, hh } = shareHouse();
  app.capture.ingest('linh', hh, ORDER_EMAIL);
  const orderId = app.delivery.summaries('linh', hh)[0]!.order!.id;
  assert.throws(() => app.delivery.shareOrder('an', orderId, true));

  app.delivery.shareOrder('linh', orderId, true);
  const shared = app.delivery.summaries('an', hh)[0]!;
  assert.equal(shared.order?.retailer, 'Dyson');
  assert.equal(shared.order?.canShare, false);
  assert.equal(shared.trackingNumber, '1Z999AA10123456784');
  const receipt = app.platform.graph.neighbors(orderId, { relation: 'evidenced_by' })[0]!;
  assert.equal(app.platform.acl.canRead('an', receipt), true);
  // Sharing the order does not put the cost into the split.
  assert.deepEqual(app.finance.settleUp('an', hh), []);

  app.delivery.shareOrder('linh', orderId, false);
  assert.equal(app.delivery.summaries('an', hh)[0]!.order, undefined);
});

test('a household survives a save/restore round trip, permissions included', () => {
  const { app, hh } = shareHouse();
  app.capture.ingest('linh', hh, ORDER_EMAIL);
  const bill = app.finance.recordBill('linh', hh, { category: 'internet', amount: 90, dueDate: '2026-10-15' });
  app.finance.payBill('linh', bill.id);

  const restored = Platform.restore(JSON.parse(JSON.stringify(app.platform.snapshot())), () => NOW);
  assert.equal(restored.acl.roleOf('minh', hh), 'property_manager');
  assert.equal(restored.acl.roleOf('an', hh), 'tenant');
  assert.equal(restored.graph.size.nodes, app.platform.graph.size.nodes);
  assert.equal(restored.graph.size.edges, app.platform.graph.size.edges);
  assert.equal(restored.acl.visible('an', hh, 'transaction').length, 0);
  assert.equal(restored.graph.requireNode(bill.id).createdAt.toISOString(), NOW.toISOString());
});

test('leaving a household revokes access but keeps history', () => {
  const { app, hh } = shareHouse();
  app.finance.recordExpense('an', hh, { description: 'Shared soap', amount: 10, category: 'household', shared: true });
  app.platform.removeMember(hh, 'an');
  assert.equal(app.platform.acl.roleOf('an', hh), undefined);
  assert.deepEqual(app.finance.settleUp('linh', hh), [{ from: 'linh', to: 'an', amount: 5 }]);
  assert.deepEqual(app.platform.residents(hh).map((r) => r.id), ['linh']);
});

const vi = new RuleBasedExtractor({ defaultCurrency: 'VND' });
const at = new Date('2026-10-02T00:00:00Z');

test('Vietnamese electricity bill: amount in đồng, due date and billing period', () => {
  const [bill] = vi.extract({
    source: 'email',
    from: 'hoadon@evnhcmc.vn',
    subject: 'Thông báo tiền điện tháng 9/2026',
    body:
      'Kỳ thanh toán: từ 01/09/2026 đến 30/09/2026\nĐiện năng tiêu thụ: 312 kWh\n' +
      'Tổng tiền thanh toán: 1.234.567 đ\nHạn thanh toán: 15/10/2026',
    receivedAt: at,
  });
  assert.deepEqual(bill, {
    kind: 'bill',
    category: 'electricity',
    amount: 1_234_567,
    currency: 'VND',
    provider: 'Evnhcmc',
    dueDate: '2026-10-15',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
  });
});

test('phone bills are not mistaken for electricity; VND without a symbol', () => {
  const [bill] = vi.extract({
    source: 'ocr',
    body: 'HÓA ĐƠN ĐIỆN THOẠI\nSố tiền cần thanh toán 245.000\nThanh toán trước ngày 20 tháng 10 năm 2026',
    receivedAt: at,
  });
  assert.equal(bill?.kind, 'bill');
  assert.deepEqual(bill && { ...bill }, { kind: 'bill', category: 'phone', amount: 245_000, currency: 'VND', dueDate: '2026-10-20' });
});

test('English bills: month names, cross-year periods, labels with noise in between', () => {
  const extractor = new RuleBasedExtractor({ defaultCurrency: 'AUD' });
  const [gas] = extractor.extract({
    source: 'email',
    from: 'accounts@agl.com.au',
    subject: 'Your gas bill',
    body: 'Supply period: 1 Dec - 28 Feb 2027\nTotal amount due (incl. GST): $412.10\nDue date: March 21, 2027',
    receivedAt: at,
  });
  assert.deepEqual(gas, {
    kind: 'bill',
    category: 'gas',
    amount: 412.1,
    currency: 'AUD',
    provider: 'AGL',
    dueDate: '2027-03-21',
    periodStart: '2026-12-01',
    periodEnd: '2027-02-28',
  });

  // Unknown kind of bill, but a due date makes it a bill.
  const [other] = extractor.extract({ source: 'email', body: 'Strata levy. Amount payable: A$650.00. Pay by 30/11/2026', receivedAt: at });
  assert.deepEqual(other, { kind: 'bill', category: 'other', amount: 650, currency: 'AUD', dueDate: '2026-11-30' });
});

test('Vietnamese delivery messages', () => {
  const facts = vi.extract({
    source: 'manual',
    body: 'Đơn hàng của bạn đang được Giao Hàng Nhanh vận chuyển. Mã vận đơn: GHN8K2LQ9X. Dự kiến giao: 05/10/2026',
    receivedAt: at,
  });
  assert.deepEqual(facts, [{ kind: 'tracking', trackingNumber: 'GHN8K2LQ9X', carrier: 'Giao Hàng Nhanh', expectedOn: '2026-10-05' }]);
  const [spx] = vi.extract({ source: 'manual', body: 'Shopee: kiện hàng SPXVN041234567890 đã đến kho', receivedAt: at });
  assert.deepEqual(spx, { kind: 'tracking', trackingNumber: 'SPXVN041234567890', carrier: 'Shopee Express' });
});

test('date parsing', () => {
  assert.equal(parseDate('2026-10-05', 2026), '2026-10-05');
  assert.equal(parseDate('5/10/2026', 2026), '2026-10-05');
  assert.equal(parseDate('10/25/2026', 2026), '2026-10-25'); // month-first only when day-first is impossible
  assert.equal(parseDate('31/02/2026', 2026), undefined);
  assert.equal(parseDate('Oct 5th', 2026), '2026-10-05');
  assert.equal(parseDate('ngày 5 tháng 10', 2027), '2027-10-05');
});

const eur = new RuleBasedExtractor({ defaultCurrency: 'EUR' });

test('French bill: "Montant à payer", échéance, période du … au …', () => {
  const [bill] = eur.extract({
    source: 'email',
    from: 'factures@energie-sud.fr',
    subject: 'Votre facture d’électricité',
    body: 'Période de facturation : du 01/09/2026 au 30/09/2026\nMontant à payer : 1 234,56 €\nDate d’échéance : 15 octobre 2026',
    receivedAt: at,
  });
  assert.deepEqual(bill && { ...bill, provider: undefined }, {
    kind: 'bill',
    category: 'electricity',
    amount: 1234.56,
    currency: 'EUR',
    provider: undefined,
    dueDate: '2026-10-15',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
  });
});

test('German bill: Rechnungsbetrag, "fällig am 15. Oktober", Abrechnungszeitraum … bis …', () => {
  const [bill] = eur.extract({
    source: 'ocr',
    body: 'Stadtwerke – Ihre Stromrechnung\nAbrechnungszeitraum: 01.09.2026 bis 30.09.2026\nRechnungsbetrag: 89,90 €\nFällig am 15. Oktober 2026',
    receivedAt: at,
  });
  assert.deepEqual(bill, {
    kind: 'bill',
    category: 'electricity',
    amount: 89.9,
    currency: 'EUR',
    dueDate: '2026-10-15',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
  });
});

test('Dutch bill: "Te betalen: € 1.049,95", vervaldatum, factuurperiode … t/m …', () => {
  const [bill] = eur.extract({
    source: 'email',
    body: 'Uw huur voor oktober\nFactuurperiode: 01-10-2026 t/m 31-10-2026\nTe betalen: € 1.049,95\nVervaldatum: 1 okt. 2026',
    receivedAt: at,
  });
  assert.deepEqual(bill, {
    kind: 'bill',
    category: 'rent',
    amount: 1049.95,
    currency: 'EUR',
    dueDate: '2026-10-01',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
  });
});

test('dates in French, German and Dutch month names', () => {
  assert.equal(parseDate('1er août 2026', 2026), '2026-08-01');
  assert.equal(parseDate('3 févr. 2027', 2026), '2027-02-03');
  assert.equal(parseDate('15. März 2026', 2026), '2026-03-15');
  assert.equal(parseDate('12 mrt 2026', 2026), '2026-03-12');
  assert.equal(parseDate('7 mei', 2026), '2026-05-07');
  assert.equal(parseDate('2 décembre 2026', 2026), '2026-12-02');
});
