/**
 * Core descriptive statistics for eval scores, following
 * Miller, "Adding Error Bars to Evals" (arXiv:2411.00640) §2–3.
 *
 * Scores are per-question values in [0, 1] (binary correctness or partial
 * credit / probability-weighted grades). All functions are pure.
 */

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error("mean of empty array");
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Unbiased sample variance (n−1 denominator), 0 for a single observation. */
export function sampleVariance(xs: readonly number[]): number {
  const n = xs.length;
  if (n === 0) throw new Error("variance of empty array");
  if (n === 1) return 0;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return ss / (n - 1);
}

/**
 * Standard error of the mean via the Central Limit Theorem (paper Eq. 2):
 * SE = sqrt(Var(s) / n).
 *
 * This is the whole "a benchmark score is a poll, not a fact" idea in one
 * line: the questions asked are treated as an i.i.d. sample from an
 * idealized pool of all such questions, so the observed mean is one draw of
 * a random variable whose spread this function estimates. A different sample
 * of questions would have produced a different score; SE quantifies by how
 * much, and ±1.96·SE is the familiar 95% margin of error.
 */
export function seMean(xs: readonly number[]): number {
  return Math.sqrt(sampleVariance(xs) / xs.length);
}

/**
 * Bernoulli shortcut for binary scores (paper Eq. 3): sqrt(p(1−p)/n).
 * For 0/1 scores the variance is fully determined by the mean, so the SE
 * needs no second pass over the data. Also handy as a sanity ceiling: no
 * [0,1]-valued score distribution with mean p can have variance above
 * p(1−p), so no honest SE can exceed this one at the same n.
 */
export function seBernoulli(p: number, n: number): number {
  if (p < 0 || p > 1) throw new Error(`p out of [0,1]: ${p}`);
  if (n <= 0) throw new Error(`n must be positive: ${n}`);
  return Math.sqrt((p * (1 - p)) / n);
}

/** 95% confidence interval half-width. */
export const Z_95 = 1.959964;

export interface Estimate {
  value: number;
  se: number;
}

/** [lo, hi] of the 95% confidence interval for an estimate. */
export function ci95({ value, se }: Estimate): [number, number] {
  return [value - Z_95 * se, value + Z_95 * se];
}
