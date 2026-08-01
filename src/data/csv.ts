/**
 * CSV upload parsing & validation — the "bring your own data" entry point.
 *
 * ## Accepted schema (strict v1 — sniffing of other layouts is a documented
 * follow-up, see MIKADO.md D-slice 3)
 *
 * A header row is REQUIRED. One data row per (model, question) — or per
 * (model, question, repeat) when `sample_k` is used.
 *
 * Required columns (any order; names are case-insensitive):
 *   - `model`     — model name, e.g. "ckpt-1600"
 *   - `item_id`   — question identifier, shared across models
 *   - `score`     — number in [0,1]; continuous values allowed ("0", "1",
 *                   "0.5", ".5" all fine). Fractions, not percentages.
 *
 * Optional columns:
 *   - `cluster_id` — group label (same passage / same problem translated into
 *                    many languages). Must be consistent for a given
 *                    (benchmark, item_id) across models — the cluster is a
 *                    property of the QUESTION, not of the model answering it.
 *   - `sample_k`   — repeat index. Multiple rows for the same
 *                    (model, benchmark, item_id) with DISTINCT sample_k values
 *                    are repeats of the same question; we AVERAGE them into one
 *                    score per item. Averaging keeps the per-item score arrays
 *                    (and therefore every standard error downstream) valid;
 *                    decomposing question-luck vs answer-luck (the paper's
 *                    ω²/σ² split) from repeats is a documented non-goal for
 *                    now (MIKADO.md D-slice 3).
 *   - `benchmark`  — benchmark name. Absent → the whole file is one benchmark
 *                    named "uploaded". Present → one benchmark per distinct
 *                    value.
 *
 * Unknown columns are ignored with a warning (not an error — people export
 * from spreadsheets with extra bookkeeping columns all the time).
 *
 * Quoting: simple RFC-4180 — fields may be double-quoted, quoted fields may
 * contain commas, newlines and doubled quotes (""). CRLF and LF both accepted.
 *
 * ## Validation philosophy
 *
 * Errors must be friendly and SPECIFIC — they name the row, quote the value,
 * and say what to do instead. A rejected upload with a vague error is a dead
 * end; a rejected upload with "Row 12: score '85' is outside 0–1 — use 0.85,
 * not 85" is a fixable one. All errors are collected (up to a cap) so the user
 * fixes the file once, not once per error.
 */

import type { BenchmarkData, EvalDataset } from "./types";

export interface CsvError {
  /** 1-based line number in the file (header is row 1); absent = file-level */
  row?: number;
  message: string;
}

export type ParseResult =
  | { ok: true; dataset: EvalDataset; warnings: string[] }
  | { ok: false; errors: CsvError[] };

/** Benchmark name used when the optional `benchmark` column is absent. */
export const DEFAULT_BENCHMARK = "uploaded";

/** Stop collecting per-row errors past this many — a wall of hundreds of
 * identical messages helps nobody; the first screenful shows the pattern. */
const MAX_ERRORS = 25;

// ---------------------------------------------------------------------------
// Low-level record splitting (RFC-4180-level quoting)
// ---------------------------------------------------------------------------

interface RawRecord {
  fields: string[];
  /** 1-based line number where this record STARTS (what a spreadsheet shows) */
  line: number;
}

/**
 * Split CSV text into records of fields, honoring double-quoted fields that
 * may contain commas, doubled quotes ("") and even newlines. We track the line
 * number each record starts on so error messages match what the user sees in
 * their spreadsheet/editor — that's the whole reason for a hand-rolled scanner
 * instead of a line-split.
 */
function splitRecords(text: string): RawRecord[] {
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  /** whether the current field was quoted (quoted fields keep whitespace) */
  let wasQuoted = false;
  let line = 1;
  let recordStart = 1;

  const endField = () => {
    // Unquoted fields get trimmed — "a, b, c" is overwhelmingly meant as
    // three clean values, and stray spaces around ids would silently break
    // the cross-model item matching.
    fields.push(wasQuoted ? field : field.trim());
    field = "";
    wasQuoted = false;
  };
  const endRecord = () => {
    endField();
    // Skip records that are entirely blank (trailing newline, blank lines) —
    // they're formatting noise, not data.
    if (!(fields.length === 1 && fields[0] === "")) {
      records.push({ fields, line: recordStart });
    }
    fields = [];
    recordStart = line;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"' && field.trim() === "") {
      // Opening quote (only at field start; a quote mid-field is taken
      // literally rather than erroring — lenient beats pedantic here).
      inQuotes = true;
      wasQuoted = true;
      field = "";
    } else if (c === ",") {
      endField();
    } else if (c === "\n") {
      line++;
      endRecord();
    } else if (c === "\r") {
      // CRLF: swallow the \r, let the \n (next char) end the record.
      // A bare \r (old-Mac line ending) also ends the record.
      if (text[i + 1] !== "\n") {
        line++;
        endRecord();
      }
    } else {
      field += c;
    }
  }
  // Flush the final record if the file doesn't end with a newline.
  if (field !== "" || fields.length > 0) endRecord();
  return records;
}

// ---------------------------------------------------------------------------
// Score parsing
// ---------------------------------------------------------------------------

/**
 * Parse one score cell. Returns the number, or a friendly error message.
 * Accepts "0", "1", "0.5", ".5", "1.0" etc. Rejects blanks, non-numbers and
 * anything outside [0,1] — with the fraction-vs-percentage hint, because a
 * score of "85" is by far the most common mistake and "outside 0–1" alone
 * would leave the user guessing.
 */
function parseScore(raw: string): { value: number } | { error: string } {
  const s = raw.trim();
  if (s === "") return { error: "score is empty. Expected a fraction between 0 and 1, like 0.85." };
  // Number() accepts "" and whitespace as 0 — already excluded above.
  const v = Number(s);
  if (!Number.isFinite(v)) {
    return { error: `score '${s}' is not a number. Expected a fraction between 0 and 1, like 0.85.` };
  }
  if (v < 0 || v > 1) {
    return { error: `score '${s}' is outside 0–1. Scores are fractions — use 0.85, not 85.` };
  }
  return { value: v };
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

const REQUIRED = ["model", "item_id", "score"] as const;
const OPTIONAL = ["cluster_id", "sample_k", "benchmark"] as const;

export function parseCsv(text: string): ParseResult {
  const records = splitRecords(text);
  if (records.length === 0) {
    return {
      ok: false,
      errors: [{ message: "The file is empty. Expected a header row with columns: model, item_id, score." }],
    };
  }

  // --- header ---
  const header = records[0].fields.map((h) => h.trim().toLowerCase());
  const col: Record<string, number> = {};
  const unknown: string[] = [];
  header.forEach((name, i) => {
    if ((REQUIRED as readonly string[]).includes(name) || (OPTIONAL as readonly string[]).includes(name)) {
      // First occurrence wins if a column name repeats — repeating a column is
      // odd but harmless to resolve deterministically.
      if (!(name in col)) col[name] = i;
    } else if (name !== "") {
      unknown.push(name);
    }
  });
  const missing = REQUIRED.filter((r) => !(r in col));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [
        {
          row: records[0].line,
          message:
            `The header row is missing required column${missing.length > 1 ? "s" : ""}: ` +
            `${missing.join(", ")}. Expected at least: model, item_id, score ` +
            `(optional: cluster_id, sample_k, benchmark).`,
        },
      ],
    };
  }

  const warnings: string[] = [];
  if (unknown.length > 0) {
    warnings.push(`Ignoring unrecognized column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`);
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    return {
      ok: false,
      errors: [{ message: "No data rows found — the file has only a header. Add one row per model and question." }],
    };
  }

  // --- row pass: collect scores into nested maps, validating as we go ---
  const errors: CsvError[] = [];
  const addError = (row: number | undefined, message: string) => {
    if (errors.length < MAX_ERRORS) errors.push({ row, message });
    else if (errors.length === MAX_ERRORS) errors.push({ message: "…more errors omitted. Fix the above and re-upload." });
  };

  /** global model order = first appearance in the file (the UI compares the first two) */
  const modelOrder: string[] = [];
  /** benchmark order = first appearance */
  const benchmarkOrder: string[] = [];
  /** per-benchmark item order = first appearance (keeps output stable & diffable) */
  const itemOrder = new Map<string, string[]>();
  /** per-benchmark set mirror of itemOrder, so first-sighting checks stay O(1) */
  const itemSeen = new Map<string, Set<string>>();
  /** benchmark → item_id → cluster_id (+ the row that set it, for error messages) */
  const clusters = new Map<string, Map<string, { cluster: string; row: number }>>();
  /** whether any row in a benchmark carried a non-empty cluster_id */
  const hasClusters = new Map<string, boolean>();
  /**
   * benchmark → model → item_id → (sample_k label → {score, row}).
   * Keyed by sample_k so that repeats (distinct sample_k) accumulate for
   * averaging while true duplicates (same or missing sample_k) are caught.
   */
  const cells = new Map<string, Map<string, Map<string, Map<string, { score: number; row: number }>>>>();

  const nCols = header.length;
  for (const rec of dataRecords) {
    if (rec.fields.length !== nCols) {
      addError(
        rec.line,
        `has ${rec.fields.length} value${rec.fields.length === 1 ? "" : "s"} but the header has ${nCols} columns. ` +
          `Every row needs one value per column (quote fields that contain commas).`,
      );
      continue;
    }
    const get = (name: string) => (name in col ? rec.fields[col[name]] : "");

    const model = get("model");
    const itemId = get("item_id");
    if (model === "") {
      addError(rec.line, "model is empty — every row needs a model name.");
      continue;
    }
    if (itemId === "") {
      addError(rec.line, "item_id is empty — every row needs a question id.");
      continue;
    }

    const scoreRes = parseScore(get("score"));
    if ("error" in scoreRes) {
      addError(rec.line, scoreRes.error);
      continue;
    }

    // Missing benchmark column, or a blank cell in it, both mean "the one
    // implicit benchmark" — a blank cell shouldn't silently create a
    // benchmark named "".
    const benchmark = get("benchmark") || DEFAULT_BENCHMARK;
    const sampleK = "sample_k" in col ? get("sample_k").trim() : "";
    const clusterId = "cluster_id" in col ? get("cluster_id").trim() : "";

    if (!modelOrder.includes(model)) modelOrder.push(model);
    if (!benchmarkOrder.includes(benchmark)) {
      benchmarkOrder.push(benchmark);
      itemOrder.set(benchmark, []);
      itemSeen.set(benchmark, new Set());
      clusters.set(benchmark, new Map());
      hasClusters.set(benchmark, false);
      cells.set(benchmark, new Map());
    }

    // Cluster consistency: the cluster is a property of the question, so every
    // model's row for the same (benchmark, item_id) must agree. Silent
    // disagreement would make the clustered standard error depend on which
    // model's labels happened to be read last — reject loudly instead.
    if (clusterId !== "") {
      hasClusters.set(benchmark, true);
      const known = clusters.get(benchmark)!.get(itemId);
      if (known === undefined) {
        clusters.get(benchmark)!.set(itemId, { cluster: clusterId, row: rec.line });
      } else if (known.cluster !== clusterId) {
        addError(
          rec.line,
          `item '${itemId}' has cluster '${clusterId}' here but '${known.cluster}' on row ${known.row}. ` +
            `A question's cluster must be the same for every model.`,
        );
        continue;
      }
    }

    const byModel = cells.get(benchmark)!;
    if (!byModel.has(model)) byModel.set(model, new Map());
    const byItem = byModel.get(model)!;
    if (!byItem.has(itemId)) byItem.set(itemId, new Map());
    // Item order is a property of the BENCHMARK (first sighting across all
    // models), not of each model — otherwise every model would re-append the
    // same ids and the aligned arrays would double up.
    if (!itemSeen.get(benchmark)!.has(itemId)) {
      itemSeen.get(benchmark)!.add(itemId);
      itemOrder.get(benchmark)!.push(itemId);
    }
    const bySample = byItem.get(itemId)!;
    const existing = bySample.get(sampleK);
    if (existing !== undefined) {
      // Same (model, benchmark, item_id) and same sample_k (or no sample_k at
      // all) = a genuine duplicate, not a repeat. Averaging duplicates would
      // hide data-preparation bugs, so we refuse.
      addError(
        rec.line,
        `duplicate row: model '${model}', item '${itemId}'` +
          (sampleK !== "" ? `, sample_k '${sampleK}'` : "") +
          ` already appeared on row ${existing.row}. ` +
          (sampleK === ""
            ? "If these are repeated runs of the same question, add a sample_k column to number them."
            : "Each (model, item_id, sample_k) combination may appear only once."),
      );
      continue;
    }
    bySample.set(sampleK, { score: scoreRes.value, row: rec.line });
  }

  if (errors.length > 0) return { ok: false, errors };

  // --- assembly pass: average repeats, align models on shared items ---
  const benchmarks: BenchmarkData[] = [];
  for (const bname of benchmarkOrder) {
    const byModel = cells.get(bname)!;
    const models = modelOrder.filter((m) => byModel.has(m));

    // Which models are missing from this benchmark entirely? Not an error —
    // the benchmark just won't show them — but worth saying out loud, because
    // it usually means a typo in the benchmark column.
    for (const m of modelOrder) {
      if (!byModel.has(m)) {
        warnings.push(`Benchmark "${bname}": no rows for model '${m}' — it will be missing from that benchmark.`);
      }
    }

    // Average repeats down to one score per (model, item). One score per item
    // keeps the per-item arrays i.i.d.-per-question, which is exactly what the
    // standard-error estimators assume; see the sample_k note in the header.
    const perModelScores = new Map<string, Map<string, number>>();
    for (const m of models) {
      const out = new Map<string, number>();
      for (const [item, bySample] of byModel.get(m)!) {
        let sum = 0;
        for (const { score } of bySample.values()) sum += score;
        out.set(item, sum / bySample.size);
      }
      perModelScores.set(m, out);
    }

    // Keep only items every model answered. Pairing subtracts scores
    // element-wise, so the arrays MUST be over the same questions; an item one
    // model never saw has no pair to subtract.
    const allItems = itemOrder.get(bname)!;
    const shared = allItems.filter((item) => models.every((m) => perModelScores.get(m)!.has(item)));
    const droppedCount = allItems.length - shared.length;

    if (shared.length === 0 && models.length > 1) {
      return {
        ok: false,
        errors: [
          {
            message:
              `Benchmark "${bname}": the models share no item_ids, so their answers can't be matched up. ` +
              `Comparing models requires rows for the same questions (same item_id values) for every model. ` +
              `Check that item_id means the same thing in every model's rows.`,
          },
        ],
      };
    }
    if (droppedCount > 0) {
      warnings.push(
        `Benchmark "${bname}": dropped ${droppedCount} question${droppedCount === 1 ? "" : "s"} that not every ` +
          `model answered — comparing models question-by-question needs the same questions for everyone.`,
      );
    }

    const itemIds = models.length > 1 ? shared : allItems;
    const scores: Record<string, number[]> = {};
    for (const m of models) {
      scores[m] = itemIds.map((item) => perModelScores.get(m)!.get(item)!);
    }

    const bench: BenchmarkData = { name: bname, itemIds: [...itemIds], scores };
    if (hasClusters.get(bname)) {
      const clusterMap = clusters.get(bname)!;
      // A blank cluster on some rows while others have one: treat the blank
      // item as its own singleton cluster (an independent question), which is
      // statistically the correct reading of "no group label".
      bench.clusterIds = itemIds.map((item) => clusterMap.get(item)?.cluster ?? item);
    }
    benchmarks.push(bench);
  }

  if (modelOrder.length === 1) {
    warnings.push(
      `Only one model found — margins of error will show, but comparing models needs at least two. ` +
        `Add a second model's rows (same item_ids) to unlock the question-by-question comparison.`,
    );
  } else if (modelOrder.length > 2) {
    warnings.push(
      `Found ${modelOrder.length} models — the comparison view uses the first two (${modelOrder[0]} and ${modelOrder[1]}) for now.`,
    );
  }

  return {
    ok: true,
    dataset: {
      id: "upload",
      label: "Uploaded CSV",
      note: "Your file, parsed in the browser. Nothing is uploaded anywhere.",
      models: modelOrder,
      benchmarks,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Downloadable template
// ---------------------------------------------------------------------------

/**
 * A small, self-explanatory example CSV for the "download a blank template"
 * link in the dropzone. CSV has no comment syntax, so the example must teach
 * by shape alone: two models on the same three questions, a cluster label
 * shared by two of them, and one question asked twice (sample_k 1 and 2) —
 * every optional feature demonstrated in eight rows. Parses cleanly through
 * parseCsv (asserted in tests) so a user can round-trip it unchanged.
 */
export function csvTemplate(): string {
  return [
    "model,item_id,score,cluster_id,sample_k",
    "my-model-v1,question-1,1,passage-A,1",
    "my-model-v1,question-2,0,passage-A,1",
    "my-model-v1,question-3,0.5,passage-B,1",
    "my-model-v1,question-3,1,passage-B,2",
    "my-model-v2,question-1,0,passage-A,1",
    "my-model-v2,question-2,1,passage-A,1",
    "my-model-v2,question-3,0.5,passage-B,1",
    "my-model-v2,question-3,0,passage-B,2",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Loading a CSV by URL
// ---------------------------------------------------------------------------

/**
 * Turn a fetch failure into plain-language guidance. Kept separate from
 * fetchCsvUrl so the message mapping is unit-testable without network access.
 *
 * Why these messages: browsers deliberately hide the difference between "the
 * site blocked cross-origin reads" and "the network is down" (both surface as
 * an opaque TypeError), so the honest move is to explain the LIKELY cause and
 * always offer the escape hatch that works regardless: download the file and
 * drop it in.
 */
export function describeFetchError(
  _url: string, // accepted (and kept in the signature) so callers can pass it and future messages can quote it
  kind: "parquet" | "cors" | "http" | "network",
  status?: number,
): string {
  switch (kind) {
    case "parquet":
      return "That's a parquet file — this app reads CSV. Convert it first, or download and drop it above.";
    case "http":
      return (
        `The server replied with error ${status ?? "unknown"} for that link` +
        (status === 404 ? " (file not found)" : "") +
        ". Check that the URL opens in your browser; if it does, download the file and drop it above."
      );
    case "cors":
      return (
        "That site doesn't allow web pages to fetch its files directly (a browser security rule called CORS). " +
        "Download the file and drop it above — or use a HuggingFace or raw.githubusercontent.com link, which allow it."
      );
    case "network":
      return "Couldn't reach that link — check the URL and your connection, or download the file and drop it above.";
  }
}

/**
 * Fetch CSV text from a user-pasted URL. Never throws — failures come back as
 * { ok: false, message } with guidance from describeFetchError. The parquet
 * check runs BEFORE any network call: HuggingFace dataset pages hand out
 * parquet links constantly, and failing fast with the right message beats a
 * confusing binary-soup parse error after a successful download.
 */
export async function fetchCsvUrl(url: string): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  // Strip query/fragment before the extension check so "data.parquet?download=1" is caught.
  const path = url.split(/[?#]/)[0];
  if (/\.parquet$/i.test(path)) {
    return { ok: false, message: describeFetchError(url, "parquet") };
  }
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    // In browsers, CORS rejections and true network failures are
    // indistinguishable (an opaque TypeError, by spec). CORS is far more
    // common for this app's audience (pasting links from data-hosting sites),
    // so lead with that explanation — it includes the fix for both cases.
    return { ok: false, message: describeFetchError(url, "cors") };
  }
  if (!response.ok) {
    return { ok: false, message: describeFetchError(url, "http", response.status) };
  }
  return { ok: true, text: await response.text() };
}
