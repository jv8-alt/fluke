/**
 * The app shell: guided story (slice 1) + explore mode (slice 2 convergence).
 *
 * Slice-2 wiring in this file: dataset picker + upload + URL loading (C1 via
 * Toolbelt), share links (C2 codec on the Copy-link button and boot-time hash
 * decode), real datasets (D1 via the bundled registry), the power panel (P1),
 * and the About panel. Every number on screen is computed from the current
 * dataset via src/stats — nothing is hardcoded.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import "./app.css";
import { buildPaperDataset } from "../data/papermode";
import { loadBundled } from "../data/bundled";
import { parseCsv } from "../data/csv";
import { decodeShare, shareableOrReason, type ShareState } from "../data/share";
import type { EvalDataset } from "../data/types";
import {
  claim,
  computeDatasetStats,
  fmt,
  gapSE,
  gapsHint,
  modelSE,
  moe,
  verdict,
  type BenchmarkStats,
  type Toggles,
  type Verdict,
} from "./model";
import { PopoverHost, popContent, type PopKind } from "./popover";
import { PowerPanel } from "./PowerPanel";
import { Toolbelt } from "./Toolbelt";
import { AboutFooter } from "./About";

/** The tour: each step flips on exactly one correction (one idea per step). */
const STEPS: { t: string; p: string; s: Toggles }[] = [
  {
    t: "The scoreboard",
    p: `Two models, three benchmarks. Bold marks the higher score. <b>Dreadnought wins 2 of 3</b> — so it's the better model, right?`,
    s: { bars: false, clust: false, pair: false },
  },
  {
    t: "Every score comes with luck",
    p: `A benchmark asks a <i>sample</i> of possible questions — like a poll samples voters. Turn on the margins of error and one "win" already wobbles: HumanEval has only 164 questions, far too few to trust a 3-point gap.`,
    s: { bars: true, clust: false, pair: false },
  },
  {
    t: "Repeated questions count less",
    p: `MGSM looks like 2,500 questions, but it's really 250 questions translated into 10 languages — and the copies succeed or fail together. Count each group once and Dreadnought's lead there stops looking real.`,
    s: { bars: true, clust: true, pair: false },
  },
  {
    t: "Compare the same test, answer by answer",
    p: `Both models took the <i>same</i> test, so grade them side by side, question by question. Luck about which questions were hard cancels out, the picture sharpens — and the verdict flips: <b>the only real win belongs to Galleon</b>.`,
    s: { bars: true, clust: true, pair: true },
  },
];

/**
 * First-visit memory: the guided tour auto-plays only the very first time
 * someone lands on the page. Any later visit — whether they finished the
 * tour, skipped it, or just closed the tab mid-step — opens straight into
 * explore mode; "Restart tour" and the "Guided demo" picker entry are always
 * there to bring it back on purpose. A cookie (not app state) so it survives
 * across visits; guarded so server-side test renders (no `document`) behave
 * as a first visit.
 */
/**
 * Every new dataset starts with the corrections off, so the naive scoreboard
 * is always the first thing you see and you build the story up one checkbox
 * at a time — the same arc the tour walks, on whatever data you brought.
 * (Shared links are exempt: they carry their own toggle state.)
 */
const NO_CORRECTIONS: Toggles = { bars: false, clust: false, pair: false };

const VISITED_COOKIE = "errorbars_visited";
const hasVisitedBefore = (): boolean =>
  typeof document !== "undefined" && document.cookie.includes(`${VISITED_COOKIE}=1`);
const rememberVisited = () => {
  document.cookie = `${VISITED_COOKIE}=1; max-age=31536000; path=/; SameSite=Lax`;
};

export function App() {
  const paper = useMemo(buildPaperDataset, []);
  const [dataset, setDataset] = useState<EvalDataset>(paper);
  const [uploadText, setUploadText] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);
  // Read (never write) during render — the actual "mark as visited" write
  // happens in an effect below, after mount, so the initial render stays a
  // pure function of existing state.
  const returning = useMemo(hasVisitedBefore, []);
  // Returning visitors start free, with every correction already on (the
  // "after" view the tour ends on) rather than replaying the story.
  const [mode, setMode] = useState<"story" | "explore">(
    returning ? "explore" : "story",
  );
  const [step, setStep] = useState(0);
  const [toggles, setToggles] = useState<Toggles>(
    returning ? { bars: true, clust: true, pair: true } : STEPS[0].s,
  );
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const dsId = dataset.id;
  const stats = useMemo(
    () => (dataset.models.length >= 2 ? computeDatasetStats(dataset) : []),
    [dataset],
  );
  const groupNotes = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const b of dataset.benchmarks) m.set(b.name, b.groupNote ?? null);
    return m;
  }, [dataset]);

  const toast = (msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3400);
  };

  const pick = (id: string) => {
    if (id === dsId) return;
    setMode("explore");
    loadBundled(id).then(
      (ds) => {
        setDataset(ds);
        setToggles(NO_CORRECTIONS);
      },
      (err: Error) => toast(`Couldn't load ${id}: ${err.message}`),
    );
  };

  const onParsed = (ds: EvalDataset, csvText: string, summary: string) => {
    setDataset(ds);
    setUploadText(csvText);
    setUploadSummary(summary);
    setMode("explore");
    setToggles(NO_CORRECTIONS);
    toast(`Parsed: ${summary}`);
  };

  // Mark this browser as having visited, so the tour won't auto-play again —
  // regardless of whether this visit finishes it, skips it, or abandons it
  // mid-step. Runs once, after the first render that already read `returning`.
  useEffect(() => {
    if (!returning) rememberVisited();
  }, []);

  // Boot: restore a shared view from the URL fragment, if present.
  useEffect(() => {
    const s = decodeShare(location.hash);
    if (!s) return;
    const t = { bars: s.bars, clust: s.clust, pair: s.pair };
    if (s.ds === "upload" && s.csv) {
      const res = parseCsv(s.csv);
      if (res.ok) {
        setDataset({ ...res.dataset, label: "shared upload" });
        setUploadText(s.csv);
        setUploadSummary("restored from a shared link");
        setMode("explore");
        setToggles(t);
      }
      return;
    }
    if (s.ds !== "paper") {
      loadBundled(s.ds).then(
        (ds) => {
          setDataset(ds);
          setMode("explore");
          setToggles(t);
        },
        () => {
          /* unknown/failed id → stay on the default view */
        },
      );
      return;
    }
    if (s.step !== undefined && s.step >= 1 && s.step <= STEPS.length) {
      setStep(s.step - 1);
      setToggles(STEPS[s.step - 1].s);
    } else {
      setMode("explore");
      setToggles(t);
    }
  }, []);

  const copyLink = () => {
    const state: ShareState = {
      ds: dsId,
      ...toggles,
      step: mode === "story" && dsId === "paper" ? step + 1 : undefined,
      csv: dsId === "upload" ? (uploadText ?? undefined) : undefined,
    };
    const res = shareableOrReason(state);
    if (!res.ok) {
      toast(res.reason);
      return;
    }
    const url = `${location.origin}${location.pathname}#${res.fragment}`;
    navigator.clipboard.writeText(url).then(
      () => toast("Link copied"),
      () => toast("Couldn't access the clipboard — copy the address bar after the page updates"),
    );
  };

  const go = (d: number) => {
    const next = step + d;
    setStep(next);
    setToggles(STEPS[next].s);
  };
  const explore = () => setMode("explore");
  const resumeTour = () => {
    setMode("story");
    setToggles(STEPS[step].s);
  };
  const restart = () => {
    setMode("story");
    setStep(0);
    setToggles(STEPS[0].s);
    if (dsId !== "paper") setDataset(paper);
  };
  const flip = (k: keyof Toggles) => {
    setToggles({ ...toggles, [k]: !toggles[k] });
    if (mode === "story") setMode("explore");
  };

  const exploring = mode === "explore" || dsId !== "paper";
  const models = dataset.models;
  const statFor = (name: string | undefined) =>
    stats.find((s) => s.name === name) ?? stats[0];

  return (
    <div class="wrap">
      <header>
        <div>
          <h1>Error Bars</h1>
          <p class="tagline">
            A benchmark score is a poll, not a fact. See which wins survive the
            margin of error.
          </p>
        </div>
        <div class="hbtns">
          <button class="btn" onClick={copyLink}>
            Copy link
          </button>
          <button class="btn" onClick={restart}>
            Restart tour
          </button>
        </div>
      </header>

      {dsId !== "paper" ? (
        <div class="story paused">
          <span>{dataset.note ?? `Viewing ${dataset.label}.`}</span>
          <button class="btn" onClick={restart}>
            Back to demo
          </button>
        </div>
      ) : mode === "story" ? (
        <div class="story">
          <h2>{STEPS[step].t}</h2>
          {/* Step copy is trusted static text defined above, not user input. */}
          <p dangerouslySetInnerHTML={{ __html: STEPS[step].p }} />
          <div class="nav">
            {step > 0 && (
              <button class="btn" onClick={() => go(-1)}>
                Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button class="btn primary" onClick={() => go(1)}>
                Next
              </button>
            ) : (
              <button class="btn primary" onClick={explore}>
                Explore on your own →
              </button>
            )}
            <button class="btn ghost" onClick={explore}>
              Skip tour
            </button>
            <div class="dots">
              {STEPS.map((_, i) => (
                <span class={`dot ${i === step ? "on" : ""}`} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div class="story paused">
          <span>
            You're exploring freely — click any dashed value to see why it is
            what it is.
          </span>
          <button class="btn" onClick={resumeTour}>
            Resume tour
          </button>
        </div>
      )}

      <div class="controls">
        <label class={toggles.bars ? "on" : ""}>
          <input type="checkbox" checked={toggles.bars} onChange={() => flip("bars")} />{" "}
          Margins of error
        </label>
        <label class={toggles.clust ? "on" : ""}>
          <input type="checkbox" checked={toggles.clust} onChange={() => flip("clust")} />{" "}
          Count grouped questions once
        </label>
        <label class={toggles.pair ? "on" : ""}>
          <input type="checkbox" checked={toggles.pair} onChange={() => flip("pair")} />{" "}
          Compare question-by-question
        </label>
        {dsId !== "paper" && <span class="chip">viewing: {dataset.label}</span>}
      </div>

      {models.length >= 2 ? (
        <>
          <p
            class="claim"
            dangerouslySetInnerHTML={{ __html: claim(stats, models, toggles) }}
          />
          <div class="card">
            <table>
              <thead>
                <tr>
                  <th>Benchmark</th>
                  <th>Questions</th>
                  <th class="mG">{models[0]}</th>
                  <th class="mD">{models[1]}</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <ScoreRow
                    s={s}
                    t={toggles}
                    models={[models[0], models[1]]}
                    hasClusters={s.nClusters !== null}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {toggles.bars && (
            <section>
              <details open={exploring || step >= 3}>
                <summary>
                  The gaps, up close{" "}
                  <span class="hint">
                    {gapsHint(
                      toggles,
                      stats.some((s) => s.nClusters !== null),
                    )}
                  </span>
                </summary>
                <div class="body">
                  <p class="sub">
                    Each bar is the plausible range for the true gap between
                    the models. If a bar touches the zero line, the "lead"
                    could just be luck in which questions were asked.
                  </p>
                  {stats.map((s) => (
                    <GapRow
                      s={s}
                      t={toggles}
                      models={[models[0], models[1]]}
                      hasClusters={s.nClusters !== null}
                    />
                  ))}
                </div>
              </details>
            </section>
          )}
        </>
      ) : (
        <SingleModelView dataset={dataset} />
      )}

      {exploring && (
        <section id="toolbelt">
          <Toolbelt
            currentId={dsId}
            uploadLabel={dsId === "upload" ? dataset.label : null}
            uploadSummary={uploadSummary}
            onPick={pick}
            onParsed={onParsed}
          />
          <PowerPanel />
        </section>
      )}

      <AboutFooter />

      <PopoverHost
        resolve={(kind, evName) =>
          popContent(
            kind as PopKind,
            statFor(evName),
            toggles,
            groupNotes.get(evName ?? "") ?? null,
          )
        }
      />

      <div class={`toast ${toastMsg ? "show" : ""}`} role="status">
        {toastMsg}
      </div>
    </div>
  );
}

/** Margins-only table for single-model uploads (comparison needs two). */
function SingleModelView({ dataset }: { dataset: EvalDataset }) {
  const model = dataset.models[0];
  return (
    <>
      <p class="claim">
        Margins only — <b>add a second model</b> to unlock comparisons.
      </p>
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Benchmark</th>
              <th>Questions</th>
              <th class="mG">{model}</th>
            </tr>
          </thead>
          <tbody>
            {dataset.benchmarks.map((b) => {
              const scores = b.scores[model];
              const mean =
                (scores.reduce((a, x) => a + x, 0) / scores.length) * 100;
              return (
                <tr>
                  <td>{b.name}</td>
                  <td class="num">{b.itemIds.length.toLocaleString()}</td>
                  <td class="num mG">{fmt(mean)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function VerdictBadge({
  v,
  s,
  models,
}: {
  v: Verdict;
  s: BenchmarkStats;
  models: [string, string];
}) {
  // key = verdict: a flipped verdict remounts the badge and replays the
  // highlight, so the moment a margin crosses the gap is unmissable.
  if (v === "sigA")
    return (
      <button key="sigA" class="badge sigG reflash" data-pop="verdict" data-ev={s.name}>
        {models[0]} leads — real ✓
      </button>
    );
  if (v === "sigB")
    return (
      <button key="sigB" class="badge sigD reflash" data-pop="verdict" data-ev={s.name}>
        {models[1]} leads — real ✓
      </button>
    );
  return (
    <button key="noise" class="badge noise reflash" data-pop="verdict" data-ev={s.name}>
      too close to call
    </button>
  );
}

function ScoreRow({
  s,
  t,
  models,
  hasClusters,
}: {
  s: BenchmarkStats;
  t: Toggles;
  models: [string, string];
  hasClusters: boolean;
}) {
  const v = verdict(s, t);
  // Scores are shown bare. Each model's own margin answers "how precisely do
  // we know this model's absolute score?", which is NOT what the verdict
  // reads — putting it beside the score invites comparing the two ranges by
  // eye, the scoreboard-to-scoreboard reading the paper warns against (§5).
  // The margin that governs the verdict is the gap's, shown with it below;
  // per-model margins live one tier down, in the gaps panel.
  const cell = (which: "A" | "B", cls: string) => {
    const val = which === "A" ? s.meanA : s.meanB;
    const isWinner = !t.bars && (which === "A") === (s.gap > 0);
    return (
      <td class={`num ${cls} ${isWinner ? "winner" : ""}`}>{fmt(val)}%</td>
    );
  };
  return (
    <tr>
      <td>{s.name}</td>
      <td class="num">
        {t.clust && hasClusters ? (
          <span
            key="groups"
            class="pm reflash"
            role="button"
            tabIndex={0}
            data-pop="clusters"
            data-ev={s.name}
          >
            {(s.nClusters ?? 0).toLocaleString()} groups
          </span>
        ) : (
          s.n.toLocaleString()
        )}
      </td>
      {cell("A", "mG")}
      {cell("B", "mD")}
      <td>
        {t.bars ? (
          <>
            <VerdictBadge v={v} s={s} models={models} />
            {/* the gap and its margin sit with the verdict because this is
                the evidence the verdict is actually read from */}
            <div class="gapline">
              gap {s.gap > 0 ? "+" : ""}
              {fmt(s.gap)}{" "}
              <span
                key={`gl-${fmt(moe(gapSE(s, t)))}`}
                class="pm reflash"
                role="button"
                tabIndex={0}
                data-pop={t.pair ? "seP" : "seU"}
                data-ev={s.name}
              >
                ± {fmt(moe(gapSE(s, t)))}
              </span>
            </div>
          </>
        ) : (
          <span class={s.gap > 0 ? "mG" : "mD"} style={{ fontSize: "13px" }}>
            {s.gap > 0 ? models[0] : models[1]} by {fmt(Math.abs(s.gap))}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * One row of the "gaps, up close" panel: the gap and its margin, the interval
 * graphic, the verdict — plus each model's own margin on a second line.
 *
 * This is the only place per-model margins appear. They belong here rather
 * than in the leaderboard for two reasons: the paper's first recommendation
 * is to report a margin with every score, and "this score is only good to
 * ±6" is the most vivid evidence of clustering; but read beside the gap they
 * invite the overlapping-ranges fallacy, so they sit in the detail tier,
 * explicitly labelled as standalone, where both magnitudes can be compared
 * deliberately instead of accidentally.
 */
function GapRow({
  s,
  t,
  models,
  hasClusters,
}: {
  s: BenchmarkStats;
  t: Toggles;
  models: [string, string];
  hasClusters: boolean;
}) {
  const half = moe(gapSE(s, t));
  const v = verdict(s, t);
  const popKind = t.clust && hasClusters ? "moeC" : "moe";
  const own = (which: "A" | "B", cls: string) => (
    <span class={cls}>
      {which === "A" ? models[0] : models[1]}{" "}
      {fmt(which === "A" ? s.meanA : s.meanB)}
      {" "}
      <span
        key={`own-${which}-${fmt(moe(modelSE(s, which, t)))}`}
        class="pm reflash"
        role="button"
        tabIndex={0}
        data-pop={popKind}
        data-ev={s.name}
      >
        ± {fmt(moe(modelSE(s, which, t)))}
      </span>
    </span>
  );
  return (
    <div class="cmprow">
      <div>
        <div class="name">{s.name}</div>
        <div class="meta">
          {s.gap > 0 ? "+" : ""}
          {fmt(s.gap)}{" "}
          {/* keyed like the table margins: replays the highlight when a
              toggle changes this gap's margin */}
          <span
            key={`g-${fmt(half)}`}
            class="pm reflash"
            role="button"
            tabIndex={0}
            data-pop={t.pair ? "seP" : "seU"}
            data-ev={s.name}
          >
            ± {fmt(half)}
          </span>
        </div>
      </div>
      <GapSvg diff={s.gap} half={half} v={v} />
      <div>
        <VerdictBadge v={v} s={s} models={models} />
      </div>
      <div class="alone">
        each score on its own: {own("A", "mG")} · {own("B", "mD")}
      </div>
    </div>
  );
}

/**
 * The interval graphic: a horizontal 95% range around the gap, centered on a
 * zero line. Color = the leading model when the range clears zero, grey when
 * it doesn't (uncertainty encoded in form as well as color).
 */
function GapSvg({ diff, half, v }: { diff: number; half: number; v: Verdict }) {
  const W = 300;
  const H = 44;
  const mid = W / 2;
  const sc = 12; // px per score point; ±11.5 pts visible
  const x = (d: number) => mid + Math.max(-11.5, Math.min(11.5, d)) * sc;
  const col =
    v === "sigA" ? "var(--g)" : v === "sigB" ? "var(--d)" : "#94a3b8";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <line x1={mid} y1={4} x2={mid} y2={H - 12} stroke="#e2e8f0" stroke-width={1.5} />
      <text x={mid} y={H - 1} font-size={9} fill="#94a3b8" text-anchor="middle">
        0
      </text>
      <line
        x1={x(diff - half)}
        y1={H / 2 - 6}
        x2={x(diff + half)}
        y2={H / 2 - 6}
        stroke={col}
        stroke-width={2.5}
        stroke-linecap="round"
      />
      <line x1={x(diff - half)} y1={H / 2 - 12} x2={x(diff - half)} y2={H / 2} stroke={col} stroke-width={2} />
      <line x1={x(diff + half)} y1={H / 2 - 12} x2={x(diff + half)} y2={H / 2} stroke={col} stroke-width={2} />
      <circle cx={x(diff)} cy={H / 2 - 6} r={4.5} fill={col} />
    </svg>
  );
}
