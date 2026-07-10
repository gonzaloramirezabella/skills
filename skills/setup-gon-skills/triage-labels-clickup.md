# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

Issues live in ClickUp (see `issue-tracker.md`), so each role maps to a **ClickUp tag**.

| Canonical role    | ClickUp tag         | Meaning                                  |
| ----------------- | ------------------- | ---------------------------------------- |
| `needs-triage`    | `{tag}`             | Maintainer needs to evaluate this issue  |
| `needs-info`      | `{tag}`             | Waiting on reporter for more information |
| `ready-for-agent` | `{tag}`             | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `{tag}`             | Requires human implementation            |
| `wontfix`         | `{tag}`             | Will not be actioned                     |

Default: each role's tag equals its canonical name.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), apply the corresponding tag via `clickup_add_tag_to_task` (and remove the previous role's tag via `clickup_remove_tag_from_task` if the issue is moving between roles).

These triage tags are **independent of** the ClickUp lifecycle statuses (planned / in progress / in review — exact strings in `task-workflow.md`); those are managed by `plan-task` / `work-task`, not by the triage skill.

Edit the tag column if you decide to rename any tags later.
