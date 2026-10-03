import { CHARACTERS, characterForRoom, normaliseCharacter, type Room } from '../../src/characters.js';
import { t, type MessageKey } from './i18n/index.js';

/**
 * Filled in at build time from web/public/characters/<id>/ (see
 * scripts/build-web.mjs): which frames, room scenes and layers exist.
 */
interface Art {
  avatar?: string;
  blink?: string;
  wave?: string;
  scenes: Record<string, string>;
  layers?: Record<string, Record<string, string>>;
}
declare const __CHARACTER_ART__: Record<string, Art>;
const ART: Record<string, Art> = typeof __CHARACTER_ART__ === 'undefined' ? {} : __CHARACTER_ART__;

const byId = (id: string | undefined) => CHARACTERS.find((c) => c.id === normaliseCharacter(id))!;
export const characterName = (id: string) => t(`characters.${byId(id).id}.name` as MessageKey);

/**
 * How a figure moves. All motion is CSS (transform/opacity only, so it stays
 * on the compositor) and switches off with the OS "reduce motion" setting.
 *  - idle:   gentle breathing + blinking
 *  - wave:   a short wave, then idle
 *  - bounce: one happy hop (e.g. a new message), no loop
 *  - still:  no motion (long lists)
 */
export type Mood = 'idle' | 'wave' | 'bounce' | 'still';

/** Stable per-figure offset so a room full of characters doesn't blink in sync. */
const offset = (seed: string) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `-${(h % 4000) / 1000}s`;
};

export function CharacterAvatar(props: { id?: string; size?: number; title?: string; mood?: Mood; layers?: Partial<Record<string, string>> }) {
  const { size = 40, title, mood = 'still' } = props;
  const c = byId(props.id);
  const art = ART[c.id];
  const style = { '--size': `${size}px`, '--delay': offset(c.id + (title ?? '')) } as Record<string, string>;
  const hasWaveFrame = Boolean(art?.wave);
  return (
    <span class={`figure mood-${mood} ${hasWaveFrame ? 'has-wave-frame' : ''}`} style={style} title={title} aria-hidden="true">
      <span class="figure-body">
        {art?.avatar ? (
          <>
            <img class="frame base" src={art.avatar} alt="" draggable={false} />
            {Object.entries(props.layers ?? {}).map(([slot, option]) =>
              option && art.layers?.[slot]?.[option] ? <img key={slot} class="frame layer" src={art.layers[slot]![option]} alt="" /> : null,
            )}
            {art.blink && <img class="frame blink" src={art.blink} alt="" draggable={false} />}
            {art.wave && <img class="frame wave" src={art.wave} alt="" draggable={false} />}
          </>
        ) : c.color === null ? (
          <TomSketch />
        ) : (
          <CharacterSketch id={c.id} color={c.color} initial={t(`characters.${c.id}.initial` as MessageKey)} showInitial={size >= 34} />
        )}
      </span>
    </span>
  );
}

/**
 * Tom until his drawings arrive: a few ink lines, no colour of his own.
 * Eyes blink and the hand waves with the same CSS as the real frames.
 */
function TomSketch() {
  return (
    <svg class="tom-sketch" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="100" r="50" fill="var(--surface)" stroke="none" />
      <path d="M22 99c2-14 13-22 28-22s26 8 28 22" fill="var(--surface)" />
      <circle cx="50" cy="44" r="23" fill="var(--surface)" />
      <path d="M37 25c4-6 15-8 22-3" />
      <g class="eyes">
        <ellipse cx="42" cy="44" rx="2.6" ry="3.4" fill="currentColor" stroke="none" />
        <ellipse cx="58" cy="44" rx="2.6" ry="3.4" fill="currentColor" stroke="none" />
      </g>
      <path d="M43 54c4 4 10 4 14 0" />
      <g class="hand">
        <path d="M78 99V84" />
        <path d="M78 84c0-5 6-5 6 0v4" />
      </g>
    </svg>
  );
}

/**
 * A stand-in drawing until a character's artwork arrives: the same ink-line
 * style as Tom, their own colour, one telling detail each (James's glasses
 * and beard, Timothy's beret, Ella's bun, Nolan's cap) and their initial in
 * a monogram on the shirt. Eyes blink and the hand waves like the real frames will.
 */
function CharacterSketch({ id, color, initial, showInitial }: { id: string; color: string; initial: string; showInitial: boolean }) {
  return (
    <svg class="tom-sketch char-sketch" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="50" fill={color} opacity="0.18" stroke="none" />
      {id === 'ella' && <path d="M28 46c-4 18 0 32 6 38M72 46c4 18 0 32-6 38" />}
      <path d="M22 99c2-14 13-22 28-22s26 8 28 22" fill={color} />
      <circle cx="50" cy="44" r={id === 'nolan' ? 21 : 23} fill="var(--surface)" />
      {id === 'james' && (
        <>
          <path d="M30 38c2-12 8-16 12-17M70 38c-2-12-8-16-12-17" />
          <path d="M37 58c4 9 22 9 26 0" fill="var(--surface)" />
          <circle cx="42" cy="44" r="6" />
          <circle cx="58" cy="44" r="6" />
          <path d="M48 44h4" />
        </>
      )}
      {id === 'timothy' && (
        <>
          <ellipse cx="48" cy="22" rx="20" ry="7" fill={color} />
          <path d="M48 15v-4" />
        </>
      )}
      {id === 'ella' && (
        <>
          <circle cx="50" cy="16" r="8" fill={color} />
          <path d="M29 40c4-14 14-19 21-19s17 5 21 19" />
        </>
      )}
      {id === 'nolan' && (
        <>
          <path d="M30 34c2-11 10-15 20-15s18 4 20 15z" fill={color} />
          <path d="M66 34h14" />
        </>
      )}
      <g class="eyes">
        <ellipse cx="42" cy="44" rx="2.6" ry="3.4" fill="currentColor" stroke="none" />
        <ellipse cx="58" cy="44" rx="2.6" ry="3.4" fill="currentColor" stroke="none" />
      </g>
      <path d={id === 'james' ? 'M45 54c3 2 7 2 10 0' : 'M43 54c4 4 10 4 14 0'} />
      <g class="hand">
        <path d="M78 99V84" />
        <path d="M78 84c0-5 6-5 6 0v4" />
      </g>
      {showInitial && (
        <text class="initial" x="50" y="96" text-anchor="middle" font-size="15" font-weight="700" fill="#fff" stroke="none">
          {initial}
        </text>
      )}
    </svg>
  );
}

/**
 * The character who lives in a room (e.g. James reading in the Library),
 * or undefined until that scene's artwork exists.
 */
export function roomScene(room: Room): { src: string; alt: string } | undefined {
  const c = characterForRoom(room);
  const src = c && ART[c.id]?.scenes[room];
  return src ? { src, alt: characterName(c!.id) } : undefined;
}

export function CharacterPicker(props: { value: string; onChange: (id: string) => void; label: string; hideLabel?: boolean }) {
  const { onChange, label } = props;
  const value = normaliseCharacter(props.value);
  return (
    <fieldset class="picker" style={props.hideLabel ? { marginBottom: 0 } : undefined}>
      <legend class={props.hideLabel ? 'sr-only' : undefined}>{label}</legend>
      <div class="picker-row" role="radiogroup" aria-label={label}>
        {CHARACTERS.map((c) => (
          <button
            type="button"
            role="radio"
            aria-checked={value === c.id}
            class="picker-option"
            key={c.id}
            onClick={() => onChange(c.id)}
            title={t(`characters.${c.id}.description` as MessageKey)}
          >
            {/* Re-mount on select so the chosen one waves hello. */}
            <CharacterAvatar key={value === c.id ? 'on' : 'off'} id={c.id} size={52} mood={value === c.id ? 'wave' : 'idle'} />
            <span>{characterName(c.id)}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
