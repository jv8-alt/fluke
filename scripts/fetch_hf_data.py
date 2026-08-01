#!/usr/bin/env python3
"""Regenerate datasets/mmlu.csv and datasets/drop.csv from the Open LLM
Leaderboard v1 archive on HuggingFace.

Provenance
----------
Source repos (public, no auth required; organization formerly named
`open-llm-leaderboard`, archived as `open-llm-leaderboard-old`):

  https://huggingface.co/datasets/open-llm-leaderboard-old/details_meta-llama__Llama-2-70b-hf
  https://huggingface.co/datasets/open-llm-leaderboard-old/details_tiiuae__falcon-40b

These "details" datasets hold the per-sample logs the leaderboard produced with
the EleutherAI lm-evaluation-harness. We read two evaluation runs per model:

  MMLU  — task files `details_harness|hendrycksTest-<subject>|5_<run>.parquet`
          (57 subject files, 5-shot; `acc` is 0/1 per question).
          Runs: Llama-2-70b-hf 2023-08-22T09:05:23.035851,
                falcon-40b     2023-08-21T22:49:59.134750
  DROP  — task file `details_harness|drop|3_<run>.parquet`
          (9,536 questions, 3-shot; `f1` in [0,1] per question, plus binary `em`).
          Runs: Llama-2-70b-hf 2023-09-08T23-38-08.931556,
                falcon-40b     2023-09-08T21-43-04.856041

License / redistribution note: Open LLM Leaderboard results are openly
published. We redistribute *scores and group labels only* — no benchmark
questions, no reference answers, no model outputs. MMLU cluster_id is the
subject name; DROP cluster_id is a SHA-1 prefix of the passage text (the text
itself is not included). Item ids are the subject + within-subject index
(MMLU) or the DROP query UUID — none of which reveal item content.

Output CSV schema (project-wide): benchmark,model,item_id,cluster_id,score
  - score is 0/1 for MMLU (`acc`) and [0,1] for DROP (`f1`, 4 decimals).
  - both models cover identical item_id sets within each benchmark (asserted).

Generated 2026-08-01. Re-run with:  python3 scripts/fetch_hf_data.py
(needs `pyarrow`; downloads ~140 MB into a cache dir, env FLUKE_HF_CACHE).
"""

import csv
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.parse
import urllib.request

import pyarrow.parquet as pq

HF = "https://huggingface.co"
ORG = "open-llm-leaderboard-old"

# (short model name used in CSVs, details repo, MMLU run dir, DROP run dir)
MODELS = [
    ("Llama-2-70b-hf",
     f"{ORG}/details_meta-llama__Llama-2-70b-hf",
     "2023-08-22T09:05:23.035851",
     "2023-09-08T23-38-08.931556"),
    ("falcon-40b",
     f"{ORG}/details_tiiuae__falcon-40b",
     "2023-08-21T22:49:59.134750",
     "2023-09-08T21-43-04.856041"),
]

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO_ROOT, "public", "datasets")
CACHE = os.environ.get("FLUKE_HF_CACHE") or os.path.join(
    tempfile.gettempdir(), "fluke-hf-cache")


def cached_download(repo, path):
    """Download <repo>/resolve/main/<path> once; return local file path."""
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(
        CACHE, re.sub(r"[^A-Za-z0-9._-]", "_", f"{repo}_{path}"))
    if not os.path.exists(local):
        url = f"{HF}/datasets/{repo}/resolve/main/{urllib.parse.quote(path)}"
        sys.stderr.write(f"  fetch {path}\n")
        with urllib.request.urlopen(url) as r, open(local + ".tmp", "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(local + ".tmp", local)
    return local


def list_run_files(repo, run_dir):
    url = f"{HF}/api/datasets/{repo}/tree/main/{urllib.parse.quote(run_dir)}"
    with urllib.request.urlopen(url) as r:
        return [e["path"] for e in json.load(r) if e["type"] == "file"]


def mmlu_rows():
    """Yield (model, item_id, cluster_id, score) for all 57 MMLU subjects."""
    per_model = {}  # model -> {subject: (hashes, scores)}
    subjects = None
    for name, repo, run, _ in MODELS:
        files = [p for p in list_run_files(repo, run)
                 if re.search(r"harness\|hendrycksTest-.*\|5_.*\.parquet$", p)]
        subj_of = {re.search(r"hendrycksTest-(.*?)\|5", p).group(1): p
                   for p in files}
        if subjects is None:
            subjects = sorted(subj_of)
        assert sorted(subj_of) == subjects, f"{name}: subject set differs"
        per_model[name] = {}
        for s in subjects:
            t = pq.read_table(cached_download(repo, subj_of[s]),
                              columns=["acc", "hashes"])
            hs = [h["example"] for h in t.column("hashes").to_pylist()]
            accs = t.column("acc").to_pylist()
            per_model[name][s] = (hs, accs)
    assert len(subjects) == 57, f"expected 57 subjects, got {len(subjects)}"
    # Both models must have evaluated identical questions in identical order
    # (the harness iterates the test split in dataset order); item ids are the
    # subject plus that stable within-subject index.
    ref = MODELS[0][0]
    for name, _, _, _ in MODELS[1:]:
        for s in subjects:
            assert per_model[ref][s][0] == per_model[name][s][0], (
                f"MMLU example-hash order differs for subject {s}")
    for name, _, _, _ in MODELS:
        for s in subjects:
            for i, acc in enumerate(per_model[name][s][1]):
                assert acc in (0, 0.0, 1, 1.0), f"non-binary acc {acc}"
                yield name, f"{s}#{i:04d}", s, str(int(acc))


def drop_rows():
    """Yield (model, item_id, cluster_id, score) for DROP.

    item_id = the DROP query UUID (`example` column);
    cluster_id = "p:" + first 8 hex chars of SHA-1 of the passage text,
    so questions about the same passage share a cluster; score = token F1.

    The archive contains exactly one query UUID that appears twice (the same
    question evaluated twice, at the same positions for every model); the
    second occurrence gets a "#2" suffix so item ids stay unique while both
    real observations are kept.
    """
    per_model = {}  # model -> ordered list of (qid, cluster, f1)
    for name, repo, _, run in MODELS:
        files = [p for p in list_run_files(repo, run)
                 if re.search(r"harness\|drop\|3_.*\.parquet$", p)]
        assert len(files) == 1, f"{name}: expected one DROP file, got {files}"
        t = pq.read_table(cached_download(repo, files[0]),
                          columns=["example", "passage", "f1"])
        rows = []
        for qid, passage, f1 in zip(t.column("example").to_pylist(),
                                    t.column("passage").to_pylist(),
                                    t.column("f1").to_pylist()):
            f1 = float(f1)  # stored as a string column in the archive
            assert 0.0 <= f1 <= 1.0, f"f1 out of range: {f1}"
            cluster = "p:" + hashlib.sha1(
                passage.encode("utf-8")).hexdigest()[:8]
            rows.append((qid, cluster, f1))
        per_model[name] = rows
    # Both models must have evaluated identical questions in identical order
    # (the harness iterates the dataset in order), so per-position qids and
    # passage clusters line up exactly across models.
    ref = MODELS[0][0]
    for name, _, _, _ in MODELS[1:]:
        assert [r[:2] for r in per_model[ref]] == \
               [r[:2] for r in per_model[name]], (
            "DROP qid/cluster sequences differ between models")
    for name, _, _, _ in MODELS:
        seen = {}
        for qid, cluster, f1 in per_model[name]:
            seen[qid] = seen.get(qid, 0) + 1
            item_id = qid if seen[qid] == 1 else f"{qid}#{seen[qid]}"
            score = f"{f1:.4f}".rstrip("0").rstrip(".") or "0"
            yield name, item_id, cluster, score


def write_csv(path, benchmark, rows):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["benchmark", "model", "item_id", "cluster_id", "score"])
        n = 0
        for model, item_id, cluster_id, score in rows:
            w.writerow([benchmark, model, item_id, cluster_id, score])
            n += 1
    sys.stderr.write(
        f"wrote {path}: {n} rows, {os.path.getsize(path)} bytes\n")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    write_csv(os.path.join(OUT_DIR, "mmlu.csv"), "mmlu", mmlu_rows())
    write_csv(os.path.join(OUT_DIR, "drop.csv"), "drop", drop_rows())


if __name__ == "__main__":
    main()
