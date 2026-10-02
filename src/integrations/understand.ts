/**
 * "Understand" step: turn unstructured text (an email, an OCR'd receipt)
 * into typed facts. Deterministic extractors here; an LLM extractor can
 * implement the same `Extractor` interface for messier inputs.
 */

export interface TrackingFact {
  kind: 'tracking';
  trackingNumber: string;
  carrier: string;
}

export interface ReceiptFact {
  kind: 'receipt';
  retailer?: string;
  orderNumber?: string;
  total: number;
  currency: string;
}

export interface BillFact {
  kind: 'bill';
  category: BillCategory;
  amount: number;
  currency: string;
  dueDate?: string; // ISO date
}

export type BillCategory = 'electricity' | 'water' | 'gas' | 'internet' | 'rent' | 'phone' | 'insurance';

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
  { carrier: 'USPS', pattern: /\b9[2-5]\d{20}\b/g },
  { carrier: 'FedEx', pattern: /\b\d{12}\b/g, requiresMention: /fedex/i },
  { carrier: 'DHL', pattern: /\b\d{10}\b/g, requiresMention: /\bdhl\b/i },
];

const CURRENCY_SYMBOLS: Record<string, string> = { $: 'AUD', '£': 'GBP', '€': 'EUR', '₫': 'VND' };

const BILL_KEYWORDS: [BillCategory, RegExp][] = [
  ['electricity', /electricity|power bill|energy bill|tiền điện/i],
  ['water', /water bill|water usage|tiền nước/i],
  ['gas', /\bgas bill\b|gas usage/i],
  ['internet', /internet|broadband|nbn|wi-?fi/i],
  ['rent', /\brent\b|tiền nhà|tiền thuê/i],
  ['phone', /mobile plan|phone bill/i],
  ['insurance', /insurance premium|policy renewal/i],
];

export class RuleBasedExtractor implements Extractor {
  constructor(private readonly defaultCurrency = 'AUD') {}

  extract(signal: Signal): Fact[] {
    const text = `${signal.subject ?? ''}\n${signal.body}`;
    const facts: Fact[] = [...this.tracking(text)];

    const bill = this.bill(text);
    if (bill) facts.push(bill);
    else {
      const receipt = this.receipt(text, signal.from);
      if (receipt) facts.push(receipt);
    }
    return facts;
  }

  private tracking(text: string): TrackingFact[] {
    const found = new Map<string, TrackingFact>();
    for (const rule of CARRIERS) {
      if (rule.requiresMention && !rule.requiresMention.test(text)) continue;
      for (const match of text.matchAll(rule.pattern)) {
        if (!found.has(match[0])) found.set(match[0], { kind: 'tracking', trackingNumber: match[0], carrier: rule.carrier });
      }
    }
    if (found.size === 0) {
      const generic = /tracking (?:number|no\.?|#|code)\s*[:#]?\s*([A-Z0-9]{8,30})\b/i.exec(text);
      if (generic?.[1]) {
        found.set(generic[1], { kind: 'tracking', trackingNumber: generic[1], carrier: 'Unknown' });
      }
    }
    return [...found.values()];
  }

  private amount(text: string, label: RegExp): { amount: number; currency: string } | undefined {
    const re = new RegExp(
      `(?:${label.source})\\s*[:\\-]?\\s*(?:([A-Z]{3})\\s*)?([$£€₫])?\\s*(\\d{1,3}(?:[,.]\\d{3})*(?:[.,]\\d{2})?|\\d+(?:[.,]\\d{2})?)`,
      'i',
    );
    const m = re.exec(text);
    if (!m?.[3]) return undefined;
    const currency = m[1]?.toUpperCase() ?? (m[2] ? CURRENCY_SYMBOLS[m[2]] : undefined) ?? this.defaultCurrency;
    return { amount: parseAmount(m[3]), currency };
  }

  private bill(text: string): BillFact | undefined {
    const category = BILL_KEYWORDS.find(([, re]) => re.test(text))?.[0];
    if (!category) return undefined;
    const money = this.amount(text, /amount due|total due|balance due|amount payable|total/);
    if (!money) return undefined;
    const due = /(?:due|pay by|payment due)\s*(?:date|on|by)?\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text);
    return { kind: 'bill', category, ...money, dueDate: due?.[1] ? toIsoDate(due[1]) : undefined };
  }

  private receipt(text: string, from?: string): ReceiptFact | undefined {
    const money = this.amount(text, /grand total|order total|total paid|total/);
    if (!money) return undefined;
    const order = /order\s*(?:#|no\.?|number)\s*[:#]?\s*([A-Z0-9-]{4,})/i.exec(text);
    return { kind: 'receipt', retailer: retailerName(text, from), orderNumber: order?.[1], total: money.amount, currency: money.currency };
  }
}

function parseAmount(raw: string): number {
  // "1,234.56" / "1.234,56" / "12.50" / "12,50"
  const lastSep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  const hasDecimals = lastSep !== -1 && raw.length - lastSep - 1 === 2;
  const integer = (hasDecimals ? raw.slice(0, lastSep) : raw).replace(/[.,]/g, '');
  const decimals = hasDecimals ? raw.slice(lastSep + 1) : '0';
  return Number(`${integer}.${decimals}`);
}

function toIsoDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [d, m, y] = raw.split('/');
  return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
}

function retailerName(text: string, from?: string): string | undefined {
  const thanks = /thank you for (?:shopping|your order|ordering) (?:at|with|from) ([A-Z][\w&' ]{1,40}?)[.!,\n]/i.exec(text);
  if (thanks?.[1]) return thanks[1].trim();
  const domain = from ? /@(?:[\w-]+\.)*?([\w-]+)\.(?:com|co|net|org|shop)(?:\.\w{2})?>?$/i.exec(from.trim()) : null;
  if (domain?.[1]) return domain[1].charAt(0).toUpperCase() + domain[1].slice(1);
  return undefined;
}
