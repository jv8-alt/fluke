/**
 * Tolerance tests: the synthetic paper-mode dataset must reproduce the
 * published statistics of the paper's worked example (Tables 1 & 5 of
 * arXiv:2411.00640) when run through OUR estimators — that is the claim the
 * guided demo makes on screen.
 *
 * Tolerances vary by construction method, on purpose:
 * - MATH / HumanEval are deterministic contingency builds → tight (±0.15pp),
 *   limited only by integer counts.
 * - MGSM is a seeded random build with clipping → slightly looser
 *   (means ±0.3pp, gap ±0.25pp, clustered paired SE ±0.10pp).
 * - Correlations get ±0.08: the paper's fictional numbers are not all
 *   jointly achievable with binary scores (e.g. HumanEval's ρ=0.64 with
 *   paired SE 2.10 at those means is mathematically infeasible — max-variance
 *   binary data caps the SE below that), so we prioritize means/gaps/SEs and
 *   let ρ land as close as the data allows.
 */
import { describe, expect, it } from "vitest";
import { buildPaperDataset, DREADNOUGHT, GALLEON, PAPER_TARGETS } from "./papermode";
import {
  ci95,
  comparePaired,
  mean,
  seClustered,
  seMean,
  sePairedClustered,
} from "../stats";

const ds = buildPaperDataset();
const bench = (name: string) => {
  const b = ds.benchmarks.find((x) => x.name === name);
  if (!b) throw new Error(`missing benchmark ${name}`);
  return b;
};
const pct = (x: number) => x * 100;

describe("dataset shape", () => {
  it("has the three benchmarks with aligned arrays", () => {
    expect(ds.benchmarks.map((b) => b.name)).toEqual(["MATH", "HumanEval", "MGSM"]);
    for (const b of ds.benchmarks) {
      expect(b.scores[GALLEON]).toHaveLength(b.itemIds.length);
      expect(b.scores[DREADNOUGHT]).toHaveLength(b.itemIds.length);
    }
  });

  it("MGSM is 2500 rows in 250 clusters of 10", () => {
    const m = bench("MGSM");
    expect(m.itemIds).toHaveLength(2500);
    const counts = new Map<string, number>();
    for (const c of m.clusterIds!) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(250);
    for (const n of counts.values()) expect(n).toBe(10);
  });
});

describe("MATH reproduces the published values (deterministic)", () => {
  const t = PAPER_TARGETS.MATH;
  const b = bench("MATH");
  const c = comparePaired(b.scores[GALLEON], b.scores[DREADNOUGHT]);

  it("means and gap", () => {
    expect(pct(mean(b.scores[GALLEON]))).toBeCloseTo(t.meanA, 1);
    expect(Math.abs(pct(mean(b.scores[DREADNOUGHT])) - t.meanB)).toBeLessThan(0.15);
    expect(Math.abs(pct(c.gap) - t.gap)).toBeLessThan(0.15);
  });

  it("paired SE and correlation", () => {
    expect(Math.abs(pct(c.sePaired) - t.sePaired)).toBeLessThan(0.05);
    expect(Math.abs(c.correlation - t.corr)).toBeLessThan(0.08);
  });

  it("the gap is statistically real: 95% CI excludes zero, like Table 5's (+1.2, +3.8)", () => {
    const [lo, hi] = ci95({ value: pct(c.gap), se: pct(c.sePaired) });
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeCloseTo(1.2, 0);
    expect(hi).toBeCloseTo(3.8, 0);
  });
});

describe("HumanEval reproduces the published values (deterministic)", () => {
  const t = PAPER_TARGETS.HumanEval;
  const b = bench("HumanEval");
  const c = comparePaired(b.scores[GALLEON], b.scores[DREADNOUGHT]);

  it("means and gap", () => {
    expect(Math.abs(pct(mean(b.scores[GALLEON])) - t.meanA)).toBeLessThan(0.15);
    expect(Math.abs(pct(mean(b.scores[DREADNOUGHT])) - t.meanB)).toBeLessThan(0.15);
    expect(Math.abs(pct(c.gap) - t.gap)).toBeLessThan(0.15);
  });

  it("paired SE within integer-count resolution, correlation close", () => {
    expect(Math.abs(pct(c.sePaired) - t.sePaired)).toBeLessThan(0.15);
    expect(Math.abs(c.correlation - t.corr)).toBeLessThan(0.08);
  });

  it("the gap is a coin flip: 95% CI crosses zero, like Table 5's (−7.2, +1.0)", () => {
    const [lo, hi] = ci95({ value: pct(c.gap), se: pct(c.sePaired) });
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
  });
});

describe("MGSM reproduces the published values (seeded random)", () => {
  const t = PAPER_TARGETS.MGSM;
  const b = bench("MGSM");
  const a = b.scores[GALLEON];
  const d = b.scores[DREADNOUGHT];
  const c = comparePaired(a, d);
  const seC = pct(sePairedClustered(a, d, b.clusterIds!));

  it("means and gap", () => {
    expect(Math.abs(pct(mean(a)) - t.meanA)).toBeLessThan(0.3);
    expect(Math.abs(pct(mean(d)) - t.meanB)).toBeLessThan(0.3);
    expect(Math.abs(pct(c.gap) - t.gap)).toBeLessThan(0.25);
  });

  it("cluster-aware paired SE matches Table 5's 1.7", () => {
    expect(Math.abs(seC - t.sePairedClustered)).toBeLessThan(0.1);
  });

  it("correlation close to Table 5's 0.37", () => {
    expect(Math.abs(c.correlation - t.corr)).toBeLessThan(0.08);
  });

  it("clustering matters: bundle-aware SEs are ~2× the naive ones", () => {
    const ratioA = seClustered(a, b.clusterIds!) / seMean(a);
    expect(ratioA).toBeGreaterThan(1.5);
    // and the clustered PAIRED SE exceeds the naive paired SE
    expect(seC).toBeGreaterThan(pct(c.sePaired));
  });

  it("the gap is a coin flip once clusters are counted honestly (Table 5: −6.1 to +0.7)", () => {
    const [lo, hi] = ci95({ value: pct(c.gap), se: seC });
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
  });
});

describe("the demo's headline claim", () => {
  it("naive scoreboard: Dreadnought wins 2 of 3; honest stats: the only real win is Galleon's", () => {
    let dreadnoughtNaiveWins = 0;
    const realWins: string[] = [];
    for (const b of ds.benchmarks) {
      const a = b.scores[GALLEON];
      const d = b.scores[DREADNOUGHT];
      const c = comparePaired(a, d);
      if (c.gap < 0) dreadnoughtNaiveWins++;
      const se = b.clusterIds ? sePairedClustered(a, d, b.clusterIds) : c.sePaired;
      const [lo, hi] = ci95({ value: c.gap, se });
      if (lo > 0) realWins.push(`${GALLEON}:${b.name}`);
      if (hi < 0) realWins.push(`${DREADNOUGHT}:${b.name}`);
    }
    expect(dreadnoughtNaiveWins).toBe(2);
    expect(realWins).toEqual(["Galleon:MATH"]);
  });
});
