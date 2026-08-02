#!/usr/bin/env python3
"""Generate public/datasets/example-eval.csv — the demo file for the
"bring your own data" path.

It exists so someone can try the import path both ways before pointing it at
their own data: paste its raw.githubusercontent.com link into the URL box, or
download it and drop it on the dropzone. Both routes hit the same parser.

This is SYNTHETIC and self-evidently so (the models are named `baseline-v1`
and `tuned-v2`) — it is a format and behaviour demo, not evidence about any
real model. It is deliberately shaped around the question people actually
bring to this app: *did my fine-tune actually help?*

The point it makes is that **the bigger gap is the fake one** — which is
exactly the mistake a scoreboard invites, and it comes out of the structure
of the two benchmarks rather than out of their headline numbers:

  reading    — 480 questions in 40 passages (`cluster_id` = passage).
               tuned-v2 leads by ~8 points and that clears the naive margin,
               so it reads as real. But the advantage is concentrated in a
               few passages rather than spread across questions, so counting
               each passage once roughly doubles the margin and the lead
               stops being readable. The clustering lesson, on a file you
               loaded yourself.
  arithmetic — 500 independent questions, no clusters. A *smaller* lead
               (~7 points) that survives every correction, because there is
               nothing for the corrections to expose.

So the honest read is "the arithmetic gain is real; the reading gain can't
be distinguished from a lucky draw of passages" — the reverse of what the
raw scoreboard suggests.

Distinct `sample_k` values are NOT used here (the template shown in-app
covers that column); keeping one row per model/question keeps the file small
enough that download-then-upload is instant.

Usage:  python3 scripts/make_example_csv.py [--check]
        --check recomputes the statistics and prints the verdicts without
        writing, so the story above can be re-verified after any edit.
"""

import argparse
import csv
import math
import os
import random
from collections import defaultdict

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO_ROOT, "public", "datasets", "example-eval.csv")

SEED = 20241106  # the paper's arXiv submission date, as elsewhere in this repo
MODEL_A, MODEL_B = "baseline-v1", "tuned-v2"

N_PASSAGES, PER_PASSAGE = 40, 12
# Enough arithmetic questions that a *believable* gain (single digits) clears
# the margin — at n=200 nothing under ~10pp is detectable, which would have
# forced a cartoonish gap to make the point.
N_ARITHMETIC = 500

# reading: mean per-passage advantage (logit) and how much it varies between
# passages. The spread is the whole point — it is what the clustered estimator
# sees and the naive one misses.
EDGE_MEAN, EDGE_SPREAD = 0.75, 2.4


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def build():
    """Return rows as (benchmark, model, item_id, cluster_id, score)."""
    rng = random.Random(SEED)
    rows = []

    # --- reading: the advantage varies BY PASSAGE, which is what makes the
    # clustered margin blow up. A per-passage `edge` term means whole passages
    # swing together; that covariance is invisible to the naive estimator.
    #
    # The edges are drawn for spread and then re-centred on an exact mean.
    # Spread and effect size pull in opposite directions here: the spread is
    # what we want (it drives the clustered margin), but across only 40
    # passages it also moves the sample mean by several points, so an
    # uncentred draw decides the headline gap by luck. Centring pins the
    # effect size while preserving the covariance the demo is about.
    edges = [rng.gauss(0.0, EDGE_SPREAD) for _ in range(N_PASSAGES)]
    shift = EDGE_MEAN - sum(edges) / len(edges)
    edges = [e + shift for e in edges]

    for p in range(N_PASSAGES):
        passage = f"passage-{p:02d}"
        difficulty = rng.gauss(0.0, 1.15)  # shared: some passages are just hard
        edge = edges[p]                    # tuned-v2's advantage on THIS passage
        for q in range(PER_PASSAGE):
            item = f"read-{p:02d}-{q}"
            wobble = rng.gauss(0.0, 0.45)  # per-question noise, shared by both
            pa = sigmoid(0.25 + difficulty + wobble)
            pb = sigmoid(0.25 + difficulty + wobble + edge)
            rows.append(("reading", MODEL_A, item, passage, int(rng.random() < pa)))
            rows.append(("reading", MODEL_B, item, passage, int(rng.random() < pb)))

    # --- arithmetic: independent questions, a modest but consistent gain. No
    # cluster_id column value, so this benchmark is unaffected by the
    # "count grouped questions once" toggle. ---
    for i in range(N_ARITHMETIC):
        item = f"calc-{i:03d}"
        difficulty = rng.gauss(0.0, 0.9)
        pa = sigmoid(0.15 + difficulty)
        pb = sigmoid(0.15 + difficulty + 0.33)
        rows.append(("arithmetic", MODEL_A, item, "", int(rng.random() < pa)))
        rows.append(("arithmetic", MODEL_B, item, "", int(rng.random() < pb)))

    return rows


# --- the app's estimators, re-implemented here so --check is self-contained ---

def naive_se(v):
    n = len(v)
    m = sum(v) / n
    return math.sqrt(sum((x - m) ** 2 for x in v) / n) / math.sqrt(n)


def clustered_se(v, clusters):
    n = len(v)
    m = sum(v) / n
    sums = defaultdict(float)
    for x, c in zip(v, clusters):
        sums[c] += x - m
    return math.sqrt(sum(s * s for s in sums.values())) / n


def report(rows):
    by = defaultdict(lambda: defaultdict(dict))   # bench -> model -> item -> score
    cluster_of = {}
    for bench, model, item, cluster, score in rows:
        by[bench][model][item] = float(score)
        cluster_of[(bench, item)] = cluster or item  # blank cluster = singleton

    for bench in by:
        items = sorted(by[bench][MODEL_A])
        a = [by[bench][MODEL_A][i] for i in items]
        b = [by[bench][MODEL_B][i] for i in items]
        d = [y - x for x, y in zip(a, b)]           # tuned − baseline
        cl = [cluster_of[(bench, i)] for i in items]
        pp = 100.0
        gap = pp * sum(d) / len(d)
        se = {
            "uN": pp * math.hypot(naive_se(a), naive_se(b)),
            "uC": pp * math.hypot(clustered_se(a, cl), clustered_se(b, cl)),
            "pN": pp * naive_se(d),
            "pC": pp * clustered_se(d, cl),
        }
        print(f"\n{bench}: n={len(items)} clusters={len(set(cl))}")
        print(f"  {MODEL_A} {pp*sum(a)/len(a):.1f}%   {MODEL_B} {pp*sum(b)/len(b):.1f}%"
              f"   gap {gap:+.1f}")
        for stage, key in [("margins only        ", "uN"),
                           ("+ groups counted once", "uC"),
                           ("+ question-by-question", "pC")]:
            margin = 1.96 * se[key]
            verdict = "REAL" if abs(gap) > margin else "too close to call"
            print(f"    {stage}: ±{margin:5.1f}  ->  {verdict}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="print statistics without writing the file")
    args = ap.parse_args()

    rows = build()
    report(rows)
    if args.check:
        return

    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["benchmark", "model", "item_id", "cluster_id", "score"])
        w.writerows(rows)
    size = os.path.getsize(OUT)
    print(f"\nwrote {OUT}  ({len(rows)} rows, {size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
