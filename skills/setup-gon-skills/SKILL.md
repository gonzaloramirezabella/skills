---
name: setup-gon-skills
description: Configurar un repo para las skills de ciclo de vida de tareas (plan-task, work-task, init-task) — genera docs/agents/task-workflow.md con los statuses, gate, ramas y rutas del repo. Correr una vez, después de setup-matt-pocock-skills.
disable-model-invocation: true
---

# Setup de las skills de Gon

Scaffoldea la configuración por repo que asumen `plan-task`, `work-task` e `init-task`: un único archivo `docs/agents/task-workflow.md` con los **statuses del ciclo de vida**, el **gate de calidad**, la **rama base + CLI de MR** y las **rutas** (bitácora, docs de dominio vía `domain.md`).

Es una skill guiada por prompt, no un script determinista: explorá, presentá lo encontrado, confirmá con el usuario, y recién ahí escribí.

## Prerequisitos — verificar y resolver antes de empezar

Los dos primeros los resolvés vos mismo (avisando qué vas a instalar); no se los delegues al usuario.

1. **Skills de mattpocock**: esta suite delega en `grilling`, `domain-modeling`, `to-spec`, `to-tickets`, `tdd`, `code-review` y `triage`. Si faltan en `.agents/skills/`, instalálas: `npx skills add mattpocock/skills --all` (o con `--skill {nombre}` una por una — la lista separada por comas está rota en el CLI).
2. **Skills de Gon**: `plan-task`, `work-task` e `init-task` (opcionales de la familia: `task-finish`, `hotfix-start`, `write-handbook`, `grill-with-docs`). Si faltan en `.agents/skills/`: preguntá al usuario la fuente — su repo de skills publicado (`npx skills add {owner}/{repo}`) o copia manual desde otro proyecto. Tras una copia manual, verificá que sean visibles desde `.claude/skills/`: si es un symlink a `.agents/skills` no hay nada que hacer; si no, creá los hardlinks por archivo (`mkdir .claude/skills/{skill} && ln .agents/skills/{skill}/* .claude/skills/{skill}/`), igual que hace `npx skills`.
3. **`setup-matt-pocock-skills` ya corrido**: deben existir `docs/agents/issue-tracker.md`, `triage-labels.md` y `domain.md`. Si faltan, invocá esa skill primero (es interactiva — corre acá mismo, con el usuario presente) — `task-workflow.md` se apoya en las tres.
4. **Tracker ClickUp**: estas skills llaman a las tools `clickup_*` directamente (subtareas, dependencias, statuses). Si `issue-tracker.md` dice otro tracker, avisá que exportarlas requiere adaptar esas llamadas — este setup no alcanza.

## Proceso

### 1. Explorar

Mirá el estado real del repo; no asumas:

- `docs/agents/` — ¿ya existe `task-workflow.md` (re-run)? Leé `issue-tracker.md` y `domain.md`.
- `git remote -v` — ¿GitHub o GitLab? → propone `gh` o `glab` como CLI de MR.
- `git branch -a` — ¿existe una rama de integración (`dev`, `develop`)? Si no, la base será la default.
- Sistema de build (`Makefile`, `composer.json`, `package.json`, etc.) — proponé comandos concretos de test / análisis estático / formato para el gate.
- Statuses del workspace de ClickUp: si podés, descubrilos con `clickup_get_list` sobre la lista de trabajo del usuario en vez de adivinar.
- ¿Existe una skill de handbook (`write-handbook` u otra productora de docs de operación)?

### 2. Presentar y preguntar — una decisión por vez

Para cada sección: explicá en una línea qué es y para qué la usan las skills, mostrá lo que encontraste como propuesta, y esperá la respuesta antes de pasar a la siguiente. En texto plano, sin volcar todo junto.

- **A. Statuses del ciclo** — los cuatro roles (backlog de slices, planned de padres, in progress, in review) con su string exacto del workspace. `plan-task` deja al padre en *planned*; `work-task` mueve todo hasta *in review*.
- **B. Gate de calidad** — los comandos que cada slice debe pasar en verde antes de *in review* (tests acotables, análisis estático, formato). Los corre el subagente de `work-task` en cada slice y de nuevo tras el code review.
- **C. Rama base + MR** — de dónde salen las ramas y contra qué se abre el MR; qué CLI (`glab`/`gh`).
- **D. Ruta de la bitácora** — dónde versiona `work-task` su log de reentrada (default: `plans/work/{parent-id}.md`).
- **E. Handbook (opcional)** — si el repo tiene docs de operación para humanos: cuál es el trigger y qué skill lo produce. Si no aplica, la sección se omite y `work-task` saltea ese paso.

### 3. Confirmar y escribir

Mostrá el borrador completo de `docs/agents/task-workflow.md` (usá [task-workflow.md](./task-workflow.md) de esta carpeta como plantilla semilla) y dejá que el usuario lo edite antes de escribirlo.

Después, en el `CLAUDE.md`/`AGENTS.md` que ya tenga la sección `## Agent skills` (la crea `setup-matt-pocock-skills` — editá el archivo existente, no crees el otro), agregá o actualizá in-place:

```markdown
### Task workflow

[una línea: statuses del ciclo, rama base y gate]. See `docs/agents/task-workflow.md`.
```

### 4. Listo

Confirmá al usuario qué skills leen ahora ese archivo (`plan-task`, `work-task`, `init-task` y los subagentes que estas lanzan). Puede editarlo a mano después; re-correr esta skill sólo hace falta para reconfigurar desde cero.
