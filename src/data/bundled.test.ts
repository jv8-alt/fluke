/**
 * Convergence contract tests: the D branch's real snapshot files must
 * round-trip through the C branch's parser into datasets the UI can render —
 * this is the cross-branch conformance check the Mikado plan assigned to B2.
 * Files are read from disk (node) here; the app fetches the same files over
 * HTTP from public/datasets/.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUNDLED, parseBundled } from "./bundled";
import { computeBenchmarkStats } from "../ui/model";

const read = (p: string) =>
  readFileSync(new URL(`../../public/${p}`, import.meta.url), "utf8");

describe("bundled registry", () => {
  it("ids are unique and CSV-backed entries have paths", () => {
    expect(new Set(BUNDLED.map((e) => e.id)).size).toBe(BUNDLED.length);
    for (const e of BUNDLED.filter((x) => x.id !== "paper")) {
      expect(e.path).toBeTruthy();
    }
  });
});

describe("MMLU snapshot parses and matches the D-branch report", () => {
  const ds = parseBundled("mmlu", read("datasets/mmlu.csv"));

  it("two models, 14,042 shared items, 57 subject clusters", () => {
    expect(ds.models).toHaveLength(2);
    const b = ds.benchmarks[0];
    expect(b.itemIds).toHaveLength(14042);
    expect(new Set(b.clusterIds).size).toBe(57);
    expect(b.groupNote).toContain("57");
  });

  it("means match the archive's own aggregates (69.19 vs 55.88)", () => {
    const s = computeBenchmarkStats(ds.benchmarks[0], ds.models);
    expect(Math.abs(s.meanA - 69.19)).toBeLessThan(0.05);
    expect(Math.abs(s.meanB - 55.88)).toBeLessThan(0.05);
  });

  it("clustering widens the honest margin (that's why it's bundled)", () => {
    const s = computeBenchmarkStats(ds.benchmarks[0], ds.models);
    expect(s.seCA).toBeGreaterThan(s.seNA);
  });
});

describe("MMLU close-race snapshot: the verdict actually flips", () => {
  const ds = parseBundled("mmlu-close", read("datasets/mmlu-close.csv"));
  const b = ds.benchmarks[0];
  const s = computeBenchmarkStats(b, ds.models);

  it("two sibling models with a small real gap in 57 subject clusters", () => {
    expect(ds.models).toEqual(["vicuna-13b-v1.5", "Llama-2-13b-hf"]);
    expect(new Set(b.clusterIds).size).toBe(57);
    expect(Math.abs(s.gap)).toBeGreaterThan(1.5);
    expect(Math.abs(s.gap)).toBeLessThan(3);
  });

  it("double flip across the app's toggle sequence: real → too close → real", async () => {
    const { verdict } = await import("../ui/model");
    // margins only (unpaired naive)
    expect(verdict(s, { bars: true, clust: false, pair: false })).toBe("sigA");
    // + count grouped questions once (unpaired clustered)
    expect(verdict(s, { bars: true, clust: true, pair: false })).toBe("noise");
    // + compare question-by-question (paired clustered)
    expect(verdict(s, { bars: true, clust: true, pair: true })).toBe("sigA");
  });

  it("each stage clears its boundary comfortably (no float-noise story)", async () => {
    const { gapSE } = await import("../ui/model");
    const margin = (t: { bars: boolean; clust: boolean; pair: boolean }) =>
      1.96 * gapSE(s, t);
    expect(Math.abs(s.gap)).toBeGreaterThan(margin({ bars: true, clust: false, pair: false }) + 0.1);
    expect(Math.abs(s.gap)).toBeLessThan(margin({ bars: true, clust: true, pair: false }) - 0.1);
    expect(Math.abs(s.gap)).toBeGreaterThan(margin({ bars: true, clust: true, pair: true }) + 0.1);
  });
});

describe("DROP snapshot parses and matches the D-branch report", () => {
  const ds = parseBundled("drop", read("datasets/drop.csv"));

  it("9,536 shared items, 579 passage clusters, continuous scores", () => {
    const b = ds.benchmarks[0];
    expect(b.itemIds).toHaveLength(9536);
    expect(new Set(b.clusterIds).size).toBe(579);
  });

  it("means reflect the real (broken-parser-era) F1: ~6.6 vs ~6.4", () => {
    const s = computeBenchmarkStats(ds.benchmarks[0], ds.models);
    expect(Math.abs(s.meanA - 6.62)).toBeLessThan(0.05);
    expect(Math.abs(s.meanB - 6.41)).toBeLessThan(0.05);
  });
});
