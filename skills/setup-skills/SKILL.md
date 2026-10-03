---
name: setup-skills
description: Configurar un repo para las skills de ciclo de vida de tareas (plan-task, work-task, init-task) — genera docs/agents/task-workflow.md (statuses, gate, guardrails, ramas, rutas, review policy) y CODING_STANDARDS.md. Idempotente — en un repo en marcha audita y completa lo que falte. Correr después de setup-matt-pocock-skills.
disable-model-invocation: true
---

# Setup de las skills de tareas

Scaffoldea la configuración por repo que asumen las skills de tareas (`plan-task`, `work-task`, `init-task`, `qa-task`, `task-finish`). Esas skills **no contienen ningún valor de este repo**: nombran roles y leen los strings de `docs/agents/`. Este setup escribe los dos archivos que lo hacen posible:

- **`task-workflow.md`** (nuevo) — statuses del ciclo, gate de calidad, rama base + CLI de MR, entorno, ruteo de documentación, rutas (bitácora, mandatos) y Handbook.
- **`issue-tracker.md`** (ya existe: lo escribió `setup-matt-pocock-skills`) — se le agrega el **mapa de comandos** por operación.

Si al terminar una skill de la suite todavía nombra un tracker, un binario o un status literal, el setup quedó incompleto.

Es una skill guiada por prompt, no un script determinista: explorá, presentá lo encontrado, confirmá con el usuario, y recién ahí escribí.

## Modo: proyecto nuevo o en marcha

Antes de preguntar nada, decidí el modo mirando el repo:

- **Nuevo** (no existe `docs/agents/task-workflow.md`): recorré las decisiones A–G en orden (A, B, B2, C, D, D2–D4, E, F, G), una por vez.
- **En marcha** (ya existe): no re-preguntes lo que ya está decidido. Evaluá cada decisión contra el archivo real y la **criterio** de abajo, imprimí un tablero `✅/⚠️` por decisión (statuses, gate con sus tres patas, guardrails, mandatos, standards, cierre del ciclo, review policy) y ejecutá **sólo las ⚠️**, confirmando cada una. Un re-run que no encuentra ⚠️ termina ahí, con el tablero como salida. Las secciones nuevas de la plantilla (`## Guardrails`, `## Review policy`) se agregan al archivo existente sin tocar las demás: el worker parsea por encabezado y tolera secciones que no conoce.

## Prerequisitos — verificar y resolver antes de empezar

Los dos primeros los resolvés vos mismo (avisando qué vas a instalar); no se los delegues al usuario.

1. **Skills de mattpocock**: esta suite delega en `grilling`, `domain-modeling`, `to-spec`, `to-tickets`, `tdd`, `code-review`, `pr` y `triage`. Si faltan en `.agents/skills/`, instalálas: `npx skills add mattpocock/skills --skill '*' -y` (o con `--skill {nombre}` una por una — la lista separada por comas está rota en el CLI). **No uses `--all`**: implica `--agent '*'` y crea directorios para todos los agentes soportados (`agent/`, etc.), no sólo los detectados.
2. **Skills de la suite**: `plan-task`, `work-task` e `init-task` (opcionales de la familia: `qa-task`, `task-finish`, `write-handbook`, `setup-sandcastle`). Si faltan en `.agents/skills/`: preguntá al usuario la fuente — el repo fuente (`npx skills add gonzaloramirezabella/skills --skill '*' -y`) o copia manual desde otro proyecto. Tras una copia manual, verificá que sean visibles desde `.claude/skills/`: si es un symlink a `.agents/skills` no hay nada que hacer; si no, creá los hardlinks por archivo (`mkdir .claude/skills/{skill} && ln .agents/skills/{skill}/* .claude/skills/{skill}/`), igual que hace `npx skills`.
3. **`setup-matt-pocock-skills` ya corrido**: deben existir `docs/agents/issue-tracker.md`, `triage-labels.md` y `domain.md`. Si faltan, corré esa skill primero: es user-invoked, así que la Skill tool no la carga — **leé `.agents/skills/setup-matt-pocock-skills/SKILL.md` y seguilo** acá mismo, con el usuario presente (es interactiva) — `task-workflow.md` se apoya en las tres. **Guiala hacia el flujo de esta suite**, sin dejar de confirmar cada decisión con el usuario:
   - **Issue tracker → ClickUp** (para el setup upstream es la opción "Other" — no tiene seed de ClickUp): en lugar de escribir `issue-tracker.md` desde cero, usá [issue-tracker-clickup.md](./issue-tracker-clickup.md) de esta carpeta como seed y completá los placeholders (`{git host}`, `{MR CLI}`, convenciones del workspace).
   - **Triage labels → tags de ClickUp**: seed [triage-labels-clickup.md](./triage-labels-clickup.md); default, cada rol mapea a un tag con su mismo nombre.
   - **Domain docs**: el setup upstream asume `GLOSSARY.md` en la raíz; en los repos de esta suite el glosario vive en `docs/GLOSSARY.md` (lo fija `setup-project`), así que apuntá `domain.md` ahí y dejá dicho que no se cree un `GLOSSARY.md` en la raíz.
4. **CLI del tracker operativo**: cualquiera sea el tracker que declare `issue-tracker.md`, su CLI tiene que estar instalado y autenticado antes de seguir — probalo con su comando de health check. Con ClickUp: `clickup-cli auth check`; si el binario falta o el token no está, resolvelo con la sección Setup de la skill [`clickup-cli`](../clickup-cli/SKILL.md) (el token va en `CLICKUP_TOKEN`, nunca leído de disco por el agente).

## Proceso

### 1. Explorar

Mirá el estado real del repo; no asumas:

- `docs/agents/` — ¿ya existe `task-workflow.md` (re-run)? Leé `issue-tracker.md` y `domain.md`.
- `git remote -v` — ¿GitHub o GitLab? → propone `gh` o `glab` como CLI de MR.
- `git branch -a` — ¿existe una rama de integración (`dev`, `develop`)? Si no, la base será la default.
- Sistema de build (`Makefile`, `composer.json`, `package.json`, etc.) — proponé comandos concretos de test / análisis estático / formato para el gate.
- Statuses reales del tracker: descubrilos con su CLI en vez de adivinar (con ClickUp: `clickup-cli list get {LIST_ID} --output json | jq '[.[].statuses[].status]'` sobre la lista de trabajo del usuario).
- Cómo se levanta la app y cómo se aplican migraciones (Makefile, compose, scripts) — van a la sección *Environment*.
- ¿Existe una skill de handbook (`write-handbook` u otra productora de docs de operación)? Si hay un directorio de handbook, abrí un par de páginas existentes para inferir el formato (frontmatter, naming, links) y proponerlo en la decisión E.

### 2. Presentar y preguntar — una decisión por vez

Para cada sección: explicá en una línea qué es y para qué la usan las skills, mostrá lo que encontraste como propuesta, y esperá la respuesta antes de pasar a la siguiente. En texto plano, sin volcar todo junto.

- **A. Statuses del ciclo** — los roles (planned para padres; backlog, in progress, in review para padres y slices) con su string exacto del workspace: **el plan entero vive en el tracker** (hijas `[SPEC]`/slices/`[DOCS]`/`[QA]` del padre), así que los statuses de slice tienen que existir ahí. *Blocked on a human* es el **tag** `needs-info`, no un status. `plan-task` deja al padre en *planned*; `work-task` mueve todo hasta *in review*.
- **B. Gate de calidad** — los comandos que cada slice debe pasar en verde antes de *in review*: tests acotables, **análisis estático** y formato. Los corre el orquestador (`work-task` o un worker), no el agente que implementó. **La pata de análisis estático no es opcional**: un gate de tests + formato confía en tests que pueden mentir; si el repo no tiene herramienta (larastan/phpstan, `tsc`, mypy, `go vet`…), frená y resolvelo con `setup-project` paso 1 antes de escribir el bloque. Un bloque sin esa línea no cumple la criterio.
- **B2. Guardrails** — dónde corre el gate **sin agente ni humano**: el pipeline de CI sobre cada MR es obligatorio (si no existe, `setup-project` paso 1b lo crea; anotá la ruta), el hook de pre-commit es opcional. Va a la sección `## Guardrails`. Criterio: el archivo de CI existe y corre los mismos comandos que el bloque Host.
- **C. Rama base + MR** — de dónde salen las ramas y contra qué se abre el MR; qué CLI (`glab`/`gh`); si la base está protegida (sin push directo). La rama del padre la crea `init-task` cuando el trabajo empieza — la planificación no crea ramas ni committea nada.
- **D. Ruta de la bitácora** — dónde versiona `work-task` su log de reentrada (default: `work-logs/{parent-id}.md`), el único archivo del repo adyacente al plan: es artefacto del trabajo, no del plan.
- **D2. Entorno** — el comando que levanta la app y el que aplica migraciones.
- **D2b. QA (opcional, recomendado)** — la sección `## QA`: carril de navegador (`yes` sólo si el sandbox va a llevar Chromium), tope de ciclos QA↔fix (default 2), credenciales con las que un agente entra a la app, y dos bloques de «levantar la app»: **Host** (lo que corre `work-task`/`qa-task` en la máquina del dev, con su URL) y **Sandbox** (nativo, dentro de la imagen del worker: migrar/semillar y servir desprendido, con su URL). Es lo que hace que la fase de QA corra sola antes del cierre y convierta cada fallo en una hija `[FIX]`. Si el repo es móvil (simulador), el carril es `no` y la sección igual vale para lo observable por consola.
- **D3. Ruteo de documentación** — qué señal del diff alimenta a qué skill productora de docs, que `task-finish` evalúa al cerrar. Si el repo no tiene skills de docs, se omite.
- **D4. Mandatos del slice, del cierre, de QA y de la tarea suelta** — el **único** archivo de mandato de cada uno, compartido por `work-task`, `qa-task` y cualquier worker automatizado; el mandato no se duplica dentro de las skills. El de QA ([prompts/qa.md](./prompts/qa.md)) es la fase de verificación previa al cierre (va declarado como *QA mandate* en `## Paths`; sin esa línea la fase se saltea). El de la tarea suelta ([prompts/task.md](./prompts/task.md)) lo usa sólo el drenaje de tareas fuera de un plan (`sandcastle-tasks`). No los escribas de cero: copiá [prompts/slice.md](./prompts/slice.md), [prompts/close.md](./prompts/close.md), [prompts/qa.md](./prompts/qa.md) y [prompts/task.md](./prompts/task.md) de esta carpeta (son portables: sólo placeholders `{{...}}`, ningún valor de repo) y confirmá la ruta destino — default `docs/agents/prompts/`, junto al resto de la config que leen las skills. Van ahí aunque todavía no haya worker: `work-task` los usa igual.
- **E. Handbook (opcional)** — si el repo tiene docs de operación para humanos (admins/operadores): el trigger, la skill productora, y los valores que `write-handbook` lee de esta sección — **ruta raíz** y estructura, **formato de página** (naming, frontmatter obligatorio, links/assets, restricciones de render), **idioma**, y el doc de _rationale_ si existe. Proponé lo que hayas encontrado explorando (directorio del handbook, páginas existentes de las que inferir el formato). Para la **ruta raíz**: si la propia plataforma renderiza el handbook (lo sirve en una URL), tiene que vivir donde la app lo lea sin montajes extra — dentro del árbol de la app, no en un directorio hermano. En un repo con la app bajo `src/` (p. ej. Laravel), proponé una ruta ahí adentro (p. ej. `src/resources/handbook/`, legible con `resource_path('handbook')`); reservá una ruta suelta de repo (p. ej. `docs/handbook/`) para cuando el handbook no se sirva desde la app. Si no aplica, la sección se omite: `work-task` saltea el paso y `write-handbook` no corre.
- **F. Coding standards** — el archivo `CODING_STANDARDS.md` en la raíz que lee el eje Standards de `code-review` (y que `retro` edita con el tiempo). Si no existe, copiá [CODING_STANDARDS.md](./CODING_STANDARDS.md) de esta carpeta y completá con el usuario sólo la sección *Idioma* (el resto es portable: dominio, las tres mentiras de los tests, forma). Si existe, verificá que tenga las secciones *Tests*, *Lo que no se escribe* (datos personales e incidentes fuera de commits, MR y tracker) y *Forma*; si le falta alguna, agregala desde el seed. Regla de ubicación: las guías de estilo **no** van en `AGENTS.md`/`CLAUDE.md` —sobrecargan al agente que implementa y éste puede o no leerlas—; ahí queda un puntero de una línea. Lo que un linter pueda chequear se saca del archivo y va al gate. Criterio: el archivo existe con *Tests*, *Lo que no se escribe* y *Forma*, y `AGENTS.md` no contiene reglas de estilo, sólo el puntero.
- **G. Cierre del ciclo** — cómo la revisión humana mejora la siguiente corrida. Dos entradas en la tabla de comandos de `AGENTS.md`: `/retro` (tras un drenaje o una sesión de `work-task` torcida: lee los logs y los comentarios humanos de los MRs recientes, propone checks, punteros y reglas de `CODING_STANDARDS.md`, nunca código) y `/improve-codebase-architecture` (periódico, sobre las zonas que más cambiaron: propone módulos más profundos, que son los que dan tests menos frágiles). Y la sección `## Review policy` de la plantilla, que fija cuánto le debe un revisor a cada MR según su bloque *Riesgo de merge*. Criterio: las dos filas están y la sección existe.

### 3. Confirmar y escribir

Mostrá el borrador completo de `docs/agents/task-workflow.md` (usá [task-workflow.md](./task-workflow.md) de esta carpeta como plantilla semilla) y dejá que el usuario lo edite antes de escribirlo. Su sección **Paths** es contrato de máquina además de prosa: un worker automatizado parsea las etiquetas y los valores en backticks, así que no reformatees esas líneas ni resuelvas el `{parent-id}` — es literal.

Copiá también los tres mandatos de la decisión D4 a la ruta acordada, y verificá que las rutas que anotaste en *Paths* apunten a los archivos que acabás de escribir. Escribí `CODING_STANDARDS.md` (decisión F) y, si `AGENTS.md` tenía reglas de estilo, movelas ahí dejando el puntero.

Después agregá a `docs/agents/issue-tracker.md` la sección **`### Command map`**: una fila por operación, con el comando exacto del CLI del tracker y las mañas que un llamador tiene que saber (qué operación es destructiva, qué búsqueda no ve subtareas, qué falla con un string inválido). Las operaciones que la suite usa son: *health check*, *my user id*, *get task (fields)*, *get task (full description)*, *list subtasks*, *search by status + assignee*, *set status*, *replace description*, *create child task*, *add tag*, *mark blocked by*, *comment*, *task web URL*. Con ClickUp, el seed de esta carpeta ya la trae.

Después, en `.claude/settings.json` (crealo si no existe; si existe, fusioná la clave sin tocar el resto) apagá la firma de Claude en commits y MR:

```json
{ "attribution": { "commit": "", "pr": "", "sessionUrl": false } }
```

Strings vacíos y no `false`: las versiones de Claude Code anteriores a v2.1.281 rechazan `false` e ignoran el archivo entero.

Después, en el `CLAUDE.md`/`AGENTS.md` que ya tenga la sección `## Agent skills` (la crea `setup-matt-pocock-skills` — editá el archivo existente, no crees el otro), agregá o actualizá in-place:

```markdown
### Task workflow

[una línea: statuses del ciclo, rama base y gate]. See `docs/agents/task-workflow.md`.
```

Y en su tabla de comandos, las dos filas de la decisión G:

```markdown
| `/retro` (skill) | Tras un drenaje o una sesión de `work-task` torcida: lee los logs y los comentarios humanos de los MRs recientes y propone cambios al entorno del agente (checks, punteros, `CODING_STANDARDS.md`), no al código. |
| `/improve-codebase-architecture` (skill) | Periódico, sobre las zonas que más cambiaron: propone módulos más profundos; lo que elija el usuario se planifica como tarea normal. |
```

### 4. Listo

Confirmá al usuario qué skills leen ahora esos archivos (`plan-task`, `work-task`, `init-task`, `qa-task`, `task-finish` y los subagentes que lanzan), y que `code-review` lee `CODING_STANDARDS.md`. Puede editarlos a mano después; re-correr esta skill sólo hace falta para reconfigurar desde cero.

Cerrá con la verificación de portabilidad: `rg -i '{nombre del tracker}|{binario del tracker}|{status literal}' .agents/skills/{plan-task,work-task,init-task,qa-task,task-finish}` no debería devolver nada más que ejemplos explícitos.
