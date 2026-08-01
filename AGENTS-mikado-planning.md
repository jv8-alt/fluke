# Mikado Planning — Agent Guide

<!-- Full guide: read and follow this file during planning.
     Execution has its own guide: AGENTS-mikado-execution.md.
     Don't paste this whole file into AGENTS.md/CLAUDE.md — paste the short
     pointer below instead, so it's cheap to keep permanently loaded. -->

Use the Mikado Method to plan any non-trivial change. This guide covers **planning
only**: align on the goal, decide the load-bearing questions, decompose into a
dependency graph, red-team it, and get it approved. Running the plan — parallel
agents, PRs, narration — is in the execution guide.

## Keep this loaded automatically — no one should have to remember to ask

Agents lose context: sessions restart, conversations get summarized, work gets
handed to a fresh agent mid-effort. Don't rely on anyone re-prompting "go read the
Mikado guide" after that happens — paste this stub into the project's **`AGENTS.md`
or `CLAUDE.md`** (the file every tool reloads at the start of *every* session,
unconditionally, regardless of context state). It's a pointer, not the guide
itself, so it costs almost nothing to keep permanently loaded:

```markdown
## Mikado Method (planning & execution)

Any non-trivial change follows the Mikado Method. Full rules live in two files —
read the relevant one **in full** before proceeding, even if you believe you
already read it earlier in this conversation, in a prior session, or before a
context summary. Memory of having read it is not a substitute for reading it.

- Planning a change (new effort, or revising an approved plan):
  `templates/AGENTS-mikado-planning.md`
- Executing an approved plan (parallel agents, worktrees, PRs, narration):
  `templates/AGENTS-mikado-execution.md`
- If `MIKADO.md` exists at the repo root, an effort is already underway —
  read it first, regardless of which phase you think you're in.
```

## Core concepts (shared with the execution guide)

- **Mikado Method**: build a dependency graph of prerequisites, work from the leaves, parallelize independent branches.
- The graph is a **DAG, not a strict tree** — a node may have prerequisites in more than one branch (cross-branch edges).
- **Node roles**: **root** `G` = the goal; **trunk** = a node ≥2 branches depend on (shared interface/contract/schema/protocol); **branch** node; **convergence** = a node fed by >1 branch.
- **Node IDs** are stable and hierarchical: root `G`; trunks `T1, T2…`; branches `A, B, C…`; nodes `A1, A2…` where `A1` merges before `A2`.
- **Statuses**: `pending` / `in-progress` / `done`.
- **Artifacts**: `MIKADO.md` at the repo root is the canonical graph (goal, diagrams, node table, branch boundaries, collapse plan). This guide and the execution guide tell agents how to act in each phase.

## 1. Align before you decompose

**Check for an existing `MIKADO.md` first.** If one exists, an effort is already
underway — read it in full before anything else; don't re-derive context from
memory or restart alignment from scratch. Extend or revise the existing plan
rather than replacing it, and treat this section as governing plan *revisions*
too.

Don't open with a dependency graph. First reach a shared understanding with the user:

- **Context & goal** — the outcome they want and why, who uses it, and what "done" looks like at the product level.
- **Requirements & constraints** — must-haves vs. nice-to-haves, non-functional needs (performance, security, compatibility), and what's explicitly out of scope.
- **Open questions** — surface unknowns now; an unanswered product question becomes a hidden edge later.

Play this back and get confirmation before drawing anything. Decomposition built on a misread goal is wasted.

**Look ahead, but deliver iteratively.** Anticipate where the work is heading — enough
to avoid painting the architecture into a corner — but never front-load the whole
effort. Optimize the graph for **small chunks of delivered value**: ship a slice,
validate it works and points the right direction, then continue. Prefer the shortest
path to something real and reviewable over a complete-but-unvalidated foundation. When
a node exists only to serve speculative future work, defer it until the work is real.

**Offer a UI/UX mockup first when the change has a user-facing surface.** Ask whether the user wants to mock up the experience before planning the build. Unless they say otherwise, build a **fully clickable HTML prototype** — real navigation and states, not static images — so they can feel the flow and correct it cheaply. The approved mockup then anchors the requirements and the graph.

## 2. Design decisions before decomposition

List the load-bearing decisions in a **"Design decisions"** section at the top of
`MIKADO.md`: data model, error & status conventions, config/secrets source,
external dependencies, storage of shared state. Each decision creates or dissolves
cross-branch edges — most edges discovered mid-flight trace back to a decision
nobody wrote down (e.g. "where do auth tokens live?" decides whether auth depends
on persistence). An undecided item is a planning blocker, not a TODO.

For high-uncertainty areas, prefer a **throwaway spike first** to discover the real
prerequisite structure, then plan; mark exploratory nodes with a **risk flag** in
the node table so they're sequenced early or conservatively.

## 3. Architecture & flow diagrams are part of the plan

Whenever the work changes structure (new components, boundaries, protocols,
integrations), `MIKADO.md` includes, alongside the dependency graph:

- a **target-architecture diagram** — components and their boundaries in the end
  state, each labeled with the branch/node that builds it, so branch boundaries and
  trunk contracts are *visible* rather than asserted;
- a **flow diagram** for each key runtime path (e.g. request → auth → handler →
  store), since flows cross branch boundaries and are where contract mismatches surface.

The dependency graph says *in what order*; the architecture diagram says *what*; the
flow diagram says *how it behaves*. A plan with only the first is unreviewable.

**Diagram tooling:**

- **Dependency graph → Mermaid.** It diffs cleanly and each node is one editable row.
- **Architecture diagrams, flow diagrams, and any complex graph → SVG.** Mermaid's
  auto-layout tangles these into crossing edges that hide the structure. Hand-lay
  SVG for maximum legibility: group related components, keep flow left-to-right or
  top-to-bottom, and **avoid crossing lines unless truly unavoidable**.

Architecture docs are **living artifacts**: produce them in planning, and keep them
updated through execution (see the execution guide) — never a one-time deliverable.

## 4. Build the graph

- The **root** is the goal. Each **child** is a prerequisite that must land before its parent can. Recurse until every **leaf** can be done *now* with no unmet prerequisites.
- Record **every edge you know of**, including cross-branch ones; hunt explicitly for shared prerequisites — especially interfaces/contracts multiple branches build against.
- **Trunk-first**: any node ≥2 branches depend on is a **trunk node**, and trunk nodes merge *before* parallel agents spin up. This stops agents blocking mid-branch on another branch's work.
- **Contracts specify failure modes, not just signatures** — status codes, error-body shapes, null/edge behavior, and (where relevant) a reusable conformance test implementations must pass. Happy-path-only contracts let parallel branches silently diverge and collide at convergence.
- **Contract freeze**: once a trunk contract merges, changing it requires a plan-revision PR naming every dependent branch — never a quiet edit inside a node PR.
- The plan is a hypothesis and **attempts are how the graph learns**. If you discover a hidden prerequisite mid-node, don't push through — run the discovery loop (execution guide). The graph is a living document; update it as reality corrects the plan.
- IMPORTANT: We want to have an idea of the full architecture, and all the dependencies to get there, but we don't want to build the whole thing from the beginning. We should chop up the full tree into different pieces that stand on their own, that we can deliver incrementally. It's okay if we need to do some refactoring or other changes in order to deliver subsequent pieces of value. For example, don't implement at the beginning interfaces that will only be needed for the last couple of nodes. The planning document should articulate these different deliverables, each with their own dependency tree.

### Node requirements

Every node MUST be:

- **Discrete & individually deliverable** — lands on `main` by itself and leaves the codebase green (builds, tests pass) even before the parent goal is reached. Use feature flags, parallel implementations, or expand/contract patterns to keep intermediate states shippable.
- **One reviewable PR** — target **under 250 changed lines** whenever possible, and a single conceptual change. Smaller PRs review faster and more carefully; if a node can't yield one, split it.
- **Independent within its branch** — nodes on *different* branches must not touch the same files/modules. If two nodes must, they belong on the same branch (sequenced), not parallel branches. Minor, trivially-mergeable overlap aside.
- **Test-covered** — every node that ships behavior includes test coverage, unless the change is fully covered by type checks or other automated validation, or there's genuinely nothing to test (e.g. author-facing markdown/docs). State which in the acceptance criterion.
- **Explicitly labeled** — in every diagram, each node carries its **ID and a short description** (`A2: SqliteStorage backend`), never a bare `A2`.
- **Acceptance-criterion-bearing** — the node's table row states a one-line done-condition ("done when: \<observable behavior or named test passes\>"). If you can't write one, the node isn't individually deliverable — split or restructure.

## 5. Persist the graph in MIKADO.md

- Create `MIKADO.md` at the repo root in the effort's first PR. It holds: the goal, the design-decisions section, the Mermaid dependency graph, the SVG architecture/flow diagrams, a node table, branch boundaries, and the convergence/collapse plan.
- **Statuses**: a node's own PR flips its row to `done` and adds the PR link — "done" means "done when this PR merges". No post-merge bookkeeping edits.
- **Conflict hygiene** (so parallel agents merge cleanly):
  - Each node is exactly **one table row on one line**; agents edit *only their own node's row*.
  - The diagrams and prose change only in planning or plan-revision PRs, never in routine node PRs.
  - Rebase on latest `main` before opening a PR, so row conflicts stay rare and trivial.

## 6. Planning output checklist

Produce before any implementation:

- [ ] Alignment on context, goal, requirements, and scope — confirmed with the user (§1)
- [ ] UI/UX mockup offered (and, if taken, an approved clickable HTML prototype)
- [ ] Design-decisions section — all load-bearing choices decided, no "TBD" (§2)
- [ ] SVG target-architecture diagram (components labeled with building branch/node) and flow diagram(s) for key runtime paths, when structure changes (§3)
- [ ] Mermaid dependency graph with stable, labeled node IDs and all known cross-branch edges
- [ ] Trunk nodes identified and sequenced before parallel work
- [ ] Node table (ID, description, files/modules touched, acceptance criterion, test plan, risk flag, est. PR size) — one line per node
- [ ] Branch → agent assignment with explicit file boundaries per branch
- [ ] Convergence nodes identified, with collapse plan (which agent survives) and contract tests planned
- [ ] `MIKADO.md` created/updated

## 7. Red-team, then the approval gate

**Red-team the plan before presenting it.** Mechanically verify:

- [ ] For each parallel branch, list every file it touches; confirm the sets are pairwise disjoint (or overlap is trivially mergeable and justified).
- [ ] For each node, re-hunt prerequisites: what will its code import/read that isn't merged before it starts? Any hit = missing edge.
- [ ] Every design decision is actually decided — no "TBD" a branch silently resolves on its own.
- [ ] Every node has an acceptance criterion and a test plan (or a stated reason none is needed); every trunk contract specifies failure modes.
- [ ] Convergence nodes are single-concept (wire OR guard OR docs) — a convergence PR doing three things is three nodes.

**Then stop.** Present in chat: the Mermaid graph, the SVG architecture/flow diagrams
(when structure changes), the node table with acceptance criteria, the branch → agent
assignments, and anything the red-team pass changed. Do **not** create worktrees, spawn
agents, or start any node until the user approves. If they request changes, revise and
re-present. The same gate applies to plan revisions that restructure branches or reassign
agents (discovered-edge bookkeeping inside a node PR is exempt).

## 8. Crunch mode — explicit override only

Under time pressure the user may explicitly override these defaults and approve
**larger-scope nodes and PRs**, less iterative slicing, and (at execution time)
merging without their review. Only ever act on this when they say so directly —
never infer it from a deadline in the requirements, from urgency in the request, or
from silence. Honor exactly what was named, record the authorization and its scope in
`MIKADO.md`, and revert to these defaults once that work is done. Even in crunch mode,
nodes still need acceptance criteria and a test plan (see the execution guide).
