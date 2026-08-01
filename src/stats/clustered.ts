/**
 * Cluster-aware standard errors (paper §3.1, Eq. 4).
 *
 * Questions that arrive in bundles — the same passage, the same problem
 * translated into ten languages — succeed or fail together, so they carry
 * less independent information than their row count suggests. The naive SE
 * treats every row as fresh evidence and is therefore too small (overconfident)
 * whenever rows within a bundle are positively correlated — which they nearly
 * always are, because they share difficulty. The clustered SE charges that
 * co-movement at full price: within each cluster, deviations are summed
 * *first*, then squared.
 *
 * Why summing-then-squaring is the whole trick:
 *   (d₁ + d₂)² = d₁² + d₂² + 2·d₁d₂
 * The naive estimator keeps only d₁² + d₂². The cross-term 2·d₁d₂ is exactly
 * the covariance between clustered rows: positive when the bundle moves
 * together, which inflates the true sampling variance. Squaring the cluster
 * *sum* keeps those cross-terms; squaring each deviation separately throws
 * them away. Honest error bars on clustered evals can come out 2–3× wider.
 */

import { mean } from "./descriptive";

/**
 * Clustered standard error of the mean.
 *
 * SE²(clustered) = (1/n²) · Σ_clusters ( Σ_{i∈cluster} (s_i − s̄) )²
 *
 * This grouped-sum form is algebraically identical to "CLT variance plus
 * within-cluster covariance terms" (expand the square and the cross-terms are
 * the covariances) and is how the paper's Eq. 4 is computed in practice.
 *
 * Conventions worth knowing before comparing outputs elsewhere:
 * - With every question in its own cluster the cross-terms vanish and this
 *   reduces to the plain CLT standard error — but with an n (not n−1)
 *   variance denominator, matching the paper's estimator. So singleton
 *   clusters ≠ `seMean` by a factor of sqrt((n−1)/n); negligible at eval
 *   sizes, asserted explicitly in the tests.
 * - Cluster labels only group rows; their values carry no meaning.
 *
 * @param scores one score per row
 * @param clusters cluster label per row, same length as scores
 */
export function seClustered(
  scores: readonly number[],
  clusters: readonly (string | number)[],
): number {
  const n = scores.length;
  if (n === 0) throw new Error("seClustered of empty array");
  if (clusters.length !== n) {
    throw new Error(
      `scores (${n}) and clusters (${clusters.length}) length mismatch`,
    );
  }

  const m = mean(scores);

  // Step 1 — sum deviations WITHIN each cluster before any squaring.
  // A cluster whose members all sit 0.1 above the mean accumulates a large
  // sum (its co-movement will be charged in full); a cluster whose members
  // scatter symmetrically around the mean cancels itself out and contributes
  // almost nothing — exactly the behavior that distinguishes "bundled
  // questions" from "independent questions that happen to share a label".
  const perCluster = new Map<string | number, number>();
  for (let i = 0; i < n; i++) {
    perCluster.set(clusters[i], (perCluster.get(clusters[i]) ?? 0) + (scores[i] - m));
  }

  // Step 2 — square the per-cluster sums and add them up. Expanding each
  // square yields every within-cluster covariance cross-term; between-cluster
  // cross-terms never appear, which encodes the assumption that separate
  // clusters are independent draws.
  let ss = 0;
  for (const dev of perCluster.values()) ss += dev * dev;

  // Step 3 — normalize: Var(mean) = ss/n², so SE = sqrt(ss)/n.
  return Math.sqrt(ss) / n;
}
