/**
 * The bundled dataset registry: what the "Use different data" picker offers
 * and how each entry is loaded. Three sources today — the synthetic guided
 * demo (built in code) and two real per-question snapshots (CSV files served
 * statically from public/datasets/, parsed by the same parser that handles
 * user uploads, so bundled data and uploads exercise one code path).
 */

import type { EvalDataset } from "./types";
import { buildPaperDataset } from "./papermode";
import { parseCsv } from "./csv";

export interface BundledEntry {
  id: string;
  /** picker card title */
  title: string;
  /** picker card description line */
  desc: string;
  /** small tag on the right of the card */
  tag: string;
  /** provenance note shown in the paused story box */
  note: string;
  /** static CSV path relative to the site base; absent = built in code */
  path?: string;
}

export const BUNDLED: BundledEntry[] = [
  {
    id: "paper",
    title: "Guided demo",
    desc: "Two models, three benchmarks — the tour's example",
    tag: "built in",
    note:
      "Synthetic data calibrated to the paper's worked example (Tables 1 & 5). " +
      "Per-question outcomes are constructed, not published — see About.",
  },
  {
    id: "mmlu",
    title: "MMLU",
    desc: "Real logs · Llama-2-70b vs Falcon-40b · questions grouped by subject",
    tag: "real data",
    note:
      "Real per-question logs from the Open LLM Leaderboard archive. " +
      "Questions grouped by subject — milder bundling than DROP's passages.",
    path: "datasets/mmlu.csv",
  },
  {
    id: "mmlu-close",
    title: "MMLU — close race",
    desc: "Real logs · vicuna-13b-v1.5 vs its base Llama-2-13b · watch the verdict flip",
    tag: "real data",
    note:
      "Real per-question logs for a fine-tune and its own base model, 2.1 points apart. " +
      "Flip the corrections in order: the lead reads as real, dissolves when subjects are " +
      "counted as groups, then comes back once the models are compared question-by-question.",
    path: "datasets/mmlu-close.csv",
  },
  {
    id: "drop",
    title: "DROP",
    desc: "Real logs · questions grouped by passage — and a broken-eval story",
    tag: "real data",
    note:
      "Real per-question logs, grouped by passage. Scores are strikingly low — " +
      "the harness's DROP answer-parsing was broken in 2023 (see About). " +
      "The bundling structure this demo analyzes is unaffected.",
    path: "datasets/drop.csv",
  },
];

/**
 * Post-parse dressing for the real snapshots: stable ids/labels and a
 * human-readable description of each benchmark's grouping (computed from the
 * data so it can never drift from the file contents).
 */
function dress(ds: EvalDataset, entry: BundledEntry): EvalDataset {
  for (const b of ds.benchmarks) {
    if (!b.clusterIds) continue;
    const nClusters = new Set(b.clusterIds).size;
    b.groupNote =
      entry.id.startsWith("mmlu")
        ? `${nClusters} school subjects`
        : `${nClusters} passages, ~${Math.round(b.itemIds.length / nClusters)} questions each`;
  }
  return { ...ds, id: entry.id, label: entry.title, note: entry.note };
}

/** Parse a bundled CSV's text into a dressed dataset (pure — used by tests). */
export function parseBundled(entryId: string, csvText: string): EvalDataset {
  const entry = BUNDLED.find((e) => e.id === entryId);
  if (!entry) throw new Error(`unknown bundled dataset: ${entryId}`);
  const res = parseCsv(csvText);
  if (!res.ok) {
    // A bundled file failing to parse is a packaging bug, not a user error.
    throw new Error(
      `bundled ${entryId} failed to parse: ${res.errors[0]?.message}`,
    );
  }
  return dress(res.dataset, entry);
}

const cache = new Map<string, Promise<EvalDataset>>();

/** Load a bundled dataset by id (cached; network only for CSV-backed entries). */
export function loadBundled(id: string): Promise<EvalDataset> {
  let p = cache.get(id);
  if (p) return p;
  const entry = BUNDLED.find((e) => e.id === id);
  if (!entry) return Promise.reject(new Error(`unknown dataset: ${id}`));
  p = entry.path
    ? fetch(`${import.meta.env.BASE_URL}${entry.path}`).then(async (r) => {
        if (!r.ok) throw new Error(`fetch ${entry.path}: HTTP ${r.status}`);
        return parseBundled(id, await r.text());
      })
    : Promise.resolve(buildPaperDataset());
  cache.set(id, p);
  return p;
}
