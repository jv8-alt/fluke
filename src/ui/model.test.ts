/**
 * View-model tests: the tour's four steps must tell exactly the story the
 * mockup tells, with every number computed from the paper-mode dataset.
 */
import { describe, expect, it } from "vitest";
import { buildPaperDataset } from "../data/papermode";
import { claim, computeDatasetStats, gapSE, verdict, type Toggles } from "./model";

const ds = buildPaperDataset();
const stats = computeDatasetStats(ds);
const step = (bars: boolean, clust: boolean, pair: boolean): Toggles => ({ bars, clust, pair });

const byName = (name: string) => {
  const s = stats.find((x) => x.name === name);
  if (!s) throw new Error(`missing ${name}`);
  return s;
};

describe("step 1 — raw scoreboard", () => {
  it("Dreadnought wins 2 of 3", () => {
    expect(claim(stats, ds.models, step(false, false, false))).toContain(
      "Dreadnought wins 2 of 3",
    );
    expect(verdict(byName("MATH"), step(false, false, false))).toBe("A");
    expect(verdict(byName("HumanEval"), step(false, false, false))).toBe("B");
    expect(verdict(byName("MGSM"), step(false, false, false))).toBe("B");
  });
});

describe("step 2 — margins of error appear", () => {
  const t = step(true, false, false);
  it("HumanEval (164 questions) is immediately too close to call", () => {
    expect(verdict(byName("HumanEval"), t)).toBe("noise");
  });
  it("MGSM still looks like a real Dreadnought lead (clusters not yet charged)", () => {
    expect(verdict(byName("MGSM"), t)).toBe("sigB");
  });
});

describe("step 3 — grouped questions counted once", () => {
  const t = step(true, true, false);
  it("MGSM's lead stops looking real", () => {
    expect(verdict(byName("MGSM"), t)).toBe("noise");
  });
  it("clustering widens MGSM's gap margin", () => {
    expect(gapSE(byName("MGSM"), t)).toBeGreaterThan(
      gapSE(byName("MGSM"), step(true, false, false)),
    );
  });
});

describe("step 4 — question-by-question comparison", () => {
  const t = step(true, true, true);
  it("the verdict flips: only Galleon's MATH lead is real", () => {
    expect(verdict(byName("MATH"), t)).toBe("sigA");
    expect(verdict(byName("HumanEval"), t)).toBe("noise");
    expect(verdict(byName("MGSM"), t)).toBe("noise");
    expect(claim(stats, ds.models, t)).toContain("one real lead — Galleon on MATH");
  });
  it("pairing tightens every gap margin", () => {
    for (const s of stats) {
      expect(gapSE(s, t)).toBeLessThan(gapSE(s, step(true, true, false)));
    }
  });
});

describe("stats bundle sanity", () => {
  it("cluster-aware numbers equal naive ones when there are no clusters", () => {
    const m = byName("MATH");
    expect(m.seCA).toBe(m.seNA);
    expect(m.se.uC).toBeCloseTo(m.se.uN, 12);
    expect(m.se.pC).toBe(m.se.pN);
    expect(m.nClusters).toBeNull();
  });
  it("MGSM reports its cluster count", () => {
    expect(byName("MGSM").nClusters).toBe(250);
  });
});
