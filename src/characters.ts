/**
 * The MATE characters. This is the ONLY place they are declared — server
 * validation, the avatar picker, room scenes and animations all read from
 * here. Names and descriptions live in the translation files under
 * `characters.<id>`.
 *
 * Artwork goes in web/public/characters/<id>/ by convention (transparent
 * hand-inked PNG/WebP/SVG, all frames on the same square canvas):
 *   avatar.*            the character at rest            (required for art)
 *   blink.*             same pose, eyes closed           (optional → blinking)
 *   wave.*              same pose, waving                (optional → waving)
 *   <room>.*            the character in a room, e.g. library.webp
 *   layers/<slot>/<option>.*   Tom only: hair / outfit pieces drawn over avatar
 * The build scans those folders, so dropping files in is enough — no code
 * changes. Until art exists, a placeholder is drawn (and still animates).
 */
export interface Character {
  id: string;
  /** Placeholder colour until artwork exists. `null` = no colour of its own (Tom). */
  color: string | null;
  /** Rooms where this character appears, and what they are doing there. */
  scenes: Partial<Record<Room, SceneAction>>;
  /** The app's guide (like a mascot) — greets on the welcome screen. */
  mascot?: boolean;
  /** Customisable pieces the person can later choose for themself. */
  slots?: readonly CustomSlot[];
}

export type Room = 'chat' | 'library' | 'bills' | 'kitchen' | 'wardrobe' | 'welcome';
export type SceneAction = 'reading' | 'waving' | 'painting' | 'playing' | 'counting' | 'guiding';
export type CustomSlot = 'hair' | 'outfit';

export const CHARACTERS: readonly Character[] = [
  { id: 'tom', color: null, mascot: true, slots: ['hair', 'outfit'], scenes: { welcome: 'guiding' } },
  { id: 'james', color: '#8A6F4D', scenes: { library: 'reading' } },
  { id: 'timothy', color: '#4C6A92', scenes: { chat: 'painting' } },
  { id: 'ella', color: '#9A5B6B', scenes: { kitchen: 'waving', bills: 'counting' } },
  { id: 'nolan', color: '#5E7F4E', scenes: { chat: 'playing' } },
];

export const CHARACTER_IDS = CHARACTERS.map((c) => c.id);
/** New people start as Tom — the character they will dress up later. */
export const DEFAULT_CHARACTER = 'tom';
export const MASCOT = CHARACTERS.find((c) => c.mascot)!.id;

/** Ids used before the characters were named; mapped so old accounts keep their pick. */
const LEGACY: Record<string, string> = { grandpa: 'james', artist: 'timothy', woman: 'ella', boy: 'nolan' };

export const isCharacter = (id: unknown): id is string => typeof id === 'string' && CHARACTER_IDS.includes(id);

/** A valid character id for whatever is stored (legacy ids upgraded, unknown → default). */
export function normaliseCharacter(id: unknown): string {
  if (isCharacter(id)) return id;
  if (typeof id === 'string' && LEGACY[id]) return LEGACY[id]!;
  return DEFAULT_CHARACTER;
}

/** Which character (if any) appears in a room. First declared wins. */
export const characterForRoom = (room: Room) => CHARACTERS.find((c) => c.scenes[room]);
