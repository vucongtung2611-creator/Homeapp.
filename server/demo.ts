import { crc32, deflateSync } from 'node:zlib';
import { RuleBasedExtractor, type BillFact } from '../src/integrations/understand.js';

/**
 * Fills a running server with a ready-to-film home: four people, a chat,
 * Library items and a bill parsed from an email. Everything goes through the
 * public HTTP API, exactly as the app itself would do it.
 */
export const DEMO_PASSWORD = 'mate-demo-2026';
export type DemoLang = 'vi' | 'en';

interface Person {
  key: string;
  name: string;
  avatar: string;
  email: string;
}

const day = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function content(lang: DemoLang, now: Date) {
  const due = new Date(now.getTime() + 6 * day);
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  if (lang === 'vi') {
    return {
      home: 'Nhà số 7',
      currency: 'VND',
      people: [
        { key: 'tom', name: 'Tom', avatar: 'tom' },
        { key: 'linh', name: 'Linh', avatar: 'ella' },
        { key: 'minh', name: 'Minh', avatar: 'timothy' },
        { key: 'bao', name: 'Bảo', avatar: 'nolan' },
      ],
      billEmail: {
        from: 'hoadon@evnhcmc.vn',
        subject: `Thông báo tiền điện tháng ${end.getMonth() + 1}/${end.getFullYear()}`,
        body:
          `Kỳ thanh toán: từ ${dmy(start)} đến ${dmy(end)}\nĐiện năng tiêu thụ: 312 kWh\n` +
          `Tổng tiền thanh toán: 1.180.000 đ\nHạn thanh toán: ${dmy(due)}`,
      },
      billLabel: 'Tiền điện',
      internet: { label: 'Internet FPT', provider: 'FPT Telecom', amount: 220_000 },
      groceries: { description: 'Đi chợ cuối tuần', amount: 360_000 },
      chat: {
        hello: ['tom', 'Chào cả nhà! Từ giờ việc nhà, hoá đơn và giấy tờ để hết ở đây nhé 🏠'],
        reply: ['linh', 'Tuyệt! Mình vừa chụp chỉ số đồng hồ điện, để trong Thư viện rồi.'],
        pizza: ['minh', 'Tối nay ăn pizza không mọi người? 🍕'],
        yes: ['bao', 'Có! Mình về lúc 7 giờ.'],
        paid: ['linh', 'Mình trả tiền điện tháng này rồi nha, app tự chia cho cả nhà luôn.'],
        thanks: ['tom', 'Cảm ơn Linh! Tối nay mình chuyển khoản.'],
      },
      library: {
        wifi: { title: 'Wi‑Fi của nhà', body: 'Tên mạng: NhaSo7\nMật khẩu: chaomung2026\nModem đặt ở kệ phòng khách.', tags: ['wifi', 'nhà'] },
        trash: { title: 'Lịch đổ rác', body: 'Thứ Hai và thứ Năm: rác thường, để trước cổng trước 7 giờ tối.\nThứ Bảy: rác tái chế (giấy, chai nhựa).', tags: ['việc nhà'] },
        rules: { title: 'Nội quy nhà', body: '1. Rửa bát ngay sau khi ăn.\n2. Khách ngủ lại báo trước trong nhóm chat.\n3. Sau 11 giờ đêm giữ yên lặng.', tags: ['nhà'] },
        lease: { title: 'Hợp đồng thuê nhà', body: 'Bản scan hợp đồng, có chữ ký của chủ nhà và cả nhà.', tags: ['giấy tờ', 'hợp đồng'], file: 'Hop-dong-thue-nha.pdf' },
        meter: { title: 'Chỉ số đồng hồ điện', body: 'Chụp ngày cuối kỳ để đối chiếu hoá đơn.', tags: ['điện'], file: 'dong-ho-dien.png' },
        secret: { title: 'Quà sinh nhật Linh 🤫', body: 'Mục riêng tư — chỉ Tom thấy. Tai nghe, đặt trước ngày 20.', tags: ['riêng'] },
        bond: { title: 'Tiền cọc nhà', body: 'Đã cọc 2 tháng tiền nhà, hoàn lại khi trả nhà.', amount: 9_000_000 },
        recipe: { title: 'Phở bò của Bảo', body: 'Khẩu phần: 4 người\nNguyên liệu:\n- 500 g bánh phở\n- 400 g thịt bò\n- Hành, gừng, quế, hồi\n\nCách làm:\n1. Nướng hành gừng, ninh xương 3 tiếng.\n2. Trụng bánh, xếp thịt, chan nước dùng.', tags: ['món nước'] },
        contact: { title: 'Chú Hùng – chủ nhà', body: 'Điện thoại: 0903 000 777\nLiên hệ khi: hỏng điện nước, gia hạn hợp đồng.' },
      },
    };
  }
  return {
    home: 'House No. 7',
    currency: 'EUR',
    people: [
      { key: 'tom', name: 'Tom', avatar: 'tom' },
      { key: 'linh', name: 'Ella', avatar: 'ella' },
      { key: 'minh', name: 'Tim', avatar: 'timothy' },
      { key: 'bao', name: 'Nolan', avatar: 'nolan' },
    ],
    billEmail: {
      from: 'billing@brightpower.example',
      subject: 'Your electricity bill',
      body: `Billing period: ${dmy(start)} - ${dmy(end)}\nUsage: 312 kWh\nTotal amount due: €84.60\nDue date: ${dmy(due)}`,
    },
    billLabel: 'Electricity',
    internet: { label: 'Home internet', provider: 'FibreNet', amount: 39.99 },
    groceries: { description: 'Weekend groceries', amount: 62.4 },
    chat: {
      hello: ['tom', 'Hi all! From now on chores, bills and paperwork live here 🏠'],
      reply: ['linh', 'Nice! I just took a photo of the electricity meter, it’s in the Library.'],
      pizza: ['minh', 'Pizza tonight, anyone? 🍕'],
      yes: ['bao', 'Yes! I’m home at 7.'],
      paid: ['linh', 'I paid this month’s electricity, the app split it for everyone.'],
      thanks: ['tom', 'Thanks Ella! I’ll transfer my share tonight.'],
    },
    library: {
      wifi: { title: 'Home Wi‑Fi', body: 'Network: HouseNo7\nPassword: welcome2026\nThe router is on the living-room shelf.', tags: ['wifi', 'home'] },
      trash: { title: 'Bin days', body: 'Monday and Thursday: general waste, out by 7 pm.\nSaturday: recycling (paper, plastic bottles).', tags: ['chores'] },
      rules: { title: 'House rules', body: '1. Wash up right after eating.\n2. Overnight guests: say so in the chat first.\n3. Quiet after 11 pm.', tags: ['home'] },
      lease: { title: 'Tenancy agreement', body: 'Scanned copy, signed by the landlord and all of us.', tags: ['documents', 'lease'], file: 'Tenancy-agreement.pdf' },
      meter: { title: 'Electricity meter reading', body: 'Taken at the end of the period to check the bill.', tags: ['power'], file: 'meter.png' },
      secret: { title: 'Ella’s birthday present 🤫', body: 'Private — only Tom sees this. Headphones, order before the 20th.', tags: ['private'] },
      bond: { title: 'Bond', body: 'Four weeks’ rent, paid back when we move out.', amount: 1800 },
      recipe: { title: 'Nolan’s pasta bake', body: 'Serves: 4\nIngredients:\n- 400 g penne\n- 1 jar tomato sauce\n- 200 g mozzarella\n\nSteps:\n1. Boil the pasta.\n2. Mix with sauce, top with cheese, bake 20 min at 200 °C.', tags: ['dinner'] },
      contact: { title: 'Mr Hughes – landlord', body: 'Phone: 0400 000 777\nWhat for: repairs, renewing the lease.' },
    },
  };
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** A tiny HTTP client that keeps one person's session cookie. */
export class Client {
  private cookie = '';
  constructor(
    private readonly base: string,
    private readonly fetcher: Fetcher,
  ) {}
  async call<T = any>(method: string, path: string, data?: unknown, raw?: { bytes: Uint8Array; name: string }): Promise<T> {
    const headers: Record<string, string> = { 'X-Requested-With': 'homeapp', Origin: this.base };
    if (this.cookie) headers.Cookie = this.cookie;
    let body: BodyInit | undefined;
    if (raw) {
      headers['Content-Type'] = 'application/octet-stream';
      headers['X-File-Name'] = encodeURIComponent(raw.name);
      body = raw.bytes as unknown as BodyInit;
    } else if (data !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(data);
    }
    const res = await this.fetcher(this.base + path, { method, headers, body });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const json = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  }
}

export async function seedDemo(base: string, lang: DemoLang = 'vi', now = new Date(), fetcher: Fetcher = fetch) {
  const c = content(lang, now);
  const people: (Person & { client: Client; id: string })[] = [];
  for (const p of c.people) {
    const client = new Client(base, fetcher);
    const email = `${p.key}@mate.demo`;
    const { user } = await client.call('POST', '/api/auth/signup', { email, password: DEMO_PASSWORD, name: p.name, avatar: p.avatar });
    people.push({ ...p, email, client, id: user.id });
  }
  const by = (key: string) => people.find((p) => p.key === key)!;
  const [tom, linh, minh, bao] = [by('tom'), by('linh'), by('minh'), by('bao')];

  const { id: hid } = await tom.client.call('POST', '/api/households', { name: c.home, currency: c.currency, kind: 'share_house', samples: false });
  for (const p of [linh, minh, bao]) {
    const { url } = await tom.client.call('POST', `/api/households/${hid}/invites`, { label: p.name });
    await p.client.call('POST', `/api/invites/${String(url).split('/join/')[1]}/accept`, {});
    const { requests } = await tom.client.call('GET', `/api/households/${hid}/requests`);
    await tom.client.call('POST', `/api/households/${hid}/requests/${requests[0].id}/approve`, {});
  }
  const say = ([who, text]: string[], fileId?: string) => by(who!).client.call('POST', `/api/households/${hid}/messages`, { text, fileId });
  const upload = (p: Person & { client: Client }, bytes: Uint8Array, name: string) =>
    p.client.call<{ id: string }>('POST', `/api/households/${hid}/files`, undefined, { bytes, name });
  const item = (p: Person & { client: Client }, data: Record<string, unknown>) => p.client.call('POST', `/api/households/${hid}/items`, data);

  // Library
  const L = c.library;
  await item(tom, { kind: 'note', ...L.wifi });
  await item(bao, { kind: 'note', ...L.trash });
  await item(tom, { kind: 'note', ...L.rules, collection: 'house_rules' });
  const pdf = await upload(tom, leasePdf(L.lease.title), L.lease.file);
  // The lease ends in 25 days, so the reminder shows straight away.
  await item(tom, {
    kind: 'document', title: L.lease.title, body: L.lease.body, tags: L.lease.tags, attachmentIds: [pdf.id],
    collection: 'rental', docType: 'lease', date: iso(new Date(now.getTime() - 340 * day)), expiresOn: iso(new Date(now.getTime() + 25 * day)),
  });
  await item(tom, { kind: 'note', ...L.bond, collection: 'rental', docType: 'deposit', date: iso(new Date(now.getTime() - 340 * day)) });
  await item(bao, { kind: 'note', ...L.recipe, collection: 'recipes' });
  await item(tom, { kind: 'note', ...L.contact, collection: 'contacts' });
  const meter = await upload(linh, meterPng(), L.meter.file);
  await item(linh, { kind: 'photo', title: L.meter.title, body: L.meter.body, tags: L.meter.tags, attachmentIds: [meter.id] });
  await item(tom, { kind: 'note', ...L.secret, private: true });

  // Chat, with a bill parsed from an email and paid along the way
  await say(c.chat.hello);
  await say(c.chat.reply);
  const pizza = await upload(minh, pizzaPng(), 'pizza.png');
  await say(c.chat.pizza, pizza.id);
  await say(c.chat.yes);

  const bill = new RuleBasedExtractor({ defaultCurrency: c.currency })
    .extract({ source: 'email', ...c.billEmail, receivedAt: now })
    .find((f): f is BillFact => f.kind === 'bill');
  if (!bill) throw new Error('demo bill was not recognised');
  const money = await linh.client.call('POST', `/api/households/${hid}/bills`, {
    category: bill.category,
    label: c.billLabel,
    amount: bill.amount,
    provider: bill.provider,
    dueDate: bill.dueDate,
    periodStart: bill.periodStart,
    periodEnd: bill.periodEnd,
    shared: true,
  });
  const billId = (money.bills as { id: string; category: string }[]).find((b) => b.category === bill.category)!.id;
  await linh.client.call('POST', `/api/households/${hid}/bills/${billId}/pay`, {});
  await say(c.chat.paid);
  await say(c.chat.thanks);

  await tom.client.call('POST', `/api/households/${hid}/bills`, {
    category: 'internet',
    label: c.internet.label,
    provider: c.internet.provider,
    amount: c.internet.amount,
    dueDate: iso(new Date(now.getTime() + 12 * day)),
    shared: true,
  });
  await minh.client.call('POST', `/api/households/${hid}/expenses`, { ...c.groceries, shared: true, date: iso(new Date(now.getTime() - day)) });

  return { householdId: hid, home: c.home, people: people.map(({ name, email, avatar }) => ({ name, email, avatar })), bill };
}

// ── Generated pictures and a one-page PDF (no files to ship) ──────────
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), row + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
  );
}

export function pizzaPng() {
  const W = 480;
  const H = 360;
  const cx = 240;
  const cy = 190;
  const toppings = [
    [200, 150],
    [280, 160],
    [230, 220],
    [300, 230],
    [180, 210],
    [250, 120],
  ];
  return png(W, H, (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    if (toppings.some(([tx, ty]) => Math.hypot(x - tx!, y - ty!) < 16)) return [178, 34, 34];
    if (d < 120) return [246, 196, 83]; // cheese
    if (d < 135) return [205, 133, 63]; // crust
    if (d < 150) return [250, 250, 248]; // plate
    return (Math.floor(x / 30) + Math.floor(y / 30)) % 2 ? [220, 80, 70] : [250, 240, 230]; // tablecloth
  });
}

export function meterPng() {
  // A meter face with a row of digit windows.
  return png(480, 360, (x, y) => {
    if (x < 60 || x > 420 || y < 50 || y > 310) return [214, 219, 224];
    if (y > 120 && y < 200 && x > 90 && x < 390) {
      const cell = Math.floor((x - 90) / 50);
      const inCell = (x - 90) % 50;
      if (inCell < 4) return [40, 40, 40];
      const seg = [3, 1, 2, 4, 7, 5][cell] ?? 0;
      const bar = Math.floor(((y - 120) / 80) * 8);
      return bar <= seg && inCell > 14 && inCell < 36 ? [240, 240, 240] : [30, 30, 30];
    }
    return [245, 245, 240];
  });
}

export function leasePdf(title: string) {
  const ascii = title.normalize('NFD').replace(/[^\x20-\x7e]/g, '');
  const text = `BT /F1 22 Tf 60 760 Td (${ascii}) Tj ET BT /F1 12 Tf 60 720 Td (MATE demo document - not a real contract.) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
