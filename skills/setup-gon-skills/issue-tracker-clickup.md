# Issue Tracker

Issues and tasks for this repo live in **ClickUp**, not in {git host} issues. {Git host} is used only for code, merge requests, and CI.

Skills that need to create, read, update, or list issues should treat ClickUp as the source of truth.

## How to access ClickUp

There are two ways, in order of preference:

1. **ClickUp MCP tools** — preferred. Tools are namespaced `clickup_*` (e.g. `clickup_create_task`, `clickup_get_task`, `clickup_update_task`, `clickup_filter_tasks`, `clickup_create_task_comment`, `clickup_search`). Use these for any structured create/read/update operation.
2. **Existing project skills** — for higher-level flows that are already wrapped, prefer the skill over raw MCP calls:
   - `plan-task` — plan a ClickUp task: grill → spec → tickets → manual-QA issue, leaving the parent in the *planned* status. Does **not** create a branch.
   - `work-task` — execute planned work: create the branch with `init-task`, apply the `[DOCS]` issue as the first commit, do each AFK slice in a subagent, and move everything to the *in review* status.

## Workspace conventions

- {Task types available in this workspace, or how to encode type when types don't exist — e.g. a title prefix like `[Bug] ...`.}
- Use `clickup_get_workspace_hierarchy` once at the start of a session if you need to discover space / folder / list IDs; cache the result for the rest of the session.
- For task lookups by human-readable name, prefer `clickup_search` or `clickup_filter_tasks` over guessing IDs.

## When a skill says "create an issue"

Default: `clickup_create_task` in the list the user names (ask if unspecified). Apply triage tags per `triage-labels.md`. Do not open a {git host} issue unless the user explicitly asks for one.

## When a skill says "comment on the issue"

Use `clickup_create_task_comment`.

## When a skill says "move issue to state X"

Map the canonical triage roles to ClickUp tags as documented in `triage-labels.md`. ClickUp **statuses** belong to the work-in-progress lifecycle — exact strings in `task-workflow.md` — and are managed by `plan-task` / `work-task`, not by the triage skill.

## {Git host}'s role

{Git host} still owns:

- Source of truth for code, branches, tags.
- Merge requests (via the {MR CLI, e.g. `glab` / `gh`} CLI — see `task-workflow.md`).
- CI pipelines and release tags.
