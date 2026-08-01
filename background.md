Please see below the brief that we will be building an app for. For now, I want you to review requirements and ideas and help me plan the app. Wait to execute until I say we're ready.

## Assignment prompt

Software Engineering Take-Home Assignment
Context
As AI capabilities advance rapidly, engineers at Anthropic face a unique challenge:
building tools and experiences that are genuinely useful, trustworthy, and
delightful. The best products demonstrate taste, handle complexity gracefully, and
solve real problems in non-obvious ways.
This assignment asks you to build something that showcases your judgment,
creativity, and execution.
Time Expectation
Target: 1-2 hours. Hard limit: 8 hours, but we really want to deliver in 2 hours and tweak from there.
This assignment is designed to replace a synchronous interview session. We expect
most candidates to complete something compelling in 1-2 hours, and we value your
time - something insightful and deeper is more valuable than breadth. You may
spend up to 8 hours if you're enjoying the problem, but this is not expected or
required—we've seen excellent submissions completed in under 2 hours.
If you find yourself exceeding 8 hours, stop and submit what you have. Part of what
we're evaluating is your ability to scope effectively.
In your written rationale, please note approximately how long you spent.
Objective
Build a functional prototype that demonstrates your ability to ship an impressive,
self-contained experience. 

## Chosen themes

I've chosen 2 themes that I'd like to address with a single app:

Theme 1: Exploration & Understanding
Complex systems, technical concepts, and unfamiliar artifacts are hard to
understand through static explanation. Build a tool that helps users develop deep
understanding—whether that's a simulation of emergent dynamics, an explainer for
a technical concept, or a tool for exploring codebases, datasets, or documents.

Theme 4: Evaluation & Data Quality
ML research depends on rigorous evaluation and clean data—but both are
surprisingly hard. Build a tool or pipeline that addresses a real challenge in evals,
reward modeling, data quality, or experiment tracking.

## Follow-up guidelines

See below for more details about the app itself. In the meantime, here are the remaining guidelines:

Critical Requirement: Self-Contained Evaluation
Your prototype must be evaluatable without requiring specific data, documents, or
domain expertise from the reviewer.
If your concept requires domain-specific inputs, either bundle compelling examples
or provide a "demo mode" that showcases the tool's capabilities without requiring
the reviewer to source their own data.
Requirements
Create three deliverables:
1. A functioning prototype (deployed)
● The Anthropic team should be able to use and interact with the prototype
immediately.
○ A browser or API-based experience is likely the simplest; a local
experience should come with an appropriate way to run the project.
● Feel free to focus on a single feature or interaction pattern
● Polish is less important than demonstrating your core idea effectively
● Must include sample data or demo mode if the tool requires specific inputs
2. Your code
● Submit via GitHub repo link
● Code quality matters but is not the primary evaluation criterion
● Use any languages/technologies you're comfortable with
3. Design rationale
● Use both formats: self-recorded video (~5 min) and a short written doc
● Why you chose this theme and this specific approach
● What makes your idea interesting or non-obvious
● Key design decisions and tradeoffs you made
● How you'd extend this with more time
● Approximately how long you spent

## The App: Concepts

Every time a new model comes out, I see a list of benchmarks that show how this model compares to other models against certain kinds of evals. It's often not clear to me how reliable those measurements are, or whether one model scoring 87.5% in one metric is meaningfully better than one that scored 85.2%.

Researching this led me to this paper, https://arxiv.org/pdf/2411.00640 which makes a few key points about these benchmarks:

1. Report the margin of error with every score. A benchmark score is a poll, not a fact: the questions are a sample standing in for all possible questions of that kind. The standard error quantifies it.

2. Account for clustering — bundled questions are less data than they look. Five questions about one passage, or one question in ten languages, rise and fall as a bloc — like polling 1,000 people from 200 households. Fix: within each cluster, sum deviations first, then square (instead of squaring each separately), so bloc behavior gets charged at full price. Honest error bars can be 2–3× wider than naive ones.

3. Reduce answer luck the legitimate ways — never by lowering temperature. Score noise = question luck (which questions landed in the eval; only more questions help) + answer luck (the model answers the same question differently run to run; shrink by averaging K repeats, or eliminate by reading the model's token probabilities instead of sampling). Setting temperature to 0 measures a different model and can increase the irreducible noise.

4. Compare models question-by-question, not scoreboard-to-scoreboard. When both models answered the same questions, subtract per question first: shared difficulty ("this question is just hard") cancels out of the gaps, leaving only the real between-model signal. Same data, same average, meaningfully tighter error bars — a free reduction in noise whenever the models' scores correlate (they nearly always do).

5. Check the eval's eyesight before trusting it (power analysis). Every benchmark has a smallest gap it can reliably detect, set mostly by question count (~1,000 questions to see a 3-pt gap). Below that threshold, wins and losses are unreadable — know the threshold before running the eval, or before believing someone else's.

The paper is filled with difficult equations (at least for those not steeped in statistics). Let's build a simple app that makes it easy to compare how a set of evals holds up with and without all the paper's recommended modifications. The goals are to educate our audience about these methodologies and to try to yield "real" scores for models that haven't been published or contextualized with these modifications (and to compare them to each other in "true" terms).

## The App: Implementation

Conceptually, this will be an experience that converts the core equations and methodologies described in https://arxiv.org/pdf/2411.00640 into a highly performant, delightful, interactive experience in a web browser. 

Note that the stats already exist as Python libraries (`evalci`, `evalstats`, Inspect AI's built-in metrics), but as far as I can tell none have a UI designed for general consumption. Our value add is the missing front-end: zero-install, visual, shareable — adoption, not invention. Prior art should be cited, however, and we should use these and any other tools to cross-reference and validate our own implementations.

### Core user journeys

A reviewer lands on a URL and, within 30 seconds and zero input, sees a familiar leaderboard claim ("Model B wins 2 of 3 benchmarks") fall apart under proper statistics — error bars, clustering, paired differences — ending at the opposite verdict. We can seed the experience with the paper's own example models and data.

From there, users should be able to play with other (real) eval datasets that we have available in our repo, or they can upload their own. (To start with, we should insist on a specific CSV format, but we can attempt to parse/sniff as an enhancement if we have time later.)

Only if there's time: A final section should allow power users to tweak variables to see, for example, how many questions they'd need in order to improve their benchmarks by a certain number of points, and any other variables/experiences you can think of to help power users who are actually trying to improve model outcomes.

IMPORTANT NOTE ABOUT UX: We should plan on progressive enhancement/complexity so that users drop into a very clean and easy to follow experience for their first tour. Statistics formulas and jargon are important for some users, but should be hidden behind pop-ups, footnotes, or other collapsed-by-default experiences (like the power users section).

## Requirements

This should be as SIMPLE as possible to start. This is a demo, not a production app. Optimize for simple, elegant architecture with interfaces that will let us transition easily to more features and production readiness at a later time. 

- **Self-contained:** Bundled demo data (synthetic "paper mode" calibrated to reproduce the paper's Table 5, + one real or honestly-synthetic dataset); never an empty state. Upload accepts CSV <-- Let's discuss necessary columns and whether we can try to sniff out alternative formats.
- **Stack:** TypeScript with Preact on the front-end, nodejs on the backend, no LLM calls, no keys if we can avoid it. We do want a very simple API/back-end for uploading and storing (and possibly processing) datasets, and loading them into the UI. But it should be exceedingly simple for now, again with interfaces that allow us to swap out/scale up as needed. For hosting, either something like Render for the full-stack or Vercel + Supabase. 
- **Correct & provable:** Stats as pure, unit-tested functions implementing the paper's equations. Tests validated against `evalci`/`statsmodels` outputs when appropriate. A test asserting Table 5 is reproducible. 
- **Shareable:** When you load a given dataset/leaderboard, you should be able to share that via a link.
- **Scoped:** 2h hard cap on development. We can spend more time tweaking from there. Never cut: Compare-screen toggles, paper-mode reproduction, critical path tests, deployed URL. Identify for follow up, but do not build, enhancements/hardening/observability/etc. that you would expect to need if we were to take this all the way to production.