/**
 * PowerPanel — "How big must an eval be?" (paper §5, Eq. 9–10).
 *
 * The panel answers the planning question most leaderboard readers never
 * ask: before trusting a scoreboard, check whether the eval is even large
 * enough to SEE the gap being claimed. The user picks the smallest gap they
 * care about plus how strict they want the statistics to be, and the panel
 * reports how many questions that resolution costs.
 *
 * All statistics live in ../stats (T2 trunk); this file only maps slider
 * positions to the parameters of `questionsNeeded` and renders the result.
 * The pure mapping is exported separately as `powerReadout` so it can be
 * unit-tested without any DOM and reused by the convergence node (B2),
 * which will re-mount this panel and eventually feed it variances estimated
 * from whatever dataset the user has loaded.
 */
import { useState } from "preact/hooks";
import { questionsNeeded } from "../stats";
import "./powerpanel.css";

/**
 * The discrete stops the two "strictness" sliders offer. Kept as arrays
 * (not free numeric inputs) because ../stats's z-score lookup supports
 * exactly these values — and because α/power are genuinely a policy choice
 * among conventional levels, not a continuum users should fine-tune.
 */
export const ALPHAS = [0.01, 0.05, 0.1] as const;
export const POWERS = [0.8, 0.9] as const;

/**
 * The paper's illustrative variance components, used until a real dataset
 * is loaded (matches the mockup's constants):
 *
 * - ω² = 1/9 — QUESTION luck: variance of per-question mean score
 *   differences. This is what "ask more questions" fights; nothing else
 *   shrinks it.
 * - σ² = 1/6 per model — ANSWER luck: run-to-run randomness on the same
 *   question. Shrinks as σ²/K when each question is asked K times, and
 *   vanishes entirely under next-token-probability grading.
 *
 * The mockup wrote the answer-luck term as 2·σ²/K with one shared σ²; we
 * pass σ²_A = σ²_B = 1/6 to `questionsNeeded`, which is algebraically the
 * same thing (σ²_A/K + σ²_B/K = 2·σ²/K when the σ²s are equal) while
 * keeping the door open for per-model estimates later.
 */
export const ILLUSTRATIVE = {
  omega2: 1 / 9,
  sigma2A: 1 / 6,
  sigma2B: 1 / 6,
} as const;

/** Dataset-estimated variance components, supplied by B2 at convergence. */
export interface PowerVariances {
  /** question-luck variance ω² of the paired per-question differences */
  omega2: number;
  /** answer-luck variance σ² for each model (may differ) */
  sigma2A: number;
  sigma2B: number;
}

export interface PowerReadoutParams {
  /** smallest gap that matters, in percentage points (slider: 1–10) */
  mdePts: number;
  /** times each question is asked (slider: 1–10) */
  K: number;
  /** index into ALPHAS — tolerance for false alarms (1% / 5% / 10%) */
  alphaIdx: 0 | 1 | 2;
  /** index into POWERS — chance of catching a real gap (80% / 90%) */
  powerIdx: 0 | 1;
  /** grade by the model's own answer probabilities (kills answer luck) */
  ntp: boolean;
  /** dataset-estimated variances; null/undefined → paper's illustrative */
  variances?: PowerVariances | null;
}

export interface PowerReadout {
  /** questions needed (integer, from `questionsNeeded`) */
  n: number;
  /** echo of the requested gap, for the readout sentence */
  mdePts: number;
  /** α as a whole percentage (1, 5, or 10) for display */
  alphaPct: number;
  /** power as a whole percentage (80 or 90) for display */
  powerPct: number;
}

/**
 * Pure slider-state → readout mapping. Everything the panel displays comes
 * from this one function, so testing it tests the panel's arithmetic.
 *
 * Why ntp zeroes σ² even when dataset variances are provided: next-token-
 * probability grading reads the probability the model assigns to the right
 * answer instead of sampling an answer and grading it. That eliminates the
 * answer-luck component BY CONSTRUCTION — regardless of how much answer
 * luck the dataset's sampled answers exhibited. Question luck (ω²) remains
 * untouched; no grading trick can fix which questions were asked.
 */
export function powerReadout(p: PowerReadoutParams): PowerReadout {
  const v = p.variances ?? ILLUSTRATIVE;
  const n = questionsNeeded({
    // Sliders speak percentage points (a "3-point gap"); the stats core
    // speaks score units in [0,1]. Convert exactly once, here.
    delta: p.mdePts / 100,
    alpha: ALPHAS[p.alphaIdx],
    power: POWERS[p.powerIdx],
    omega2: v.omega2,
    sigma2A: p.ntp ? 0 : v.sigma2A,
    sigma2B: p.ntp ? 0 : v.sigma2B,
    K: p.K,
  });
  return {
    n,
    mdePts: p.mdePts,
    alphaPct: Math.round(ALPHAS[p.alphaIdx] * 100),
    powerPct: Math.round(POWERS[p.powerIdx] * 100),
  };
}

/**
 * The collapsed panel itself. Sits below the dataset tools as a
 * self-contained <details>; the shell classes (summary/.hint/.body/.sub)
 * are styled globally by the app stylesheet — this file only ships the
 * panel-specific .pgrid/.pout/.val/.fine rules.
 *
 * The `what's this?` / `assumptions` spans carry the app-wide popover
 * contract (`class="pm" data-pop="…"`): a global click handler owned by
 * the popover host turns them into formula + citation popovers. This
 * component only renders the trigger attributes.
 */
export function PowerPanel({
  variances,
}: {
  variances?: PowerVariances | null;
}) {
  // Slider state. Defaults mirror the mockup: 3-point gap, ask once,
  // α = 5%, power = 80%, sampled-answer grading. These defaults are chosen
  // so the panel opens on the paper's flagship worked example (§5.3):
  // ticking the probability-grading box immediately shows ≈ 969.
  const [mdePts, setMdePts] = useState(3);
  const [K, setK] = useState(1);
  const [alphaIdx, setAlphaIdx] = useState<0 | 1 | 2>(1);
  const [powerIdx, setPowerIdx] = useState<0 | 1>(0);
  const [ntp, setNtp] = useState(false);

  const out = powerReadout({ mdePts, K, alphaIdx, powerIdx, ntp, variances });

  return (
    <details id="powerbox">
      <summary>
        How big must an eval be?{" "}
        <span class="hint">find out before trusting a scoreboard</span>
      </summary>
      <div class="body">
        <p class="sub">
          Every eval has a smallest gap it can reliably tell apart from luck.
          Set the gap you care about and see how many questions that takes.
        </p>
        <div class="pgrid">
          {/*
            MDE slider — the "resolution" knob. Halving the gap you want to
            see quadruples the questions needed (n ∝ 1/δ²), which is the
            single most surprising fact this panel teaches; a slider makes
            that quadratic blow-up tangible in a way a formula never is.
          */}
          <label>
            Smallest gap that matters to you{" "}
            <span class="val">{mdePts.toFixed(1)} pts</span>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={mdePts}
              onInput={(e) => setMdePts(Number(e.currentTarget.value))}
            />
          </label>
          {/*
            K slider — resampling. Asking each question K times divides
            only the answer-luck term (σ²/K); question luck ω² is immune.
            Watching n flatten as K grows is the paper's Recommendation #3
            in interactive form: repeats help, but only down to the
            question-luck floor.
          */}
          <label>
            Times each question is asked <span class="val">{K}×</span>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={K}
              onInput={(e) => setK(Number(e.currentTarget.value))}
            />
          </label>
          {/*
            α slider — false-alarm tolerance. Demanding fewer false "model
            A beat model B!" headlines (smaller α) raises the critical
            value and thus the question bill. Three conventional stops.
          */}
          <label>
            Tolerance for false alarms{" "}
            <span class="val">{Math.round(ALPHAS[alphaIdx] * 100)}%</span>
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={alphaIdx}
              onInput={(e) =>
                setAlphaIdx(Number(e.currentTarget.value) as 0 | 1 | 2)
              }
            />
          </label>
          {/*
            Power slider — the chance a real gap of the chosen size is
            actually flagged. 80% is the scientific default; 90% costs
            noticeably more questions because z_β jumps from 0.84 to 1.28.
          */}
          <label>
            Chance of catching a real gap{" "}
            <span class="val">{Math.round(POWERS[powerIdx] * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={1}
              value={powerIdx}
              onInput={(e) =>
                setPowerIdx(Number(e.currentTarget.value) as 0 | 1)
              }
            />
          </label>
          {/*
            Next-token-probability grading — sets σ² = 0 outright, the one
            legitimate way to erase answer luck (paper §3.3). The popover
            behind "what's this?" carries the crucial caveat that lowering
            temperature is NOT a substitute.
          */}
          <label style={{ gridColumn: "1/-1" }}>
            <input
              type="checkbox"
              checked={ntp}
              onChange={(e) => setNtp(e.currentTarget.checked)}
            />{" "}
            Grade by the model’s own answer probabilities{" "}
            <span class="pm" data-pop="ntp">
              what’s this?
            </span>
          </label>
          <div class="pout">
            <b>≈ {out.n.toLocaleString()}</b> questions needed to reliably spot
            a {out.mdePts.toFixed(1)}-point gap.
            <br />
            <span class="fine">
              Anything smaller than that on a smaller eval is unreadable — win
              or lose.{" "}
              <span class="pm" data-pop="power">
                assumptions
              </span>
            </span>
          </div>
        </div>
      </div>
    </details>
  );
}
