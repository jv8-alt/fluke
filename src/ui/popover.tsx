/**
 * The drill-in popovers: plain language first, exact formula + paper citation
 * underneath. Any element rendered with a `data-pop` attribute becomes a
 * trigger; one delegated document listener positions the single active
 * popover under it (same behavior as the approved mockup).
 */
import { useEffect, useState } from "preact/hooks";
import { fmt, gapSE, moe, type BenchmarkStats, type Toggles } from "./model";

/** Miller, "Adding Error Bars to Evals" — every popover cites a section of it. */
const PAPER_URL = "https://arxiv.org/abs/2411.00640";

export type PopKind =
  | "moe"
  | "moeC"
  | "seU"
  | "seP"
  | "verdict"
  | "clusters"
  | "ntp"
  | "power";

interface PopContent {
  title: string;
  body: string;
  eq: string;
  cite: string;
}

/**
 * Content builders. Every number shown is computed from the live dataset —
 * the popover is the "show your work" layer, so it must agree with the table.
 */
export function popContent(
  kind: PopKind,
  s: BenchmarkStats,
  t: Toggles,
  groupNote: string | null,
): PopContent {
  switch (kind) {
    case "moe":
      return {
        title: `Margin of error — ${s.name}`,
        body:
          `This score is an average over ${s.n.toLocaleString()} sampled questions. ` +
          `A different sample of questions would give a slightly different score; ` +
          `± ${fmt(moe(s.seNA))} is the range that covers that luck 95 times out of 100.`,
        eq: `SE = √( s̄(1−s̄) / n ) = ${fmt(s.seNA, 2)} · margin = 1.96 × SE`,
        cite: "Paper §2.1, Eq. 1–3",
      };
    case "moeC":
      return {
        title: `Margin of error, groups counted once — ${s.name}`,
        body:
          `${groupNote ?? "Related questions"} succeed or fail together, so they carry less ` +
          `independent information than their row count suggests. Counting each group once ` +
          `widens the honest margin from ± ${fmt(moe(s.seNA))} to ± ${fmt(moe(s.seCA))}.`,
        eq: `SE²(grouped) = SE²(plain) + within-group covariance terms`,
        cite: "Paper §2.2, Eq. 4",
      };
    case "seU":
      return {
        title: `Gap margin (overall scores) — ${s.name}`,
        body:
          `Treats the two scores as unrelated measurements and adds their uncertainties. ` +
          `Valid — but wasteful when both models answered the very same questions.`,
        eq: `SE(gap) = √( SE²A + SE²B )`,
        cite: "Paper §4.1, Eq. 5",
      };
    case "seP":
      return {
        title: `Gap margin (question-by-question) — ${s.name}`,
        body:
          `Score the gap per question, then average. Whatever made a question hard for both ` +
          `models cancels out, so the margin shrinks — for free. It works because the models ` +
          `agree on which questions are hard (agreement here: ${fmt(s.corr, 2)}).`,
        eq: `SE(gap) = √( Var(sA − sB) / n )`,
        cite: "Paper §4.2, Eq. 7–8",
      };
    case "verdict": {
      const half = moe(gapSE(s, t));
      const lo = s.gap - half;
      const hi = s.gap + half;
      const isNoise = lo <= 0 && hi >= 0;
      return {
        title: `Why this verdict — ${s.name}`,
        body:
          `The plausible range for the true gap is ${fmt(lo)} to ${fmt(hi)}. ` +
          (isNoise
            ? `That range includes zero — so the lead could be luck about which questions were asked.`
            : `Zero isn't in that range — the lead is bigger than question luck can explain.`),
        eq: `real ⇔ 95% range excludes 0`,
        cite: "Paper §4, Eq. 3 & 5",
      };
    }
    case "clusters":
      return {
        title: `Question groups — ${s.name}`,
        body:
          `${s.n.toLocaleString()} rows, but they come in ${(s.nClusters ?? 0).toLocaleString()} ` +
          `groups — ${groupNote ?? "related questions"}. Questions in a group succeed or fail ` +
          `together, so groups, not rows, are the real unit of evidence.`,
        eq: `n(effective) ≪ n(rows)`,
        cite: "Paper §2.2",
      };
    // The two power-panel drill-ins are dataset-independent (the P branch
    // renders their triggers; the copy lives here with the other popovers).
    case "ntp":
      return {
        title: `Grading by answer probabilities`,
        body:
          `Instead of sampling an answer and grading it (which adds coin-flip luck), read how ` +
          `much probability the model itself puts on the right answer. Same question, zero ` +
          `answer luck. Only works when there's no chain of thought. Lowering temperature is ` +
          `NOT a substitute — that changes the model being measured.`,
        eq: `score = P(correct token) ⇒ answer-luck term σ² = 0`,
        cite: "Paper §3.2–3.3",
      };
    case "power":
      return {
        title: `Assumptions behind this estimate`,
        body:
          `Uses the paper's illustrative variance numbers for a question-by-question comparison ` +
          `of two similar models. Estimating these terms from the dataset you have loaded needs ` +
          `per-question repeats (the sample_k column) — a documented follow-up.`,
        eq: `n = (zα/2 + zβ)² (ω² + σ²A/K + σ²B/K) / δ²`,
        cite: "Paper §5, Eq. 9–10",
      };
  }
}

interface ActivePop {
  content: PopContent;
  left: number;
  top: number;
}

/**
 * Popover host: delegated click handling on [data-pop] triggers.
 * `resolve` maps a trigger's dataset attributes to content (the app knows the
 * current stats/toggles; this component only handles placement/lifecycle).
 */
export function PopoverHost({
  resolve,
}: {
  resolve: (kind: string, evName: string | undefined) => PopContent | null;
}) {
  const [pop, setPop] = useState<ActivePop | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-pop]");
      if (!t) {
        setPop(null);
        return;
      }
      const content = resolve(t.dataset.pop!, t.dataset.ev);
      if (!content) {
        setPop(null);
        return;
      }
      const r = t.getBoundingClientRect();
      setPop({
        content,
        left: Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - 360),
        top: window.scrollY + r.bottom + 8,
      });
      // Suppress the click's default action as well as its propagation. A
      // trigger placed inside a <label> would otherwise activate that label,
      // which forwards a click to the labelled control — toggling it and
      // firing a second, non-trigger click that closes this popover again.
      // Triggers are spans and plain buttons, so nothing else relies on a
      // default action here.
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [resolve]);

  if (!pop) return null;
  return (
    <div class="pop" style={{ left: `${pop.left}px`, top: `${pop.top}px` }}>
      <b>{pop.content.title}</b>
      <div style={{ marginTop: "6px" }}>{pop.content.body}</div>
      <div class="eq">{pop.content.eq}</div>
      {/* The citation is the "never a dead end for experts" exit: it names the
          section and opens the paper itself, in a new tab so the reader
          doesn't lose the view they were interrogating. */}
      <div class="cite">
        <a href={PAPER_URL} target="_blank" rel="noreferrer noopener">
          {pop.content.cite} · arXiv:2411.00640
        </a>
      </div>
    </div>
  );
}
