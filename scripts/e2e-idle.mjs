// Real-browser check of the chat idle pause: the live stream closes after a
// while without activity (or with the tab hidden), and reconnects and loads
// the missed messages when the person comes back.
// Start the server with a short timeout first, e.g.
//   CHAT_IDLE_MINUTES=0.05 DATA_DIR=$(mktemp -d) PORT=3100 npm start
//   BASE_URL=http://localhost:3100 node scripts/e2e-idle.mjs
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const run = Date.now().toString(36);
const step = (msg) => console.log(`• ${msg}`);
const problems = [];
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const phone = { ...devices['iPhone 13'], locale: 'en-US' };
delete phone.defaultBrowserType;

async function person(name) {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`[${name}] ${e.message}`));
  const call = async (method, path, data) => {
    const res = await context.request.fetch(BASE + path, { method, data, headers: { 'X-Requested-With': 'homeapp', Origin: BASE } });
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
    return res.json();
  };
  await call('POST', '/api/auth/signup', { email: `${name}-${run}@example.com`, password: 'idle-test-password', name });
  return { context, page, call };
}
const live = (page, state, timeout = 10_000) =>
  page.waitForFunction((s) => document.documentElement.dataset.live === s, state, { timeout }).catch(() => {
    throw new Error(`expected data-live=${state}`);
  });
const setHidden = (page, hidden) =>
  page.evaluate((hidden) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

try {
  const a = await person('Ana');
  const b = await person('Ben');
  const { config } = await a.call('GET', '/api/me');
  const idleMs = config.chatIdleMinutes * 60_000;
  if (idleMs > 10_000) throw new Error(`start the server with a short CHAT_IDLE_MINUTES (got ${config.chatIdleMinutes})`);
  const { id } = await a.call('POST', '/api/households', { name: 'Idle test', samples: false });
  const { url } = await a.call('POST', `/api/households/${id}/invite`, {});
  await b.call('POST', `/api/invites/${url.split('/join/')[1]}/accept`, {});

  await a.page.goto(`${BASE}/h/${id}/chat`);
  await live(a.page, 'live');
  step(`chat connects (timeout ${idleMs / 1000}s)`);

  // Activity keeps it open, longer than the timeout.
  const until = Date.now() + idleMs * 1.6;
  while (Date.now() < until) {
    await a.page.mouse.wheel(0, 10);
    await a.page.waitForTimeout(400);
  }
  if ((await a.page.evaluate(() => document.documentElement.dataset.live)) !== 'live') throw new Error('stayed live while active');
  await b.call('POST', `/api/households/${id}/messages`, { text: `still here ${run}` });
  await a.page.getByText(`still here ${run}`).waitFor({ timeout: 5000 });
  step('scrolling keeps it connected past the timeout; messages arrive live');

  // Idle → paused, banner shown, nothing arrives.
  await live(a.page, 'paused', idleMs * 3);
  await a.page.getByText('Paused to save battery').waitFor();
  await b.call('POST', `/api/households/${id}/messages`, { text: `while idle ${run}` });
  await a.page.waitForTimeout(1500);
  if (await a.page.getByText(`while idle ${run}`).count()) throw new Error('message arrived while paused');
  step('no activity → disconnected with a "paused" note');

  // Tap → reconnect and catch up.
  await a.page.mouse.click(200, 300);
  await live(a.page, 'live');
  await a.page.getByText(`while idle ${run}`).waitFor({ timeout: 5000 });
  if (await a.page.getByText('Paused to save battery').count()) throw new Error('paused note still visible');
  step('a tap reconnects and loads the missed message');

  // Hidden tab → paused even without waiting for "inactivity" from the start.
  await a.page.mouse.click(200, 300);
  await setHidden(a.page, true);
  await live(a.page, 'paused', idleMs * 3);
  await b.call('POST', `/api/households/${id}/messages`, { text: `while hidden ${run}` });
  await a.page.waitForTimeout(1000);
  await setHidden(a.page, false);
  await live(a.page, 'live');
  await a.page.getByText(`while hidden ${run}`).waitFor({ timeout: 5000 });
  step('hidden tab → disconnected; visible again → reconnects and loads what was missed');

  if (problems.length) throw new Error(problems.join('\n'));
  console.log('\nIdle e2e: all good');
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
