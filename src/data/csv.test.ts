/**
 * Tests for the CSV upload parser (csv.ts).
 *
 * Organized to mirror the parser's contract: happy paths first (each optional
 * feature exercised), then every rejection path — each asserting not just that
 * parsing failed, but that the error names the row and says something a person
 * could act on. describeFetchError is tested as a pure message mapping; no
 * network calls anywhere in this file.
 */

import { describe, expect, it } from "vitest";
import { csvTemplate, DEFAULT_BENCHMARK, describeFetchError, parseCsv } from "./csv";

/** Convenience: parse and assert success, returning the dataset + warnings. */
function parseOk(text: string) {
  const res = parseCsv(text);
  if (!res.ok) throw new Error("expected ok, got errors: " + JSON.stringify(res.errors));
  return res;
}

/** Convenience: parse and assert failure, returning the errors. */
function parseErr(text: string) {
  const res = parseCsv(text);
  if (res.ok) throw new Error("expected errors, got ok");
  return res.errors;
}

describe("parseCsv — happy paths", () => {
  it("parses a minimal two-model file", () => {
    const { dataset, warnings } = parseOk(
      ["model,item_id,score", "a,q1,1", "a,q2,0", "b,q1,0", "b,q2,1"].join("\n"),
    );
    expect(dataset.models).toEqual(["a", "b"]);
    expect(dataset.benchmarks).toHaveLength(1);
    const bench = dataset.benchmarks[0];
    expect(bench.name).toBe(DEFAULT_BENCHMARK); // no benchmark column → "uploaded"
    expect(bench.itemIds).toEqual(["q1", "q2"]);
    expect(bench.scores).toEqual({ a: [1, 0], b: [0, 1] });
    expect(bench.clusterIds).toBeUndefined(); // no cluster column → no cluster array
    expect(warnings).toEqual([]); // clean file, nothing to warn about
  });

  it("accepts free column order, fractional and dot-leading scores", () => {
    const { dataset } = parseOk(
      ["score,item_id,model", ".5,q1,a", "1.0,q2,a", "0,q1,b", "0.25,q2,b"].join("\n"),
    );
    expect(dataset.benchmarks[0].scores).toEqual({ a: [0.5, 1], b: [0, 0.25] });
  });

  it("splits a multi-benchmark file into one BenchmarkData per distinct benchmark", () => {
    const { dataset } = parseOk(
      [
        "model,item_id,score,benchmark",
        "a,q1,1,math",
        "a,q1,0,code", // same item_id in a different benchmark is a different question
        "b,q1,0,math",
        "b,q1,1,code",
      ].join("\n"),
    );
    expect(dataset.benchmarks.map((b) => b.name)).toEqual(["math", "code"]); // first-appearance order
    expect(dataset.benchmarks[0].scores).toEqual({ a: [1], b: [0] });
    expect(dataset.benchmarks[1].scores).toEqual({ a: [0], b: [1] });
  });

  it("preserves cluster_id into BenchmarkData.clusterIds, aligned with itemIds", () => {
    const { dataset } = parseOk(
      [
        "model,item_id,score,cluster_id",
        "a,q1,1,p1",
        "a,q2,0,p1",
        "a,q3,1,p2",
        "b,q1,0,p1",
        "b,q2,1,p1",
        "b,q3,1,p2",
      ].join("\n"),
    );
    expect(dataset.benchmarks[0].itemIds).toEqual(["q1", "q2", "q3"]);
    expect(dataset.benchmarks[0].clusterIds).toEqual(["p1", "p1", "p2"]);
  });

  it("averages sample_k repeats into one score per item (repeats 1 and 0 → 0.5)", () => {
    const { dataset } = parseOk(
      [
        "model,item_id,score,sample_k",
        "a,q1,1,1",
        "a,q1,0,2", // distinct sample_k → repeat, averaged
        "b,q1,1,1",
        "b,q1,1,2",
      ].join("\n"),
    );
    expect(dataset.benchmarks[0].scores).toEqual({ a: [0.5], b: [1] });
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    const { dataset } = parseOk(
      ['model,item_id,score', '"model, with comma","q ""one""",1', '"model, with comma",q2,0'].join("\n"),
    );
    expect(dataset.models).toEqual(["model, with comma"]);
    expect(dataset.benchmarks[0].itemIds).toEqual(['q "one"', "q2"]);
  });

  it("accepts CRLF line endings and a trailing newline", () => {
    const { dataset } = parseOk("model,item_id,score\r\na,q1,1\r\nb,q1,0\r\n");
    expect(dataset.benchmarks[0].scores).toEqual({ a: [1], b: [0] });
  });

  it("warns on a single-model file but still parses (margins only)", () => {
    const { dataset, warnings } = parseOk(["model,item_id,score", "a,q1,1", "a,q2,0"].join("\n"));
    expect(dataset.models).toEqual(["a"]);
    expect(dataset.benchmarks[0].scores.a).toEqual([1, 0]);
    expect(warnings.some((w) => w.includes("one model"))).toBe(true);
  });

  it("drops items not answered by every model, with a warning saying how many and why", () => {
    const { dataset, warnings } = parseOk(
      ["model,item_id,score", "a,q1,1", "a,q2,0", "a,q3,1", "b,q1,0"].join("\n"),
    );
    // q2 and q3 only exist for model a → dropped so the arrays stay aligned
    expect(dataset.benchmarks[0].itemIds).toEqual(["q1"]);
    expect(dataset.benchmarks[0].scores).toEqual({ a: [1], b: [0] });
    const w = warnings.find((w) => w.includes("dropped 2 questions"));
    expect(w).toBeDefined();
    expect(w).toContain("same questions"); // the "why" — pairing needs shared items
  });

  it("keeps 3+ models in first-appearance order and warns that the UI compares the first two", () => {
    const { dataset, warnings } = parseOk(
      ["model,item_id,score", "c,q1,1", "a,q1,0", "b,q1,1"].join("\n"),
    );
    expect(dataset.models).toEqual(["c", "a", "b"]);
    expect(warnings.some((w) => w.includes("first two") && w.includes("c") && w.includes("a"))).toBe(true);
  });

  it("warns about unknown columns and ignores them", () => {
    const { dataset, warnings } = parseOk(
      ["model,item_id,score,notes", "a,q1,1,irrelevant", "b,q1,0,also irrelevant"].join("\n"),
    );
    expect(dataset.benchmarks[0].scores).toEqual({ a: [1], b: [0] });
    expect(warnings.some((w) => w.includes("notes"))).toBe(true);
  });

  it("warns when a model is absent from one benchmark of a multi-benchmark file", () => {
    const { warnings } = parseOk(
      ["model,item_id,score,benchmark", "a,q1,1,math", "b,q1,0,math", "a,q9,1,code"].join("\n"),
    );
    expect(warnings.some((w) => w.includes('"code"') && w.includes("'b'"))).toBe(true);
  });
});

describe("parseCsv — rejection paths (errors must be specific and friendly)", () => {
  it("rejects an empty file, naming the expected columns", () => {
    const errors = parseErr("");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("model, item_id, score");
  });

  it("rejects a header-only file", () => {
    const errors = parseErr("model,item_id,score\n");
    expect(errors[0].message).toContain("only a header");
  });

  it("rejects a missing required column, naming it", () => {
    const errors = parseErr("model,item_id\na,q1");
    expect(errors[0].message).toContain("score");
    expect(errors[0].message).toContain("missing required column");
  });

  it("rejects an out-of-range score with the row number and the fraction hint", () => {
    const errors = parseErr("model,item_id,score\na,q1,1\na,q2,1.4");
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3); // header is row 1, so the bad row is row 3
    expect(errors[0].message).toContain("'1.4'");
    expect(errors[0].message).toContain("outside 0–1");
    expect(errors[0].message).toContain("0.85, not 85"); // the actionable hint
  });

  it("rejects a non-numeric score with the row number", () => {
    const errors = parseErr("model,item_id,score\na,q1,accurate");
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toContain("'accurate'");
    expect(errors[0].message).toContain("not a number");
  });

  it("rejects duplicate (model, item_id) rows without sample_k, suggesting sample_k for repeats", () => {
    const errors = parseErr("model,item_id,score\na,q1,1\na,q1,0");
    expect(errors[0].row).toBe(3);
    expect(errors[0].message).toContain("duplicate");
    expect(errors[0].message).toContain("row 2"); // points back at the first occurrence
    expect(errors[0].message).toContain("sample_k"); // tells the user how repeats are expressed
  });

  it("rejects duplicate rows even when sample_k is present but repeated", () => {
    const errors = parseErr("model,item_id,score,sample_k\na,q1,1,1\na,q1,0,1");
    expect(errors[0].message).toContain("duplicate");
    expect(errors[0].message).toContain("sample_k '1'");
  });

  it("rejects inconsistent cluster_id for the same item across models", () => {
    const errors = parseErr(
      ["model,item_id,score,cluster_id", "a,q1,1,p1", "b,q1,0,p2"].join("\n"),
    );
    expect(errors[0].row).toBe(3);
    expect(errors[0].message).toContain("'p2'");
    expect(errors[0].message).toContain("'p1'");
    expect(errors[0].message).toContain("same for every model");
  });

  it("rejects a multi-model benchmark with zero shared item_ids, explaining the pairing need", () => {
    const errors = parseErr("model,item_id,score\na,q1,1\nb,q2,0");
    expect(errors[0].message).toContain("share no item_ids");
    expect(errors[0].message).toContain("same questions");
  });

  it("rejects a row with the wrong number of fields, with the row number", () => {
    const errors = parseErr("model,item_id,score\na,q1\nb,q1,0");
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toContain("2 values");
    expect(errors[0].message).toContain("3 columns");
  });

  it("collects multiple errors in one pass instead of stopping at the first", () => {
    const errors = parseErr("model,item_id,score\na,q1,2\na,q2,nope");
    expect(errors).toHaveLength(2);
    expect(errors[0].row).toBe(2);
    expect(errors[1].row).toBe(3);
  });
});

describe("csvTemplate", () => {
  it("round-trips through parseCsv with two models, clusters and averaged repeats", () => {
    const { dataset, warnings } = parseOk(csvTemplate());
    expect(dataset.models).toEqual(["my-model-v1", "my-model-v2"]);
    const bench = dataset.benchmarks[0];
    expect(bench.itemIds).toEqual(["question-1", "question-2", "question-3"]);
    expect(bench.clusterIds).toEqual(["passage-A", "passage-A", "passage-B"]);
    // question-3 has sample_k 1 and 2 → averaged: v1 (0.5+1)/2, v2 (0.5+0)/2
    expect(bench.scores["my-model-v1"]).toEqual([1, 0, 0.75]);
    expect(bench.scores["my-model-v2"]).toEqual([0, 1, 0.25]);
    expect(warnings).toEqual([]); // the template we hand out must parse clean
  });
});

describe("describeFetchError — message mapping (no network)", () => {
  it("explains parquet files and offers the conversion path", () => {
    const msg = describeFetchError("https://x.co/data.parquet", "parquet");
    expect(msg).toContain("parquet");
    expect(msg).toContain("CSV");
    expect(msg).toContain("Convert");
  });

  it("explains CORS in plain language and names hosts that work", () => {
    const msg = describeFetchError("https://example.com/data.csv", "cors");
    expect(msg).toContain("Download the file and drop it above");
    expect(msg).toContain("HuggingFace");
    expect(msg).toContain("raw.githubusercontent.com");
  });

  it("includes the HTTP status, with a not-found note for 404", () => {
    expect(describeFetchError("https://x.co/d.csv", "http", 404)).toContain("404");
    expect(describeFetchError("https://x.co/d.csv", "http", 404)).toContain("not found");
    expect(describeFetchError("https://x.co/d.csv", "http", 500)).toContain("500");
    expect(describeFetchError("https://x.co/d.csv", "http", 500)).not.toContain("not found");
  });

  it("gives network failures the download-and-drop escape hatch", () => {
    const msg = describeFetchError("https://x.co/d.csv", "network");
    expect(msg).toContain("drop it above");
  });
});
