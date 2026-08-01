/**
 * Comparing two models on the same questions (paper §5).
 *
 * The scoreboard way to compare models is to subtract their overall scores
 * and add their uncertainties ("unpaired"). That is valid but wasteful when
 * both models answered the very same questions: much of each model's score
 * variance is *shared question difficulty* — hard questions are hard for
 * everyone. Subtracting per question FIRST cancels that shared component out
 * of the gap, leaving only the between-model signal. Same data, tighter
 * margin — a free precision gain whenever the models' per-question scores
 * correlate positively (they nearly always do).
 *
 * In symbols: Var(s̄_A − s̄_B) = Var(s̄_A) + Var(s̄_B) − 2·Cov(s̄_A, s̄_B).
 * Unpaired analysis drops the covariance term (it can't know it); paired
 * analysis measures it implicitly by working with the per-question
 * differences, whose variance is exactly the full right-hand side.
 */

import { mean, sampleVariance, seMean } from "./descriptive";
import { seClustered } from "./clustered";

/**
 * SE of a difference of two INDEPENDENT means: sqrt(SE_A² + SE_B²).
 * This is the honest fallback when the two models answered different
 * question sets (no per-question alignment → covariance unknowable).
 */
export function seUnpaired(seA: number, seB: number): number {
  return Math.sqrt(seA * seA + seB * seB);
}

export interface PairedComparison {
  /** mean(A) − mean(B), in score units */
  gap: number;
  /** paired standard error of the gap: sqrt(Var(s_A − s_B) / n) */
  sePaired: number;
  /** unpaired standard error for the same data, for comparison */
  seUnpaired: number;
  /** Pearson correlation of the two models' per-question scores */
  correlation: number;
  n: number;
}

/**
 * Question-by-question comparison of two aligned score arrays
 * (element i of each array is the same question for both models).
 *
 * Returns both the paired and unpaired SE for the same data so callers can
 * show the "before vs after" margin, plus the correlation that explains the
 * shrink: the higher the models' per-question agreement, the more shared
 * difficulty there was to cancel, and the bigger the paired win.
 */
export function comparePaired(
  a: readonly number[],
  b: readonly number[],
): PairedComparison {
  const n = a.length;
  if (n === 0) throw new Error("comparePaired of empty arrays");
  if (b.length !== n) throw new Error(`length mismatch: ${n} vs ${b.length}`);

  // The per-question differences ARE the paired analysis: everything shared
  // between the models at question i (difficulty, topic, ambiguity) is
  // present in both a[i] and b[i] and vanishes in the subtraction.
  const diffs = new Array<number>(n);
  for (let i = 0; i < n; i++) diffs[i] = a[i] - b[i];

  return {
    // mean of differences ≡ difference of means — pairing never moves the
    // gap itself, only shrinks the uncertainty around it.
    gap: mean(diffs),
    sePaired: seMean(diffs),
    seUnpaired: seUnpaired(seMean(a), seMean(b)),
    correlation: pearson(a, b),
    n,
  };
}

/**
 * Paired gap SE that ALSO charges question bundles at full price: the paired
 * differences of clustered rows (e.g. the same problem in ten languages) can
 * still co-move — one model may be uniformly better at that problem in every
 * language — so the differences themselves need the clustered treatment.
 * This is the estimator behind the paper's Table 5 MGSM row.
 */
export function sePairedClustered(
  a: readonly number[],
  b: readonly number[],
  clusters: readonly (string | number)[],
): number {
  const n = a.length;
  if (b.length !== n) throw new Error(`length mismatch: ${n} vs ${b.length}`);
  const diffs = new Array<number>(n);
  for (let i = 0; i < n; i++) diffs[i] = a[i] - b[i];
  return seClustered(diffs, clusters);
}

/**
 * Pearson correlation of two aligned score arrays.
 *
 * Reported alongside paired results because it quantifies the pairing win:
 * relative to unpaired, paired variance shrinks by roughly a factor of
 * (1 − ρ) when the two models have similar variances. ρ≈0.5 → margins ~30%
 * tighter for free.
 *
 * Returns 0 when either side has zero variance (a model that scores
 * identically on every question has no co-movement to measure; mathematically
 * the coefficient is 0/0 and any conventional value would do — 0 keeps the
 * "no information" reading).
 */
export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (b.length !== n) throw new Error(`length mismatch: ${n} vs ${b.length}`);
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  for (let i = 0; i < n; i++) sab += (a[i] - ma) * (b[i] - mb);
  // sampleVariance uses n−1; multiplying back by (n−1) recovers the raw
  // sums of squares so numerator and denominator share the same scale.
  const va = sampleVariance(a) * (n - 1);
  const vb = sampleVariance(b) * (n - 1);
  if (va === 0 || vb === 0) return 0;
  return sab / Math.sqrt(va * vb);
}
