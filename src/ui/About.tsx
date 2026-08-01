/**
 * The About panel: method, data provenance, prior art, and the two honesty
 * notes (the paper-number correction and the DROP broken-parser caveat).
 * Collapsed behind a footer button — depth on demand, per the UX principles.
 */
import { useState } from "preact/hooks";

export function AboutFooter() {
  const [open, setOpen] = useState(false);
  return (
    <footer>
      <div class="fline">
        Based on Miller,{" "}
        <a href="https://arxiv.org/abs/2411.00640">
          <i>Adding Error Bars to Evals</i>
        </a>{" "}
        (Anthropic, 2024). Click any dashed value for the formula behind it.
        <button class="lnk" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "About, data & credits"}
        </button>
      </div>
      {open && (
        <div class="about">
          <p>
            <b>The method.</b> Everything here follows the paper above. Click
            any dashed value in the app to see the exact formula and the
            section it comes from. The guided demo reproduces the paper's
            worked example within stated tolerances — the reproduction is
            asserted by the test suite in the repo.
          </p>
          <p>
            <b>The data.</b> The guided demo is synthetic, calibrated to the
            paper's fictional example (its per-question outcomes are
            constructed, since the paper publishes only summary statistics).
            MMLU and DROP are real per-question logs for{" "}
            <code>Llama-2-70b-hf</code> and <code>falcon-40b</code> from the{" "}
            <a href="https://huggingface.co/open-llm-leaderboard-old">
              Open LLM Leaderboard archive
            </a>{" "}
            — scores and group labels only, no benchmark questions or answers.
            The conversion script ships in the repo (<code>scripts/</code>).
          </p>
          <p>
            <b>Why DROP's scores look absurdly low.</b> They really were: the
            2023 evaluation harness had a broken answer parser for DROP, and
            the benchmark was later pulled from the leaderboard because of it.
            We kept it on purpose — the grouping structure this demo analyzes
            is real, and it's a live example of why you should check an eval
            before trusting its scoreboard.
          </p>
          <p>
            <b>One correction.</b> The paper's Table 1 lists HumanEval /
            Dreadnought as 87.7%; we use 86.7%, which is what its own −3.1
            difference implies and what its later tables use.
          </p>
          <p>
            <b>Prior art.</b> These statistics already exist as Python
            libraries: <code>evalci</code>, <code>evalstats</code>, Inspect
            AI's{" "}
            <a href="https://inspect.aisi.org.uk/">stderr() metrics</a>, and{" "}
            <a href="https://github.com/evaleval/every_eval_ever">
              Every Eval Ever
            </a>
            . What was missing was a version you don't have to install.
          </p>
        </div>
      )}
    </footer>
  );
}
