# Error Bars — is that benchmark win real, or a fluke?

**Live demo: https://jv8-alt.github.io/fluke/**

An interactive, zero-install web app that turns the statistics of
[*Adding Error Bars to Evals*](https://arxiv.org/abs/2411.00640) (Miller,
Anthropic, 2024) into something you can *feel*: a familiar leaderboard claim
("Model B wins 2 of 3 benchmarks") falls apart — and flips — as you switch on
the paper's corrections, one checkbox at a time.

- **A 30-second guided tour** walks through the paper's argument on its own
  worked example: margins of error, bundled questions counted once,
  question-by-question comparison, and the verdict reversal.
- **Real data included**: per-question logs for real open models on MMLU and
  DROP from the Open LLM Leaderboard archive — including a pair
  (`vicuna-13b-v1.5` vs its base `Llama-2-13b-hf`) whose verdict visibly
  flips *real → too close to call → real* as the corrections stack.
- **Bring your own eval**: drop a CSV (or paste a HuggingFace/GitHub link) of
  per-question scores; the same statistics apply instantly. A blank template
  is downloadable in-app.
- **Share any view**: the Copy-link button encodes the dataset, toggles, and
  even an uploaded CSV into the URL.
- **Check an eval's eyesight**: an interactive power panel answers "how many
  questions does a benchmark need before a 3-point gap means anything?"
  (the paper's answer: ≈969, reproduced live).

Every number on screen is computed in the browser from per-question data by
small, pure, hand-verified statistics functions — nothing is hardcoded, and
every simplified claim has a click-through popover showing the exact formula
and the paper section it implements.

**Why this exists**: the statistics already ship in Python libraries
(`evalci`, `evalstats`, Inspect AI's metrics). What was missing is the
zero-install, visual, shareable version — the one you can hand to anyone who
reads leaderboards. See [docs/design.md](docs/design.md) for the full design
rationale: why this approach, what's non-obvious, key tradeoffs, and where
it would go next.

## Development

Requires Node 22+.

```bash
npm ci        # install
npm run dev   # dev server at http://localhost:5173/fluke/
npm test      # vitest — stats, parser, share codec, dataset conformance, UI logic
npm run build # type-check + production build to dist/
```

Deployment is automatic: every push to `main` runs tests + build and
publishes `dist/` to GitHub Pages via `.github/workflows/pages.yml`.

### Layout

```
src/stats/        pure statistics (SE, clustered SE, paired gaps, power) + hand-computed tests
src/data/         dataset types, bundled registry, CSV parse/validate, share codec, paper-mode generator
src/ui/           Preact app: tour, leaderboard, gaps panel, popovers, toolbelt, power panel
public/datasets/  real per-question snapshots (see scripts/README.md for provenance & regeneration)
scripts/          data wrangling: archive fetcher + close-pair scanner (re-runnable, documented)
docs/design.md    design rationale
MIKADO.md         the build's planning/execution graph (process artifact)
```

### Data & licensing note

Bundled real datasets redistribute **scores and group labels only** — no
benchmark questions, answers, or model outputs. Provenance and regeneration
instructions: [scripts/README.md](scripts/README.md).
