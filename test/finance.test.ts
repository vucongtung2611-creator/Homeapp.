import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHomeApp, currencyDigits, splitEvenly, splitWeighted } from '../src/index.js';
import { NOW, shareHouse } from './fixtures.js';

test('splits are exact to the minor unit', () => {
  assert.deepEqual(splitEvenly(100, ['a', 'b', 'c']), { a: 33.34, b: 33.33, c: 33.33 });
  assert.deepEqual(splitWeighted(90, { big: 2, small: 1 }), { big: 60, small: 30 });
  const shares = splitWeighted(312.45, { a: 3, b: 2, c: 2 });
  assert.equal(Object.values(shares).reduce((s, v) => Math.round((s + v) * 100) / 100, 0), 312.45);
  // VND has no minor unit: no fractional đồng.
  assert.equal(currencyDigits('VND'), 0);
  assert.deepEqual(splitEvenly(100_000, ['a', 'b', 'c'], 0), { a: 33_334, b: 33_333, c: 33_333 });
});

test('only expenses marked shared enter the split', () => {
  const { app, hh } = shareHouse();
  app.finance.recordExpense('linh', hh, { description: 'Groceries', amount: 60, category: 'food', shared: true });
  app.finance.recordExpense('an', hh, { description: 'Cleaning supplies', amount: 20, category: 'household', shared: true });
  // Two participants but not marked shared: stays out of the split.
  app.finance.recordExpense('an', hh, { description: 'Dinner with Linh', amount: 80, category: 'food', participants: ['an', 'linh'] });
  const concert = app.finance.recordExpense('an', hh, { description: 'Concert ticket', amount: 150, category: 'fun' });

  assert.deepEqual(app.finance.settleUp('linh', hh), [{ from: 'an', to: 'linh', amount: 20 }]);
  assert.equal(app.platform.acl.canRead('linh', concert), false);
  const linhReport = app.finance.monthlyReport('linh', hh, '2026-10');
  assert.equal(linhReport.total, 80);
  assert.equal(app.finance.monthlyReport('an', hh, '2026-10').total, 310);

  // Marking an existing expense shared brings it into the split.
  app.finance.setExpenseShared('an', concert.id, true);
  assert.deepEqual(app.finance.settleUp('linh', hh), [{ from: 'linh', to: 'an', amount: 55 }]);
  assert.throws(() => app.finance.setExpenseShared('linh', concert.id, false));
});

test('a paid shared bill makes the others owe the payer; settlements square up', () => {
  const { app, hh } = shareHouse();
  const bill = app.finance.recordBill('linh', hh, { category: 'water', amount: 80, dueDate: '2026-10-10' });
  assert.deepEqual(app.finance.settleUp('an', hh), []);
  app.finance.payBill('an', bill.id);
  assert.equal(app.platform.graph.requireNode(bill.id).props.status, 'paid');
  assert.deepEqual(app.coordination.tasksFor('linh', hh), []);
  assert.deepEqual(app.finance.settleUp('linh', hh), [{ from: 'linh', to: 'an', amount: 40 }]);

  assert.throws(() => app.finance.recordSettlement('minh', hh, { from: 'linh', to: 'an', amount: 40 }));
  app.finance.recordSettlement('linh', hh, { from: 'linh', to: 'an', amount: 40 });
  assert.deepEqual(app.finance.settleUp('an', hh), []);
  // Settlements are not spending.
  assert.deepEqual(app.finance.monthlyReport('linh', hh, '2026-10').byCategory, { water: 80 });

  app.finance.unpayBill('an', bill.id);
  assert.deepEqual(app.finance.settleUp('an', hh), [{ from: 'an', to: 'linh', amount: 40 }]);
});

test('a personal bill is private and never split', () => {
  const { app, hh } = shareHouse();
  const phone = app.finance.recordBill('an', hh, { category: 'phone', amount: 45, shared: false });
  assert.deepEqual(phone.props.shares, { an: 45 });
  assert.equal(app.platform.acl.canRead('linh', phone), false);
  app.finance.payBill('an', phone.id);
  assert.deepEqual(app.finance.settleUp('an', hh), []);
});

test('reminders: bills due soon or overdue, and debts', () => {
  const { app, hh } = shareHouse();
  const soon = app.finance.recordBill('linh', hh, { category: 'electricity', amount: 120, dueDate: '2026-10-04' });
  app.finance.recordBill('linh', hh, { category: 'internet', amount: 90, dueDate: '2026-11-30' });
  const late = app.finance.recordBill('linh', hh, { category: 'water', amount: 60, dueDate: '2026-09-30' });
  app.finance.recordExpense('linh', hh, { description: 'Groceries', amount: 50, category: 'food', shared: true });

  const an = app.finance.reminders('an', hh);
  assert.deepEqual(
    an.map((r) => [r.kind, r.billId ?? r.to, r.amount]),
    [
      ['bill_due', soon.id, 120],
      ['bill_overdue', late.id, 60],
      ['debt', 'linh', 25],
    ],
  );
  assert.deepEqual(app.finance.reminders('minh', hh), []);
  app.finance.payBill('linh', soon.id);
  assert.equal(app.finance.reminders('an', hh).filter((r) => r.billId === soon.id).length, 0);
});

test('VND households split in whole đồng', () => {
  const app = createHomeApp({ clock: () => NOW });
  const hh = app.platform.createHousehold('Nhà Q7', { userId: 'a', name: 'A' }, { kind: 'share_house', currency: 'VND' }).id;
  app.platform.addMember(hh, 'b', 'B', 'tenant');
  app.platform.addMember(hh, 'c', 'C', 'tenant');
  const bill = app.finance.recordBill('a', hh, { category: 'electricity', amount: 1_000_000 });
  assert.deepEqual(bill.props.shares, { a: 333_334, b: 333_333, c: 333_333 });
  app.finance.payBill('a', bill.id);
  assert.deepEqual(app.finance.settleUp('b', hh), [
    { from: 'b', to: 'a', amount: 333_333 },
    { from: 'c', to: 'a', amount: 333_333 },
  ]);
});

test('deleting: creator or household owner only', () => {
  const { app, hh } = shareHouse();
  const tx = app.finance.recordExpense('an', hh, { description: 'Oops', amount: 10, category: 'food', shared: true });
  assert.throws(() => app.finance.remove('minh', tx.id));
  app.finance.remove('linh', tx.id); // household owner
  assert.equal(app.platform.graph.getNode(tx.id), undefined);
});
