// Real-browser walkthrough with two people on phone-sized screens.
// Usage: BASE_URL=http://localhost:3000 SHOTS=./shots node scripts/e2e.mjs
// Needs Playwright (NODE_PATH pointing at a global install is fine).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? 'shots';
mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const problems = [];
const step = (msg) => console.log(`• ${msg}`);
const expect = async (cond, msg) => {
  if (!(await cond)) throw new Error(`Expectation failed: ${msg}`);
};

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const phone = { ...devices['iPhone 13'], locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', defaultBrowserType: undefined };
delete phone.defaultBrowserType;

async function person(label) {
  const context = await browser.newContext({ ...phone, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`[${label} console] ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`[${label} pageerror] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return { context, page };
}
const waitCount = (page, n, msg) =>
  page.waitForFunction((n) => document.querySelectorAll('.list-item').length === n, n, { timeout: 5000 }).catch(() => {
    throw new Error(`Expectation failed: ${msg}`);
  });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`), animations: 'disabled' });

try {
  // ── 1. Linh signs up and creates a home ──────────────────────────────
  const linh = await person('linh');
  let p = linh.page;
  await p.goto(BASE);
  await p.getByRole('heading', { name: 'Nhà mình' }).waitFor();
  await shot(p, '01-welcome');
  step('welcome screen');

  await p.getByRole('button', { name: 'Bắt đầu' }).click();
  await p.getByLabel('Tên bạn').fill('Linh');
  await p.getByLabel('Email').fill(`linh-${run}@example.com`);
  await p.getByLabel('Mật khẩu').fill('mat khau that dai');
  await shot(p, '02-signup');
  await p.getByRole('button', { name: 'Tiếp tục' }).click();
  await p.getByRole('heading', { name: 'Tạo nhà của bạn' }).waitFor();
  await p.getByLabel('Tên nhà').fill('Nhà 12 Lê Lợi');
  await p.getByRole('button', { name: 'Tạo nhà' }).click();
  await p.getByText('Chào mừng về nhà!').waitFor();
  await shot(p, '03-chat-welcome');
  step('signup + create home → chat with welcome message');

  // ── 2. Invite link ───────────────────────────────────────────────────
  await p.getByRole('button', { name: 'Cài đặt nhà' }).click();
  await p.getByRole('button', { name: 'Tạo link mời' }).click();
  const inviteUrl = (await p.getByTestId('invite-link').textContent()).trim();
  await expect(inviteUrl.includes('/join/'), 'invite link shown');
  await shot(p, '04-invite');
  step(`invite link created`);

  // ── 3. An opens the link, signs up, lands in the home ───────────────
  const an = await person('an');
  const q = an.page;
  await q.goto(inviteUrl);
  await q.getByRole('heading', { name: 'Linh mời bạn vào nhà' }).waitFor();
  await shot(q, '05-join');
  await q.getByLabel('Tên bạn').fill('An');
  await q.getByLabel('Email').fill(`an-${run}@example.com`);
  await q.getByLabel('Mật khẩu').fill('mat khau cua an');
  await q.getByRole('button', { name: 'Tiếp tục' }).click();
  await q.getByText('An đã vào nhà 🎉').waitFor();
  step('An joined via invite link');

  // ── 4. Realtime chat ─────────────────────────────────────────────────
  await p.getByRole('link', { name: 'Chat' }).click();
  await p.getByText('An đã vào nhà 🎉').waitFor({ timeout: 5000 });
  const t0 = Date.now();
  await q.getByLabel('Tin nhắn').fill('Chào cả nhà! Tối nay ai nấu cơm?');
  await q.getByRole('button', { name: 'Gửi', exact: true }).click();
  await p.getByText('Chào cả nhà! Tối nay ai nấu cơm?').waitFor({ timeout: 5000 });
  step(`text message arrived on Linh's phone in ${Date.now() - t0} ms (no reload)`);

  // Photo: a PNG rendered by the browser itself.
  const photo = await p.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0E7C66';
    ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('Ảnh test 📷', 160, 320);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await p.locator('.composer input[type=file]').setInputFiles({ name: 'bep.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
  await p.getByLabel('Tin nhắn').fill('Bếp mới lau xong ✨');
  await p.getByRole('button', { name: 'Gửi', exact: true }).click();
  await q.getByText('Bếp mới lau xong ✨').waitFor({ timeout: 8000 });
  const img = q.locator('.bubble.photo img').last();
  await img.waitFor();
  await expect(img.evaluate((el) => el.complete && el.naturalWidth > 0 && el.src.includes('/api/files/')), 'photo loads for An');
  await shot(p, '06-chat-linh');
  await shot(q, '07-chat-an');
  step('photo message delivered and visible to An');

  // ── 5. Library ───────────────────────────────────────────────────────
  await p.getByRole('link', { name: 'Thư viện' }).click();
  await p.getByText('Wi-Fi nhà mình').waitFor();
  await waitCount(p, 4, 'Linh sees 4 sample items (incl. her private note)');
  await shot(p, '08-library');
  await q.getByRole('link', { name: 'Thư viện' }).click();
  await q.getByText('Wi-Fi nhà mình').waitFor();
  await waitCount(q, 3, 'An does not see Linh’s private note');
  await expect((await q.getByText('Ghi chú riêng của bạn').count()) === 0, 'private note hidden from An');
  step('library: private note hidden from housemate');

  await q.getByLabel('Tìm trong thư viện').fill('noi quy');
  await q.getByText('Nội quy chung').waitFor();
  await waitCount(q, 1, 'accent-insensitive search');
  await q.getByLabel('Tìm trong thư viện').fill('khong co gi');
  await q.getByText('Không tìm thấy').waitFor();
  await shot(q, '09-library-empty-search');
  await q.getByLabel('Tìm trong thư viện').fill('');
  step('search works without diacritics; empty state shown');

  // An adds a note with tags and a photo attachment
  await q.getByRole('button', { name: 'Thêm', exact: true }).click();
  await q.getByRole('dialog').getByRole('button', { name: /Ghi chú/ }).click();
  await q.getByLabel('Tiêu đề').fill('Hợp đồng thuê nhà');
  await q.getByLabel('Nội dung').fill('Hết hạn 30/06/2027. Cọc 2 tháng.');
  await q.getByLabel('Thêm nhãn').fill('giấy tờ');
  await q.keyboard.press('Enter');
  await q.getByLabel('Thêm nhãn').fill('nhà');
  await q.keyboard.press('Enter');
  await shot(q, '10-library-editor');
  await q.getByRole('button', { name: 'Lưu' }).click();
  await q.getByText('Đã thêm vào thư viện').waitFor();
  await p.getByText('Hợp đồng thuê nhà').waitFor({ timeout: 5000 });
  step('note added by An appears on Linh’s phone in real time');
  await p.getByRole('button', { name: '#giấy tờ', exact: true }).click();
  await waitCount(p, 1, 'tag filter');
  await p.locator('.list-item').first().click();
  await p.getByRole('dialog').getByText('Cọc 2 tháng').waitFor();
  await shot(p, '11-library-item');
  await p.getByRole('button', { name: 'Đóng' }).click();
  step('tag filter + item detail');

  // ── 6. Bills: paste → parse → split → pay → who owes whom ────────────
  await p.getByRole('link', { name: 'Hóa đơn' }).click();
  await p.getByRole('heading', { name: 'Ai nợ ai' }).waitFor();
  await shot(p, '12-bills-sample');
  await p.getByRole('button', { name: 'Thêm', exact: true }).click();
  await p.getByRole('dialog').getByRole('button', { name: /Hóa đơn/ }).click();
  await p.getByLabel(/dán nội dung email/i).fill(
    'EVNHCMC - THÔNG BÁO TIỀN ĐIỆN\nKỳ thanh toán: từ 01/09/2026 đến 30/09/2026\nĐiện năng tiêu thụ: 312 kWh\nTổng tiền thanh toán: 1.234.567 đ\nHạn thanh toán: 15/10/2026',
  );
  await p.getByRole('button', { name: 'Tách thông tin' }).click();
  await p.getByText(/Đã tìm thấy số tiền, hạn trả, kỳ thanh toán/).waitFor();
  await expect((await p.getByLabel(/Số tiền/).inputValue()) === '1.234.567', 'amount parsed');
  await expect((await p.getByLabel('Hạn trả').inputValue()) === '2026-10-15', 'due date parsed');
  await expect((await p.getByLabel('Kỳ từ').inputValue()) === '2026-09-01', 'period start parsed');
  await expect((await p.getByLabel('đến', { exact: true }).inputValue()) === '2026-09-30', 'period end parsed');
  await shot(p, '13-bill-review');
  await p.getByRole('button', { name: 'Lưu hóa đơn' }).click();
  await p.getByText('Đã thêm hóa đơn').waitFor();
  step('pasted bill parsed: 1.234.567 đ, due 15/10/2026, period 01/09–30/09');

  await p.locator('.list-item', { hasText: 'Tiền điện' }).filter({ hasText: '1.234.567' }).click();
  await p.getByRole('button', { name: 'Tôi đã trả hóa đơn này' }).click();
  await p.getByText('Đã ghi nhận bạn trả hóa đơn').waitFor();
  await p.getByRole('button', { name: 'Đóng' }).click();
  await p.getByText('Mọi người còn nợ bạn').waitFor();
  await shot(p, '14-bills-paid');

  await q.getByRole('link', { name: 'Hóa đơn' }).click();
  await q.getByText('Bạn cần trả').waitFor({ timeout: 5000 });
  const owed = await q.locator('.big-number').first().textContent();
  await expect(owed.includes('617.283'), `An owes half of 1.234.567 → ${owed}`);
  await shot(q, '15-bills-an-owes');
  step(`An sees they owe ${owed.trim()}`);

  await q.getByRole('button', { name: 'Đã trả', exact: true }).click();
  await q.getByText('Đã ghi nhận 👍').waitFor();
  await q.getByText('Sòng phẳng ✨').waitFor();
  await p.getByText('Sòng phẳng ✨').waitFor({ timeout: 5000 });
  step('An marks paid → both phones show “Sòng phẳng”');

  // Shared expense vs personal: only shared is split.
  await q.getByRole('button', { name: 'Thêm', exact: true }).click();
  await q.getByRole('dialog').getByRole('button', { name: /Chi tiêu chung/ }).click();
  await q.getByLabel('Mua gì?').fill('Đi chợ cuối tuần');
  await q.getByLabel(/Số tiền/).fill('300.000');
  await shot(q, '16-expense');
  await q.getByRole('button', { name: 'Lưu' }).click();
  await q.getByText('Mọi người còn nợ bạn').waitFor();
  await p.getByText('Bạn cần trả').waitFor({ timeout: 5000 });
  step('shared expense split in real time');

  // ── 7. Bill photo → on-device OCR ────────────────────────────────────
  const billPage = await linh.context.newPage();
  await billPage.setViewportSize({ width: 900, height: 700 });
  await billPage.setContent(`<html><body style="margin:0;background:#fff;font:34px/1.6 Arial,sans-serif;padding:40px">
    <div><b>CÔNG TY CẤP NƯỚC</b></div><div>HÓA ĐƠN TIỀN NƯỚC</div>
    <div>Kỳ thanh toán: 01/09/2026 - 30/09/2026</div>
    <div>Tổng tiền thanh toán: 245.000 đ</div><div>Hạn thanh toán: 20/10/2026</div></body></html>`);
  const billImage = await billPage.screenshot({ type: 'png' });
  await billPage.close();
  await p.getByRole('button', { name: 'Thêm', exact: true }).click();
  await p.getByRole('dialog').getByRole('button', { name: /Hóa đơn/ }).click();
  const ocrStart = Date.now();
  await p.locator('input[type=file]:not([capture])').last().setInputFiles({ name: 'hoadon.png', mimeType: 'image/png', buffer: billImage });
  await p.getByRole('heading', { name: 'Kiểm tra hóa đơn' }).waitFor({ timeout: 90_000 });
  const ocrAmount = await p.getByLabel(/Số tiền/).inputValue();
  const ocrDue = await p.getByLabel('Hạn trả').inputValue();
  await shot(p, '17-ocr-review');
  await expect(ocrAmount === '245.000', `OCR amount (got ${ocrAmount})`);
  await expect(ocrDue === '2026-10-20', `OCR due date (got ${ocrDue})`);
  step(`photo OCR on device in ${((Date.now() - ocrStart) / 1000).toFixed(1)} s → ${ocrAmount} đ, due ${ocrDue}`);
  await p.getByRole('button', { name: 'Đóng' }).click();

  // ── 8. States: error + sign out ──────────────────────────────────────
  await linh.context.setOffline(true);
  await p.getByRole('link', { name: 'Thư viện' }).click();
  await p.getByText(/Không kết nối được|Chưa tải được|Đang kết nối lại/).first().waitFor({ timeout: 8000 });
  await shot(p, '18-offline-error');
  await linh.context.setOffline(false);
  step('offline shows an error state with retry');

  await q.getByRole('button', { name: 'Cài đặt nhà' }).click();
  await q.getByRole('button', { name: 'Đăng xuất' }).click();
  await q.getByRole('heading', { name: 'Nhà mình' }).waitFor();
  step('sign out');

  // Tesseract logs harmless 'Parameter not found' warnings through console.error.
  const ignorable = /Failed to load resource|net::ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|EventSource|Parameter not found/;
  const real = problems.filter((x) => !ignorable.test(x));
  if (real.length) {
    console.log('\nConsole problems:\n' + real.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('\n✅ All browser checks passed, no console errors.');
  }
} catch (err) {
  console.error('\n❌', err.message);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
