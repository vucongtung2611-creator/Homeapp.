import { CHARACTERS, DEFAULT_CHARACTER, characterForRoom, type Room } from '../../src/characters.js';
import { t, type MessageKey } from './i18n/index.js';

/** Filled in at build time from web/public/characters/<id>/ (see scripts/build-web.mjs). */
declare const __CHARACTER_ART__: Record<string, { avatar?: string; scenes: Record<string, string> }>;
const ART = typeof __CHARACTER_ART__ === 'undefined' ? {} : __CHARACTER_ART__;

const byId = (id: string | undefined) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER)!;
export const characterName = (id: string) => t(`characters.${byId(id).id}.name` as MessageKey);

/** A character's picture, or a coloured circle with its initial until artwork exists. */
export function CharacterAvatar({ id, size = 40, title }: { id?: string; size?: number; title?: string }) {
  const c = byId(id);
  const art = ART[c.id]?.avatar;
  const style = { width: size, height: size };
  if (art) return <img class="avatar" src={art} alt="" title={title} style={style} />;
  return (
    <span class="avatar placeholder" aria-hidden="true" title={title} style={{ ...style, background: c.color, fontSize: Math.round(size * 0.42) }}>
      {t(`characters.${c.id}.initial` as MessageKey)}
    </span>
  );
}

/**
 * The character who lives in a room (e.g. Grandpa reading in the Library).
 * Renders nothing until that scene's artwork exists, so callers can show a
 * fallback illustration instead.
 */
export function roomScene(room: Room): { src: string; alt: string } | undefined {
  const c = characterForRoom(room);
  const src = c && ART[c.id]?.scenes[room];
  return src ? { src, alt: characterName(c!.id) } : undefined;
}

export function CharacterPicker(props: { value: string; onChange: (id: string) => void; label: string; hideLabel?: boolean }) {
  const { value, onChange, label } = props;
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
            <CharacterAvatar id={c.id} size={56} />
            <span>{characterName(c.id)}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
