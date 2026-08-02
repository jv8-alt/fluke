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
import { EXAMPLE_CSV_URL, parseCsv } from "./csv";
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
    expect(bench("reading").nClusters).toBe(30);
    expect(bench("arithmetic").nClusters).toBeNull();
  });

  it("a loaded view of it still fits in a share link", async () => {
    // The whole reason this file is as small as it is. If a size constant in
    // scripts/make_example_csv.py grows, this is what catches it.
    const { shareableOrReason, MAX_FRAGMENT_CHARS } = await import("./share");
    const res = shareableOrReason({
      ds: "upload",
      bars: true,
      clust: true,
      pair: true,
      csv: text,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.fragment.length).toBeLessThanOrEqual(MAX_FRAGMENT_CHARS);
  });
});

describe("the one-click example URL stays valid after merge", () => {
  it("is pinned to main, not to a branch that gets deleted", () => {
    // A branch ref works in review and 404s the moment the branch is deleted,
    // which is exactly when everyone else starts using it.
    expect(EXAMPLE_CSV_URL).toContain("/fluke/main/");
    expect(EXAMPLE_CSV_URL).not.toMatch(/\/fluke\/(mikado|revert)[/-]/);
  });

  it("points at raw.githubusercontent.com, the host that allows browser fetches", () => {
    expect(new URL(EXAMPLE_CSV_URL).host).toBe("raw.githubusercontent.com");
  });

  it("points at the path this file actually lives at", () => {
    // Guards a rename of the CSV leaving the button aimed at nothing.
    expect(EXAMPLE_CSV_URL.endsWith("/public/datasets/example-eval.csv")).toBe(true);
  });
});

describe("the story the docs promise: same size gap, opposite verdicts", () => {
  const reading = bench("reading");
  const arithmetic = bench("arithmetic");

  it("both leads are nearly the same size — that's the point", () => {
    // gap is (model A − model B) and tuned-v2 is model B, so both gaps are
    // negative; the claim is about size of lead, hence magnitudes. If these
    // drift apart the file stops making its argument.
    expect(Math.abs(Math.abs(reading.gap) - Math.abs(arithmetic.gap))).toBeLessThan(1.5);
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
