/**
 * "Paper mode": the guided demo's dataset, calibrated to the worked example in
 * Miller, "Adding Error Bars to Evals" (arXiv:2411.00640) — two fictional
 * models (Galleon vs Dreadnought) on MATH, HumanEval and MGSM, with the score
 * means of Table 1 and the paired gaps/SEs/correlations of Table 5.
 *
 * The paper releases no data, so we synthesize per-question outcomes:
 *
 * - MATH and HumanEval have no cluster structure, so they are built
 *   DETERMINISTICALLY from 2×2 contingency counts (both right / only A /
 *   only B / both wrong) chosen so the means, gap and paired SE land on the
 *   published values. No randomness, no seed.
 * - MGSM is 250 problems × 10 languages (a cluster per problem), generated
 *   from a seeded PRNG with per-problem difficulties tuned so that naive,
 *   clustered, and paired statistics land within the test tolerances.
 *
 * Honest limitation, asserted in the tests: the paper's fictional numbers are
 * not all jointly achievable with binary scores (e.g. HumanEval's ρ = 0.64
 * together with paired SE 2.10 at those means is infeasible), so correlations
 * carry a looser tolerance than means/gaps/SEs. See papermode.test.ts.
 */

import type { BenchmarkData, EvalDataset } from "./types";

export const GALLEON = "Galleon";
export const DREADNOUGHT = "Dreadnought";

/** Published values the synthetic data is calibrated to (percent units). */
export const PAPER_TARGETS = {
  MATH: { meanA: 65.5, meanB: 63.0, gap: +2.5, sePaired: 0.7, corr: 0.5, n: 5000 },
  HumanEval: { meanA: 83.6, meanB: 86.7, gap: -3.1, sePaired: 2.1, corr: 0.64, n: 164 },
  // MGSM's Table 5 SE (1.7) is the cluster-aware paired SE.
  MGSM: { meanA: 75.3, meanB: 78.0, gap: -2.7, sePairedClustered: 1.7, corr: 0.37, n: 2500, clusters: 250 },
} as const;

/** Build aligned binary score arrays from 2×2 contingency counts. */
function fromCounts(
  name: string,
  bothRight: number,
  onlyA: number,
  onlyB: number,
  bothWrong: number,
): BenchmarkData {
  const n = bothRight + onlyA + onlyB + bothWrong;
  const a = new Array<number>(n);
  const b = new Array<number>(n);
  const itemIds = new Array<string>(n);
  let i = 0;
  const fill = (count: number, sa: number, sb: number) => {
    for (let k = 0; k < count; k++, i++) {
      a[i] = sa;
      b[i] = sb;
      itemIds[i] = `${name}-${i + 1}`;
    }
  };
  fill(bothRight, 1, 1);
  fill(onlyA, 1, 0);
  fill(onlyB, 0, 1);
  fill(bothWrong, 0, 0);
  return { name, itemIds, scores: { [GALLEON]: a, [DREADNOUGHT]: b } };
}

/** mulberry32 — tiny deterministic PRNG so the dataset is stable across runs. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * MGSM: shared per-problem difficulty drives both models (that's what makes
 * language copies rise and fall together, and what pairing later cancels).
 * Constants tuned so computed stats hit PAPER_TARGETS.MGSM within tolerance
 * for SEED — see papermode.test.ts.
 */
function buildMgsm(): BenchmarkData {
  const SEED = 20241106; // arXiv submission date of the paper; do not change without re-running the tolerance test
  const PROBLEMS = 250;
  const LANGS = 10;
  // Three independently tunable noise sources, each targeting one published
  // statistic (values found by running the tolerance test against the seed):
  // - TAU: sd of shared per-problem difficulty → drives per-model clustering
  //   and part of the A↔B correlation (hard problems are hard for both).
  // - WOBBLE: sd of each model's own per-problem strength → makes the score
  //   DIFFERENCES co-move within a problem, driving the cluster-aware paired
  //   SE (Table 5's 1.7).
  // - SHARE: probability a language-item reuses the same uniform draw for
  //   both models → adds item-level correlation without touching any
  //   cluster-level variance.
  const TAU = 0.22;
  const WOBBLE = 0.24;
  const SHARE = 0.60;
  const BASE_A = 0.780;
  const BASE_B = 0.830;
  // Two independent streams with a FIXED number of draws per problem/item, so
  // tuning one constant never reshuffles the randomness consumed by the
  // others (a lesson learned during calibration: with a single stream, any
  // parameter change regenerated a completely different dataset).
  const rngProblem = mulberry32(SEED);
  const rngItem = mulberry32(SEED ^ 0x9e3779b9);

  const itemIds: string[] = [];
  const clusterIds: string[] = [];
  const a: number[] = [];
  const b: number[] = [];
  for (let c = 0; c < PROBLEMS; c++) {
    const difficulty = TAU * gaussian(rngProblem);
    const pA = clip(BASE_A + difficulty + WOBBLE * gaussian(rngProblem), 0.02, 0.98);
    const pB = clip(BASE_B + difficulty + WOBBLE * gaussian(rngProblem), 0.02, 0.98);
    for (let l = 0; l < LANGS; l++) {
      itemIds.push(`MGSM-p${c + 1}-l${l + 1}`);
      clusterIds.push(`problem-${c + 1}`);
      // Always draw all three uniforms (fixed consumption — see above).
      const shared = rngItem() < SHARE;
      const u = rngItem();
      const uIndep = rngItem();
      const uB = shared ? u : uIndep;
      a.push(u < pA ? 1 : 0);
      b.push(uB < pB ? 1 : 0);
    }
  }
  return {
    name: "MGSM",
    itemIds,
    clusterIds,
    scores: { [GALLEON]: a, [DREADNOUGHT]: b },
  };
}

/**
 * Contingency counts derived by hand from the targets (percent → counts):
 *
 * MATH (n=5000): gap +2.5 → onlyA − onlyB = 125; paired SE 0.70 →
 *   Var(d) = 5000·0.007² = 0.245 → disagreements = 5000·(0.245+0.025²) ≈ 1228
 *   → onlyA 676, onlyB 552 (gap 2.48); meanA 65.5 → bothRight 2599.
 * HumanEval (n=164): gap −3.1 → onlyB − onlyA = 5; paired SE 2.1 →
 *   disagreements ≈ 12–13; onlyA 4, onlyB 9 gives SE 2.19 (closest
 *   achievable with integer counts); meanA 83.6 → bothRight 133.
 */
export function buildPaperDataset(): EvalDataset {
  return {
    id: "paper",
    label: "Guided demo",
    note:
      "Synthetic data calibrated to the paper's fictional worked example (Tables 1 & 5). " +
      "Per-question outcomes are constructed, not published — see About.",
    models: [GALLEON, DREADNOUGHT],
    benchmarks: [
      fromCounts("MATH", 2599, 676, 552, 1173),
      fromCounts("HumanEval", 133, 4, 9, 18),
      buildMgsm(),
    ],
  };
}
