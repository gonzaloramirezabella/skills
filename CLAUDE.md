# Qué es este repo

Fuente de verdad de mis skills de ciclo de vida de tareas para agentes (Claude Code y compatibles). Los proyectos consumidores **no se editan directamente**: se edita acá, se pushea, y cada proyecto corre `npx skills add gonzaloramirezabella/skills --skill '*' -y` (no `update`: ver README § Actualizar).

- Layout: `skills/{nombre}/SKILL.md` (+ `REFERENCE.md` si tiene plantillas; `files/` si shippea scripts portables). El CLI `npx skills` escanea ese layout.
- Instalación en un proyecto: `npx skills add gonzaloramirezabella/skills --skill '*' -y`. **Nunca `--all`** (implica `--agent '*'` y crea directorios basura como `agent/` o `data/skills/`). La lista con comas (`--skill a,b`) está rota: una por una o `'*'`.
- El instalador copia cada skill a `.agents/skills/{nombre}` y la registra en `skills-lock.json` del proyecto (source + hash); `.claude/skills` es un symlink a `.agents/skills`.
- Acá, `.claude/skills` apunta a `skills/`: las skills propias se invocan en este repo sin instalar.

# Cómo funciona una skill

Una skill es un prompt, no un script: `SKILL.md` con frontmatter (`name`, `description`, opcional `disable-model-invocation: true` para que sólo se invoque con `/{nombre}`, opcional `model`) y pasos en el cuerpo. `REFERENCE.md` guarda plantillas y mandatos largos que la skill lee bajo demanda — no duplicar contenido entre ambos. `files/` (sólo `setup-sandcastle`) guarda scripts que el consumidor copia tal cual y nunca edita.

Las skills están escritas en español (son prompts míos); todo lo que producen en los repos (código, commits, docs técnicas) va en inglés salvo que el repo destino diga otra cosa.

# La suite y sus dependencias

Flujo: `plan-task` planifica una tarea del tracker → `work-task` la ejecuta de punta a punta hasta el MR, con la **fase de QA** adentro (antes del cierre: mandato canónico `prompts/qa.md` sobre la hija `[QA]`, una hija `[FIX]` por fallo drenada como slice, re-verificación hasta el tope de ciclos de `task-workflow.md` § QA) → `qa-task` es esa misma fase lanzada a mano. La tabla completa de skills y sus roles está en el `README.md`.

**El worker es `work-task` sin humano en el loop.** `setup-sandcastle` instala en el repo consumidor un ejecutor determinista (`.sandcastle/worker.ts`) que lee la misma cola de hijas del padre en el tracker, corre el mismo mandato canónico y aplica las mismas reglas de cierre. No es un segundo flujo: es el mismo, sin humano. Sus scripts se copian tal cual desde `skills/setup-sandcastle/files/` y no se editan al instalar — todo lo variable sale de `task-workflow.md` (workflow), `project.json` (stack) y un único archivo adapter (tracker).

**El plan vive en el tracker, no en el repo.** `plan-task` no committea nada ni crea ramas: el spec es una hija `[SPEC]`, cada slice es una hija con su tag de triage (`ready-for-agent`/`ready-for-human`) y sus dependencias, el QA es una hija `[QA]` con el checklist en su descripción, y lo que el grill decida de docs viaja en una hija `[DOCS]`. La rama la crea `init-task` cuando el trabajo empieza. El status de un slice lo setea **el orquestador que verificó** (commit real + gate verde corrido por él) — nunca el agente que implementó, que no toca el tracker. El único archivo del repo adyacente al plan es la bitácora.

**Configuración por repo, no en las skills.** Los strings exactos de statuses, la forma de las hijas del plan, el gate de calidad (bloques Host y Sandbox), la rama base + CLI de MR, el entorno y las rutas (bitácora, mandatos canónicos, docs de dominio) viven en `docs/agents/task-workflow.md` de cada proyecto consumidor, que las skills leen al arrancar. En las skills esos valores se nombran como *roles* (planned, in progress, in review, backlog, needs-info, "la rama base", "el gate") — nunca hardcodear un valor de un repo concreto acá.

Ese archivo no es sólo prosa: el worker lo **parsea**. Su tabla de statuses (etiquetas de fila literales), sus líneas `Base/integration branch:` y `MR CLI:`, sus bloques `### Sandbox` y `### Sandbox — slice` y su sección `## Paths` (con `{parent-id}` sin resolver) son contrato de máquina. Reformatearlas rompe el worker; `skills/setup-sandcastle/files/lib.test.ts` lo verifica en cada repo.

**El mandato del slice tampoco vive en las skills.** Es un archivo del repo consumidor (ruta en `task-workflow.md` § *Paths*) con placeholders `{{...}}`, compartido entre `work-task` y el worker. Los seeds están en `skills/setup-skills/prompts/`; `work-task/REFERENCE.md` sólo aporta la tabla de sustituciones.

**Dependencia: [mattpocock/skills](https://github.com/mattpocock/skills).** La suite delega en `grilling`, `domain-modeling`, `to-spec`, `to-tickets`, `tdd`, `code-review`, `pr` (forma del cuerpo de los MR), `triage`, `retro` e `improve-codebase-architecture`, y asume que `setup-matt-pocock-skills` ya generó `docs/agents/issue-tracker.md`, `triage-labels.md` y `domain.md`. `setup-skills` resuelve todo esto si falta: instala las skills (`npx skills add mattpocock/skills --skill '*' -y`), corre el setup upstream y lo guía hacia el flujo de la suite con seeds propios de ClickUp (`issue-tracker-clickup.md`, `triage-labels-clickup.md` — el upstream sólo trae GitHub/GitLab/local).

**Tracker: ClickUp, detrás de un mapa de comandos.** Las skills del ciclo **no nombran el tracker ni su binario**: piden operaciones por rol (*get task*, *set status*, *replace description*, *create child task*, *comment*…) y copian el comando del `### Command map` de `docs/agents/issue-tracker.md` de cada repo. La implementación es `clickup-cli` —elegido sobre MCP por consumo de tokens— documentada en la skill `clickup-cli`, que es a la vez la referencia del binario y el seed del command map. Un `rg -i 'clickup' skills/{plan-task,work-task,init-task,qa-task,task-finish}` tiene que salir vacío.

# Al editar una skill

1. Editar en `skills/{nombre}/`, respetando la separación SKILL.md (pasos) / REFERENCE.md (plantillas) / files (scripts portables).
2. Si el cambio introduce un valor específico de un repo, no va acá: va en el `task-workflow.md` de ese repo (o como placeholder en la plantilla semilla `skills/setup-skills/task-workflow.md`).
3. Si tocás `skills/setup-sandcastle/files/*.ts`: los tests (`lib.test.ts`) leen el `task-workflow.md` y `project.json` del repo consumidor, así que se corren allá (`make sandcastle-update`, que copia y testea) antes de pushear acá.
4. Actualizar la tabla del `README.md` si cambia qué hace la skill.
5. Commit + push, y avisar que los consumidores corran `npx skills add gonzaloramirezabella/skills --skill '*' -y` (y `make sandcastle-update` si tienen el worker).
