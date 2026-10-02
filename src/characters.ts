/**
 * The four household characters from the book. This is the ONLY place they
 * are declared — server validation, the avatar picker and room scenes all read
 * from here.
 *
 * Artwork goes in web/public/characters/<id>/ by convention:
 *   avatar.(webp|png|jpg|svg)   → profile picture
 *   <room>.(webp|png|jpg|svg)   → the character in a room, e.g. library.webp
 * The build scans those folders, so dropping a file in is enough — no code
 * changes. Until an image exists, a circle with the initial is shown.
 *
 * Names and descriptions live in the translation files under
 * `characters.<id>.name` / `characters.<id>.description`.
 */
export interface Character {
  id: string;
  /** Placeholder circle colour until artwork exists. */
  color: string;
  /** Rooms where this character appears, and what they are doing there (for alt text). */
  scenes: Partial<Record<Room, SceneAction>>;
}

export type Room = 'chat' | 'library' | 'bills' | 'kitchen' | 'wardrobe';
export type SceneAction = 'reading' | 'waving' | 'painting' | 'playing' | 'counting';

export const CHARACTERS: readonly Character[] = [
  { id: 'grandpa', color: '#8A6F4D', scenes: { library: 'reading' } },
  { id: 'artist', color: '#4C6A92', scenes: { chat: 'painting' } },
  { id: 'woman', color: '#9A5B6B', scenes: { kitchen: 'waving', bills: 'counting' } },
  { id: 'boy', color: '#5E7F4E', scenes: { chat: 'playing' } },
];

export const CHARACTER_IDS = CHARACTERS.map((c) => c.id);
export const DEFAULT_CHARACTER = 'artist';

export const isCharacter = (id: unknown): id is string => typeof id === 'string' && CHARACTER_IDS.includes(id);

/** Which character (if any) appears in a room. First declared wins. */
export const characterForRoom = (room: Room) => CHARACTERS.find((c) => c.scenes[room]);
