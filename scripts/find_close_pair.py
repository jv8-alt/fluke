#!/usr/bin/env python3
"""Scan the Open LLM Leaderboard v1 archive for an MMLU model pair whose
verdict FLIPS as the app's statistical corrections toggle on.

Why: the bundled Llama-2-70b-hf vs falcon-40b pair has a ~13-point gap that
survives every correction — great for "a real lead looks like this", useless
for showing a verdict change. The app applies corrections in the sequence

    uN (margins on: unpaired naive SE)
 -> uC (count grouped questions once: unpaired clustered SE)
 -> pC (compare question-by-question: paired clustered SE)

and calls a lead "real" when |gap| > 1.96*SE. A pair flips when consecutive
stages disagree. MMLU's margin structure (naive ~±1.2pp, clustered ~±1.7pp,
paired-clustered ~±1.0pp for similar models) means a gap of ~1.0–1.8pp can
flip twice: real -> too close -> real.

Usage:
  python3 scripts/find_close_pair.py                 # scan + print table
  python3 scripts/find_close_pair.py --write A B     # write mmlu-close.csv

Provenance: same archive and file conventions as fetch_hf_data.py (public,
no auth; scores + subject labels only are redistributed). Downloads cache in
FLUKE_HF_CACHE (default /tmp/fluke-hf-cache), shared with fetch_hf_data.py.
"""

import csv
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_hf_data import cached_download, ORG, HF, OUT_DIR  # noqa: E402

import pyarrow.parquet as pq  # noqa: E402

# Candidate details repos (short csv name -> repo suffix). Chosen for being
# recognizable models that historically score within a few MMLU points of
# each other on the v1 harness; availability verified at runtime.
CANDIDATES = {
    "Llama-2-13b-hf": "details_meta-llama__Llama-2-13b-hf",
    "Mistral-7B-v0.1": "details_mistralai__Mistral-7B-v0.1",
    "Qwen-7B": "details_Qwen__Qwen-7B",
    "vicuna-13b-v1.5": "details_lmsys__vicuna-13b-v1.5",
    "mpt-30b": "details_mosaicml__mpt-30b",
    "falcon-40b": "details_tiiuae__falcon-40b",
    "Yi-6B": "details_01-ai__Yi-6B",
}


def api_json(path):
    with urllib.request.urlopen(f"{HF}{path}") as r:
        return json.load(r)


def latest_mmlu_run(repo):
    """Pick the newest run directory that contains MMLU subject files."""
    entries = api_json(f"/api/datasets/{ORG}/{repo}/tree/main")
    runs = sorted((e["path"] for e in entries if e["type"] == "directory"),
                  reverse=True)
    for run in runs:
        files = api_json(
            f"/api/datasets/{ORG}/{repo}/tree/main/{urllib.parse.quote(run)}")
        mmlu = [f["path"] for f in files
                if re.search(r"harness\|hendrycksTest-.*\|5_.*\.parquet$",
                             f["path"])]
        if len(mmlu) == 57:
            return run, mmlu
    return None, None


def load_scores(repo_suffix):
    """Return {(subject, example_hash): 0/1} for a model's latest MMLU run."""
    run, files = latest_mmlu_run(repo_suffix)
    if run is None:
        raise RuntimeError("no complete MMLU run")
    scores = {}
    for path in files:
        subject = re.search(r"hendrycksTest-(.*?)\|5", path).group(1)
        t = pq.read_table(cached_download(f"{ORG}/{repo_suffix}", path),
                          columns=["acc", "hashes"])
        for h, acc in zip(t.column("hashes").to_pylist(),
                          t.column("acc").to_pylist()):
            assert acc in (0, 0.0, 1, 1.0)
            scores[(subject, h["example"])] = int(acc)
    print(f"    run {run}: {len(scores)} items", file=sys.stderr)
    return run, scores


def clustered_se(vals, clusters):
    """Grouped-sum clustered SE (matches src/stats/clustered.ts)."""
    n = len(vals)
    m = sum(vals) / n
    sums = {}
    for v, c in zip(vals, clusters):
        sums[c] = sums.get(c, 0.0) + (v - m)
    return math.sqrt(sum(s * s for s in sums.values())) / n


def naive_se(vals):
    n = len(vals)
    m = sum(vals) / n
    return math.sqrt(sum((v - m) ** 2 for v in vals) / n) / math.sqrt(n)


def pair_stats(sa, sb):
    """All four gap SEs (pp) for two aligned {key: score} dicts."""
    keys = sorted(set(sa) & set(sb))
    a = [sa[k] for k in keys]
    b = [sb[k] for k in keys]
    d = [x - y for x, y in zip(a, b)]
    clusters = [k[0] for k in keys]
    pp = 100.0
    return {
        "n": len(keys),
        "meanA": pp * sum(a) / len(a),
        "meanB": pp * sum(b) / len(b),
        "gap": pp * sum(d) / len(d),
        "uN": pp * math.hypot(naive_se(a), naive_se(b)),
        "uC": pp * math.hypot(clustered_se(a, clusters),
                              clustered_se(b, clusters)),
        "pN": pp * naive_se(d),
        "pC": pp * clustered_se(d, clusters),
    }


def verdicts(st):
    return ["real" if abs(st["gap"]) > 1.96 * st[k] else "close"
            for k in ("uN", "uC", "pC")]


def classify(vs):
    flips = sum(1 for i in range(2) if vs[i] != vs[i + 1])
    if flips == 2:
        return "DOUBLE FLIP"
    if flips == 1:
        return "single flip"
    return "-"


def main():
    models = {}
    for name, repo in CANDIDATES.items():
        print(f"  {name}", file=sys.stderr)
        try:
            run, scores = load_scores(repo)
            models[name] = (run, scores)
        except Exception as e:  # missing repo/run — skip, keep scanning
            print(f"    skipped: {e}", file=sys.stderr)

    rows = []
    names = sorted(models)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            st = pair_stats(models[a][1], models[b][1])
            vs = verdicts(st)
            rows.append((a, b, st, vs, classify(vs)))
    rows.sort(key=lambda r: ({"DOUBLE FLIP": 0, "single flip": 1}.get(r[4], 2),
                             abs(r[2]["gap"])))
    print(f"\n{'A':16} {'B':16} {'gap':>6} {'uN':>5} {'uC':>5} {'pN':>5} "
          f"{'pC':>5}  uN->uC->pC      class")
    for a, b, st, vs, cls in rows:
        print(f"{a:16} {b:16} {st['gap']:+6.2f} {st['uN']:5.2f} "
              f"{st['uC']:5.2f} {st['pN']:5.2f} {st['pC']:5.2f}  "
              f"{'->'.join(v[:5] for v in vs):15} {cls}")
    return models


def write_pair(models, a, b):
    keys = sorted(set(models[a][1]) & set(models[b][1]))
    # stable within-subject indices, mirroring fetch_hf_data.py's item ids
    out = os.path.join(OUT_DIR, "mmlu-close.csv")
    idx = {}
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["benchmark", "model", "item_id", "cluster_id", "score"])
        for name in (a, b):
            idx.clear()
            for subj, h in keys:
                i = idx.get(subj, 0)
                idx[subj] = i + 1
                w.writerow(["mmlu", name, f"{subj}#{i:04d}", subj,
                            models[name][1][(subj, h)]])
    print(f"wrote {out}: {len(keys)} items x 2 models")


if __name__ == "__main__":
    ms = main()
    if len(sys.argv) == 4 and sys.argv[1] == "--write":
        write_pair(ms, sys.argv[2], sys.argv[3])
