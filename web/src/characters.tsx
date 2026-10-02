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
          <span class="placeholder" style={{ background: c.color, fontSize: Math.round(size * 0.42) }}>
            {t(`characters.${c.id}.initial` as MessageKey)}
          </span>
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
