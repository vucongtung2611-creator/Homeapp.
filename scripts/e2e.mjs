// Real-browser walkthrough with two people on phone-sized screens.
// Usage: BASE_URL=http://localhost:3000 SHOTS=./shots node scripts/e2e.mjs
// Needs Playwright (NODE_PATH pointing at a global install is fine).
import { mkdirSync, readFileSync } from 'node:fs';
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

async function person(label, { tour = false } = {}) {
  const context = await browser.newContext({ ...phone, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => localStorage.setItem('homeapp:locale', 'vi'));
  const page = await context.newPage();
  if (!tour) await skipTour(page);
  page.on('console', (m) => m.type() === 'error' && problems.push(`[${label} console] ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`[${label} pageerror] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return { context, page };
}
const waitCount = (page, n, msg) =>
  page.waitForFunction((n) => document.querySelectorAll('.list-item').length === n, n, { timeout: 5000 }).catch(() => {
    throw new Error(`Expectation failed: ${msg}`);
  });
/** The first-time guide covers the screen; tests that aren't about it just skip it. */
const skipTour = (page) =>
  page.addLocatorHandler(page.getByTestId('tour'), async () => {
    await page.getByTestId('tour').getByRole('button').first().click();
  });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`), animations: 'disabled' });

try {
  // ── 0. Language: English by default, visible switch, remembered ──────
  {
    const context = await browser.newContext({ ...phone, locale: 'en-US' });
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`[en pageerror] ${e.message}`));
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'MATE' }).waitFor();
    await page.getByText('Your everyday companion at home.').waitFor();
    await expect((await page.locator('html').getAttribute('lang')) === 'en', 'html lang=en');
    const offered = await page.locator('.lang-switch option').allTextContents();
    await expect(offered.join('|') === 'English|Tiếng Việt|Français|Deutsch|Nederlands', `all five languages offered (got ${offered})`);
    // Tom greets with a wave; animations run.
    await expect((await page.locator('.mascot .figure').getAttribute('class')).includes('mood-wave'), 'Tom waves on the welcome screen');
    const anim = await page.locator('.mascot .figure-body').evaluate((el) => getComputedStyle(el).animationName);
    await expect(anim !== 'none', `mascot animates (${anim})`);
    await shot(page, '00-welcome-en');
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const probe = 'Tiếng Việt ạ ữ đ · Français é è ç œ · Deutsch ä ö ü ß';
      await document.fonts.load('16px Inter', probe);
      return { ok: document.fonts.check('16px Inter', probe), family: getComputedStyle(document.body).fontFamily };
    });
    await expect(fonts.ok && fonts.family.startsWith('Inter'), `Inter covers vi/fr/de glyphs (${JSON.stringify(fonts)})`);
    await page.locator('.lang-switch select').selectOption('vi');
    await page.getByText('Người bạn đồng hành của cả nhà, mỗi ngày.').waitFor();
    await page.reload();
    await page.getByText('Người bạn đồng hành của cả nhà, mỗi ngày.').waitFor();
    await expect((await page.locator('html').getAttribute('lang')) === 'vi', 'html lang=vi after reload');
    await page.locator('.lang-switch select').selectOption('en');
    await page.getByText('Your everyday companion at home.').waitFor();
    await context.close();
    step('MATE welcome; English by default; 5 languages; switching is remembered; Inter has vi/fr/de glyphs; Tom waves');
  }
  {
    // Reduced motion: the OS setting switches every animation off.
    const context = await browser.newContext({ ...phone, locale: 'en-US', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'MATE' }).waitFor();
    const anim = await page.locator('.mascot .figure-body').evaluate((el) => getComputedStyle(el).animationName);
    await expect(anim === 'none', `no animation with reduced motion (${anim})`);
    await context.close();
    step('prefers-reduced-motion turns the character animations off');
  }

  // ── 1. Linh signs up and creates a home ──────────────────────────────
  const linh = await person('linh', { tour: true });
  let p = linh.page;
  await p.goto(BASE);
  await p.getByRole('heading', { name: 'MATE' }).waitFor();
  await shot(p, '01-welcome');
  step('welcome screen');

  await p.getByRole('button', { name: 'Bắt đầu' }).click();
  await p.getByLabel('Tên bạn').fill('Linh');
  await p.getByLabel('Email').fill(`linh-${run}@example.com`);
  await p.getByLabel('Mật khẩu').fill('mat khau that dai');
  await shot(p, '02-signup');
  await p.getByRole('button', { name: 'Tiếp tục' }).click();
  // No home is made automatically: join with a link or code, or create one.
  await p.getByRole('heading', { name: 'Chào Linh!' }).waitFor();
  await p.getByRole('heading', { name: 'Vào nhà bằng link hoặc mã mời' }).waitFor();
  await shot(p, '02b-start');
  await p.getByRole('button', { name: 'Tạo nhà mới' }).click();
  await p.getByRole('heading', { name: 'Tạo nhà của bạn' }).waitFor();
  await p.getByLabel('Tên nhà').fill('Nhà 12 Lê Lợi');
  await p.getByRole('button', { name: 'Tạo nhà' }).click();
  // First time in a home: a guided tour that jumps through each screen, then the chat.
  await p.getByTestId('tour').getByRole('heading', { name: 'Chat với cả nhà' }).waitFor();
  await shot(p, '03a-tour');
  for (const title of ['Lịch và việc nhà', 'Cất những thứ cần dùng', 'Chia hoá đơn công bằng', 'Hộp thư của nhà', 'Cài đặt, lời mời và ngôn ngữ']) {
    await p.getByRole('button', { name: 'Tiếp' }).click();
    await p.getByTestId('tour').getByRole('heading', { name: title }).waitFor();
  }
  await p.getByRole('button', { name: 'Bắt đầu' }).click();
  await expect((await p.getByTestId('tour').count()) === 0, 'guide closed');
  await skipTour(p); // in case it is asked for again later
  await p.getByText('Chào mừng về nhà!').waitFor();
  await shot(p, '03-chat-welcome');
  step('signup + create home → chat with welcome message');

  // ── 2. A personal invite link for An ────────────────────────────────
  await p.getByRole('button', { name: 'Cài đặt nhà' }).click();
  await p.getByLabel('Mời ai? (ví dụ Linh)').fill('An');
  await p.getByRole('button', { name: 'Tạo link mời' }).click();
  const inviteUrl = (await p.getByTestId('invite-link').textContent()).trim();
  await expect(inviteUrl.includes('/join/'), 'invite link shown');
  await p.getByTestId('open-invite').getByText('An').waitFor();
  await shot(p, '04-invite');
  step('personal invite link created for An');

  // ── 3. An opens the link, signs up, waits; Linh lets An in ──────────
  const an = await person('an');
  const q = an.page;
  await q.goto(inviteUrl);
  await q.getByRole('heading', { name: 'Linh mời bạn vào nhà' }).waitFor();
  await shot(q, '05-join');
  await q.getByLabel('Tên bạn').fill('An');
  await q.getByLabel('Email').fill(`an-${run}@example.com`);
  await q.getByLabel('Mật khẩu').fill('mat khau cua an');
  await q.getByRole('button', { name: 'Tiếp tục' }).click();
  await q.getByText('Đã xin vào “Nhà 12 Lê Lợi”').waitFor();
  await shot(q, '05b-waiting');
  step('An used the link → waiting for approval, sees nothing of the home yet');

  // The same link a second time: turned away.
  const kim = await person('kim');
  await kim.page.goto(inviteUrl);
  await kim.page.getByText('Link mời này đã được dùng').waitFor();
  await kim.context.close();
  // That refusal is logged by the browser as a failed request; it's the expected answer.
  for (let i = problems.length - 1; i >= 0; i--) if (problems[i].startsWith('[kim console]') && problems[i].includes('410')) problems.splice(i, 1);
  step('a used link does not work for anyone else');

  await p.getByRole('link', { name: 'Chat' }).click();
  await p.getByTestId('inbox-count').waitFor({ timeout: 5000 });
  await expect((await p.getByTestId('inbox-count').textContent()) === '1', 'one unread in the inbox');
  await p.getByTestId('inbox-button').click();
  await p.getByTestId('join-requests').getByText(`an-${run}@example.com`).waitFor();
  await p.getByTestId('inbox-events').getByText('An đã dùng thư mời cho An và đang chờ duyệt').waitFor();
  await p.getByTestId('sent-invites').getByText('An đang chờ duyệt').waitFor();
  await shot(p, '05c-inbox');
  await p.getByTestId('join-requests').getByRole('button', { name: 'Đồng ý' }).click();
  await p.getByText('An đã vào nhà', { exact: true }).waitFor();
  await p.getByTestId('sent-invites').getByText('An đã nhận').waitFor();
  await p.getByTestId('inbox-events').getByText('Linh (bạn) đã cho An vào nhà (Ở chung)').waitFor();
  await expect((await p.getByTestId('inbox-count').count()) === 0, 'inbox read once opened');
  await q.getByText('An đã vào nhà 🎉').waitFor({ timeout: 15000 });
  await q.getByText('Bạn đã vào “Nhà 12 Lê Lợi”!').waitFor();
  step('Linh saw the request in the inbox (count on the icon), let An in; An was told and went straight in');

  // ── 3b. Roles and the home log ──────────────────────────────────────
  await p.getByRole('button', { name: 'Cài đặt nhà' }).click();
  await p.getByLabel('Vai trò của An').selectOption('manager');
  await p.getByText('An giờ là Quản lý').waitFor();
  await p.getByRole('button', { name: 'Mở nhật ký nhà' }).click();
  await p.getByTestId('home-log').getByText('Linh (bạn) đã đặt An làm Quản lý').waitFor();
  await p.getByTestId('home-log').getByText('Linh (bạn) đã tạo thư mời cho An (Ở chung)').waitFor();
  await shot(p, '05d-log');
  await p.getByRole('button', { name: 'Quay lại' }).click();
  step('Linh made An a manager; the home log shows invites, approvals and role changes');

  // ── 3c. A guest for 3 days: chat and look, no money, nothing to add ──
  await p.getByLabel('Mời ai? (ví dụ Linh)').fill('Bà Hoa');
  await p.getByLabel('Vai trò', { exact: true }).selectOption('guest');
  await p.getByLabel('Ở trong bao lâu').selectOption('3');
  await p.getByRole('button', { name: 'Tạo link mời' }).click();
  const guestUrl = (await p.getByTestId('invite-link').textContent()).trim();
  const hoa = await person('hoa');
  await hoa.page.goto(guestUrl);
  await hoa.page.getByLabel('Tên bạn').fill('Hoa');
  await hoa.page.getByLabel('Email').fill(`hoa-${run}@example.com`);
  await hoa.page.getByLabel('Mật khẩu').fill('mat khau cua hoa');
  await hoa.page.getByRole('button', { name: 'Tiếp tục' }).click();
  await hoa.page.getByText('Đã xin vào “Nhà 12 Lê Lợi”').waitFor();
  await p.getByTestId('inbox-button').click();
  await p.getByTestId('join-requests').getByRole('button', { name: 'Đồng ý' }).click();
  await hoa.page.getByText('Hoa đã vào nhà 🎉').waitFor({ timeout: 15000 });
  await expect((await hoa.page.getByRole('link', { name: 'Hóa đơn' }).count()) === 0, 'no Bills tab for a guest');
  await hoa.page.getByRole('link', { name: 'Thư viện' }).click();
  await hoa.page.getByPlaceholder('Tìm ghi chú, giấy tờ, ảnh…').waitFor();
  await expect((await hoa.page.getByTestId('library-add').count()) === 0, 'no Add button for a guest in the home library');
  await hoa.page.getByRole('button', { name: 'Cài đặt nhà' }).click();
  await hoa.page.getByText('Bạn là khách trong nhà này đến').waitFor();
  await shot(hoa.page, '05e-guest');
  await hoa.context.close();
  await p.getByRole('link', { name: 'Chat' }).click();
  step('a 3-day guest got in after approval: chat and library only, no Bills, nothing to add');

  // ── 3d. Two accounts on one browser: add An's, switch, switch back ──
  await p.getByRole('button', { name: 'Cài đặt nhà' }).click();
  await p.getByRole('button', { name: '＋ Thêm tài khoản' }).click();
  await p.getByRole('heading', { name: 'Thêm tài khoản' }).waitFor();
  await p.getByLabel('Email').fill(`an-${run}@example.com`);
  await p.getByLabel('Mật khẩu').fill('mat khau cua an');
  await p.getByRole('button', { name: 'Tiếp tục' }).click();
  await p.getByRole('heading', { name: 'Chat' }).waitFor();
  await p.getByRole('button', { name: 'Cài đặt nhà' }).click();
  await p.getByTestId('accounts').getByText('An (bạn)').waitFor();
  await shot(p, '05f-accounts');
  await p.getByTestId('accounts').getByRole('button', { name: 'Chuyển' }).click();
  await p.getByRole('heading', { name: 'Chat' }).waitFor();
  await p.getByRole('button', { name: 'Cài đặt nhà' }).click();
  await p.getByTestId('accounts').getByText('Linh (bạn)').waitFor();
  await p.getByRole('link', { name: 'Chat' }).click();
  step('Linh added An’s account on the same browser and switched back and forth without signing out');

  // ── 3e. Colour themes: chosen in Settings, remembered after a reload ─
  await p.getByRole('button', { name: 'Cài đặt nhà' }).click();
  for (const [name, theme] of [['Trắng ngà', 'ivory'], ['Hồng nhạt', 'pink'], ['Xanh nhạt', 'blue'], ['Vàng nhạt', 'yellow'], ['Tối', 'dark']]) {
    await p.getByTestId('themes').getByRole('radio', { name }).click();
    await expect((await p.locator('html').getAttribute('data-theme')) === theme, `theme ${theme}`);
    await shot(p, `05g-theme-${theme}`);
  }
  await p.getByTestId('themes').getByRole('radio', { name: 'Hồng nhạt' }).click();
  await p.reload();
  await p.getByTestId('themes').waitFor();
  await expect((await p.locator('html').getAttribute('data-theme')) === 'pink', 'theme remembered after reload');
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(bg === 'rgb(251, 241, 243)', `soft pink background (${bg})`);
  await p.getByTestId('themes').getByRole('radio', { name: 'Tự động' }).click();
  await expect((await p.locator('html').getAttribute('data-theme')) === null, 'back to automatic');
  await p.getByRole('link', { name: 'Chat' }).click();
  step('colour themes: ivory, pink, blue, yellow, dark; the choice survives a reload');

  // ── 4. Realtime chat ─────────────────────────────────────────────────
  await p.getByRole('link', { name: 'Chat' }).click();
  await p.getByText('An đã vào nhà 🎉').waitFor({ timeout: 5000 });
  const t0 = Date.now();
  await q.getByLabel('Tin nhắn').fill('Chào cả nhà! Tối nay ai nấu cơm?');
  await q.getByRole('button', { name: 'Gửi', exact: true }).click();
  await p.getByText('Chào cả nhà! Tối nay ai nấu cơm?').waitFor({ timeout: 5000 });
  step(`text message arrived on Linh's phone in ${Date.now() - t0} ms (no reload)`);

  // Emoji at the cursor, a sticker, and a new name for the group chat.
  await q.getByLabel('Tin nhắn').fill('Tối nay ăn phở ');
  await q.getByRole('button', { name: 'Emoji và nhãn dán' }).click();
  await q.getByTestId('picker').getByRole('button', { name: '🍜' }).click();
  await expect((await q.getByLabel('Tin nhắn').inputValue()) === 'Tối nay ăn phở 🍜', 'emoji inserted');
  await q.getByRole('button', { name: 'Gửi', exact: true }).click();
  await p.getByText('Tối nay ăn phở 🍜').waitFor({ timeout: 5000 });
  await q.getByRole('button', { name: 'Emoji và nhãn dán' }).click();
  await q.getByRole('tab', { name: 'Nhãn dán' }).click();
  await shot(q, '06b-stickers');
  await q.getByRole('button', { name: 'Gửi nhãn dán: Cảm ơn nha!' }).click();
  await p.locator('.msg .sticker', { hasText: 'Cảm ơn nha!' }).waitFor({ timeout: 5000 });
  await p.getByRole('button', { name: 'Đổi tên nhóm chat' }).click();
  await p.getByLabel('Tên nhóm chat').fill('Nhà mình 🏡');
  await p.getByRole('button', { name: 'Lưu', exact: true }).click();
  await q.getByTestId('chat-name').getByText('Nhà mình 🏡').waitFor({ timeout: 5000 });
  await q.getByText('Linh đã đổi tên nhóm chat thành “Nhà mình 🏡”').waitFor();
  step('emoji picker, a sticker, and the group chat renamed — all live on both phones');

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

  // ── Home calendar: from a chat message, month/week, filters, reminder ──
  await q.getByLabel('Tin nhắn').fill('Thứ 7 lúc 9h đưa Bin đi tiêm nha');
  await q.getByRole('button', { name: 'Gửi', exact: true }).click();
  const chip = p.locator('.msg', { hasText: 'Thứ 7 lúc 9h đưa Bin đi tiêm nha' }).getByTestId('add-to-calendar');
  await chip.waitFor({ timeout: 5000 });
  await shot(p, '07b-chat-calendar-chip');
  await chip.click();
  const editor = p.getByTestId('calendar-editor');
  await editor.waitFor();
  await expect((await editor.locator('input[name=title]').inputValue()).includes('đưa Bin đi tiêm'), 'title taken from the message');
  await expect((await editor.locator('input[name=time]').inputValue()) === '09:00', 'time taken from the message');
  await editor.getByRole('button', { name: 'An', exact: false }).click();
  await editor.locator('input[name=tag]').fill('Bin');
  await shot(p, '07c-calendar-editor');
  await editor.getByRole('button', { name: 'Lưu', exact: true }).click();
  await p.getByText('Đã thêm vào lịch nhà').waitFor();
  await p.locator('.cal-event', { hasText: 'đưa Bin đi tiêm' }).waitFor();
  await shot(p, '07d-calendar-month');
  // An sees it live, filters by the label, and switches to the week view.
  await q.getByRole('link', { name: 'Lịch' }).click();
  await q.getByTestId('calendar-month').waitFor();
  await q.getByTestId('calendar-filter').getByRole('button', { name: '🏷️ Bin' }).waitFor({ timeout: 5000 });
  await q.getByTestId('calendar-filter').getByRole('button', { name: '🏷️ Bin' }).click();
  await q.getByTestId('calendar-view').getByRole('button', { name: 'Tuần' }).click();
  await q.getByTestId('calendar-week').locator('.cal-event', { hasText: 'đưa Bin đi tiêm' }).waitFor();
  await shot(q, '07e-calendar-week');
  // The calendar in other apps: a .ics download and a secret subscription link.
  await q.getByTestId('calendar-sync').click();
  const [icsFile] = await Promise.all([q.waitForEvent('download'), q.getByTestId('ics-download').click()]);
  const icsText = readFileSync(await icsFile.path(), 'utf8');
  await expect(icsText.includes('BEGIN:VCALENDAR') && icsText.includes('đưa Bin đi tiêm'), '.ics file has the appointment');
  await q.getByTestId('feed-make').click();
  const feedUrl = await q.getByTestId('feed-url').inputValue();
  await shot(q, '07e2-calendar-sync');
  const feedText = await (await fetch(feedUrl)).text();
  await expect(feedText.includes('đưa Bin đi tiêm'), 'the subscription link works without signing in');
  await q.keyboard.press('Escape');
  // An adds something for the whole home today; Linh is reminded when she opens chat.
  await q.getByTestId('calendar-add').click();
  await q.getByTestId('calendar-editor').locator('input[name=title]').fill('Đi chợ cuối tuần');
  await q.getByTestId('calendar-editor').locator('input[name=date]').fill(await q.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }));
  await q.getByTestId('calendar-editor').locator('input[name=time]').fill('17:30');
  await q.getByTestId('calendar-editor').getByRole('button', { name: 'Lưu', exact: true }).click();
  await q.getByText('Đã thêm vào lịch nhà').waitFor();
  await p.getByRole('link', { name: 'Chat' }).click();
  await p.getByTestId('calendar-reminder').getByText('Đi chợ cuối tuần').waitFor({ timeout: 5000 });
  await p.evaluate(() => document.scrollingElement.scrollTo(0, 1e6));
  await shot(p, '07f-calendar-reminder');
  await p.getByTestId('calendar-reminder').getByRole('button', { name: 'Ẩn' }).click();
  await p.reload();
  await p.getByLabel('Tin nhắn').waitFor();
  await expect((await p.getByTestId('calendar-reminder').count()) === 0, 'a dismissed reminder stays hidden today');
  await q.getByRole('link', { name: 'Chat' }).click();
  step('calendar: "add to home calendar" from a chat message (time and text filled in), month and week views, filter by label, live on both phones, reminder on opening');

  // ── Conversations: a private chat, and Ella (rule-based, no AI) ──────────
  await p.getByTestId('conversation-picker').click();
  await p.getByRole('dialog').getByRole('button', { name: /^An/ }).click();
  await p.getByTestId('chat-note').waitFor();
  await p.getByLabel('Tin nhắn').fill('Bí mật nhé: mua quà sinh nhật mẹ');
  await p.getByRole('button', { name: 'Gửi', exact: true }).click();
  await q.getByTestId('conversation-picker').locator('.dot').waitFor({ timeout: 5000 });
  await expect((await q.getByText('Bí mật nhé: mua quà sinh nhật mẹ').count()) === 0, 'a private message stays out of the group chat');
  await q.getByTestId('conversation-picker').click();
  await shot(q, '07g-conversations');
  await q.getByRole('dialog').getByRole('button', { name: /^Linh/ }).click();
  await q.getByText('Bí mật nhé: mua quà sinh nhật mẹ').waitFor();
  await shot(q, '07h-private-chat');
  await p.getByTestId('conversation-picker').click();
  await p.getByRole('dialog').getByRole('button', { name: /^Ella/ }).click();
  await p.getByTestId('bot-greeting').waitFor();
  await p.locator('.bot-chips').getByRole('button', { name: 'gợi ý cho mình' }).click();
  await p.getByTestId('bot-reply').first().waitFor({ timeout: 5000 });
  await p.getByLabel('Tin nhắn').fill('ghi chú: Mật khẩu wifi mới là mate2026');
  await p.getByRole('button', { name: 'Gửi', exact: true }).click();
  await p.getByTestId('bot-reply').filter({ hasText: 'Đã lưu “Mật khẩu wifi mới là mate2026”' }).waitFor({ timeout: 5000 });
  await p.getByLabel('Tin nhắn').fill('tìm wifi');
  await p.getByRole('button', { name: 'Gửi', exact: true }).click();
  await p.getByTestId('bot-reply').filter({ hasText: '📝 Mật khẩu wifi mới là mate2026' }).waitFor({ timeout: 5000 });
  await p.getByLabel('Tin nhắn').fill('lịch: mai 8h họp tổ dân phố');
  await p.getByRole('button', { name: 'Gửi', exact: true }).click();
  await p.getByTestId('bot-reply').filter({ hasText: 'Đã thêm “mai 8h họp tổ dân phố” vào lịch' }).waitFor({ timeout: 5000 });
  await shot(p, '07i-ella');
  await p.getByTestId('conversation-picker').click();
  await p.getByRole('dialog').getByTestId('conv-group').click();
  await p.getByTestId('chat-name').getByText('Nhà mình 🏡').waitFor();
  await q.getByTestId('conversation-picker').click();
  await q.getByRole('dialog').getByTestId('conv-group').click();
  step('conversations: private chat Linh ↔ An stays out of the group; Ella greets, saves a note to the Library, finds it and adds an appointment (simple commands, no AI)');

  // ── Pinned note in the group chat; chores taking turns ───────────────
  await p.getByRole('link', { name: 'Thư viện' }).click();
  await p.locator('.list-item', { hasText: 'Mật khẩu wifi mới là mate2026' }).click();
  await p.getByTestId('pin-toggle').click();
  await p.getByText('Đã ghim lên đầu nhóm chat').waitFor();
  await p.getByRole('button', { name: 'Đóng' }).click();
  await q.getByTestId('pinned').getByRole('button', { name: /Mật khẩu wifi mới là mate2026/ }).click({ timeout: 5000 });
  await q.getByTestId('pinned-card').waitFor();
  await shot(q, '07j-pinned');
  await q.getByRole('link', { name: 'Lịch' }).click();
  await q.getByTestId('calendar-view').getByRole('button', { name: /Việc nhà/ }).click();
  await q.getByTestId('idea-ideaBins').click();
  await q.getByTestId('idea-ideaWifi').click();
  await q.locator('.chore', { hasText: 'Đổ rác' }).getByText('Lượt của Linh').waitFor();
  await q.locator('.chore', { hasText: 'Đổi mật khẩu wifi' }).getByText('3 tháng một lần').waitFor();
  await p.getByRole('link', { name: 'Lịch' }).click();
  await p.getByTestId('calendar-view').getByRole('button', { name: /Việc nhà/ }).click();
  await p.getByRole('button', { name: 'Đánh dấu xong “Đổ rác”' }).click();
  await p.getByText('Xong — lượt sau: An').waitFor();
  await q.locator('.chore', { hasText: 'Đổ rác' }).getByText('Lượt của bạn').waitFor({ timeout: 5000 });
  await shot(q, '07k-chores');
  await p.getByTestId('calendar-view').getByRole('button', { name: 'Tháng' }).click();
  await q.getByTestId('calendar-view').getByRole('button', { name: 'Tháng' }).click();
  await p.getByRole('link', { name: 'Chat' }).click();
  await q.getByRole('link', { name: 'Chat' }).click();
  step('a note pinned to the group chat; chores: bins taking turns (Linh → An, live), Wi‑Fi password every 3 months');

  // ── 5. Library ───────────────────────────────────────────────────────
  await p.getByRole('link', { name: 'Thư viện' }).click();
  await p.getByText('Wi-Fi nhà mình').waitFor();
  // 4 sample notes + 7 shelf examples + the note Ella saved; Linh also sees her private sample note.
  await waitCount(p, 12, 'Linh sees 12 items (incl. her private note)');
  await shot(p, '08-library');
  await q.getByRole('link', { name: 'Thư viện' }).click();
  await q.getByText('Wi-Fi nhà mình').waitFor();
  await waitCount(q, 11, 'An does not see Linh’s private note');
  await expect((await q.getByText('Ghi chú riêng của bạn').count()) === 0, 'private note hidden from An');
  step('library: private note hidden from housemate');

  await q.getByLabel('Tìm trong thư viện').fill('nguoi kia rua bat');
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
  await q.getByLabel('Tiêu đề').fill('Hợp đồng gửi xe');
  await q.getByLabel('Nội dung').fill('Hết hạn 30/06/2027. Cọc 2 tháng.');
  await q.getByLabel('Thêm nhãn').fill('giấy tờ');
  await q.keyboard.press('Enter');
  await q.getByLabel('Thêm nhãn').fill('nhà');
  await q.keyboard.press('Enter');
  await shot(q, '10-library-editor');
  await q.getByRole('button', { name: 'Lưu', exact: true }).click();
  await q.getByText('Đã thêm vào thư viện').waitFor();
  await p.getByText('Hợp đồng gửi xe').waitFor({ timeout: 5000 });
  step('note added by An appears on Linh’s phone in real time');
  await p.getByRole('button', { name: '#giấy tờ', exact: true }).click();
  await waitCount(p, 1, 'tag filter');
  await p.locator('.list-item').first().click();
  await p.getByRole('dialog').getByText('Cọc 2 tháng').waitFor();
  await shot(p, '11-library-item');
  await p.getByRole('button', { name: 'Đóng' }).click();
  step('tag filter + item detail');

  // Shelves: an empty shelf invites you in; a rental record with an expiry shows a reminder.
  await p.getByRole('button', { name: 'Tất cả', exact: true }).click();
  await p.getByTestId('shelves').getByRole('button', { name: /Hồ sơ thuê nhà/ }).click();
  await p.locator('.list-item', { hasText: 'Hợp đồng thuê nhà — 12 tháng' }).getByText('Mẫu').waitFor();
  await p.getByTestId('library-add').click();
  await p.locator('input[name=title]').fill('Hợp đồng thuê 2026');
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await p.locator('input[name=expiresOn]').fill(soon);
  await p.locator('input[name=amount]').fill('8500000');
  await p.getByRole('button', { name: 'Lưu', exact: true }).click();
  await p.locator('.list-item', { hasText: 'Hợp đồng thuê 2026' }).getByText('còn 10 ngày').waitFor();
  await p.getByRole('button', { name: 'Bỏ lọc Hồ sơ thuê nhà' }).click();
  await p.getByTestId('expiring').getByText('Hợp đồng thuê 2026 (còn 10 ngày)').waitFor();
  await shot(p, '11b-shelves');
  step('shelves: rental shelf with a sample lease → added a real lease with an expiry → reminder banner');

  // Personal library: Linh's own space; each item says who sees it.
  await p.getByTestId('library-mode').getByRole('button', { name: /Cá nhân/ }).click();
  await p.getByText('Không gian riêng của bạn').waitFor();
  await p.getByTestId('library-add').click();
  await p.getByRole('dialog').getByRole('button', { name: /Ghi chú/ }).click();
  await p.getByLabel('Tiêu đề').fill('Số hộ chiếu');
  await p.getByLabel('Nội dung').fill('C1234567 — hết hạn 2031');
  await expect((await p.locator('select[name=visibility]').count()) === 0, 'no "who sees it" choice in the personal space');
  await p.getByRole('button', { name: 'Lưu', exact: true }).click();
  await p.locator('.list-item', { hasText: 'Số hộ chiếu' }).getByText('Chỉ mình tôi').waitFor();
  await shot(p, '11c-personal');
  await expect((await p.getByTestId('shelves').count()) === 0, 'no shelves in the personal library');
  await p.getByTestId('library-mode').getByRole('button', { name: /Nhà/ }).click();
  await p.getByTestId('shelves').waitFor();
  await expect((await p.getByText('Số hộ chiếu').count()) === 0, 'personal note not in the home library');
  await expect((await q.getByText('Số hộ chiếu').count()) === 0, 'An never sees it');
  // An item only for owners and managers.
  await p.getByTestId('library-add').click();
  await p.getByRole('dialog').getByRole('button', { name: /Ghi chú/ }).click();
  await p.getByLabel('Tiêu đề').fill('Mã két sắt');
  await p.locator('select[name=visibility]').selectOption('managers');
  await p.getByRole('button', { name: 'Lưu', exact: true }).click();
  await p.locator('.list-item', { hasText: 'Mã két sắt' }).getByText('Chủ nhà và quản lý').waitFor();
  await q.reload();
  await q.getByText('Wi-Fi nhà mình').waitFor();
  await expect((await q.getByText('Mã két sắt').count()) === 1, 'An is a manager now, so An sees it');
  step('Personal library is Linh’s alone; home items show who sees them (me / home / owners & managers)');

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
  await p.getByText(/Đã tìm thấy số tiền, hạn trả và kỳ thanh toán/).waitFor();
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
  await q.getByRole('button', { name: 'Lưu', exact: true }).click();
  await q.getByText('Mọi người còn nợ bạn').waitFor();
  await p.getByText('Bạn cần trả').waitFor({ timeout: 5000 });
  step('shared expense split in real time');

  // ── 7. Bill photo → on-device OCR ────────────────────────────────────
  const billPage = await linh.context.newPage();
  await skipTour(billPage);
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

  // ── 7b. The owner downloads everything ───────────────────────────────
  await p.getByRole('button', { name: 'Cài đặt nhà' }).click();
  const [download] = await Promise.all([p.waitForEvent('download'), p.getByTestId('export').click()]);
  const zipPath = join(SHOTS, 'export.zip');
  await download.saveAs(zipPath);
  const zipBytes = readFileSync(zipPath);
  await expect(zipBytes.readUInt32LE(0) === 0x04034b50 && zipBytes.includes('data.json'), 'a ZIP with data.json');
  await expect(/^mate-nha-12-le-loi-\d{4}-\d{2}-\d{2}\.zip$/.test(download.suggestedFilename()), `file name (${download.suggestedFilename()})`);
  step(`owner downloaded the whole home: ${download.suggestedFilename()} (${Math.round(zipBytes.length / 1024)} KB)`);
  await p.getByRole('link', { name: 'Chat' }).click();

  // ── 7c. Clear the samples; an empty shelf offers examples ─────────────
  await p.getByRole('button', { name: 'Cài đặt nhà' }).click();
  await p.getByRole('button', { name: 'Xoá dữ liệu mẫu' }).click();
  await p.getByRole('link', { name: 'Thư viện' }).click();
  await p.getByTestId('shelves').getByRole('button', { name: /Công thức nấu ăn/ }).click();
  await p.getByRole('heading', { name: 'Chưa có công thức nào' }).waitFor();
  await p.getByTestId('add-examples').click();
  await p.getByText('Gà xào rau củ (20 phút)').waitFor();
  await shot(p, '11d-examples');
  await p.getByRole('button', { name: 'Bỏ lọc Công thức nấu ăn' }).click();
  await p.getByRole('link', { name: 'Chat' }).click();
  step('samples cleared; an empty shelf filled with a realistic example in one tap');

  // ── 8. States: error + sign out ──────────────────────────────────────
  await linh.context.setOffline(true);
  await p.getByRole('link', { name: 'Thư viện' }).click();
  await p.getByText(/Không kết nối được|Chưa tải được|Đang kết nối lại/).first().waitFor({ timeout: 8000 });
  await shot(p, '18-offline-error');
  await linh.context.setOffline(false);
  step('offline shows an error state with retry');

  await q.getByRole('button', { name: 'Cài đặt nhà' }).click();
  await q.getByRole('button', { name: 'Đăng xuất' }).click();
  await q.getByRole('heading', { name: 'MATE' }).waitFor();
  step('sign out');

  // ── 9. French, German, Dutch: text, sample content, money and dates ──
  const norm = (x) => x.replace(/[\u00a0\u202f]/g, ' ').trim();
  for (const [locale, tabBills, wifi, region] of [
    ['fr', 'Factures', 'Wi-Fi de la maison', 'fr-FR'],
    ['de', 'Rechnungen', 'WLAN zu Hause', 'de-DE'],
    ['nl', 'Rekeningen', 'Wifi thuis', 'nl-NL'],
  ]) {
    const ctx = await browser.newContext({ ...phone, locale: region, timezoneId: 'Europe/Amsterdam' });
    const page = await ctx.newPage();
    await skipTour(page);
    page.on('pageerror', (e) => problems.push(`[${locale} pageerror] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && problems.push(`[${locale} console] ${m.text()}`));
    await page.goto(`${BASE}/signup`);
    await expect((await page.locator('html').getAttribute('lang')) === locale, `${locale} detected from the browser`);
    await page.locator('input[name=name]').fill('Tom');
    await page.locator('input[name=email]').fill(`tom-${locale}-${run}@example.com`);
    await page.locator('input[name=password]').fill('long enough pw');
    await page.locator('button[type=submit]').click();
    await page.getByTestId('start-create').click();
    await page.locator('input[name=homeName]').fill('Amsterdam');
    await expect((await page.locator('select[name=currency]').inputValue()) === 'EUR', `${locale}: euro suggested`);
    await page.locator('form button[type=submit]').click();
    await page.locator('.system').first().waitFor();
    await page.getByRole('link', { name: tabBills }).click();
    const amount = norm(await page.locator('.list-item .amount').first().textContent());
    const expected = norm(new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(142.5));
    await expect(amount === expected, `${locale}: money ${amount} = ${expected}`);
    await page.locator('.list-item').first().click();
    const due = await page.locator('.sheet .card .row').first().locator('span').last().textContent();
    const dueIso = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const [y, m, d] = dueIso.split('-').map(Number);
    const dueExpected = norm(new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(y, m - 1, d)));
    await expect(norm(due) === dueExpected, `${locale}: date ${due} = ${dueExpected}`);
    await shot(page, `20-bills-${locale}`);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: { fr: 'Bibliothèque', de: 'Bibliothek', nl: 'Bibliotheek' }[locale] }).click();
    await page.getByText(wifi).waitFor();
    await shot(page, `21-library-${locale}`);
    await ctx.close();
    step(`${locale}: translated UI and samples; ${amount}; due ${due}`);
  }

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
