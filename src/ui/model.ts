/**
 * Pure view-model logic for the app: computes every number the UI shows from
 * a dataset (nothing on screen is hardcoded), and derives verdicts and the
 * claim line from the current toggle state. Kept free of Preact so it can be
 * unit-tested directly.
 */

import type { BenchmarkData, EvalDataset } from "../data/types";
import {
  ci95,
  comparePaired,
  mean,
  seClustered,
  seMean,
  sePairedClustered,
} from "../stats";

/** Which of the paper's corrections are switched on. */
export interface Toggles {
  /** show margins of error at all (naive SEs) */
  bars: boolean;
  /** count grouped questions once (clustered SEs) */
  clust: boolean;
  /** compare question-by-question (paired gap SE) */
  pair: boolean;
}

/** Everything the UI needs about one benchmark, computed once per dataset. */
export interface BenchmarkStats {
  name: string;
  n: number;
  nClusters: number | null;
  /** percent units throughout (65.5 = 65.5%) */
  meanA: number;
  meanB: number;
  /** per-model SEs, naive and cluster-aware */
  seNA: number;
  seNB: number;
  seCA: number;
  seCB: number;
  /** gap = A − B, percent */
  gap: number;
  /** gap SEs for the four analysis modes: unpaired/paired × naive/clustered */
  se: { uN: number; uC: number; pN: number; pC: number };
  corr: number;
}

/** Compute the full stats bundle for one benchmark (models[0] = A). */
export function computeBenchmarkStats(
  b: BenchmarkData,
  models: readonly string[],
): BenchmarkStats {
  const a = b.scores[models[0]];
  const d = b.scores[models[1]];
  if (!a || !d) throw new Error(`benchmark ${b.name}: missing model scores`);
  const paired = comparePaired(a, d);
  const seNA = seMean(a);
  const seNB = seMean(d);
  // Without clusters the cluster-aware numbers ARE the naive numbers — the
  // UI can always read seC*/pC and get the honest value for the toggle state.
  const seCA = b.clusterIds ? seClustered(a, b.clusterIds) : seNA;
  const seCB = b.clusterIds ? seClustered(d, b.clusterIds) : seNB;
  const pC = b.clusterIds
    ? sePairedClustered(a, d, b.clusterIds)
    : paired.sePaired;
  const pct = (x: number) => x * 100;
  return {
    name: b.name,
    n: b.itemIds.length,
    nClusters: b.clusterIds ? new Set(b.clusterIds).size : null,
    meanA: pct(mean(a)),
    meanB: pct(mean(d)),
    seNA: pct(seNA),
    seNB: pct(seNB),
    seCA: pct(seCA),
    seCB: pct(seCB),
    gap: pct(paired.gap),
    se: {
      uN: pct(paired.seUnpaired),
      uC: pct(Math.sqrt(seCA * seCA + seCB * seCB)),
      pN: pct(paired.sePaired),
      pC: pct(pC),
    },
    corr: paired.correlation,
  };
}

export function computeDatasetStats(ds: EvalDataset): BenchmarkStats[] {
  return ds.benchmarks.map((b) => computeBenchmarkStats(b, ds.models));
}

/** Gap SE for the current toggle state (percent units). */
export function gapSE(s: BenchmarkStats, t: Toggles): number {
  return s.se[`${t.pair ? "p" : "u"}${t.clust ? "C" : "N"}` as keyof BenchmarkStats["se"]];
}

/** Per-model displayed SE for the current toggle state. */
export function modelSE(s: BenchmarkStats, model: "A" | "B", t: Toggles): number {
  if (model === "A") return t.clust ? s.seCA : s.seNA;
  return t.clust ? s.seCB : s.seNB;
}

export type Verdict = "A" | "B" | "sigA" | "sigB" | "noise";

/**
 * Verdict for one benchmark under the current toggles.
 * Without margins of error the "verdict" is just who scored higher; with
 * them, a lead is only real when the 95% interval for the gap excludes zero.
 */
export function verdict(s: BenchmarkStats, t: Toggles): Verdict {
  if (!t.bars) return s.gap > 0 ? "A" : "B";
  const [lo, hi] = ci95({ value: s.gap, se: gapSE(s, t) });
  if (lo > 0) return "sigA";
  if (hi < 0) return "sigB";
  return "noise";
}

export interface Claim {
  /** plain-language headline for the current toggle state */
  html: string;
}

/**
 * The claim line above the table — the one-sentence reading of the current
 * state. Mirrors the approved mockup's wording exactly.
 */
export function claim(
  stats: readonly BenchmarkStats[],
  models: readonly string[],
  t: Toggles,
): string {
  const [A, B] = models;
  if (!t.bars) {
    const bWins = stats.filter((s) => s.gap < 0).length;
    const winner = bWins > stats.length / 2 ? B : A;
    const nWins = Math.max(bWins, stats.length - bWins);
    return `Scoreboard says: <b>${winner} wins ${nWins} of ${stats.length}</b>.`;
  }
  const sigA = stats.filter((s) => verdict(s, t) === "sigA");
  const sigB = stats.filter((s) => verdict(s, t) === "sigB");
  if (!sigA.length && !sigB.length) {
    return `Right now: <b>no lead is large enough to trust</b> — every gap could be luck.`;
  }
  if (sigA.length && sigB.length) {
    return `Right now: a <b>split decision</b> — ${A} really leads on ${sigA
      .map((s) => s.name)
      .join(", ")}, ${B} on ${sigB.map((s) => s.name).join(", ")}.`;
  }
  const win = sigA.length ? A : B;
  const evs = (sigA.length ? sigA : sigB).map((s) => s.name).join(", ");
  return `Right now: <b>one real lead — ${win} on ${evs}</b>. The rest could be luck.`;
}

/**
 * Splits one model's margin into the part that CANCELS against the other
 * model and the part that doesn't.
 *
 * Why this exists: a model's own score can be very uncertain while the *gap*
 * between two models is nailed down — on real MMLU data each model's score
 * swings ±5.9 (models are uneven across subjects, so which subjects the
 * benchmark happens to cover matters a lot) while the gap between them holds
 * to ±0.7, because that subject lottery lifts and drops both models together.
 * Reading the two per-model margins as if they were independent is the
 * classic "overlapping error bars means no real difference" mistake.
 *
 * The split is exact rather than a gesture: the gap's variance is divided
 * between the two models in proportion to each one's own variance, so
 * own_A² + own_B² = Var(gap) always. Two consequences fall out for free:
 * - unpaired analysis (nothing cancels) → own == total, the full margin;
 * - paired analysis → own collapses to the residual that survives pairing.
 * So the same formula, evaluated under the current toggles, makes the
 * shrink visible the moment "compare question-by-question" is switched on.
 */
export function marginSplit(
  s: BenchmarkStats,
  t: Toggles,
): { ownA: number; ownB: number; totalA: number; totalB: number } {
  const totalA = modelSE(s, "A", t);
  const totalB = modelSE(s, "B", t);
  const gap = gapSE(s, t);
  const denom = totalA * totalA + totalB * totalB;
  if (denom === 0) return { ownA: 0, ownB: 0, totalA, totalB };
  return {
    ownA: gap * Math.sqrt((totalA * totalA) / denom),
    ownB: gap * Math.sqrt((totalB * totalB) / denom),
    totalA,
    totalB,
  };
}

/**
 * Hint for the "gaps, up close" panel header: names every correction
 * currently applied, so it's unambiguous that the bars show the COMBINED
 * effect of all checked boxes, not just the most recent one. (The panel is
 * only visible when margins are on, so that part is always listed.)
 */
export function gapsHint(t: Toggles, anyClusters: boolean): string {
  const parts = ["margins of error"];
  if (t.clust && anyClusters) parts.push("groups counted once");
  parts.push(t.pair ? "question-by-question gaps" : "overall-score gaps");
  return `combining: ${parts.join(" + ")}`;
}

/** Format helpers shared by the UI. */
export const fmt = (x: number, d = 1) => x.toFixed(d);
export const Z95_DISPLAY = 1.96;
/** displayed "± …" margins are 95% half-widths */
export const moe = (se: number) => Z95_DISPLAY * se;
