# Task Workflow Conventions

Per-repo values consumed by the task-lifecycle skills (`plan-task`, `work-task`, `init-task`). Those skills reference the concepts below by role name; the exact strings, commands, and paths live here. Editing this file re-targets the skills without touching them.

Produced by the `setup-gon-skills` skill; safe to edit by hand afterwards.

## Lifecycle statuses

Issue-tracker statuses for the work-in-progress lifecycle (tracker: ClickUp — see `issue-tracker.md`). Strings are exact; skills must never invent variants.

| Role | String | Notes |
|---|---|---|
| Backlog (slices) | `{backlog status, e.g. "to do"}` | Slices wait and get deferred here |
| Planned (parents only) | `{planned status, e.g. "planificado"}` | |
| In progress | `{in-progress status, e.g. "iniciado"}` | |
| In review | `{in-review status, e.g. "Revisión"}` | |

Parents flow planned → in progress → in review; slices flow backlog → in progress → in review.

## Branching & merge requests

- Base/integration branch: `{base branch, e.g. dev}` (branches are created from it and MRs target it).
- Branch naming: `{feature|fix|chore}/{task-id}-{slug}` (lowercase, no accents, ≤60 chars).
- MR CLI: `{glab (GitLab) | gh (GitHub)}`.

## Quality gate

Every slice must be green on all of these before moving to in-review:

```bash
{test command, scoped to the new work when possible}
{static analysis command — no new errors}
{formatting command — applied}
```

## Paths

- Work log (bitácora): `{path, e.g. plans/work/{parent-id}.md}` — versioned, committed alongside each slice.
- Domain docs (glossary + ADRs): see `domain.md`.

## Handbook (optional section)

Delete this section if the repo has no operator/admin handbook — `work-task` then skips its handbook step silently.

- Trigger: `{when the parent's accumulated work warrants a handbook page — describe the signal}`.
- Producer skill: `{skill name, e.g. write-handbook}`.
