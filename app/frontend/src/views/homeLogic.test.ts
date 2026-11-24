import { describe, expect, it, vi } from 'vitest';
import {
  backgroundFor,
  formatTime,
  markMatchShown,
  MAX_LISTEN_STEP_S,
  nextListened,
  swipeDirection,
  wasMatchShown,
} from './homeLogic';

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [9.9, '0:09'],
    [59, '0:59'],
    [60, '1:00'],
    [605, '10:05'],
    [-3, '0:00'],
    [Number.NaN, '0:00'],
    [Number.POSITIVE_INFINITY, '0:00'],
  ])('R_HOME_05 %s -> %s', (seconds, text) => {
    expect(formatTime(seconds)).toBe(text);
  });
});

describe('nextListened', () => {
  const at = (positionSeconds: number, isPaused = false) => ({ positionSeconds, durationSeconds: 30, isPaused });

  it('counts a normal forward step while playing', () => {
    expect(nextListened(2, at(5), at(6))).toBe(3);
  });

  it('counts a step exactly MAX_LISTEN_STEP_S long, but not a longer one (a seek)', () => {
    expect(nextListened(0, at(5), at(5 + MAX_LISTEN_STEP_S))).toBe(MAX_LISTEN_STEP_S);
    expect(nextListened(0, at(5), at(5 + MAX_LISTEN_STEP_S + 0.01))).toBe(0);
  });

  it.each([
    ['no previous update', null, at(1)],
    ['previous update paused', at(1, true), at(2)],
    ['next update paused', at(1), at(2, true)],
    ['no movement', at(4), at(4)],
    ['backwards (seek or restart)', at(10), at(0)],
  ])('adds nothing: %s', (_, prev, next) => {
    expect(nextListened(7, prev, next)).toBe(7);
  });
});

describe('swipeDirection', () => {
  it.each([
    [60, 'right'],
    [200, 'right'],
    [59, null],
    [0, null],
    [-59, null],
    [-60, 'left'],
    [-200, 'left'],
  ])('R_HOME_14 R_HOME_16 dx=%s -> %s', (dx, direction) => {
    expect(swipeDirection(dx)).toBe(direction);
  });
});

describe('backgroundFor', () => {
  /** WCAG contrast ratio of white text on an hsl() colour. */
  function whiteContrast(css: string): number {
    const [h, s, l] = css.match(/[\d.]+/g)!.map(Number);
    const sat = s / 100;
    const light = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    const channel = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = 0.2126 * linear(channel(0)) + 0.7152 * linear(channel(8)) + 0.0722 * linear(channel(4));
    return 1.05 / (lum + 0.05);
  }

  it('R_HOME_09 maps sad songs to blue and happy songs to orange', () => {
    expect(backgroundFor([0, 0, 0])).toBe('hsl(220 35% 25%)');
    expect(backgroundFor([1, 0, 1])).toBe('hsl(30 75% 25%)');
  });

  it('R_UI_03 keeps white text at contrast >= 4.5:1 for every valence and energy', () => {
    for (let v = 0; v <= 1; v += 0.05) {
      for (let e = 0; e <= 1; e += 0.25) {
        const css = backgroundFor([v, 0.5, e]);
        expect(whiteContrast(css), css).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('clamps out-of-range and missing values', () => {
    expect(backgroundFor([2, 0, -1])).toBe(backgroundFor([1, 0, 0]));
    expect(backgroundFor([Number.NaN, 0, Number.NaN])).toBe(backgroundFor([0, 0, 0]));
  });
});

describe('shown matches', () => {
  it('R_HOME_20 remembers matches shown in this tab', () => {
    expect(wasMatchShown('m-1')).toBe(false);
    markMatchShown('m-1');
    markMatchShown('m-1'); // idempotent
    expect(wasMatchShown('m-1')).toBe(true);
    expect(wasMatchShown('m-2')).toBe(false);
    expect(JSON.parse(sessionStorage.getItem('do-re.shownMatches')!)).toEqual(['m-1']);
  });

  it('ignores corrupt stored data', () => {
    sessionStorage.setItem('do-re.shownMatches', '{not json');
    expect(wasMatchShown('m-1')).toBe(false);
    sessionStorage.setItem('do-re.shownMatches', '{"a":1}');
    expect(wasMatchShown('m-1')).toBe(false);
    sessionStorage.setItem('do-re.shownMatches', '["m-1", 5]');
    expect(wasMatchShown('m-1')).toBe(true);
  });

  it('works without storage', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(() => markMatchShown('m-1')).not.toThrow();
      expect(wasMatchShown('m-1')).toBe(false);
    } finally {
      set.mockRestore();
    }
  });
});
