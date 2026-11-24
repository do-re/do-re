/**
 * The celebration over the album cover when a song is liked: one big heart, with small hearts and
 * music notes flying outward. Purely decorative, so it is hidden from screen readers, and
 * home.css turns it off for people who prefer reduced motion.
 */
import type { CSSProperties } from 'react';

const PARTICLES: readonly { glyph: string; x: number; y: number; turn: number; delay: number }[] = [
  { glyph: '♥', x: -112, y: -82, turn: -35, delay: 0 },
  { glyph: '♪', x: -58, y: -128, turn: -18, delay: 40 },
  { glyph: '♥', x: 8, y: -142, turn: 10, delay: 10 },
  { glyph: '♫', x: 74, y: -118, turn: 22, delay: 60 },
  { glyph: '♥', x: 120, y: -62, turn: 38, delay: 20 },
  { glyph: '♪', x: 128, y: 28, turn: 45, delay: 70 },
  { glyph: '♥', x: 66, y: 104, turn: 20, delay: 30 },
  { glyph: '♫', x: -62, y: 112, turn: -24, delay: 50 },
  { glyph: '♥', x: -130, y: 24, turn: -42, delay: 15 },
];

/**
 * Requires: rendered inside a positioned element.
 * Effects: plays the animation once, then calls onDone.
 */
export function LikeBurst({ onDone }: { onDone: () => void }) {
  return (
    <span className="like-burst" aria-hidden="true">
      <span className="like-burst__heart" onAnimationEnd={onDone}>
        ♥
      </span>
      {PARTICLES.map(({ glyph, x, y, turn, delay }) => (
        <span
          key={`${x},${y}`}
          className="like-burst__particle"
          style={
            {
              '--burst-x': `${x}px`,
              '--burst-y': `${y}px`,
              '--burst-turn': `${turn}deg`,
              animationDelay: `${delay}ms`,
            } as CSSProperties
          }
        >
          {glyph}
        </span>
      ))}
    </span>
  );
}
