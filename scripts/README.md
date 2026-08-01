# Data snapshots — provenance & regeneration

`public/datasets/mmlu.csv` and `public/datasets/drop.csv` (under `public/` so the static site serves them) are real per-question evaluation
logs for **meta-llama/Llama-2-70b-hf** and **tiiuae/falcon-40b**, snapshotted
from the Open LLM Leaderboard v1 archive on HuggingFace
([`open-llm-leaderboard-old/details_meta-llama__Llama-2-70b-hf`](https://huggingface.co/datasets/open-llm-leaderboard-old/details_meta-llama__Llama-2-70b-hf)
and
[`details_tiiuae__falcon-40b`](https://huggingface.co/datasets/open-llm-leaderboard-old/details_tiiuae__falcon-40b));
we redistribute **scores and group labels only** — no benchmark questions, no
reference answers, no model outputs. MMLU is the 5-shot
`harness|hendrycksTest-<subject>|5` run (14,042 questions, `acc` as a 0/1
score, subject as `cluster_id`, 57 subjects); DROP is the 3-shot
`harness|drop|3` run (9,536 questions, token-F1 in [0,1] as the score,
`cluster_id` = a SHA-1 prefix of the passage text so questions about the same
passage share a cluster — 579 passages; the one query UUID the archive
evaluated twice gets a `#2` suffix on its second occurrence). Exact run
timestamps, per-column details, and structural assertions (identical item sets
and ordering across the two models, score-range checks) live in
`fetch_hf_data.py`, which is the exact script that produced the CSVs;
regenerate them with `python3 scripts/fetch_hf_data.py` (needs `pyarrow`,
downloads ~140 MB of parquet into a cache dir, override with `FLUKE_HF_CACHE`).
Note the low absolute DROP scores (≈6.6% vs ≈6.4% mean F1) are a real property
of the archived v1 evaluation — a known harness answer-parsing issue that led
HuggingFace to drop DROP from the leaderboard in late 2023 — which we keep
as-is because the per-passage clustering structure (the thing this demo
analyzes) is genuine; the extracted means match the archive's own aggregate
`results_*.json` to four decimal places.
