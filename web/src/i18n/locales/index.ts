/**
 * The one list of languages. To add a language: create <code>.ts next to
 * en.ts, translate the keys, and list it here. It shows up in the language
 * picker automatically once ~90% of the keys are translated; anything missing
 * falls back to English.
 */
import de from './de.js';
import en from './en.js';
import fr from './fr.js';
import nl from './nl.js';
import vi from './vi.js';

type PluralKey = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
type Plural = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
type IsPlural<T> = T extends { other: string } ? (Exclude<keyof T, PluralKey> extends never ? true : false) : false;
type Widen<T> = T extends string
  ? string
  : T extends readonly string[]
    ? readonly string[]
    : IsPlural<T> extends true
      ? Plural
      : { [K in keyof T]: Widen<T[K]> };
type DeepPartial<T> = T extends string | readonly string[] | Plural ? T : { [K in keyof T]?: DeepPartial<T[K]> };

/** Shape every complete translation must have. */
export type Messages = Widen<typeof en>;
/** Shape of a translation in progress. */
export type PartialMessages = DeepPartial<Messages>;

export const LOCALES = [
  { code: 'en', name: 'English', messages: en as Messages | PartialMessages },
  { code: 'vi', name: 'Tiếng Việt', messages: vi },
  { code: 'fr', name: 'Français', messages: fr },
  { code: 'de', name: 'Deutsch', messages: de },
  { code: 'nl', name: 'Nederlands', messages: nl },
] as const satisfies readonly { code: string; name: string; messages: Messages | PartialMessages }[];

export type LocaleCode = (typeof LOCALES)[number]['code'];
