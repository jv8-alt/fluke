/**
 * The app shell for the guided demo (Deliverable slice 1): a four-step story
 * that walks the paper's corrections over a live leaderboard, then frees the
 * user to flip the corrections themselves. Structure and copy follow the
 * approved mockup (mockup/index.html); every number is computed at load time
 * from the paper-mode dataset via src/stats — nothing on screen is hardcoded.
 *
 * Slice 2 adds, at the convergence node: dataset picker, CSV upload, URL
 * loading, share links, the power panel, and the About section.
 */
import { useMemo, useState } from "preact/hooks";
import "./app.css";
import { buildPaperDataset } from "../data/papermode";
import {
  claim,
  computeDatasetStats,
  fmt,
  gapSE,
  modelSE,
  moe,
  verdict,
  type BenchmarkStats,
  type Toggles,
  type Verdict,
} from "./model";
import { PopoverHost, popContent, type PopKind } from "./popover";

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

export function App() {
  // Dataset + derived stats are static for slice 1 (paper mode only).
  const ds = useMemo(buildPaperDataset, []);
  const stats = useMemo(() => computeDatasetStats(ds), [ds]);
  const groupNotes = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const b of ds.benchmarks) m.set(b.name, b.groupNote ?? null);
    return m;
  }, [ds]);

  const [mode, setMode] = useState<"story" | "explore">("story");
  const [step, setStep] = useState(0);
  const [toggles, setToggles] = useState<Toggles>(STEPS[0].s);

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
  };
  const flip = (k: keyof Toggles) => {
    setToggles({ ...toggles, [k]: !toggles[k] });
    if (mode === "story") setMode("explore");
  };

  const [A, B] = ds.models;
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
          <button class="btn" onClick={restart}>
            Restart tour
          </button>
        </div>
      </header>

      {mode === "story" ? (
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
          <input
            type="checkbox"
            checked={toggles.bars}
            onChange={() => flip("bars")}
          />{" "}
          Margins of error
        </label>
        <label class={toggles.clust ? "on" : ""}>
          <input
            type="checkbox"
            checked={toggles.clust}
            onChange={() => flip("clust")}
          />{" "}
          Count grouped questions once
        </label>
        <label class={toggles.pair ? "on" : ""}>
          <input
            type="checkbox"
            checked={toggles.pair}
            onChange={() => flip("pair")}
          />{" "}
          Compare question-by-question
        </label>
      </div>

      <p
        class="claim"
        dangerouslySetInnerHTML={{ __html: claim(stats, ds.models, toggles) }}
      />

      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Benchmark</th>
              <th>Questions</th>
              <th class="mG">{A}</th>
              <th class="mD">{B}</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <ScoreRow
                s={s}
                t={toggles}
                models={[A, B]}
                hasClusters={s.nClusters !== null}
              />
            ))}
          </tbody>
        </table>
      </div>

      {toggles.bars && (
        <section>
          <details open={mode === "explore" || step >= 3}>
            <summary>
              The gaps, up close{" "}
              <span class="hint">
                {toggles.pair
                  ? "comparing question-by-question"
                  : "comparing overall scores"}
              </span>
            </summary>
            <div class="body">
              <p class="sub">
                Each bar is the plausible range for the true gap between the
                models. If a bar touches the zero line, the "lead" could just be
                luck in which questions were asked.
              </p>
              {stats.map((s) => (
                <GapRow s={s} t={toggles} models={[A, B]} />
              ))}
            </div>
          </details>
        </section>
      )}

      <footer>
        <div class="fline">
          Based on Miller,{" "}
          <a href="https://arxiv.org/abs/2411.00640">
            <i>Adding Error Bars to Evals</i>
          </a>{" "}
          (Anthropic, 2024). Click any dashed value for the formula behind it.
        </div>
      </footer>

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
    </div>
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
  if (v === "sigA")
    return (
      <button class="badge sigG" data-pop="verdict" data-ev={s.name}>
        {models[0]} leads — real ✓
      </button>
    );
  if (v === "sigB")
    return (
      <button class="badge sigD" data-pop="verdict" data-ev={s.name}>
        {models[1]} leads — real ✓
      </button>
    );
  return (
    <button class="badge noise" data-pop="verdict" data-ev={s.name}>
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
  const cell = (which: "A" | "B", cls: string) => {
    const val = which === "A" ? s.meanA : s.meanB;
    const isWinner = !t.bars && (which === "A") === (s.gap > 0);
    return (
      <td class={`num ${cls} ${isWinner ? "winner" : ""}`}>
        {fmt(val)}%
        {t.bars && (
          <>
            {" "}
            <span
              class="pm"
              role="button"
              tabIndex={0}
              data-pop={t.clust && hasClusters ? "moeC" : "moe"}
              data-ev={s.name}
            >
              ± {fmt(moe(modelSE(s, which, t)))}
            </span>
          </>
        )}
      </td>
    );
  };
  return (
    <tr>
      <td>{s.name}</td>
      <td class="num">
        {t.clust && hasClusters ? (
          <span
            class="pm"
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
          <VerdictBadge v={v} s={s} models={models} />
        ) : (
          <span class={s.gap > 0 ? "mG" : "mD"} style={{ fontSize: "13px" }}>
            {s.gap > 0 ? models[0] : models[1]} by {fmt(Math.abs(s.gap))}
          </span>
        )}
      </td>
    </tr>
  );
}

/** One row of the "gaps, up close" panel: number, interval SVG, verdict. */
function GapRow({
  s,
  t,
  models,
}: {
  s: BenchmarkStats;
  t: Toggles;
  models: [string, string];
}) {
  const half = moe(gapSE(s, t));
  const v = verdict(s, t);
  return (
    <div class="cmprow">
      <div>
        <div class="name">{s.name}</div>
        <div class="meta">
          {s.gap > 0 ? "+" : ""}
          {fmt(s.gap)}{" "}
          <span
            class="pm"
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
