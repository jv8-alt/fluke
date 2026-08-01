# Mikado Execution — Agent Guide

<!-- Full guide: read and follow this file during execution.
     Companion to AGENTS-mikado-planning.md, which has the copy-paste stub
     for keeping both guides discoverable across context loss — see its
     "Keep this loaded automatically" section. -->

This guide covers executing an **approved** Mikado plan: delivering stand-alone
slices incrementally, running parallel agents, isolating work in worktrees,
opening PRs, converging, and narrating progress. The plan itself — graph, design
decisions, diagrams, and the deliverable breakdown — lives in `MIKADO.md` and was
produced per the planning guide. **Never start execution before the user has
approved the plan.**

## Core concepts (shared with the planning guide)

- **Mikado Method**: build a dependency graph of prerequisites, work from the leaves, parallelize independent branches.
- The graph is a **DAG, not a strict tree** — a node may have prerequisites in more than one branch (cross-branch edges).
- **Node roles**: **root** `G` = the goal; **trunk** = a node ≥2 branches depend on (shared interface/contract/schema/protocol); **branch** node; **convergence** = a node fed by >1 branch.
- **Node IDs** are stable and hierarchical: root `G`; trunks `T1, T2…`; branches `A, B, C…`; nodes `A1, A2…` where `A1` merges before `A2`.
- **Statuses**: `pending` / `in-progress` / `done`.
- **Artifacts**: `MIKADO.md` at the repo root is the canonical graph (goal, diagrams, incremental deliverables each with their own subtree, node table, branch boundaries, collapse plan). This guide and the planning guide tell agents how to act in each phase.

## 1. Re-sync before you touch anything

Agents get swapped and context windows roll over mid-effort — so never trust memory over the written plan. Before starting or resuming any work:

- **Re-read this guide, in full, if there's any doubt it's fresh in context** — a summarized recollection of "the Mikado rules" from earlier in a compacted conversation is not the same as the current text. When unsure, re-read; it's cheap insurance against silently drifting from the actual rules.
- **Re-read `MIKADO.md`** — the canonical graph, node statuses, branch boundaries, and collapse plan are ground truth.
- **Check live state** — which PRs are open/merged (`gh pr list`), which nodes are `done`, and what your branch's file boundary is.
- **Confirm your change still fits.** Anything you write must accord with the current graph, the architecture docs, and other agents' in-flight work. If reality has drifted from the plan, run the discovery loop (§3) and reshape the graph — don't quietly build something the graph doesn't describe.

## 2. Deliver incrementally — don't front-load the full tree

The plan holds the full architecture and the dependency map to get there; execution
still ships **one stand-alone deliverable at a time**. `MIKADO.md` should name those
deliverables (each with its own subtree) — honor that slicing, don't collapse it into
"build the foundation first."

- **IMPORTANT: Know the whole tree; build only the next slice.** Do not implement
  nodes, interfaces, contracts, or scaffolding that exist only to serve later
  deliverables. If a piece isn't needed until the last couple of nodes of a later
  slice, leave it undone until that slice is in play.
- **Prefer the shortest path to something real and reviewable** over completing a
  complete-but-unvalidated foundation. Ship the current deliverable, validate it
  works and points the right direction, then continue.
- **Refactoring between slices is expected.** It's okay — often correct — to change
  earlier code so a subsequent deliverable can land cleanly. Don't refuse a needed
  reshape because "we already built the interface"; don't invent that interface early
  to avoid a later reshape either.
- **If the graph forces front-loading**, the plan is wrong: raise a plan-revision PR
  that chops the tree into stand-alone deliverables (planning guide §4), rather than
  executing speculative prerequisites "because they're in the graph."

## 3. Parallel agent execution

- Work the **current deliverable's** independent branches — not every remaining branch
  in the full goal tree. After that deliverable's trunks merge, identify subtrees
  whose remaining nodes share no files or tightly coupled modules.
- Spin up **one agent per independent branch**. Each works its branch leaf-first, sequentially, one PR per node.
- An agent NEVER starts a node until **all its prerequisites are merged — including cross-branch ones**.
- An agent stays inside its branch's file boundary. If it must touch another branch's territory, the graph is wrong: restructure (usually merge the two branches into one sequenced branch) via a plan-revision PR.

### The discovery loop — attempt → revert → record → recurse → reshape

The core Mikado move, not an error path. Discovering a hidden prerequisite mid-node means the method is working.

1. **Attempt honestly.** Start the node as planned; let the code reveal what's missing. Timebox it — if you're fighting the codebase, that's the signal.
2. **Revert clean — don't nurse half-work.** Commit nothing from the failed attempt; `git reset --hard` to clean. Keep it in a scratch stash/branch for reference if useful, but the node restarts from clean once its prerequisites are met. Half-finished work carried forward is how graphs rot.
3. **Record what reality taught you.** Add the discovered node/edge to `MIKADO.md` with a one-line note of what the attempt revealed ("SqliteStorage can't type against a protocol that doesn't exist yet") — the edge's *reason* is as valuable as the edge.
4. **Recurse before resuming.** The prerequisite may have its own prerequisites. Probe cheaply first (what does it import, touch, or assume that isn't merged?); if still uncertain, spend a timeboxed spike. Walk down to a true leaf — one revert per level beats discovering the chain one failed PR at a time.
5. **Reshape the graph.** Classify the prerequisite and act:
   - **Mine** (inside my boundary) → insert it into my branch sequence before the blocked node; note it in my next PR.
   - **Another branch's territory** → record the cross-branch edge; work another available node or wait for that branch to merge it. Never reach across the boundary and build it myself.
   - **Shared / contract-shaped** (≥2 branches need it) → a trunk node discovered late. Pause affected branches and raise a **plan-revision PR**; if branch assignments or boundaries change, it re-triggers the approval gate (planning guide).
   - **Only needed by a later deliverable** → do **not** pull it into the current slice. Record it on that later deliverable's subtree (plan-revision if the graph didn't already place it there) and keep building the current stand-alone piece. Discovering a future dependency is not permission to front-load it (§2).
6. **Narrate it** (§6): what was attempted, what it revealed, what was reverted, how the graph changed — in the moment, not in a retro.

### Git worktrees — one per agent

- Each agent works in its **own detached worktree**, never a shared checkout: `git worktree add --detach ../<repo>-agent-A main`.
- Per-node branches are cut from latest `main` inside the worktree: `git checkout -b mikado/<node-id> main` (e.g. `mikado/A1`). The worktree provides isolation — no long-lived per-agent branch.
- Rebase on latest `main` and rerun tests before opening each PR; merges to `main` are serialized.
- On agent collapse (below), remove dead agents' worktrees (`git worktree remove`); the survivor continues in its own.

### Review & merge policy — the user merges, never the agent

- Agents **open** PRs; they never approve their own, never merge, never enable auto-merge. Opening the PR ends the node: post the checkpoint update (§6) with the PR link and what to look at, then wait.
- The user's PR review is the standing control point — the approval gate approves the *plan* once; review approves each *increment*. Bypassing it turns "reviewable PRs" into an unread changelog.
- Waiting on review does not idle the agent: it continues with its **next node stacked** on the pending one (below). Nothing it builds may merge ahead of its base.
- If several PRs await review, present a short **review queue** (node, PR link, one-line what-it-does, suggested order) rather than pinging one at a time.
- **Explicit opt-in exception only:** the user may pre-authorize auto-merge for a named class of PRs (e.g. "auto-merge green trunk PRs"). Scope it narrowly, record it in `MIKADO.md`, and never infer it from silence.

### Stacked node PRs (within a branch only)

- **Stacking is the default within a branch — don't wait for merges.** Base node N+1's PR on node N's branch (`mikado/A2` targets `mikado/A1`) and keep going, so the agent pipelines through its branch while earlier PRs sit in review. Each PR still shows only its own node's diff. GitHub retargets a stacked PR to `main` when its base merges; rebase and rerun tests then.
- **Stack up to the convergence node, then stop.** A convergence node can't stack on multiple parents — it starts from `main` once all its feeders have merged. Stack A1 → A2 → A3, then wait.
- **Never stack across branches.** That recreates exactly the coupling the graph exists to remove.
- **Use discretion on stack depth.** Stacking trades review latency for rebase churn: if early PRs are likely to change substantially in review, a deep stack means repeatedly rewriting everything above them. When a node's approach is uncertain, contested, or the user has signaled they want a close look, stop stacking and wait for that PR to settle. Nothing in a stack may merge ahead of its base.

### Convergence & collapse

- A **convergence node** is fed by more than one branch.
- When all its feeder branches have merged, the separate agents **collapse to one**: a single agent takes the convergence node and everything above it toward the root. The others terminate or move to still-open branches.
- Never have two agents active above a convergence point.
- Convergence nodes carry **conformance/contract tests** proving every implementation honors the trunk interface.

### Scaling beyond 2–3 agents

- **Parallelism is an output of planning, not an input.** Spawn one agent per *genuinely disjoint* subtree; never split branches to hit an agent count. Hotspots (DI wiring, route tables, config, lockfiles) cap useful parallelism — two candidate branches sharing a hotspot are one branch.
- **Keep nodes small so the merge queue cycles fast.** Every merge to `main` obsoletes other agents' bases; cheap rebases stay cheap only if PRs stay small. At high agent counts the bottleneck is review throughput — don't add agents past what review absorbs.
- **Nested convergences need survivors named up front.** With many branches, convergence is staged (A+B→C1, D+E→F1, C1+F1→G). The collapse plan must name the surviving agent *per convergence node*, or two survivors both claim the upper graph.
- **Optional conflict hardening:** add `MIKADO.md merge=union` to `.gitattributes` to eliminate status-table conflicts (safe only because agents edit exactly their own single-line row).

## 4. Keep code and docs honest

- **Every node ships with test coverage.** A node that adds or changes behavior is not done until its PR includes tests that exercise that behavior (happy path and the failure/edge cases the acceptance criterion cares about). Do not defer tests to a later node, a "follow-up," or convergence — coverage lands in the same PR as the code. Exceptions only when the change is fully covered by type checks or other automated validation, or there is genuinely nothing to test (e.g. author-facing markdown/docs); state which exception applies in the PR's "How to verify" and the acceptance criterion. Trunk/convergence nodes still carry the conformance/contract tests the plan named.
- **Comment code well**, and when you change code, **update the comments that describe it** — a stale comment misleads worse than no comment.
- **Keep architecture/flow docs current.** If a node changes components, boundaries, or a runtime path, update the SVG diagrams and `MIKADO.md` in the same PR. Architecture docs are living artifacts through execution, not a planning-time snapshot.

## 5. PR requirements

Write every node PR description **for a reader with almost no context** on what
you're building or why — plain vocabulary, acronyms defined on first use, and
explicit links to related PRs and the overall goal. A reviewer who has never seen
`MIKADO.md` must be able to review from the description alone. It is **first a
normal, excellent PR description, second a Mikado artifact**: lead with the
delivery, put plan context after a divider.

**Part 1 — the delivery (lead with this):**

1. **What changed & why** — 2–5 plain-language sentences: the behavior/capability this PR adds, the approach, and any non-obvious choice worth attention. Written for someone reviewing the diff, with any domain terms or acronyms spelled out.
2. **How this fits the bigger picture** — one or two sentences naming the **current incremental deliverable** this node belongs to, connecting it to the overall goal, and naming related PRs (what merged before it, what it unblocks), so a low-context reader sees where the piece belongs — not the whole remaining tree.
3. **How to verify** — the command(s) to run and the named tests that prove this node's behavior; the PR must include those tests (or name the type-check/docs exception from §4). Do not claim "covered later" — if coverage belongs to this node, it ships here.
4. **Acceptance criterion** — quote the node's "done when" from `MIKADO.md` and state how it's met (including which tests satisfy it).

**Part 2 — Mikado context (after a `---` divider):**

5. **Graph diagram** (Mermaid, snapshot as of this PR) with this PR's node marked and merged nodes styled differently. Prefer the **current deliverable's** subtree over the entire goal graph when that keeps the snapshot readable. Every node shows its **ID and short label**:

```mermaid
flowchart BT
    T1["T1: extract Storage interface (trunk)"] --> A1["A1: factory + config"]
    T1 --> B2
    A1 --> C1
    B1["B1: schema module"] --> B2["B2: SqliteStorage backend"]
    B2 --> C1["C1: wire backend + contract tests (convergence)"]
    C1 --> G["Goal: migrate storage to SQLite"]

    style T1 fill:#22863a,color:#fff
    style B1 fill:#22863a,color:#fff
    style B2 fill:#f9c513,color:#000
    classDef default fill:#eee,color:#333
```

**Color semantics — role in the border, status in the fill (never mix them):**
borders are stable roles — blue = trunk, purple = convergence, crimson = goal;
fills are live status — grey = pending, green = merged, yellow = **this PR**. A
merged trunk is blue-border + green-fill; the goal keeps its crimson border and
fills green only when G itself merges (so it never looks "done" from day one).
**Use this exact scheme in every PR's snapshot** so a reviewer comparing PRs reads
one consistent picture of what's done, in progress, and pending.

6. **Position statement**, one line: `Deliverable 2 (read path), branch B, node B2 — 2nd of 2 on this branch. Feeds convergence node C1 (also fed by branch A).`
7. **Unblocks**, one line: which node(s) this merge unblocks, and whether it completes a feeder into a convergence node (triggering collapse) or finishes the current deliverable.
8. **`MIKADO.md` row update**: this node's row flipped to `done` + PR link (same PR).

**Size check:** keep the diff **under 250 changed lines** whenever possible. If a node
is growing past that, it's two nodes — split it rather than shipping a PR too big to
review carefully.

**Balance check:** if Part 2 (diagram excluded) is longer than Part 1, Part 1 is
underwritten — a reviewer should never reverse-engineer the change from the plan.

## 6. Narrate the execution — don't batch-ship

Execution is a guided story, not a delivery truck. The user should always know where
in the graph we are, which incremental deliverable is in flight, why the current work
is happening, and what changed since they last looked — without reading diffs to find out.

- **Checkpoint updates** at every phase boundary — a deliverable started/finished, trunks merged, each branch launched/completed, each convergence reached, each collapse, and G. Each is a short "what just landed (PR links) → what stand-alone value it proves → what starts now and why". A PR opening is not a substitute for saying what it means.
- **Narrate deviations in the moment.** Discovered edges, blocked nodes, restructures, contract changes, and any temptation to front-load a later slice: explain what was found, why the plan bends, and what it costs — when it happens, not in a retro. The user should never first learn of a plan change from a diff or a stale `MIKADO.md`.
- **Connect, don't enumerate.** Each update links back to the current deliverable, the overall goal, and the previous checkpoint ("with both stores passing the same contract, the API no longer cares which one serve wires in — that's what unblocks D1"), so the sequence reads as one argument, not a list of events.
- **Batch small mechanical steps** (rebases, row flips, worktree cleanup) into the next checkpoint rather than narrating each. Decisions and surprises get told immediately; mechanics get summarized.
- **Close with a recap**: deliverable → node → PR map, what was intentionally deferred to later slices, what was refactored between slices, what otherwise deviated from the approved plan and why, and anything learned that should feed back into these rules.

## 7. Crunch mode — explicit override only

Under time pressure the user may override the defaults above and authorize some
combination of: **larger-scope nodes and PRs**, **less iterative slicing / more front-loading**, **merging without their review**, and
**running agents in loops** to keep work moving as autonomously as possible.

- **Only when the user says so explicitly.** Never infer crunch mode from a deadline mentioned in the plan, from urgency in the task, from silence, or from a backed-up review queue. Absent an explicit switch, the defaults hold.
- **Honor exactly what was named, and nothing more.** "Merge these without me" doesn't also authorize 1,000-line PRs or skipping incremental deliverables; "bigger PRs are fine" doesn't authorize skipping review.
- **Record it in `MIKADO.md`** — what was authorized, its scope, and when — so an agent picking up later doesn't inherit an override it can't see, or wrongly assume one is still active.
- **It expires.** Crunch mode applies to the work the user named; when that's done, revert to the defaults rather than carrying it forward.
- **These hold even in crunch:** incremental deliverables unless the user explicitly authorized less slicing (§2), test coverage in every behavior-shipping PR (§4), tests green before merge, acceptance criteria met, `MIKADO.md` kept accurate, and deviations still narrated. Speed comes from bigger batches and less waiting — not from shipping untested, unverifiable, or needlessly front-loaded work.
