# Skills de Gon

Skills de ciclo de vida de tareas para agentes (Claude Code y compatibles): planificar una tarea de ClickUp hasta dejarla lista para agentes, y ejecutarla de punta a punta hasta el MR.

Complementan las [skills de ingeniería de Matt Pocock](https://github.com/mattpocock/skills) (`grilling`, `to-spec`, `to-tickets`, `tdd`, `code-review`, `triage`), que son dependencia.

## Skills

| Skill | Qué hace |
|---|---|
| `plan-task` | Planifica una tarea de ClickUp: grilling + domain-modeling → spec (`[SPEC]`) → tickets con dependencias → issue `[DOCS]` → issue `[QA]` manual. Deja el padre en *planned*. |
| `work-task` | Ejecuta trabajo planificado de forma autónoma: rama, `[DOCS]` como primer commit, un subagente por slice (TDD + gate), code review del diff, MR y roll-up. Deja todo en *in review*. |
| `init-task` | Setup mecánico no-interactivo: trae la tarea, crea la rama desde la base y pone el status en *in progress*. Lo usa `work-task` vía subagente. |
| `setup-gon-skills` | Setup por repo: genera `docs/agents/task-workflow.md` (statuses, gate, ramas, rutas) que las otras tres leen. Correr una vez por proyecto. |
| `setup-project` | Setup inicial de un repo nuevo: Docker + Makefile, `AGENTS.md`/`CLAUDE.md` con symlinks, instalación de skills (mattpocock, gon, playwright-cli), layout de `docs/` y primera página del handbook. Correr una vez, al arrancar el repo. |
| `write-handbook` | Crea o actualiza páginas del Handbook (docs de operación para admins/operadores). Ruta, formato e idioma salen de la sección Handbook de `task-workflow.md`; sin esa sección no corre. |

## Instalación

```bash
npx skills add gonzaloramirezabella/skills --skill '*' -y
npx skills add mattpocock/skills --skill '*' -y   # dependencia (setup-gon-skills la instala si falta)
```

Después, en el proyecto: `/setup-gon-skills` — verifica dependencias, corre `setup-matt-pocock-skills` si hace falta y genera la configuración del repo.

## Requisitos

- Issue tracker **ClickUp**, accesible vía MCP (tools `clickup_*`).
- Git con una rama de integración (p. ej. `dev`) y un CLI de MR (`glab` o `gh`).

## Actualizar

```bash
npx skills update
```
