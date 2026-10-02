/**
 * "Understand" step: turn unstructured text (an email, an OCR'd bill photo)
 * into typed facts. Deterministic extractors here; an LLM extractor can
 * implement the same `Extractor` interface for messier inputs.
 *
 * This module has no Node dependencies so the same code runs in the browser
 * (the Light app parses pasted text and photos on the device, offline).
 *
 * Facts double as the "confirmed" shape: the user reviews and corrects them,
 * and the optional fields (shared, participants, publicLabel…) carry their
 * choices back to `CapturePipeline.apply`.
 */

export interface TrackingFact {
  kind: 'tracking';
  trackingNumber: string;
  carrier: string;
  expectedOn?: string;
  /** What housemates see instead of the contents, e.g. "Đồ riêng". */
  publicLabel?: string;
}

export interface ReceiptFact {
  kind: 'receipt';
  retailer?: string;
  orderNumber?: string;
  total: number;
  currency: string;
  description?: string;
  date?: string;
  category?: string;
  /** Only shared purchases are split. Default false. */
  shared?: boolean;
  participants?: string[];
}

export interface BillFact {
  kind: 'bill';
  category: BillCategory;
  amount: number;
  currency: string;
  provider?: string;
  dueDate?: string; // ISO date
  periodStart?: string;
  periodEnd?: string;
  /** Default true for household bills. */
  shared?: boolean;
  responsible?: string[];
}

export type BillCategory =
  | 'electricity'
  | 'water'
  | 'gas'
  | 'internet'
  | 'rent'
  | 'phone'
  | 'insurance'
  | 'other';

export type Fact = TrackingFact | ReceiptFact | BillFact;

export interface Signal {
  /** Integration the signal arrived through (email, bank, retailer...). */
  source: 'email' | 'bank' | 'retailer' | 'delivery' | 'calendar' | 'manual' | 'ocr';
  from?: string;
  subject?: string;
  body: string;
  receivedAt?: Date;
}

export interface Extractor {
  extract(signal: Signal): Fact[];
}

interface CarrierRule {
  carrier: string;
  pattern: RegExp;
  /** Generic formats (plain digits) only count when the carrier is named. */
  requiresMention?: RegExp;
}

const CARRIERS: CarrierRule[] = [
  { carrier: 'UPS', pattern: /\b1Z[0-9A-Z]{16}\b/g },
  { carrier: 'Royal Mail', pattern: /\b[A-Z]{2}\d{9}GB\b/g },
  { carrier: 'Australia Post', pattern: /\b[A-Z]{2}\d{9}AU\b/g },
  { carrier: 'Vietnam Post', pattern: /\b[A-Z]{2}\d{9}VN\b/g },
  { carrier: 'Shopee Express', pattern: /\bSPXVN\d{9,14}\b/g },
  { carrier: 'USPS', pattern: /\b9[2-5]\d{20}\b/g },
  { carrier: 'FedEx', pattern: /\b\d{12}\b/g, requiresMention: /fedex/i },
  { carrier: 'DHL', pattern: /\b\d{10}\b/g, requiresMention: /\bdhl\b/i },
  { carrier: 'J&T Express', pattern: /\b\d{12}\b/g, requiresMention: /j&t|j and t express/i },
];

const CARRIER_MENTIONS: [string, RegExp][] = [
  ['Giao Hàng Nhanh', /giao hàng nhanh|\bghn\b/i],
  ['Giao Hàng Tiết Kiệm', /giao hàng tiết kiệm|\bghtk\b/i],
  ['Viettel Post', /viettel ?post/i],
  ['J&T Express', /j&t/i],
  ['Australia Post', /australia post|auspost/i],
  ['StarTrack', /startrack/i],
  ['Aramex', /aramex|fastway/i],
  ['DHL', /\bdhl\b/i],
  ['UPS', /\bups\b/i],
  ['FedEx', /fedex/i],
  ['Royal Mail', /royal mail/i],
  ['Evri', /\bevri\b|hermes/i],
  ['Amazon Logistics', /amazon logistics/i],
];

const BILL_KEYWORDS: [BillCategory, RegExp][] = [
  // Phone first: "hóa đơn điện thoại" must not be read as electricity.
  ['phone', /điện thoại|cước di động|mobile plan|phone bill|mobile bill|téléphon|forfait mobile|mobilfunk|handyrechnung|telefonrechnung|telefoon|mobiel abonnement/i],
  ['electricity', /electricity|electric|power bill|energy bill|kwh|tiền điện|hóa đơn điện|hoá đơn điện|điện lực|\bevn\b|électricité|electricite|\bstrom|stroom|elektriciteit/i],
  ['water', /water bill|water usage|water service|tiền nước|cấp nước|nước sạch|hóa đơn nước|hoá đơn nước|\beau\b|wasser|waterrekening|\bwater\b/i],
  ['gas', /\bgas bill\b|gas usage|\bgas\b.*\b(?:account|supply)\b|tiền ga|tiền gas|\bgaz\b|gasrechnung|gasrekening/i],
  ['internet', /internet|broadband|\bnbn\b|wi-?fi|fib(?:er|re)|cáp quang|cước mạng|glasvezel/i],
  ['rent', /\brent\b|rental|tiền nhà|tiền thuê|thuê nhà|tiền phòng|\bloyer\b|\bmiete\b|\bhuur\b/i],
  ['insurance', /insurance|policy renewal|bảo hiểm|assurance|versicherung|verzekering/i],
];

const AMOUNT_LABELS: RegExp[] = [
  /tổng (?:số )?tiền (?:cần |phải )?thanh toán/i,
  /số tiền (?:cần |phải )thanh toán/i,
  /tổng thanh toán/i,
  /total amount due|amount due|total due|balance due|amount payable|total payable|please pay|amount to pay/i,
  /số tiền thanh toán/i,
  /montant (?:total )?(?:à payer|à régler|dû|ttc)|net à payer|total à payer|somme à payer/i,
  /zu zahlender betrag|zahlbetrag|rechnungsbetrag|gesamtbetrag|endbetrag/i,
  /te betalen bedrag|totaal te betalen|te betalen|totaalbedrag/i,
  /grand total|order total|total paid|total amount|new charges/i,
  /tổng cộng|tổng tiền|thành tiền/i,
  /\btotal\b|\btotaal\b|\bmontant\b|\bbetrag\b|\bbedrag\b/i,
  /số tiền/i,
];

const DUE_LABELS =
  /due date|payment due|due by|due on|pay by|please pay by|\bdue\b|hạn thanh toán|hạn chót|hạn nộp|ngày đến hạn|ngày hết hạn|thanh toán trước(?: ngày)?|date d['’]échéance|échéance|à (?:payer|régler) avant le|payable avant le|fällig am|fällig bis|zahlbar bis|fälligkeitsdatum|fällig|vervaldatum|uiterste betaaldatum|te betalen vóór|te betalen voor|betalen voor/i;
const PERIOD_LABELS =
  /billing period|bill period|service period|supply period|usage period|billing cycle|\bperiod\b|kỳ thanh toán|kỳ hóa đơn|kỳ hoá đơn|kỳ cước|kỳ sử dụng|période de facturation|période de consommation|\bpériode\b|abrechnungszeitraum|leistungszeitraum|\bzeitraum\b|factuurperiode|\bperiode\b/i;
const EXPECTED_LABELS = /expected (?:delivery|on|by)?|estimated delivery|arriving|delivery date|dự kiến giao|ngày giao dự kiến/i;
const ORDER_DATE_LABELS = /order date|purchase date|date of purchase|ngày đặt(?: hàng)?|ngày mua/i;

/** Month-name prefixes in English, French, German and Dutch (accents stripped). Longest first. */
const MONTHS: [string, number][] = [
  ['janv', 1], ['jan', 1], ['fevr', 2], ['fev', 2], ['feb', 2], ['maart', 3], ['mars', 3], ['marz', 3], ['maerz', 3],
  ['mrt', 3], ['mar', 3], ['avr', 4], ['apr', 4], ['mai', 5], ['may', 5], ['mei', 5], ['juin', 6], ['jun', 6],
  ['juil', 7], ['jul', 7], ['aout', 8], ['aug', 8], ['sept', 9], ['sep', 9], ['oct', 10], ['okt', 10], ['nov', 11],
  ['dec', 12], ['dez', 12],
];
const monthOf = (word: string) => MONTHS.find(([prefix]) => word.startsWith(prefix))?.[1];
const MONTH_NAME =
  '(?:janv|jan|f[eé]vr?|feb|maart|mars|m[aä]rz|maerz|mrt|mar|avr|apr|mai|may|mei|juin|jun|juil|jul|ao[uû]t|aug|sept|sep|oct|okt|nov|d[eé]c|dez)\\p{L}*\\.?';
const DATE_SOURCE = [
  '\\d{4}-\\d{1,2}-\\d{1,2}',
  '\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}',
  `\\d{1,2}(?:st|nd|rd|th|er|\\.)?\\s+${MONTH_NAME},?(?:\\s+\\d{4})?`,
  `${MONTH_NAME}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`,
  '(?:ngày\\s*)?\\d{1,2}\\s*tháng\\s*\\d{1,2}(?:\\s*(?:năm|,)\\s*\\d{4})?',
  '\\d{1,2}/\\d{1,2}(?![/\\d])',
].join('|');
const dateRe = () => new RegExp(`(?<![\\d.,])(?:${DATE_SOURCE})(?![\\d.,]\\d)`, 'giu');

const MONEY_RE =
  /(?:(A\$|AU\$|US\$|NZ\$|[$£€₫]|\b(?:AUD|USD|EUR|GBP|VND|NZD|SGD|CAD|JPY)\b)\s?)?(\d{1,3}(?: \d{3})+,\d{2}|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s?(đồng|vnđ|vnd|đ|₫|aud|usd|eur|gbp|nzd|sgd)\b|\s?(đ|₫|€|£))?/gi;

const SYMBOL_CURRENCY: Record<string, string> = {
  'a$': 'AUD', 'au$': 'AUD', 'us$': 'USD', 'nz$': 'NZD', '£': 'GBP', '€': 'EUR', '₫': 'VND', 'đ': 'VND', 'đồng': 'VND', 'vnđ': 'VND',
};

export interface ExtractorOptions {
  /** Currency for bare "$" amounts and amounts without any marker. */
  defaultCurrency?: string;
}

export class RuleBasedExtractor implements Extractor {
  private readonly defaultCurrency: string;

  constructor(options: ExtractorOptions | string = {}) {
    this.defaultCurrency = (typeof options === 'string' ? options : options.defaultCurrency) ?? 'AUD';
  }

  extract(signal: Signal): Fact[] {
    const text = normalise(`${signal.subject ?? ''}\n${signal.body}`);
    const ref = signal.receivedAt ?? new Date();
    const facts: Fact[] = [...this.tracking(text, ref)];

    const bill = this.bill(text, signal.from, ref);
    if (bill) facts.push(bill);
    else {
      const receipt = this.receipt(text, signal.from, ref);
      if (receipt) facts.push(receipt);
    }
    return facts;
  }

  private tracking(text: string, ref: Date): TrackingFact[] {
    const found = new Map<string, TrackingFact>();
    const expectedOn = this.dateAfter(text, EXPECTED_LABELS, ref);
    for (const rule of CARRIERS) {
      if (rule.requiresMention && !rule.requiresMention.test(text)) continue;
      for (const match of text.matchAll(rule.pattern)) {
        if (!found.has(match[0])) {
          found.set(match[0], compact<TrackingFact>({ kind: 'tracking', trackingNumber: match[0], carrier: rule.carrier, expectedOn }));
        }
      }
    }
    if (found.size === 0) {
      const generic =
        /(?:tracking (?:number|no\.?|#|code|id)|mã vận đơn|mã vận chuyển|consignment(?: number| no\.?)?|waybill)\s*[:#]?\s*([A-Z0-9]{8,30})\b/i.exec(
          text,
        );
      if (generic?.[1] && /\d/.test(generic[1])) {
        const carrier = CARRIER_MENTIONS.find(([, re]) => re.test(text))?.[0] ?? 'Unknown';
        found.set(generic[1], compact<TrackingFact>({ kind: 'tracking', trackingNumber: generic[1].toUpperCase(), carrier, expectedOn }));
      }
    }
    return [...found.values()];
  }

  private bill(text: string, from: string | undefined, ref: Date): BillFact | undefined {
    const category = BILL_KEYWORDS.find(([, re]) => re.test(text))?.[0];
    const dueDate = this.dateAfter(text, DUE_LABELS, ref);
    if (!category && !dueDate) return undefined;
    const money = this.amount(text);
    if (!money) return undefined;
    const period = this.period(text, ref, dueDate);
    return compact<BillFact>({
      kind: 'bill',
      category: category ?? 'other',
      ...money,
      provider: senderName(from),
      dueDate,
      periodStart: period?.[0],
      periodEnd: period?.[1],
    });
  }

  private receipt(text: string, from: string | undefined, ref: Date): ReceiptFact | undefined {
    const money = this.amount(text);
    if (!money) return undefined;
    const order = /(?:order|đơn hàng)\s*(?:#|no\.?|number|số|mã)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i.exec(text);
    return compact<ReceiptFact>({
      kind: 'receipt',
      retailer: retailerName(text, from),
      orderNumber: order?.[1],
      total: money.amount,
      currency: money.currency,
      date: this.dateAfter(text, ORDER_DATE_LABELS, ref),
    });
  }

  /** The amount after the most specific label found, preferring numbers with a currency marker. */
  private amount(text: string): { amount: number; currency: string } | undefined {
    for (const label of AMOUNT_LABELS) {
      const re = new RegExp(label.source, 'gi');
      for (const m of text.matchAll(re)) {
        // Look a little past the label, ignoring any dates in that window.
        const window = text.slice(m.index! + m[0].length, m.index! + m[0].length + 60).replace(dateRe(), (d) => ' '.repeat(d.length));
        const candidates = [...window.matchAll(MONEY_RE)].filter((c) => /\d/.test(c[2] ?? ''));
        const best = candidates.find((c) => c[1] || c[3] || c[4]) ?? candidates[0];
        if (!best?.[2]) continue;
        const amount = parseAmount(best[2]);
        if (!(amount > 0)) continue;
        return { amount, currency: this.currencyOf(best[1] ?? best[3] ?? best[4], text) };
      }
    }
    return undefined;
  }

  private currencyOf(marker: string | undefined, text: string): string {
    if (marker) {
      const m = marker.toLowerCase();
      if (SYMBOL_CURRENCY[m]) return SYMBOL_CURRENCY[m]!;
      if (/^[a-z]{3}$/.test(m)) return m === 'vnd' ? 'VND' : m.toUpperCase();
      if (m === '$') return this.defaultCurrency === 'VND' ? 'USD' : this.defaultCurrency;
    }
    if (/\bvnd\b|vnđ|đồng|₫/i.test(text)) return 'VND';
    return this.defaultCurrency;
  }

  private dateAfter(text: string, labels: RegExp, ref: Date, maxGap = 30): string | undefined {
    for (const m of text.matchAll(new RegExp(labels.source, 'gi'))) {
      const start = m.index! + m[0].length;
      const window = text.slice(start, start + maxGap + 30);
      const d = dateRe().exec(window);
      if (d && d.index <= maxGap) {
        const iso = parseDate(d[0], ref.getUTCFullYear());
        if (iso) return iso;
      }
    }
    return undefined;
  }

  private period(text: string, ref: Date, dueDate?: string): [string, string] | undefined {
    const year = dueDate ? Number(dueDate.slice(0, 4)) : ref.getUTCFullYear();
    const pairAt = (window: string) => {
      const dates = [...window.matchAll(dateRe())].slice(0, 2);
      if (dates.length < 2) return undefined;
      const between = window.slice(dates[0]!.index! + dates[0]![0].length, dates[1]!.index!);
      if (!/^\s*(?:-|to|until|đến|tới|~|au|bis|t\/m|tot(?: en met)?)\s*(?:ngày|le\s*)?\s*$/i.test(between)) return undefined;
      return orderedPeriod(dates[0]![0], dates[1]![0], year);
    };
    for (const m of text.matchAll(new RegExp(PERIOD_LABELS.source, 'gi'))) {
      const start = m.index! + m[0].length;
      const found = pairAt(text.slice(start, start + 70).replace(/^[\s:()-]*(?:từ\s*(?:ngày)?|du|vom|van)?\s*/i, ''));
      if (found) return found;
    }
    const tuNgay = /từ\s*(?:ngày)?\s*/gi;
    for (const m of text.matchAll(tuNgay)) {
      const found = pairAt(text.slice(m.index! + m[0].length, m.index! + m[0].length + 60));
      if (found) return found;
    }
    // Unlabelled "01/09/2026 - 30/09/2026".
    const dates = [...text.matchAll(dateRe())];
    for (let i = 0; i + 1 < dates.length; i++) {
      const a = dates[i]!;
      const b = dates[i + 1]!;
      const between = text.slice(a.index! + a[0].length, b.index!);
      if (/^\s*(?:-|to|đến|au|bis|t\/m|tot)\s*$/i.test(between)) {
        const found = orderedPeriod(a[0], b[0], year);
        if (found) return found;
      }
    }
    return undefined;
  }
}

function orderedPeriod(a: string, b: string, year: number): [string, string] | undefined {
  const hasYear = (s: string) => /\d{4}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2}\b/.test(s);
  let start = parseDate(a, year);
  const end = parseDate(b, year);
  if (!start || !end) return undefined;
  // "1 Dec – 28 Feb 2027": the start belongs to the previous year.
  if (start > end && !hasYear(a)) start = parseDate(a, Number(end.slice(0, 4)) - 1);
  if (!start || start > end) return undefined;
  return [start, end];
}

/** Parse one date token to ISO (yyyy-mm-dd). Day-first unless that is impossible. */
export function parseDate(raw: string, refYear: number): string | undefined {
  // Accent-free, lower case, without ordinal suffixes ("1st", "1er") or the German day dot ("15. Okt").
  const s = raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th|er)\b/, '$1')
    .replace(/^(\d{1,2})\.\s+/, '$1 ');
  let y: number | undefined;
  let m: number | undefined;
  let d: number | undefined;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [y, m, d] = [+r[1]!, +r[2]!, +r[3]!];
  else if ((r = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(s))) {
    [d, m, y] = [+r[1]!, +r[2]!, +r[3]!];
    if (m > 12 && d <= 12) [d, m] = [m, d];
    if (y < 100) y += 2000;
  } else if ((r = /^(\d{1,2})\s+([a-z]+)\.?,?(?:\s+(\d{4}))?$/.exec(s))) {
    [d, m, y] = [+r[1]!, monthOf(r[2]!), r[3] ? +r[3] : refYear];
  } else if ((r = /^([a-z]+)\.?\s+(\d{1,2}),?(?:\s+(\d{4}))?$/.exec(s))) {
    [m, d, y] = [monthOf(r[1]!), +r[2]!, r[3] ? +r[3] : refYear];
  } else if ((r = /^(?:ngay\s*)?(\d{1,2})\s*thang\s*(\d{1,2})(?:\s*(?:nam|,)\s*(\d{4}))?$/.exec(s))) {
    [d, m, y] = [+r[1]!, +r[2]!, r[3] ? +r[3] : refYear];
  } else if ((r = /^(\d{1,2})\/(\d{1,2})$/.exec(s))) {
    [d, m, y] = [+r[1]!, +r[2]!, refYear];
    if (m > 12 && d <= 12) [d, m] = [m, d];
  }
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return undefined;
  return date.toISOString().slice(0, 10);
}

/** "1,234.56" / "1.234,56" / "1.234.567" / "12.50" / "12,5" */
export function parseAmount(input: string): number {
  const raw = input.replace(/\s/g, '');
  const lastSep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  const tail = lastSep === -1 ? 0 : raw.length - lastSep - 1;
  const hasDecimals = lastSep !== -1 && (tail === 1 || tail === 2);
  const integer = (hasDecimals ? raw.slice(0, lastSep) : raw).replace(/[.,]/g, '');
  const decimals = hasDecimals ? raw.slice(lastSep + 1) : '0';
  return Number(`${integer}.${decimals}`);
}

function normalise(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u2012-\u2015\u2212]/g, '-');
}

function senderName(from?: string): string | undefined {
  const domain = from ? /@(?:[\w-]+\.)*?([\w-]+)\.(?:com|co|net|org|shop|vn|io)(?:\.\w{2})?>?$/i.exec(from.trim()) : null;
  if (!domain?.[1]) return undefined;
  const name = domain[1];
  return name.length <= 4 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1);
}

function retailerName(text: string, from?: string): string | undefined {
  const thanks = /(?:thank you for (?:shopping|your order|ordering) (?:at|with|from)|cảm ơn bạn đã (?:mua sắm|đặt hàng) (?:tại|ở|trên)) ([A-Z][\w&' ]{1,40}?)[.!,\n]/i.exec(text);
  if (thanks?.[1]) return thanks[1].trim();
  return senderName(from);
}

/** Drop undefined keys so facts stay small and compare cleanly. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
