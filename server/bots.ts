/**
 * MATE and the characters as chat partners — a trial, with NO AI behind it.
 * A message is matched against a few simple commands, in any of the five
 * app languages; replies are stored as a key + params and written out in
 * the reader's language by the app (like system messages).
 *
 *   note: …            save a note to this home's Library      ("ghi chú: …", "notiz: …")
 *   private: …         the same, visible only to me             ("ghi riêng: …")
 *   calendar … <day>   add an appointment                       ("lịch: thứ 7 9h đi bơi")
 *   find …             look through the Library and calendar     ("tìm wifi", "suche Miete")
 *   upcoming           what's on the calendar next               ("sắp tới", "à venir")
 *   suggest            what could be done next                   ("gợi ý", "was soll ich tun")
 */
import { detectWhen } from '../src/integrations/when.js';

export type BotIntent =
  | { kind: 'note'; title: string; body: string; private: boolean }
  | { kind: 'event'; title: string; date?: string; time?: string }
  | { kind: 'find'; query: string }
  | { kind: 'upcoming' }
  | { kind: 'suggest' }
  | { kind: 'hello' }
  | { kind: 'help' };

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/** Fold one character at a time, so positions in the folded text match the original. */
function foldKeep(text: string): { folded: string; rest: (n: number) => string } {
  const chars = [...text];
  const parts = chars.map((c) => fold(c));
  return {
    folded: parts.join(''),
    rest: (n: number) => {
      let used = 0;
      let i = 0;
      while (i < chars.length && used < n) used += parts[i++]!.length;
      return chars.slice(i).join('').trim();
    },
  };
}

const PRIVATE = /^(ghi rieng|luu rieng|rieng|private note|private|note privee|privee|prive|privat|privenotitie)\b\s*[:\-–]?\s*/;
const NOTE = /^(ghi chu|ghi lai|ghi nho|luu lai|luu|note|save|remember|retiens|notiz|merke dir|merk dir|merke|noteer|onthoud|bewaar)\b\s*[:\-–]?\s*/;
const EVENT = /^(them lich|them vao lich|dat lich|lich hen|lich|hen|nhac toi|nhac|calendar|add to calendar|appointment|remind me|reminder|agenda|rdv|rendez-vous|rappelle-moi|rappel|termin|kalender|erinnere mich|erinnerung|afspraak|herinner me|herinnering)\b\s*[:\-–]?\s*/;
const FIND = /^(tim lai|tim|nho lai|tra|find|search|look up|recall|cherche|retrouve|such|suche|finde|zoek|vind)\b\s*[:\-–]?\s*/;
const UPCOMING = /\b(sap toi|lich sap toi|co lich gi|upcoming|what['’]?s next|coming up|a venir|prochains? rendez|demnachst|anstehend|was steht an|binnenkort|komende|wat staat er)\b/;
const SUGGEST = /\b(goi y|nen lam gi|lam gi tiep|viec gi|suggest|suggestions?|what should|next steps?|ideas?|que faire|conseil|vorschlag|was soll|tipps?|suggesties?|wat moet|wat nu)\b/;
const HELLO = /^(hi|hello|hey|chao|xin chao|alo|bonjour|salut|coucou|hallo|moin|servus|hoi|dag|goedemorgen)\b/;

export function parseIntent(text: string, now: Date): BotIntent {
  const { folded, rest } = foldKeep(text.trim());
  let m: RegExpExecArray | null;
  if ((m = PRIVATE.exec(folded)) && rest(m[0].length)) return note(rest(m[0].length), true);
  if ((m = NOTE.exec(folded)) && rest(m[0].length)) return note(rest(m[0].length), false);
  if ((m = EVENT.exec(folded))) {
    const title = rest(m[0].length);
    const when = detectWhen(title, now);
    return { kind: 'event', title: title || text.trim(), date: when?.date, time: when?.time };
  }
  if ((m = FIND.exec(folded)) && rest(m[0].length)) return { kind: 'find', query: rest(m[0].length).replace(/[?？!.]+$/, '') };
  if (UPCOMING.test(folded)) return { kind: 'upcoming' };
  if (SUGGEST.test(folded)) return { kind: 'suggest' };
  if (HELLO.test(folded)) return { kind: 'hello' };
  return { kind: 'help' };
}

function note(content: string, isPrivate: boolean): BotIntent {
  const [first, ...more] = content.split('\n');
  const title = first!.length > 80 ? `${first!.slice(0, 77)}…` : first!;
  return { kind: 'note', title, body: more.length ? more.join('\n').trim() : first!.length > 80 ? content : '', private: isPrivate };
}

/** For search: does `text` contain every word of `query`, ignoring accents and case? */
export function matches(text: string, query: string): boolean {
  const hay = fold(text);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
