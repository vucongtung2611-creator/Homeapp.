import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectWhen } from '../src/integrations/when.js';

// Friday 2 October 2026, 10:00
const now = new Date(2026, 9, 2, 10, 0);

test('finds days and times in five languages', () => {
  const cases: [string, ReturnType<typeof detectWhen>][] = [
    ['Họp phụ huynh thứ 6 lúc 19h nhé', { date: '2026-10-02', time: '19:00' }],
    ['Ngày mai 7 giờ tối ăn lẩu', { date: '2026-10-03', time: '19:00' }],
    ['Chủ nhật dọn nhà nha', { date: '2026-10-04' }],
    ['Thứ hai đi khám răng 8h30', { date: '2026-10-05', time: '08:30' }],
    ['Sinh nhật Linh 7/10', { date: '2026-10-07' }],
    ['Hẹn thợ sửa máy giặt ngày 12 tháng 10 lúc 14:00', { date: '2026-10-12', time: '14:00' }],
    ['Dentist tomorrow at 3pm', { date: '2026-10-03', time: '15:00' }],
    ['Parent meeting on Tuesday 6:30pm', { date: '2026-10-06', time: '18:30' }],
    ['Rent inspection Oct 20 10:00', { date: '2026-10-20', time: '10:00' }],
    ['Dîner demain à 19h', { date: '2026-10-03', time: '19:00' }],
    ['Réunion lundi 9h', { date: '2026-10-05', time: '09:00' }],
    ['Am Samstag um 8 Uhr Flohmarkt', { date: '2026-10-03', time: '08:00' }],
    ['Arzt am 15.10. um 11:15', { date: '2026-10-15', time: '11:15' }],
    ['Zaterdag 10:30 boodschappen', { date: '2026-10-03', time: '10:30' }],
    ['Vanavond om 8 eten', { date: '2026-10-02', time: '20:00' }],
    ['Back to school 3/9', { date: '2027-09-03' }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(detectWhen(text, now), expected, text);
});

test('stays quiet when no day is named', () => {
  for (const text of ['Ok cảm ơn nha', 'Who took my charger?', 'Pizza 🍕', 'Mình về lúc 7h', 'Room 12 is free', 'Tiền điện 1.180.000 đ']) {
    assert.equal(detectWhen(text, now), undefined, text);
  }
});
