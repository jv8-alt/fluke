# Design rationale

*Companion to the [README](../README.md). Live app:
https://jv8-alt.github.io/fluke/ · Method: Miller,
[Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640) (Anthropic, 2024).*

## Why this theme, why this approach

This project sits deliberately on two of the assignment's themes at once:
**Exploration & Understanding** (making a genuinely hard technical idea —
sampling error, clustering, paired comparison, statistical power — graspable
without equations) and **Evaluation & Data Quality** (the idea being explained
is itself the foundation of trustworthy model evaluation).

The seed was a recurring, practical annoyance: every model release ships a
benchmark table, and it is genuinely unclear whether 87.5% vs 85.2% means
anything. Miller's paper answers that question rigorously — but as a paper,
full of estimator algebra, read mostly by people who already believed its
conclusion. Meanwhile the machinery already exists as Python libraries
(`evalci`, `evalstats`, Inspect AI's `stderr()`, Every Eval Ever). **The gap
was never the statistics; it was the missing front-end.** So the approach is
adoption, not invention: a zero-install page where the paper's corrections are
three checkboxes over a live leaderboard, and the reviewer's own eyes watch a
verdict flip. Prior art is cited in-app; our claim is the experience, not the
math.

## What makes it interesting / non-obvious

**The verdict is the interface.** Scores get margins, but the headline object
is the *verdict* — "real ✓" vs "too close to call" — because that's what
leaderboard readers actually consume. The whole app is engineered so the user
watches verdicts change while means stay identical: the same numbers, read
honestly, reverse the story. The claim line above the table re-derives the
one-sentence takeaway on every toggle.

**Reconstructing data the paper never published.** The guided tour reproduces
the paper's worked example (fictional models Galleon vs Dreadnought), but the
paper only publishes summary statistics — and the demo computes everything
from per-question data through our own estimators. So paper mode is
*synthesized*: MATH and HumanEval are built deterministically from 2×2
agreement counts derived by hand (both-right / only-A / only-B / both-wrong
fully determine every paired statistic), and MGSM — which needs cluster
structure — comes from a seeded generator with three independently tunable
noise sources (shared problem difficulty, per-model problem strength, shared
item luck), each calibrated against one published statistic. A tolerance test
suite pins the reproduction, including the headline: naive scoreboard 2-of-3
one way, honest stats leave exactly one real win the other way. One honest
wrinkle, documented in-app: the paper's fictional numbers aren't all *jointly*
achievable with binary scores (a [0,1] score with mean 83.6% caps its SE below
the stated 3.2), so correlations carry a looser tolerance than means and SEs.

**Real data turned out to tell better stories than the fiction.** Three
findings from wiring real archive logs in, all preserved deliberately:

1. *MMLU clustering is enormous.* Treated as 14,042 independent questions,
   margins are ±1.2pp; counted as 57 subjects, ±8pp — because models genuinely
   differ subject by subject. Textbook-sized clustering corrections (the
   paper's "2–3×") are the mild case.
2. *A fine-tune vs its base is the perfect flip demo.* `vicuna-13b-v1.5` vs
   `Llama-2-13b-hf` (2.1pp apart) flips **real → too close → real** as the
   corrections stack: clustering honestly destroys the naive verdict, then
   question-by-question pairing — devastatingly effective between sibling
   models, whose per-question scores correlate heavily — earns it back. Found
   by an automated scan (`scripts/find_close_pair.py`); the scan also showed
   *every* 2–7pp MMLU pair double-flips, so this isn't a cherry-pick, it's the
   norm.
3. *The DROP dataset is a broken eval, on purpose.* Its ~6.5% scores are the
   real 2023 harness answer-parsing bug that got DROP pulled from the
   leaderboard. We kept it: "check the eval before trusting its scoreboard" is
   the paper's fifth recommendation, and here it is in the wild.

**Designing away the overlapping-error-bars fallacy.** The most common
misreading in the field is to put a margin on each model's score, see the two
ranges overlap, and conclude there's no real difference. The close-race
dataset is exactly that trap: vicuna at 55.7% and Llama-2-13b at 53.6% carry
margins of ±5.9 and ±5.6 that overlap almost entirely, yet the 2.1-point gap
between them is solid. Both facts are true — each model's *absolute* score
really is that soft, because models are wildly uneven across subjects
(28–85% here) so which subjects the benchmark covers swings the headline
number; but that subject lottery lifts and drops both models together (their
per-subject scores correlate at 0.97), so it cancels out of the difference.
We first tried to *explain* the tension in place, annotating each score with
how much of its swing cancels. It added noise and confused more than it
taught. The fix that worked was structural: **the leaderboard shows bare
scores and, beside the verdict, only the gap and the gap's margin** — the
evidence the verdict is actually read from. Per-model margins move one tier
down into the gaps panel, explicitly labelled "each score on its own", where
the two magnitudes can be compared deliberately rather than collided with
accidentally. This also puts the app in line with the paper's own fourth
recommendation: the scoreboard-to-scoreboard comparison is the mistake, and a
± hanging off each score is an invitation to make it.

**One pipeline for all data.** Bundled snapshots, dropped CSVs, and
URL-fetched CSVs all flow through the same parser into the same stats — so the
demo is also a real tool: any eval with per-question scores gets the same
treatment, and any view (including an uploaded dataset) is shareable as a URL.

**Progressive disclosure as a hard rule.** Default-visible text contains no
statistics vocabulary — "margin of error," "could just be luck," "too close to
call," the paper's own poll-and-households analogies. Every simplified claim
carries a dashed drill-in whose popover gives the plain-language mechanism,
the exact formula, and the paper section (§, Eq.) it implements. Experts can
audit every number; nobody else ever has to see a σ.

## Key design decisions & tradeoffs

- **Fully static, no backend.** The original sketch included a small
  upload/storage API; we cut it for scope and honesty — the stats run
  client-side anyway. Sharing works by encoding state (and even the uploaded
  CSV itself, size-guarded) into the URL fragment. Tradeoff: very large
  uploads can't be shared as links (the app says so and suggests sharing the
  file); a storage backend can be added later behind the same load-a-dataset
  seam.
- **Stats as pure, zero-dependency functions with hand-computed tests.** Every
  estimator lives in `src/stats/` with test cases whose expected values are
  derived in comments (plus the paper's own worked examples: ≈969 questions
  for a 3-point gap; K=2 resampling cutting variance by exactly ⅓). Tradeoff:
  we validated against hand arithmetic inside the build window; cross-checking
  against `evalci`/`statsmodels` golden fixtures is the first listed follow-up.
- **Tolerance-based reproduction rather than exact construction.** Matching
  the paper's numbers to reported precision (±0.15pp deterministic, ±0.3pp
  seeded) with documented limits beat chasing an exact joint construction that
  provably doesn't exist for the correlations.
- **Strict CSV schema v1** (`model,item_id,score` + optional
  `cluster_id,sample_k,benchmark`), friendly row-level errors, and a
  downloadable template — rather than format sniffing. Repeats (`sample_k`)
  are averaged, which keeps standard errors valid; the ω²/σ² decomposition
  they'd enable is deferred.
- **The power panel uses the paper's illustrative variances**, clearly labeled
  in its "assumptions" popover: estimating question-luck vs answer-luck from a
  loaded dataset honestly requires per-question repeats, which neither the
  archive logs nor typical uploads have.
- **Preact + Vite + hand-drawn SVG, ~20 KB gzipped, no chart library, no LLM
  calls, no keys, no runtime network beyond fetching bundled CSVs.**
- **Process**: the build followed a Mikado-method dependency graph
  ([MIKADO.md](../MIKADO.md)) — small reviewable PRs per node, parallel
  branches in git worktrees, cross-branch conformance tests at the convergence
  node (the real CSVs must round-trip through the upload parser and reproduce
  the archive's own aggregates through our estimators).

## How this would extend with more time

1. **Golden-fixture validation**: a Python script cross-checking every
   estimator against `evalci`/`statsmodels` on shared fixtures, committed to
   CI.
2. **Answer-luck decomposition**: parse `sample_k` repeats into ω²/σ²
   estimates, feed the power panel dataset-estimated variances, and visualize
   the question-luck floor as K grows.
3. **More models, more benchmarks, n-way comparison**: the archive has
   hundreds of models; the table currently compares the first two models of a
   dataset. A model picker plus pairwise matrix view is a natural next step.
4. **Import adapters**: Inspect AI logs and lm-evaluation-harness outputs
   directly, plus CSV sniffing for near-miss formats.
5. **Share-link hardening**: compression (lz-string) and a checksum (a
   truncated link currently has one undetectable failure mode, documented in
   tests).
6. **Exact paper-mode construction** for the correlation targets, or better:
   replace the fictional example with a real pair once per-question data for a
   frontier-model comparison is publishable.

## Time spent

Roughly **2 hours** for the core implementation (scaffold → deployed guided
demo → datasets/sharing/power panel), inside the assignment's target window,
plus about an hour of planning and clickable-mockup iteration beforehand and
short post-launch tweak rounds afterwards (tour memory, toggle feedback, the
close-race dataset) driven by live testing. <!-- adjust to taste before
submitting -->
