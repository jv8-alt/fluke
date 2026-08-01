/**
 * Logic tests for the power panel's slider-state → readout mapping.
 *
 * Deliberately DOM-free: `powerReadout` is the entire arithmetic surface
 * of the panel (the component just renders its output), so testing the
 * pure function pins the panel's numbers without pulling any rendering
 * dependency into the project. UI behavior is covered by the manual
 * click-through named in the MIKADO P1 test plan.
 */
import { describe, expect, it } from "vitest";
import { questionsNeeded } from "../stats";
import { ILLUSTRATIVE, powerReadout } from "./PowerPanel";

describe("powerReadout", () => {
  it("reproduces the paper's flagship example: 3-pt gap, α=5%, power 80%, probability grading → ≈969 questions", () => {
    // Paper §5.3 worked example: with answer luck eliminated (ntp) the
    // only variance left is question luck ω² = 1/9, and resolving a
    // 3-point gap at conventional strictness costs ~969 questions. This
    // is the number the whole panel is calibrated against.
    const out = powerReadout({
      mdePts: 3,
      K: 1,
      alphaIdx: 1, // α = 5%
      powerIdx: 0, // power = 80%
      ntp: true,
    });
    expect(out.n).toBe(969);
    // Display fields feed the readout sentence directly.
    expect(out.mdePts).toBe(3);
    expect(out.alphaPct).toBe(5);
    expect(out.powerPct).toBe(80);
  });

  it("asking each question more often strictly reduces questions needed (sampled grading)", () => {
    // With ntp off the answer-luck term σ²_A/K + σ²_B/K is alive, so
    // every increase in K must shave the bill: n(K=1) > n(K=2) > n(K=4).
    const at = (K: number) =>
      powerReadout({ mdePts: 3, K, alphaIdx: 1, powerIdx: 0, ntp: false }).n;
    expect(at(2)).toBeLessThan(at(1));
    expect(at(4)).toBeLessThan(at(2));
  });

  it("a stricter false-alarm tolerance (α=1%) needs more questions than a looser one (α=10%)", () => {
    // Smaller α → larger critical value z_{α/2} → bigger multiplier on
    // the variance → more questions for the same gap.
    const at = (alphaIdx: 0 | 1 | 2) =>
      powerReadout({ mdePts: 3, K: 1, alphaIdx, powerIdx: 0, ntp: false }).n;
    expect(at(0)).toBeGreaterThan(at(2));
  });

  it("provided dataset variances override the paper's illustrative values", () => {
    // Same sliders, different variance regime → different n, and the n
    // must be exactly what the stats core computes from the provided
    // components (the panel adds no arithmetic of its own).
    const variances = { omega2: 0.05, sigma2A: 0.02, sigma2B: 0.08 };
    const out = powerReadout({
      mdePts: 3,
      K: 1,
      alphaIdx: 1,
      powerIdx: 0,
      ntp: false,
      variances,
    });
    const expected = questionsNeeded({
      delta: 0.03,
      alpha: 0.05,
      power: 0.8,
      ...variances,
      K: 1,
    });
    expect(out.n).toBe(expected);
    // ...and it genuinely differs from the illustrative-value answer.
    const illustrative = powerReadout({
      mdePts: 3,
      K: 1,
      alphaIdx: 1,
      powerIdx: 0,
      ntp: false,
    }).n;
    expect(out.n).not.toBe(illustrative);
  });

  it("probability grading zeroes answer luck even when dataset variances are provided", () => {
    // ntp eliminates σ² by construction — how much answer luck the
    // dataset's sampled answers showed is irrelevant once grading reads
    // token probabilities. Only ω² should survive.
    const variances = { omega2: 0.05, sigma2A: 0.4, sigma2B: 0.4 };
    const out = powerReadout({
      mdePts: 3,
      K: 1,
      alphaIdx: 1,
      powerIdx: 0,
      ntp: true,
      variances,
    });
    const omegaOnly = questionsNeeded({
      delta: 0.03,
      alpha: 0.05,
      power: 0.8,
      omega2: variances.omega2,
      sigma2A: 0,
      sigma2B: 0,
      K: 1,
    });
    expect(out.n).toBe(omegaOnly);
  });

  it("keeps the mockup's 2·σ²/K shorthand equivalent to per-model σ²/K terms", () => {
    // The mockup wrote the answer-luck variance as 2·σ²/K with a single
    // shared σ² = 1/6; the panel passes σ²_A = σ²_B = 1/6 instead. Guard
    // the equivalence so a future refactor can't silently break it.
    const out = powerReadout({
      mdePts: 3,
      K: 2,
      alphaIdx: 1,
      powerIdx: 0,
      ntp: false,
    });
    const shorthand = questionsNeeded({
      delta: 0.03,
      alpha: 0.05,
      power: 0.8,
      omega2: ILLUSTRATIVE.omega2,
      // 2·σ²/K expressed as one model carrying both terms: σ²_A = 2σ², σ²_B = 0
      sigma2A: 2 * ILLUSTRATIVE.sigma2A,
      sigma2B: 0,
      K: 2,
    });
    expect(out.n).toBe(shorthand);
  });
});
