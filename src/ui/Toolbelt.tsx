/**
 * "Use different data": the dataset picker (bundled real snapshots), the CSV
 * dropzone, the blank-template download, and the load-from-URL row. All
 * parsing goes through src/data/csv.ts — the same path for drops, URLs, and
 * bundled files — so error handling and validation behave identically
 * everywhere.
 */
import { useRef, useState } from "preact/hooks";
import {
  csvTemplate,
  EXAMPLE_CSV_URL,
  fetchCsvUrl,
  parseCsv,
  type CsvError,
} from "../data/csv";
import { BUNDLED } from "../data/bundled";
import type { EvalDataset } from "../data/types";

export interface ToolbeltProps {
  currentId: string;
  /** label shown on the active upload card, e.g. "my-eval.csv" */
  uploadLabel: string | null;
  uploadSummary: string | null;
  onPick: (id: string) => void;
  /** a successfully parsed upload (from drop or URL) with its raw text */
  onParsed: (dataset: EvalDataset, csvText: string, summary: string) => void;
}

/** One-line summary of a parsed upload for the confirmation toast/card. */
function summarize(ds: EvalDataset): string {
  const items = ds.benchmarks.reduce((n, b) => n + b.itemIds.length, 0);
  const parts = [
    `${ds.models.length} model${ds.models.length === 1 ? "" : "s"}`,
    `${items.toLocaleString()} questions`,
  ];
  if (ds.benchmarks.length > 1) parts.unshift(`${ds.benchmarks.length} benchmarks`);
  parts.push(
    ds.models.length >= 2
      ? "question-by-question comparison available"
      : "margins only (add a second model to compare)",
  );
  return parts.join(" · ");
}

export function Toolbelt({ currentId, uploadLabel, uploadSummary, onPick, onParsed }: ToolbeltProps) {
  const [errors, setErrors] = useState<CsvError[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [urlMsg, setUrlMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  /** Returns whether the text parsed — callers use it to avoid reporting
   *  success for a file that arrived intact but failed validation. */
  const handleText = (text: string, sourceLabel: string): boolean => {
    const res = parseCsv(text);
    if (!res.ok) {
      setErrors(res.errors);
      setWarnings([]);
      return false;
    }
    setErrors([]);
    setWarnings(res.warnings);
    const ds = { ...res.dataset, label: sourceLabel };
    onParsed(ds, text, summarize(ds));
    return true;
  };

  const handleFile = (f: File) => {
    // Drop/browse supersedes any earlier URL attempt — leaving that message up
    // would report on a file the user has moved on from.
    setUrlMsg(null);
    return f.text().then((t) => handleText(t, f.name));
  };

  const downloadTemplate = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    // Serve the template as a client-generated file — no server involved.
    const url = URL.createObjectURL(
      new Blob([csvTemplate()], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "example.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Insert the example URL only — loading stays the user's decision, same as
   * for a link they pasted themselves. Filling the box also leaves the URL
   * visible, so the shape of a link that works is part of the demonstration.
   */
  const insertExample = () => {
    if (!urlInput.current) return;
    urlInput.current.value = EXAMPLE_CSV_URL;
    urlInput.current.focus();
  };

  const loadUrl = async () => {
    const u = urlInput.current?.value.trim() ?? "";
    if (!u) {
      setUrlMsg({ text: "Paste a link to a CSV file.", warn: true });
      return;
    }
    // Progress lives on the button (see `loading`), not in a message line:
    // a status message that appears and then disappears is more motion than
    // a one-second fetch warrants.
    setUrlMsg(null);
    setLoading(true);
    let res;
    try {
      res = await fetchCsvUrl(u);
    } finally {
      setLoading(false);
    }
    if (!res.ok) {
      setUrlMsg({ text: res.message, warn: true });
      return;
    }
    // Success needs no message: the file appears as the selected card in the
    // list above, which says the same thing without a line that has to be
    // read and then dismissed. Only the failure — a file that arrived intact
    // but isn't in our schema — still needs explaining.
    const parsed = handleText(res.text, u.split("/").pop() || "linked.csv");
    setUrlMsg(
      parsed
        ? null
        : {
            text: "Downloaded that file, but it isn't in the expected format — see above.",
            warn: true,
          },
    );
  };

  return (
    <details id="uploadbox" open={currentId === "upload"}>
      <summary>
        Use different data{" "}
        <span class="hint">try a real benchmark, or bring your own</span>
      </summary>
      <div class="body">
        <p class="sub">
          Anything with per-question scores works. Two models answering the
          same questions unlocks the question-by-question comparison
          automatically.
        </p>
        <div class="dslist">
          {BUNDLED.map((o) => (
            <button
              class={`dsopt ${currentId === o.id ? "active" : ""}`}
              onClick={() => onPick(o.id)}
            >
              <div>
                <div class="t">{o.title}</div>
                <div class="d">{o.desc}</div>
              </div>
              <span class="tag">{o.tag}</span>
            </button>
          ))}
          {currentId === "upload" && (
            <button class="dsopt active">
              <div>
                <div class="t">{uploadLabel ?? "your file"}</div>
                <div class="d">{uploadSummary ?? "parsed in the browser"}</div>
              </div>
              <span class="tag">loaded</span>
            </button>
          )}
        </div>

        <div
          class={`drop ${dragOver ? "over" : ""}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer?.files?.[0];
            if (f) handleFile(f);
          }}
        >
          <b>Drop a CSV here</b> (or click to browse)
          <br />
          <span class="fine">
            one row per model &amp; question:{" "}
            <code>model, item_id, score</code> (+ optional{" "}
            <code>cluster_id, sample_k, benchmark</code>)
            <br />
            not sure of the format?{" "}
            <a href="#" onClick={downloadTemplate}>
              download a blank template
            </a>
          </span>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>

        {errors.length > 0 && (
          <div class="sub warn">
            {errors.slice(0, 5).map((er) => (
              <div>{er.message}</div>
            ))}
            {errors.length > 5 && <div>…and {errors.length - 5} more.</div>}
          </div>
        )}
        {warnings.length > 0 && (
          <div class="sub">
            {warnings.map((w) => (
              <div>⚠ {w}</div>
            ))}
          </div>
        )}

        <div class="urlrow">
          <input
            ref={urlInput}
            type="text"
            /* Names the constraint that actually bites (the file must already
               use the columns described above) and the host form that works —
               github.com/…/blob/… page URLs are CORS-blocked, raw. is not. */
            placeholder="…or paste a link to a CSV in this format (raw.githubusercontent.com, HuggingFace)"
            onKeyDown={(e) => {
              if (e.key === "Enter") loadUrl();
            }}
          />
          {/* The label stays in the DOM while loading and is only made
              invisible, with the spinner overlaid — so the button keeps the
              exact width of "Load" and nothing around it reflows. */}
          <button
            class="btn urlload"
            onClick={loadUrl}
            disabled={loading}
            aria-busy={loading}
          >
            <span class={loading ? "invisible" : ""}>Load</span>
            {loading && <span class="spinner" aria-label="Loading" />}
          </button>
        </div>
        <div class="fine urltip" style={{ textAlign: "right" }}>
          no link handy?{" "}
          <button class="lnk" onClick={insertExample}>
            use our example file
          </button>
        </div>
        {urlMsg && <div class={`sub ${urlMsg.warn ? "warn" : ""}`}>{urlMsg.text}</div>}
      </div>
    </details>
  );
}
