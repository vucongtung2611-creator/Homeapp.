import { t, type MessageKey } from './i18n/index.js';

/** Built-in stickers: a big emoji and a short caption in the reader's language. Same ids as the server. */
export const STICKERS = [
  { id: 'thanks', emoji: '🙏' },
  { id: 'love', emoji: '🥰' },
  { id: 'haha', emoji: '😂' },
  { id: 'ok', emoji: '👌' },
  { id: 'on_my_way', emoji: '🏃' },
  { id: 'dinner', emoji: '🍜' },
  { id: 'cleaning', emoji: '🧹' },
  { id: 'paid', emoji: '💸' },
  { id: 'sorry', emoji: '🙇' },
  { id: 'good_night', emoji: '🌙' },
  { id: 'party', emoji: '🎉' },
  { id: 'coffee', emoji: '☕' },
] as const;

/** A small, everyday set of emoji for the picker. */
export const EMOJI = [
  '😀', '😂', '🥰', '😊', '😉', '😍', '🤔', '😅', '😴', '😢', '😡', '🥳',
  '👍', '👎', '👌', '🙏', '👏', '💪', '🤝', '👋', '❤️', '💚', '✨', '🔥',
  '🏠', '🛋️', '🛏️', '🚿', '🧺', '🧹', '🗑️', '🔑', '💡', '🔌', '📦', '🧾',
  '🍜', '🍕', '🍳', '☕', '🍰', '🥗', '🛒', '🎂', '🎉', '📅', '⏰', '🚗',
];

export function Sticker({ id }: { id: string }) {
  const s = STICKERS.find((x) => x.id === id);
  if (!s) return null;
  return (
    <span class="sticker" role="img" aria-label={t(`stickers.${s.id}` as MessageKey)}>
      <span class="sticker-emoji" aria-hidden="true">
        {s.emoji}
      </span>
      <span class="sticker-caption">{t(`stickers.${s.id}` as MessageKey)}</span>
    </span>
  );
}
