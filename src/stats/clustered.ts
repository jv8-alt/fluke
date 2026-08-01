/**
 * Cluster-aware standard errors (paper §3.1, Eq. 4).
 *
 * Questions that arrive in bundles — the same passage, the same problem
 * translated into ten languages — succeed or fail together, so they carry
 * less independent information than their row count suggests. The clustered
 * SE charges that co-movement at full price: within each cluster, deviations
 * are summed *first*, then squared.
 */

import { mean } from "./descriptive";

/**
 * Clustered standard error of the mean.
 *
 * SE²(clustered) = (1/n²) · Σ_clusters ( Σ_{i∈cluster} (s_i − s̄) )²
 *
 * This grouped-sum form is algebraically identical to "CLT variance plus
 * within-cluster covariance terms" and is how the paper's Eq. 4 is computed in
 * practice. With every question in its own cluster it reduces to the plain
 * CLT standard error (up to the n−1 vs n variance convention; we use n here,
 * matching the paper's estimator).
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
  const perCluster = new Map<string | number, number>();
  for (let i = 0; i < n; i++) {
    perCluster.set(clusters[i], (perCluster.get(clusters[i]) ?? 0) + (scores[i] - m));
  }
  let ss = 0;
  for (const dev of perCluster.values()) ss += dev * dev;
  return Math.sqrt(ss) / n;
}
