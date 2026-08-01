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

describe("margin split: what cancels vs what doesn't", () => {
  it("unpaired — nothing cancels, so each model's own margin is its full margin", async () => {
    const { marginSplit, modelSE } = await import("./model");
    const s = byName("MGSM");
    const t = step(true, true, false);
    const { ownA, ownB } = marginSplit(s, t);
    expect(ownA).toBeCloseTo(modelSE(s, "A", t), 10);
    expect(ownB).toBeCloseTo(modelSE(s, "B", t), 10);
  });

  it("paired — own margins shrink below the full margins", async () => {
    const { marginSplit } = await import("./model");
    const s = byName("MGSM");
    const { ownA, ownB, totalA, totalB } = marginSplit(s, step(true, true, true));
    expect(ownA).toBeLessThan(totalA);
    expect(ownB).toBeLessThan(totalB);
  });

  it("the split is exact: own_A² + own_B² == the gap's variance, in every mode", async () => {
    const { marginSplit } = await import("./model");
    for (const s of stats) {
      for (const t of [
        step(true, false, false),
        step(true, true, false),
        step(true, false, true),
        step(true, true, true),
      ]) {
        const { ownA, ownB } = marginSplit(s, t);
        expect(Math.sqrt(ownA * ownA + ownB * ownB)).toBeCloseTo(gapSE(s, t), 10);
      }
    }
  });
});

describe("gaps panel hint names the full combination", () => {
  it("lists every active correction, not just the latest", async () => {
    const { gapsHint } = await import("./model");
    expect(gapsHint(step(true, false, false), true)).toBe(
      "combining: margins of error + overall-score gaps",
    );
    expect(gapsHint(step(true, true, false), true)).toBe(
      "combining: margins of error + groups counted once + overall-score gaps",
    );
    expect(gapsHint(step(true, true, true), true)).toBe(
      "combining: margins of error + groups counted once + question-by-question gaps",
    );
    // clustering toggle is irrelevant when the dataset has no groups
    expect(gapsHint(step(true, true, true), false)).toBe(
      "combining: margins of error + question-by-question gaps",
    );
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
