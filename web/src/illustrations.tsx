/**
 * Small hand-drawn style illustrations for empty and error states. Original
 * line art: one ink stroke colour plus a single accent dot, so they sit
 * quietly in the minimal UI and adapt to dark mode via currentColor.
 */
import type { Room } from '../../src/characters.js';
import { roomScene } from './characters.js';

const frame = (children: preact.ComponentChildren) => (
  <svg class="illustration" viewBox="0 0 160 120" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const accent = 'var(--accent)';

export const Illustration = {
  chat: () =>
    frame(
      <>
        <path d="M30 34h62a10 10 0 0 1 10 10v20a10 10 0 0 1-10 10H58l-14 12v-12H30a10 10 0 0 1-10-10V44a10 10 0 0 1 10-10Z" />
        <path d="M112 58h18a10 10 0 0 1 10 10v14a10 10 0 0 1-10 10h-4v10l-12-10h-14a10 10 0 0 1-10-10v-4" />
        <path d="M40 54h40M40 64h24" />
        <circle cx="128" cy="30" r="6" fill={accent} stroke="none" />
      </>,
    ),
  library: () =>
    frame(
      <>
        <path d="M24 98h112" />
        <rect x="36" y="38" width="16" height="60" rx="3" />
        <rect x="56" y="30" width="16" height="68" rx="3" />
        <path d="M80 98 92 44l15 3-12 54" />
        <path d="M40 50h8M60 42h8" />
        <circle cx="122" cy="34" r="6" fill={accent} stroke="none" />
      </>,
    ),
  bills: () =>
    frame(
      <>
        <path d="M50 20h60v84l-10-6-10 6-10-6-10 6-10-6-10 6Z" />
        <path d="M62 40h36M62 54h36M62 68h20" />
        <circle cx="120" cy="88" r="14" />
        <path d="m114 88 4 4 8-8" />
        <circle cx="36" cy="32" r="6" fill={accent} stroke="none" />
      </>,
    ),
  search: () =>
    frame(
      <>
        <circle cx="70" cy="56" r="26" />
        <path d="m89 75 22 22" />
        <path d="M60 52c2-6 8-10 14-10" />
        <circle cx="122" cy="30" r="6" fill={accent} stroke="none" />
      </>,
    ),
  offline: () =>
    frame(
      <>
        <path d="M46 84h68a20 20 0 0 0 0-40 28 28 0 0 0-54-6 22 22 0 0 0-14 46Z" />
        <path d="m72 58 16 16M88 58 72 74" />
        <circle cx="128" cy="96" r="6" fill={accent} stroke="none" />
      </>,
    ),
  link: () =>
    frame(
      <>
        <path d="M66 70 54 82a14 14 0 0 1-20-20l12-12" />
        <path d="m94 50 12-12a14 14 0 0 1 20 20l-12 12" />
        <path d="m70 50 6 6M84 64l6 6" />
        <circle cx="38" cy="30" r="6" fill={accent} stroke="none" />
      </>,
    ),
};

/** The room's character if its artwork exists, otherwise the illustration. */
export function RoomArt({ room, fallback }: { room: Room; fallback: keyof typeof Illustration }) {
  const scene = roomScene(room);
  if (scene) return <img class="scene" src={scene.src} alt={scene.alt} />;
  const Art = Illustration[fallback];
  return <Art />;
}
