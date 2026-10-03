# Task Workflow Conventions

Per-repo values consumed by the task-lifecycle skills (`plan-task`, `work-task`, `init-task`). Those skills reference the concepts below by role name; the exact strings, commands, and paths live here. Editing this file re-targets the skills without touching them.

Produced by the `setup-skills` skill; safe to edit by hand afterwards.

## Lifecycle statuses

One state store: the issue tracker (see `issue-tracker.md`). A lifecycle status is a `status:*` label — exactly one per issue, so setting one removes the previous. Strings are exact; skills must never invent variants.

- **Parents** flow planned → in progress → in review; their status is the team-facing signal.
- **Slices** are child tasks of the parent (see *Plan children* below), flowing backlog → in progress → in review. **A slice's status is set by the orchestrator that verified the work — commit present, gate green — never by the agent that implemented it.** A blocked or deferred slice simply stays in backlog; one stuck on a human keeps the backlog status and gets the *blocked on a human* tag.

**When a parent may reach in-review:** every slice of the parent is in-review — AFK *and* HITL. A HITL slice is unbuilt work, so it blocks the close: the parent stays in progress until a human drains it. The `[QA]` subtask does **not** block, because it is verification *of* the review, not work inside it — but every `[FIX]` child the QA phase creates from a ❌ is a slice, and blocks like one. A drain that leaves HITL slices pending still opens the MR and comments the roll-up — it just does not flip the status.

Skills name these roles; this table is the only place the strings live. `Backlog`, `Planned`, `In progress`, `In review` and `Blocked on a human` are the row labels a parser looks for — keep them verbatim.

| Role | String | Where | Notes |
|---|---|---|---|
| Backlog (slices) | `{backlog label, e.g. status:backlog}` | status label | Slices wait and get deferred here |
| Planned (parents only) | `{planned label, e.g. status:planned}` | status label | |
| In progress | `{in-progress label, e.g. status:in-progress}` | status label | For a slice: set when delegated |
| In review | `{in-review label, e.g. status:in-review}` | status label | Set by the verifying orchestrator |
| Blocked on a human | `needs-info` | plain label (**tag**) | Slices only (they keep the backlog status); parents get a tracker comment instead |

## Plan children (tracker)

Planning writes the tracker, never the repo: `plan-task` commits nothing and creates no branch (the branch is created by `init-task` when work starts). Every plan artifact is a **child task of the parent**, identified by title prefix and/or triage tag:

- **`[SPEC]`** — the parent spec (its description). Read as context, excluded from every work queue.
- **Slices** — one child per unit of work: description = tracer bullet + acceptance criteria, self-sufficient for a fresh-context agent; triage tag `ready-for-agent` (AFK) or `ready-for-human` (HITL); blocking edges as tracker *blocked by* dependencies; created in topological order (creation order is the default work order).
- **`[DOCS]`** — only when planning settled domain docs (glossary/ADRs): carries the literal content (the tree edits were reverted at planning time), tagged `ready-for-agent`, blocking every slice. Applied as the branch's first commit.
- **`[QA]`** — the QA checklist lives in its **description** (created by `plan-task`; every item names its lane, *agent* or *human*, with executable steps). Drained by the QA phase of `work-task` and of the automated worker, and by `qa-task` by hand; verdicts are recorded in that same description. Never blocks the close by itself.
- **`[FIX]`** — a child born from a ❌ verdict of the QA phase: created by the orchestrator (never by the agent that verified), tagged `ready-for-agent`, status backlog, description = expected vs observed + steps to reproduce. It **is a slice**: it is drained by the same loop, with the same mandate and gate, and it blocks the close like any slice. See *QA* below for the cycle bound.

A slice counts as done only when its tracker status says in-review — and that status is the verdict of the orchestrator that checked the commit and re-ran the gate, because implementing agents never touch the tracker.

## Branching & merge requests

- Base/integration branch: `{base branch, e.g. dev}` (branches are created from it and MRs target it). {If protected: "Protected — direct pushes are rejected; everything reaches it via MR."}
- The base branch is the **default**, not the only option: an orchestrator can force another one per run (the sandcastle worker takes `--base`, offered as a menu by its entry point). Work that hangs off a long-lived side branch goes there without editing this line.
- Branch naming: `{feature|fix|chore}/{task-id}-{slug}` (lowercase, no accents, ≤60 chars). Created by `init-task` (called by `work-task`) when work starts, and recorded in the parent's description as `- Rama:`.
- {Special targets, e.g. "Hotfix branches (`hotfix/`) target `main` instead" — delete if there are none.}
- MR CLI: `gh`.
- New-MR web URL (fallback when the CLI is not used): `{URL template with {branch} and {target}}`

## Environment

Commands a skill may need to make the app runnable before verifying anything by hand or in a browser. Delete a line that does not apply.

- Bring the app up: `{command}`
- Apply migrations after checking out a branch that adds them: `{command}`
- Browser credentials and URLs: `{where they live}`

## Quality gate

Every slice must be green on its gate before moving to in-review, and in every tier **the gate is verified from outside the agent that wrote the code**: the orchestrator (the parent loop in `work-task`, any automated worker) runs it itself and only accepts work whose gate exits zero. An agent's claim that it ran green is a claim, never proof — same rule as the slice status, which only the orchestrator sets.

Keep one block per execution environment, and keep them equivalent. Every block carries the three legs — tests, **static analysis**, formatting — because a gate that only runs tests trusts tests that can lie (tautological asserts, stubs that cannot fail): the static-analysis leg is mandatory, not a slot to leave empty. Judgement-call rules (what the linter cannot check) live in `CODING_STANDARDS.md` at the repo root, read by the review axis and never by the implementing agent.

### Host

Run by `work-task` and by hand.

```bash
{test command, scoped to the new work when possible}
{static analysis command — no new errors}
{formatting command — applied}
```

### Sandbox

The full gate: run inside the container by an automated worker **once at parent close**, before the MR (delete this block if there is no worker). Unscoped on purpose — a verifier that picks its own filter can miss the regression it caused — and the formatter checks instead of rewriting.

```bash
{test command, full}
{static analysis command}
{formatting command in check mode}
```

### Sandbox — slice

The slice gate: run by the worker after **each slice**, scoped to what the branch changed so a drain does not pay the full suite N times (delete this block to have the worker run the full gate per slice instead — correct, just slower). A slice's in-review status is provisional against the close gate above, which remains the authority: cross-slice breakage a scoped run missed surfaces there, and a red close gate keeps the parent open. Gitignore the state files of any scoped tool (test-impact databases, incremental build info).

```bash
{test command scoped to the changes, e.g. test-impact selection}
{static analysis command}
{formatting command in check mode}
```

### Model routing

Everything runs on the worker's default model (Opus 5) — slices and the close review alike. A slice tagged `sonnet` in the tracker routes to the light model instead (Sonnet). Reasoning effort applies to every run; unset, Fable models run `low` and every other model `high`, so the default runs `high`.

The model is chosen per run, highest precedence first: the invocation flag (`--model`, offered as a menu by the entry point), the shell environment (`SANDCASTLE_MODEL`, `SANDCASTLE_LIGHT_MODEL`, `SANDCASTLE_EFFORT`), `.sandcastle/.env`, the code default. Aliases `opus`, `fable` and `sonnet` resolve to ids; anything else is passed to the provider untouched.

The tag string is a worker literal (hardcoded like the triage tags — editing this section does not re-target it); `plan-task` (step 5) owns the eligibility criteria and applies the tag to the slices simple enough not to need the default.

## QA

The QA phase runs once **every** slice of the parent is in-review — AFK and HITL alike, since an unbuilt HITL slice would turn its checklist items into `[FIX]` work for an agent — and **before** the close (review + MR), so its fixes travel in the same MR and get the same review. The verifying agent observes and reports; **the orchestrator persists the verdicts and creates the `[FIX]` children** — the agent never touches the tracker and never commits. Evidence is text only (what was seen: data, count, URL, expected vs observed); no screenshots are kept.

Cycle: verify → a `[FIX]` child per ❌ → drain the fixes as slices → verify again (only the items without a `- [x]` verdict). Bounded by the cycles value below (N cycles = N verifications and N−1 fix rounds: the last cycle only verifies); a ❌ that survives the last cycle keeps its ❌ and its `[FIX]` child gets the *blocked on a human* tag, which leaves the parent in progress by the slice rule. The MR still opens: the code is reviewable, the parent just does not flip to in-review.

Verdict lines in the checklist (one per item, written under it): `- [x]` + `→ ✅ agente: {evidence}` (done, skipped on re-run); `- [ ]` + `→ 🙋 humano: {steps / how far the agent got}` (skipped on re-run — only a human flips it); `- [ ]` + `→ ❌ FALLÓ: {expected vs observed}` (re-verified on every cycle); bare `- [ ]` (pending).

A parser reads these lines; keep the labels verbatim.

- Browser lane: `{yes|no}` — `yes` when the sandbox image ships Chromium + `playwright-cli` (see the `setup-sandcastle` Dockerfile snippet). With `no`, every item that needs a browser is human-lane in the sandbox; on the host `qa-task` still uses the browser if `playwright-cli` is installed.
- QA↔fix cycles: `{number, e.g. 2}`
- Credentials: `{how the agent logs in, e.g. "seeded user test@example.com / password" — or "none"}`

### Host

Run by `work-task` and `qa-task`, on the developer's machine. The app URL is the first backticked value; the commands bring it up.

```bash
{command to bring the app up on the host, e.g. make up}
```

- App URL (host): `{URL, e.g. http://localhost:8080}`

### Sandbox

Run by the automated worker inside its image: no Docker, no `make`. The agent runs them before the first item of **every** cycle, in the same container, so they must be idempotent: a fresh migrate + seed, and a serve guarded so a second cycle does not fight the first over the port. Each command is exec'd on its own; the one that serves the app must detach (`nohup … &`).

```bash
{idempotent migrate + seed, e.g. cd src && php artisan migrate:fresh --force --seed}
{guarded serve, e.g. cd src && (curl -sf http://127.0.0.1:8000 >/dev/null || nohup php artisan serve --host=127.0.0.1 --port=8000 >/tmp/serve.log 2>&1 &)}
```

- App URL (sandbox): `{URL, e.g. http://127.0.0.1:8000}`

## Guardrails

Where the gate also runs **without any agent or human in the loop** — the deterministic brake. The CI job is mandatory: an agent that forgets the gate and a reviewer who trusts a green claim are both caught here. The hook is optional (fast, scoped to staged files).

- CI: `{path to the pipeline file, e.g. .github/workflows/gate.yml}` — runs the Host gate on every MR against the base branch.
- Pre-commit hook: `{path, e.g. .githooks/pre-commit, wired with core.hooksPath — or "none"}`.
- Static analysis: `{tool and config, e.g. larastan level 6 (phpstan.neon)}`.

## Paths

Every path the workflow owns lives here, and an automated worker parses this section: each line is `Label: `value`` and the parser takes the first backticked value after the label. Keep the labels verbatim, and keep `{parent-id}` as the literal placeholder — the caller substitutes it.

- Work log (bitácora): `{path, e.g. work-logs/{parent-id}.md}` — the only plan-adjacent repo file: a work artifact, versioned and committed alongside each slice on the parent branch, reaching base through the MR.
- Domain docs (glossary + ADRs): `docs/agents/domain.md` — the pointer file; the glossary and ADRs themselves are listed inside it.
- **Slice mandate — canonical**: `{path to the single slice prompt, e.g. docs/agents/prompts/slice.md}`. One file, every consumer: an automated worker passes it as its prompt, and `work-task` injects it into its subagent. Neither restates it; both substitute the placeholders it declares for their environment.
- **Parent close mandate**: `{path, e.g. docs/agents/prompts/close.md}` — the review + handbook pass that runs once per parent, before the MR.
- **Loose task mandate**: `{path, e.g. docs/agents/prompts/task.md}` — one tracker task outside any plan (no spec, no work log, no close pass), run by the loose-task drain. Optional: without this line the worker still drains parents, only the loose-task drain refuses to start.
- **QA mandate**: `{path, e.g. docs/agents/prompts/qa.md}` — the verification pass over the `[QA]` checklist, run once per cycle before the close. Optional: without this line the QA phase is skipped everywhere (worker and `work-task`).

## Documentation routing

Which producer skill a change feeds, when a close reviews whether it needs docs (`task-finish`). Axes are independent — one change may trigger both; if none triggers, the step is a silent skip. Delete this section if the repo has no doc-producing skills.

| Axis | Signal | Producer skill |
|---|---|---|
| {axis name} | {the signal in the diff that triggers it} | `{skill}` ({destination}) |

Discriminator: {the one question that tells the axes apart}.

## Review policy

What a human reviewer owes each MR, read from its `## Riesgo de merge` block (every MR body in this workflow carries it, in the shape of the `pr` skill). Not every check deserves the same attention; irreversible ones deserve all of it.

- **Two-way door, local blast radius**: skim the summary and the evidence; merge on green. The automated review already applied its fixes.
- **Two-way door, wider blast radius**: read the diff where the radius note points (consumers, deploy order).
- **One-way door** (destructive migration, data touched, irreversible side effect): full review, run it locally, no exceptions.
- A comment a reviewer writes twice is a bug in the environment, not in the code: it goes to `/retro`, which turns it into a check or a `CODING_STANDARDS.md` rule.

## Handbook (optional section)

Delete this section if the repo has no operator/admin handbook — `work-task` then skips its handbook step silently, and `write-handbook` refuses to run.

- Trigger: `{when the parent's accumulated work warrants a handbook page — describe the signal}`.
- Producer skill: `{skill name, e.g. write-handbook}`.
- Root path: `{handbook root, e.g. src/resources/handbook/}` — `{structure: depth, folder naming}`.
- Page format: `{filename convention}`; required frontmatter: `{fields}`; links between pages: `{convention}`; images/assets: `{convention}`; rendering constraints: `{markdown flavor, raw HTML allowed or not, styling rules}`.
- Dynamic blocks (hybrid pages): `{how a page embeds runtime-rendered content — e.g. a frontmatter key naming a view the app renders after the body — or "none": content that changes with the system goes here, never hand-copied into the page}`.
- Language: `{language of handbook content}`.
- Rationale: `{path to the ADR/doc explaining these rules, or delete this line}`.
