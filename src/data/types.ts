/**
 * Dataset shapes shared by the bundled datasets, the CSV parser, and the UI.
 * Columnar per benchmark: score arrays are aligned by item index so the
 * paired estimators can subtract element-wise.
 */

export interface BenchmarkData {
  name: string;
  /** item ids, one per question (aligned with every scores array) */
  itemIds: string[];
  /** cluster label per item (same passage / same problem across languages); absent = independent questions */
  clusterIds?: string[];
  /** model name → per-item scores in [0,1], aligned with itemIds */
  scores: Record<string, number[]>;
}

export interface EvalDataset {
  id: string;
  label: string;
  /** provenance note shown in the UI */
  note?: string;
  /** display order of models (first = "Model A" color) */
  models: string[];
  benchmarks: BenchmarkData[];
}
