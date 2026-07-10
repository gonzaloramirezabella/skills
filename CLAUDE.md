# Qué es este repo

Fuente de verdad de mis skills de ciclo de vida de tareas para agentes (Claude Code y compatibles). Los proyectos consumidores **no se editan directamente**: se edita acá, se pushea, y cada proyecto corre `npx skills update`.

- Layout: `skills/{nombre}/SKILL.md` (+ `REFERENCE.md` si tiene plantillas). El CLI `npx skills` escanea ese layout.
- Instalación en un proyecto: `npx skills add gonzaloramirezabella/skills --skill '*' -y`. **Nunca `--all`** (implica `--agent '*'` y crea directorios basura como `agent/` o `data/skills/`). La lista con comas (`--skill a,b`) está rota: una por una o `'*'`.
- El instalador copia cada skill a `.agents/skills/{nombre}` y la registra en `skills-lock.json` del proyecto (source + hash); `.claude/skills` es un symlink a `.agents/skills`.

# Cómo funciona una skill

Una skill es un prompt, no un script: `SKILL.md` con frontmatter (`name`, `description`, opcional `disable-model-invocation: true` para que sólo se invoque con `/{nombre}`) y pasos en el cuerpo. `REFERENCE.md` guarda plantillas y mandatos largos que la skill lee bajo demanda — no duplicar contenido entre ambos.

Las skills están escritas en español (son prompts míos); todo lo que producen en los repos (código, commits, docs técnicas) va en inglés salvo que el repo destino diga otra cosa.

# La suite y sus dependencias

Flujo: `plan-task` planifica una tarea de ClickUp (spec + slices + QA) → `work-task` la ejecuta de punta a punta hasta el MR, usando `init-task` (setup de rama) vía subagente.

| Skill | Rol |
|---|---|
| `plan-task` | Grilling → spec `[SPEC]` → tickets con dependencias → `[DOCS]` → `[QA]`. Padre queda en *planned*. |
| `work-task` | Rama, `[DOCS]` como primer commit, un subagente TDD por slice + gate, code review, MR, roll-up. Todo a *in review*. |
| `init-task` | Setup mecánico: trae la tarea, crea la rama desde la base, status a *in progress*. |
| `setup-gon-skills` | Se corre una vez por repo: genera `docs/agents/task-workflow.md`. |
| `write-handbook` | Productora de páginas de Handbook (docs de operación para admins/operadores). Ruta, formato e idioma los lee de la sección Handbook de `task-workflow.md`; sin esa sección no corre. |

**Configuración por repo, no en las skills.** Los strings exactos de statuses, el gate de calidad, la rama base + CLI de MR y las rutas (bitácora, docs de dominio) viven en `docs/agents/task-workflow.md` de cada proyecto consumidor, que las skills leen al arrancar. En las skills esos valores se nombran como *roles* (planned, in progress, in review, "la rama base", "el gate") — nunca hardcodear un valor de un repo concreto acá.

**Dependencia: [mattpocock/skills](https://github.com/mattpocock/skills).** La suite delega en `grilling`, `domain-modeling`, `to-spec`, `to-tickets`, `tdd`, `code-review` y `triage`, y asume que `setup-matt-pocock-skills` ya generó `docs/agents/issue-tracker.md`, `triage-labels.md` y `domain.md`. `setup-gon-skills` resuelve todo esto si falta: instala las skills (`npx skills add mattpocock/skills --skill '*' -y`), corre el setup upstream y lo guía hacia el flujo de la suite con seeds propios de ClickUp (`issue-tracker-clickup.md`, `triage-labels-clickup.md` — el upstream sólo trae GitHub/GitLab/local).

**Tracker: ClickUp obligatorio.** Las skills llaman a las tools MCP `clickup_*` directamente (subtareas, dependencias, statuses, tags). Portarlas a otro tracker requiere adaptar esas llamadas.

# Al editar una skill

1. Editar en `skills/{nombre}/`, respetando la separación SKILL.md (pasos) / REFERENCE.md (plantillas).
2. Si el cambio introduce un valor específico de un repo, no va acá: va en el `task-workflow.md` de ese repo (o como placeholder en la plantilla semilla `skills/setup-gon-skills/task-workflow.md`).
3. Actualizar la tabla del `README.md` si cambia qué hace la skill.
4. Commit + push, y avisar que los consumidores (wdetail-api, wdetail-app) corran `npx skills update`.
