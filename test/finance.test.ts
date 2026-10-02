import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitEvenly, splitWeighted } from '../src/index.js';
import { shareHouse } from './fixtures.js';

test('splits are exact to the cent', () => {
  assert.deepEqual(splitEvenly(100, ['a', 'b', 'c']), { a: 33.34, b: 33.33, c: 33.33 });
  assert.deepEqual(splitWeighted(90, { big: 2, small: 1 }), { big: 60, small: 30 });
  const shares = splitWeighted(312.45, { a: 3, b: 2, c: 2 });
  assert.equal(Object.values(shares).reduce((s, v) => Math.round((s + v) * 100) / 100, 0), 312.45);
});

test('bill status follows payments', () => {
  const { app, hh } = shareHouse();
  const bill = app.finance.recordBill('linh', hh, { category: 'water', amount: 80, dueDate: '2026-10-10' });
  assert.equal(app.finance.markPaid('an', bill.id).props.status, 'partially_paid');
  assert.equal(app.finance.markPaid('linh', bill.id).props.status, 'paid');
  assert.deepEqual(app.finance.monthlyReport('linh', hh, '2026-10').byCategory, { water: 80 });
});

test('settle-up shares the outcome without exposing personal spending', () => {
  const { app, hh } = shareHouse();
  app.finance.recordExpense('linh', hh, { description: 'Groceries', amount: 60, category: 'food', participants: ['linh', 'an'] });
  app.finance.recordExpense('an', hh, { description: 'Cleaning supplies', amount: 20, category: 'household', participants: ['linh', 'an'] });
  app.finance.recordExpense('an', hh, { description: 'Concert ticket', amount: 150, category: 'fun' });

  assert.deepEqual(app.finance.settleUp('linh', hh), [{ from: 'an', to: 'linh', amount: 20 }]);
  const linhReport = app.finance.monthlyReport('linh', hh, '2026-10');
  assert.equal(linhReport.total, 80);
  assert.equal(linhReport.byCategory.fun, undefined);
  assert.equal(app.finance.monthlyReport('an', hh, '2026-10').total, 230);
});
