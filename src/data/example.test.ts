/**
 * The demo file for the "bring your own data" path must actually work in the
 * app, and must keep telling the story the docs claim it tells.
 *
 * It is loaded exactly the way a user's own upload is — raw text straight
 * into parseCsv — so this doubles as an end-to-end check of the import path
 * against a realistic file (multiple benchmarks, one clustered and one not).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { computeBenchmarkStats, verdict, type Toggles } from "../ui/model";

const text = readFileSync(
  new URL("../../public/datasets/example-eval.csv", import.meta.url),
  "utf8",
);
const res = parseCsv(text);
if (!res.ok) throw new Error(`example-eval.csv failed to parse: ${res.errors[0]?.message}`);
const ds = res.dataset;

const bench = (name: string) => {
  const b = ds.benchmarks.find((x) => x.name === name);
  if (!b) throw new Error(`missing benchmark ${name}`);
  return computeBenchmarkStats(b, ds.models);
};
const step = (bars: boolean, clust: boolean, pair: boolean): Toggles => ({ bars, clust, pair });

describe("example-eval.csv parses like any upload", () => {
  it("no errors and no warnings — it is the file we tell people to imitate", () => {
    expect(res.warnings).toEqual([]);
    expect(ds.models).toEqual(["baseline-v1", "tuned-v2"]);
    expect(ds.benchmarks.map((b) => b.name).sort()).toEqual(["arithmetic", "reading"]);
  });

  it("is small enough that download-then-upload is instant", () => {
    expect(text.length).toBeLessThan(120_000);
  });

  it("carries clusters on reading and none on arithmetic", () => {
    expect(bench("reading").nClusters).toBe(40);
    expect(bench("arithmetic").nClusters).toBeNull();
  });
});

describe("the story the docs promise: the bigger gap is the fake one", () => {
  const reading = bench("reading");
  const arithmetic = bench("arithmetic");

  it("reading's lead is the larger of the two", () => {
    // gap is (model A − model B) and tuned-v2 is model B, so both gaps are
    // negative; the claim is about size of lead, hence magnitudes.
    expect(Math.abs(reading.gap)).toBeGreaterThan(Math.abs(arithmetic.gap));
  });

  it("reading reads as real until passages are counted once, then dies", () => {
    expect(verdict(reading, step(true, false, false))).toBe("sigB");
    expect(verdict(reading, step(true, true, false))).toBe("noise");
    expect(verdict(reading, step(true, true, true))).toBe("noise");
  });

  it("arithmetic's smaller lead survives every correction", () => {
    expect(verdict(arithmetic, step(true, false, false))).toBe("sigB");
    expect(verdict(arithmetic, step(true, true, false))).toBe("sigB");
    expect(verdict(arithmetic, step(true, true, true))).toBe("sigB");
  });

  it("each verdict clears its boundary with room, so the story is not knife-edge", () => {
    // reading: comfortably above the naive margin, comfortably inside the clustered one
    expect(Math.abs(reading.gap)).toBeGreaterThan(1.96 * reading.se.uN + 1);
    expect(Math.abs(reading.gap)).toBeLessThan(1.96 * reading.se.pC - 1);
    // arithmetic: clears even its widest margin
    const widest = Math.max(reading.se.pC, arithmetic.se.uC, arithmetic.se.pC);
    expect(Math.abs(arithmetic.gap)).toBeGreaterThan(1.96 * Math.min(widest, arithmetic.se.uC));
  });
});
