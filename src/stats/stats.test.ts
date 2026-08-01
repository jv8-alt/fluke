/**
 * Hand-computed cases for the stats core. Every expected value is derived in
 * a comment so a reviewer can check the arithmetic without running anything.
 * Paper = Miller, "Adding Error Bars to Evals" (arXiv:2411.00640).
 */
import { describe, expect, it } from "vitest";
import {
  ci95,
  comparePaired,
  mean,
  minimumDetectableEffect,
  pearson,
  perQuestionVariance,
  questionsNeeded,
  sampleVariance,
  seBernoulli,
  seClustered,
  seMean,
  sePairedClustered,
  seUnpaired,
} from "./index";

describe("descriptive", () => {
  it("mean and unbiased variance", () => {
    // [1,0,1,1]: mean 0.75; deviations² = .0625×3 + .5625 = .75; /(n−1)=.25
    expect(mean([1, 0, 1, 1])).toBe(0.75);
    expect(sampleVariance([1, 0, 1, 1])).toBeCloseTo(0.25, 12);
    expect(sampleVariance([0.4])).toBe(0); // single observation
  });

  it("seMean: sqrt(Var/n)", () => {
    // sqrt(0.25 / 4) = 0.25
    expect(seMean([1, 0, 1, 1])).toBeCloseTo(0.25, 12);
  });

  it("seBernoulli: sqrt(p(1−p)/n)", () => {
    expect(seBernoulli(0.5, 100)).toBeCloseTo(0.05, 12);
    // sqrt(.75×.25/4) = sqrt(.046875) = 0.216506…
    expect(seBernoulli(0.75, 4)).toBeCloseTo(0.216506, 6);
    expect(() => seBernoulli(1.2, 10)).toThrow();
    expect(() => seBernoulli(0.5, 0)).toThrow();
  });

  it("ci95 half-width is 1.96×SE", () => {
    const [lo, hi] = ci95({ value: 0.5, se: 0.1 });
    expect(lo).toBeCloseTo(0.304, 3);
    expect(hi).toBeCloseTo(0.696, 3);
  });

  it("empty input throws", () => {
    expect(() => mean([])).toThrow();
    expect(() => seMean([])).toThrow();
  });
});

describe("clustered SE (paper Eq. 4, grouped-sum form)", () => {
  it("perfectly co-moving pairs are charged at full price", () => {
    // scores [1,1,0,0], clusters [a,a,b,b], mean .5
    // cluster deviation sums: a → +1, b → −1; Σ(sums²) = 2
    // SE = sqrt(2)/4 = 0.353553…
    expect(seClustered([1, 1, 0, 0], ["a", "a", "b", "b"])).toBeCloseTo(
      Math.SQRT2 / 4,
      12,
    );
  });

  it("singleton clusters reduce to the CLT SE (n-denominator convention)", () => {
    // Σ(s_i − .5)² = 1 → SE = 1/4. (seMean uses n−1 and gives 0.2887 — the
    // paper's clustered estimator uses n, so singleton ≠ seMean by design.)
    expect(seClustered([1, 1, 0, 0], [1, 2, 3, 4])).toBeCloseTo(0.25, 12);
  });

  it("validates input lengths", () => {
    expect(() => seClustered([1, 0], ["a"])).toThrow();
    expect(() => seClustered([], [])).toThrow();
  });
});

describe("paired comparison (paper §5)", () => {
  it("seUnpaired adds variances", () => {
    // sqrt(.25² + .25²) = 0.353553…
    expect(seUnpaired(0.25, 0.25)).toBeCloseTo(Math.SQRT2 / 4, 12);
  });

  it("comparePaired: hand-computed 4-question example", () => {
    // A=[1,1,0,1], B=[1,0,0,0] → diffs [0,1,0,1]
    // gap = .5; Var(diffs) = (4×.25)/3 = 1/3; sePaired = sqrt(1/12) = 0.288675
    // seMean(A)=seMean(B)=.25 → seUnpaired = 0.353553
    // Pearson: Σ dev products = .25; Σ devA² = Σ devB² = .75 → r = 1/3
    const c = comparePaired([1, 1, 0, 1], [1, 0, 0, 0]);
    expect(c.gap).toBeCloseTo(0.5, 12);
    expect(c.sePaired).toBeCloseTo(Math.sqrt(1 / 12), 12);
    expect(c.seUnpaired).toBeCloseTo(Math.SQRT2 / 4, 12);
    expect(c.correlation).toBeCloseTo(1 / 3, 12);
    expect(c.n).toBe(4);
  });

  it("identical models: zero gap, zero paired SE, correlation 1", () => {
    const c = comparePaired([1, 0, 1, 0], [1, 0, 1, 0]);
    expect(c.gap).toBe(0);
    expect(c.sePaired).toBe(0);
    expect(c.correlation).toBeCloseTo(1, 12);
  });

  it("pearson is 0 when one side is constant", () => {
    expect(pearson([1, 1, 1], [1, 0, 1])).toBe(0);
  });

  it("sePairedClustered: singleton clusters match n-denominator CLT on diffs", () => {
    // diffs [0,1,0,1], mean .5, Σdev² = 1 → sqrt(1)/4 = 0.25
    expect(
      sePairedClustered([1, 1, 0, 1], [1, 0, 0, 0], [1, 2, 3, 4]),
    ).toBeCloseTo(0.25, 12);
  });

  it("length mismatches throw", () => {
    expect(() => comparePaired([1], [1, 0])).toThrow();
    expect(() => sePairedClustered([1], [1], [1, 2])).toThrow();
  });
});

describe("power analysis (paper §5.3 / §3.2)", () => {
  it("reproduces the paper's worked example: ≈969 questions for a 3-pt gap", () => {
    // ω²=1/9, σ²=0 (grade by token probabilities), α=.05, power=80%:
    // (1.959964+0.841621)² × (1/9) / 0.03² = 7.8489 × 0.1111 / 0.0009 ≈ 969
    expect(
      questionsNeeded({
        delta: 0.03,
        alpha: 0.05,
        power: 0.8,
        omega2: 1 / 9,
        sigma2A: 0,
        sigma2B: 0,
        K: 1,
      }),
    ).toBe(969);
  });

  it("MDE inverts questionsNeeded at the same parameters", () => {
    const mde = minimumDetectableEffect({
      n: 969,
      alpha: 0.05,
      power: 0.8,
      omega2: 1 / 9,
      sigma2A: 0,
      sigma2B: 0,
      K: 1,
    });
    expect(mde).toBeCloseTo(0.03, 4);
  });

  it("resampling: K=2 cuts the paper's uniform-difficulty variance by 1/3, K=4 by 1/2", () => {
    // x~U[0,1] binary grading: ω²=1/12, σ²=1/6; K=1 total = 1/4
    const v1 = perQuestionVariance(1 / 12, 1 / 6, 1);
    const v2 = perQuestionVariance(1 / 12, 1 / 6, 2);
    const v4 = perQuestionVariance(1 / 12, 1 / 6, 4);
    expect(v1).toBeCloseTo(0.25, 12);
    expect((v1 - v2) / v1).toBeCloseTo(1 / 3, 12);
    expect((v1 - v4) / v1).toBeCloseTo(1 / 2, 12);
  });

  it("more resamples never require more questions", () => {
    const base = { delta: 0.03, alpha: 0.05, power: 0.8, omega2: 1 / 9, sigma2A: 1 / 6, sigma2B: 1 / 6 };
    const n1 = questionsNeeded({ ...base, K: 1 });
    const n10 = questionsNeeded({ ...base, K: 10 });
    expect(n10).toBeLessThan(n1);
  });

  it("unsupported alpha/power values throw instead of silently guessing", () => {
    const base = { delta: 0.03, omega2: 1 / 9, sigma2A: 0, sigma2B: 0, K: 1 };
    expect(() => questionsNeeded({ ...base, alpha: 0.07, power: 0.8 })).toThrow();
    expect(() => questionsNeeded({ ...base, alpha: 0.05, power: 0.5 })).toThrow();
  });
});
