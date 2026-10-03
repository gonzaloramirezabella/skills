# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's GitHub Issues.

| Canonical role    | GitHub label        | Meaning                                  |
| ----------------- | ------------------- | ---------------------------------------- |
| `needs-triage`    | `{label}`           | Maintainer needs to evaluate this issue  |
| `needs-info`      | `{label}`           | Waiting on a human for more information  |
| `ready-for-agent` | `{label}`           | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `{label}`           | Requires human implementation            |
| `wontfix`         | `{label}`           | Will not be actioned                     |

Default: each role's label equals its canonical name. Labels exist per repo: `setup-skills` creates the five (plus the light-model tag from `task-workflow.md` § Model routing) with `gh label create`; an `--add-label` on a missing label fails.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), apply it via `gh issue edit {id} --add-label {label}` (and `--remove-label {previous}` if the issue is moving between roles).

These triage labels are **independent of** the lifecycle `status:*` labels (planned / in progress / in review — exact strings in `task-workflow.md`); those are managed by `plan-task` / `work-task`, not by the triage skill.

Edit the label column if you decide to rename any labels later.
