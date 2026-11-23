/**
 * A stand-in for Math.random that returns the given values in order, then repeats them.
 * Lets tests choose which "random" match the mock proposes.
 * Requires: values is non-empty and each value is in [0, 1).
 */
export function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}
