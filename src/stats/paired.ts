/**
 * Comparing two models on the same questions (paper §5).
 *
 * Unpaired: treat the two scores as unrelated measurements and add their
 * variances (Eq. in §5.1). Paired: subtract per question first, so shared
 * question difficulty cancels out of the gap — same data, tighter margin
 * whenever the models' per-question scores correlate (§5.2).
 */

import { mean, sampleVariance, seMean } from "./descriptive";
import { seClustered } from "./clustered";

/** SE of a difference of two independent means: sqrt(SE_A² + SE_B²). */
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
 * (element i of each array is the same question).
 */
export function comparePaired(
  a: readonly number[],
  b: readonly number[],
): PairedComparison {
  const n = a.length;
  if (n === 0) throw new Error("comparePaired of empty arrays");
  if (b.length !== n) throw new Error(`length mismatch: ${n} vs ${b.length}`);
  const diffs = new Array<number>(n);
  for (let i = 0; i < n; i++) diffs[i] = a[i] - b[i];
  return {
    gap: mean(diffs),
    sePaired: seMean(diffs),
    seUnpaired: seUnpaired(seMean(a), seMean(b)),
    correlation: pearson(a, b),
    n,
  };
}

/** Paired gap SE that also charges question bundles (clusters) at full price. */
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

/** Pearson correlation; 0 when either side has zero variance. */
export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (b.length !== n) throw new Error(`length mismatch: ${n} vs ${b.length}`);
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  for (let i = 0; i < n; i++) sab += (a[i] - ma) * (b[i] - mb);
  const va = sampleVariance(a) * (n - 1);
  const vb = sampleVariance(b) * (n - 1);
  if (va === 0 || vb === 0) return 0;
  return sab / Math.sqrt(va * vb);
}
