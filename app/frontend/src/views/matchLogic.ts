/**
 * Pure helpers for MatchView, kept out of the component file so React fast refresh works.
 */

/**
 * Formats a compatibility for the "XX.X% match!" line (stub displayMatch: one decimal place).
 * Satisfies: R-HOME-18 (display).
 * Requires: none.
 * Effects: none.
 * @returns percent clamped to [0, 100] with one decimal and a "%" sign, e.g. "87.4%";
 *          a non-finite value gives "0.0%"
 */
export function formatPercent(percent: number): string {
  const clamped = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  return `${clamped.toFixed(1)}%`;
}
