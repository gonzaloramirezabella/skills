# Issue Tracker

Tracking for this repo is split by audience:

- **ClickUp** holds the work and its plan: **parent tasks** (priorities, lifecycle status, roll-up comments) and, per planned parent, its **child tasks** — `[SPEC]`, one child per slice (triage tags + dependencies), `[DOCS]` when planning settled domain docs, and `[QA]` with the manual checklist in its description. Shape and statuses in `task-workflow.md`. Planning commits nothing to the repo.
- **{Git host}** is used only for code, merge requests, and CI.

## How to access ClickUp

Via the **`clickup-cli`** binary (https://clickup-cli.com, repo `nicholasbester/clickup-cli`) — chosen over ClickUp MCP servers because its flattened table output costs a fraction of the tokens of raw API JSON, and no MCP tool definitions are loaded into every session.

One-time setup per machine:

```bash
npm install -g @nick.bester/clickup-cli   # or: brew install clickup-cli / cargo install clickup-cli
clickup-cli setup --token pk_...          # or export CLICKUP_TOKEN (preferred)
clickup-cli auth check                    # exit 0 = authenticated
```

Prefer the `CLICKUP_TOKEN` env var; if using the config file, `chmod 600` the path `setup` reports (`~/.config/clickup-cli/config.toml` on Linux, `~/Library/Application Support/clickup-cli/config.toml` on macOS). Never create a `.clickup.toml` inside a repo (plaintext token, easy to commit by accident).

For higher-level flows that are already wrapped, prefer the project skill over raw CLI calls:

- `plan-task` — plan a ClickUp task: grill → `[SPEC]`, slices, `[DOCS]` and `[QA]` as children of the parent; the parent ends in the *planned* status pointing at them. No commits, no branch.
- `work-task` — execute planned work: create the parent branch (via `init-task`), do each AFK slice in a subagent, verify and set each slice's status to *in review* in the tracker.

## Token rules

- Default output (flattened table) is the cheapest — keep it. **Never `--output json`** (full API payload); if you need structure, use `--output json-compact`.
- `--fields` to select only the columns you need; `-q` when you only need IDs.
- `task get {id} --markdown` when the description's inline link URLs matter (the flattened `description` drops them).
- Multi-line text (descriptions, comments) goes through `@{file}` or `@-` (stdin), never inline in the shell.

## Command map

The task-lifecycle skills never name a tracker or a binary: they ask for an **operation by role** and read the command from here. The first block is the contract those skills rely on — keep the operation names verbatim.

| Operation | Command |
| --- | --- |
| Health check | `clickup-cli auth check` (exit 0 = authenticated) |
| My user id | `clickup-cli auth whoami` |
| Get task (fields) | `clickup-cli task get {id} --fields id,name,status,tags` |
| Get task (full description) | `clickup-cli task get {id} --markdown` |
| List subtasks | `clickup-cli task get {id} --subtasks` |
| Search by status + assignee | `clickup-cli task search --status "{status}" --assignee {user-id}` (add `--list`/`--space`/`--tag`) |
| Set status | `clickup-cli task update {id} --status "{status}"` |
| Replace description | `clickup-cli task update {id} --description @{file}` |
| Create child task | `clickup-cli task create --list {LIST_ID} --parent {parent-id} --name "{name}" --description @{file}` |
| Add / remove a tag | `clickup-cli task add-tag {id} {tag}` / `clickup-cli task remove-tag {id} {tag}` |
| Mark blocked by | `clickup-cli task add-dep {id} --depends-on {blocker-id}` |
| Comment | `clickup-cli comment create --task {id} --text @-` |
| Task web URL | `https://app.clickup.com/t/{id}` |

Quirks a caller must know:

- **Replace description is destructive**: it overwrites the whole field. Fetch with `--markdown`, edit locally, upload the whole thing. The parent's `- Rama:` block is load-bearing — never lose it.
- **`task search` does not include subtasks** — a matching task that is itself a subtask of another is not returned. Fallback when a queue looks incomplete: fetch known parents with `task get {id} --subtasks`, or hit the filter endpoint directly with `curl -H "Authorization: $CLICKUP_TOKEN" "https://api.clickup.com/api/v2/team/{workspace-id}/task?statuses%5B%5D={status}&subtasks=true"`.
- **Set status fails loudly** on an unknown string (`Status does not exist`). Never invent a variant — exact strings in `task-workflow.md`.
- **Dependencies are not always readable** from `task get`'s flattened output; read them defensively (`--output json-compact`) and fall back to creation order if they cannot be interpreted with confidence.

Beyond the contract, for triage and wayfinding:

| Operation | Command |
| --- | --- |
| Discover a list's statuses | `clickup-cli list get {LIST_ID} --output json \| jq '[.[].statuses[].status]'` |
| Discover hierarchy IDs | `clickup-cli space list`, `folder list --space {id}`, `list list --folder {id}` — once per session, cache the IDs |

## Workspace conventions

- {Task types available in this workspace, or how to encode type when types don't exist — e.g. a title prefix like `[Bug] ...`. The `[SPEC]`/`[DOCS]`/`[QA]` prefixes of plan children are part of the suite's contract.}
- For task lookups by human-readable name, prefer `task search` over guessing IDs.

## When a skill says "create an issue"

- **A plan child of a parent being planned** (anything `to-spec` / `to-tickets` / `plan-task` produces — the `[SPEC]`, a slice, the `[DOCS]`, the `[QA]`) → *create child task* with `parent` = the parent's id, in the parent's own list.
- **Anything else** (a genuinely new task, a bug found mid-work that exceeds the current scope) → `clickup-cli task create --list {LIST_ID}` in the list the user names (ask if unspecified). Apply triage tags per `triage-labels.md`. Do not open a {git host} issue unless the user explicitly asks for one.

## When a skill says "comment on the issue"

Use `clickup-cli comment create --task {id} --text @-`. Lifecycle skills comment on the **parent** (roll-ups, needs-info signals) and on the `[QA]` child (QA verdicts).

## When a skill says "move issue to state X"

Map the canonical triage roles to ClickUp tags as documented in `triage-labels.md`. ClickUp **statuses** belong to the work-in-progress lifecycle — exact strings in `task-workflow.md` — and are managed by `plan-task` / `work-task` (never by the implementing subagents), not by the triage skill.

## {Git host}'s role

{Git host} still owns:

- Source of truth for code, branches, tags.
- Merge requests (via the {MR CLI, e.g. `glab` / `gh`} CLI — see `task-workflow.md`).
- CI pipelines and release tags.
