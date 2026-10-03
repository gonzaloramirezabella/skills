# Issue Tracker

Everything lives in **GitHub**, in this repo:

- **Issues** hold the work and its plan: **parent issues** (priorities, lifecycle status, roll-up comments) and, per planned parent, its **sub-issues** — `[SPEC]`, one sub-issue per slice (triage labels + *blocked by* dependencies), `[DOCS]` when planning settled domain docs, and `[QA]` with the manual checklist in its body. Shape and statuses in `task-workflow.md`. Planning commits nothing to the repo.
- **Pull requests** carry the code; CI runs on them. The PR body links the parent (`## Tarea`); a human closes the parent after the merge — never automatically, because a merged PR can leave HITL slices pending.

## How to access GitHub

Via the **`gh`** CLI (https://cli.github.com) — chosen over GitHub MCP servers because `--json`/`--jq` output costs a fraction of the tokens of raw API JSON, and no MCP tool definitions are loaded into every session.

One-time setup per machine:

```bash
brew install gh        # or the OS package manager
gh auth login          # interactive — run by the user, never by an agent
gh auth status         # exit 0 = authenticated
```

Agents never run `gh auth token`, read `~/.config/gh/hosts.yml` or grep for `GH_TOKEN`: the output lands in the transcript. Never write a token into a file inside the repo.

For higher-level flows that are already wrapped, prefer the project skill over raw CLI calls:

- `plan-task` — plan an issue: grill → `[SPEC]`, slices, `[DOCS]` and `[QA]` as sub-issues of the parent; the parent ends in the *planned* status pointing at them. No commits, no branch.
- `work-task` — execute planned work: create the parent branch (via `init-task`), do each AFK slice in a subagent, verify and set each slice's status to *in review*.

## Model mapping

| Suite concept | GitHub |
| --- | --- |
| Task id | Issue **number** (`42`, written `#42` in prose) |
| Child task | Sub-issue of the parent, same repo |
| Lifecycle status | One `status:*` label per issue — exact strings in `task-workflow.md` |
| Tag | Any other label (triage roles in `triage-labels.md`, `needs-info`, the light-model tag) |
| Blocked by | Native issue dependency |
| Description | Issue body (markdown) |

## Token rules

- Always `--json` with the minimal field list and `--jq`; never dump a whole issue or `gh api` response.
- `gh issue view N --json body --jq .body` for descriptions.
- Multi-line text (bodies, comments) goes through `--body-file {file}` or `--body-file -`, never inline in the shell.
- `gh issue list` defaults to 30 results — pass `--limit` when building a queue.

## Command map

The task-lifecycle skills never name a tracker or a binary: they ask for an **operation by role** and read the command from here. The first block is the contract those skills rely on — keep the operation names verbatim. `{owner}/{repo}` inside `gh api` paths is resolved by `gh` from the current repo.

| Operation | Command |
| --- | --- |
| Health check | `gh auth status` (exit 0 = authenticated) |
| My user id | `gh api user --jq .login` (or `@me` in `gh issue` flags) |
| Get task (fields) | `gh issue view {id} --json number,title,state,labels --jq '{number,title,state,labels:[.labels[].name]}'` |
| Get task (full description) | `gh issue view {id} --json body --jq .body` |
| List subtasks | `gh api 'repos/{owner}/{repo}/issues/{id}/sub_issues?per_page=100' --jq '.[] \| {number,title,labels:[.labels[].name]}'` (with dependencies: GraphQL query in the `github-issues` skill) |
| Search by status + assignee | `gh issue list --label "{status}" --assignee @me --state open --limit 100 --json number,title,createdAt` |
| Set status | `gh issue edit {id} --add-label "{status}" --remove-label "{previous status}"` |
| Replace description | `gh issue edit {id} --body-file {file}` |
| Create child task | `gh issue create --title "{name}" --body-file {file} --label "{status},{tags}" --assignee @me`, then `gh api -X POST repos/{owner}/{repo}/issues/{parent-id}/sub_issues -F sub_issue_id=$(gh api repos/{owner}/{repo}/issues/{new-number} --jq .id)` |
| Add / remove a tag | `gh issue edit {id} --add-label {tag}` / `gh issue edit {id} --remove-label {tag}` |
| Mark blocked by | `gh api -X POST repos/{owner}/{repo}/issues/{id}/dependencies/blocked_by -F issue_id=$(gh api repos/{owner}/{repo}/issues/{blocker-id} --jq .id)` |
| Comment | `gh issue comment {id} --body-file -` |
| Task web URL | `https://github.com/{owner}/{repo}/issues/{id}` |

Quirks a caller must know:

- **Replace description is destructive**: it overwrites the whole body. Fetch it, edit locally, upload the whole thing. The parent's `- Rama:` block is load-bearing — never lose it.
- **Set status is two flags, not one**: an issue must carry exactly one `status:*` label, so always remove the previous one. A label that does not exist in the repo fails with `label not found` — never invent a variant; exact strings in `task-workflow.md`, created once by `setup-skills`.
- **Sub-issue and dependency calls take the database `id`**, not the number: `gh api repos/{owner}/{repo}/issues/{n} --jq .id`. Creating a child is always two calls (create, then link).
- **`gh issue list` cannot filter by parent**: a parent's queue always comes from `sub_issues`, never from `list`.
- **Dependencies are not in `sub_issues`**: read them with `gh issue view {id} --json blockedBy` or the GraphQL query; fall back to creation order if they cannot be read.

## Workspace conventions

- Work type is encoded in the title prefix (`[Bug] ...`, `[Feature] ...`) or in a GitHub issue type if the organization defines them. The `[SPEC]`/`[DOCS]`/`[QA]`/`[FIX]` prefixes of plan children are part of the suite's contract.
- For issue lookups by human-readable name, prefer `gh issue list --search "{words} in:title"` over guessing numbers.

## When a skill says "create an issue"

- **A plan child of a parent being planned** (anything `to-spec` / `to-tickets` / `plan-task` produces — the `[SPEC]`, a slice, the `[DOCS]`, the `[QA]`) → *create child task*: a sub-issue of the parent, in this repo.
- **Anything else** (a genuinely new task, a bug found mid-work that exceeds the current scope) → `gh issue create` in this repo, with the triage label per `triage-labels.md` and no status label until it is planned.

## When a skill says "comment on the issue"

Use `gh issue comment {id} --body-file -`. Lifecycle skills comment on the **parent** (roll-ups, needs-info signals) and on the `[QA]` child (QA verdicts).

## When a skill says "move issue to state X"

Map the canonical triage roles to labels as documented in `triage-labels.md`. Lifecycle **statuses** are the `status:*` labels — exact strings in `task-workflow.md` — and are managed by `plan-task` / `work-task` (never by the implementing subagents), not by the triage skill.

## Pull requests

- Opened with `gh pr create` against the base branch in `task-workflow.md`; the body follows the `pr` skill's shape and ends with the parent's URL under `## Tarea` (no closing keyword: the parent is closed by a human).
- CI runs the gate on every PR (see `task-workflow.md` § Guardrails).
