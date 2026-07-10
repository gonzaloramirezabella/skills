---
name: work-task
description: Ejecutar trabajo ya planificado en ClickUp hasta dejarlo en "Revisión", de forma autónoma y sin preguntar en el camino.
disable-model-invocation: true
---

# Ejecutar tareas planificadas hasta `Revisión`

**Principio rector: cero preguntas en el camino feliz.** Una sola confirmación al arranque (paso 2); de ahí en más la skill decide sola (mensajes de commit, prefijos, gates) y sólo se detiene ante un problema real, que marca y saltea.

El detalle operativo —mandato del subagente, plantillas, comando del MR, formato de bitácora, condición de `/goal`— vive en [REFERENCE.md](REFERENCE.md). La configuración por repo vive en `docs/agents/`: tags de triage en `triage-labels.md`, y statuses del ciclo, rama base, CLI de MR, gate de calidad y ruta de bitácora en `task-workflow.md` — **leelo al arrancar**; los nombres de status de esta skill son roles y el string exacto sale de ahí.

## Estados

- **Padre:** `planificado` → `iniciado` (al crear la rama) → `Revisión` (al cerrar todos los slices AFK).
- **Slices:** `to do` → `iniciado` → `Revisión`. `planificado` es status **sólo de padres**; un slice bloqueado se queda en `to do`.
- Los **strings exactos** de cada status están en `docs/agents/task-workflow.md`. Si `clickup_update_task` falla con `Status does not exist`, **parar y avisar**; no inventar un status.

## Hijos del padre

`plan-task` cuelga del padre, identificables por prefijo de título y/o tag:

- **`[SPEC]`** (o `[PRD]` en tareas planificadas antes del rename — tratálos igual) — requisitos. No es trabajo: se lee como spec, se excluye de la cola.
- **`[DOCS]`** (sólo si grill tocó docs, tag `ready-for-agent`) — porta `CONTEXT.md`/ADR ya decididos. No es un slice: lo aplica el agente principal como primer commit (paso 3b) y se excluye de la cola.
- **Slices** — las unidades de trabajo, cada una con tag de triage:
  - `ready-for-agent` (**AFK**) → se trabaja autónomamente.
  - `ready-for-human` (**HITL**, p. ej. el `[QA]` final) → **no se trabaja**: se deja para un humano y **no** bloquea el cierre del padre.

## Modos

- **Con Task ID → un padre:** recorre los slices de ese padre.
- **Sin argumento → cola:** busca todos los padres `planificado` asignados a mí, los ordena (bloqueantes primero, luego oldest-first) y los procesa uno por uno.

Es el mismo loop por slices; el modo cola lo envuelve en un loop externo por padres.

## `/goal` y reentrada

El **motor es el loop interno** de esta skill: confirmada al arranque, drena la cola sola. `/goal` es un envoltorio opcional de garantía: si una corrida se corta (límite de turno/contexto, error transitorio), re-lanza la skill hasta cumplir la condición (string exacto en REFERENCE.md). El evaluador de `/goal` **no corre comandos ni lee archivos** y sólo ve el transcript del padre — por eso el padre **imprime progreso verificable al cerrar cada slice** (5c).

**Reentrada:** antes de la confirmación del paso 2, mirá si existe la bitácora (ruta en `task-workflow.md`) o hay trabajo en curso en ClickUp (padre `iniciado`, slices `iniciado`/`Revisión`). Si lo hay, **salteá la confirmación**, leé la bitácora para saber qué slices ya están ✅ y reanudá desde el primero no terminado — no rehagas lo hecho.

Por cada padre mantené una **bitácora versionada** en la ruta que define `task-workflow.md` (formato en REFERENCE.md): registra el plan de cada slice, alimenta el comentario roll-up del cierre, y es el estado de reentrada. El subagente la commitea junto al trabajo de cada slice.

## Pasos

### 1. Resolver la cola

**Un padre** (hay Task ID): `clickup_get_task` con `subtasks=true`. Validá que el status sea `planificado`; si no, avisá y seguí (puede ser un re-run).

**Cola** (sin args): resolvé tu user con `clickup_resolve_assignees` (`"me"`); `clickup_filter_tasks` con `statuses: ["planificado"]`, `assignees: [{tu id}]` y **`subtasks: true`** (un padre `planificado` puede ser él mismo subtarea de otra; sin esto `filter_tasks` no lo devuelve y la cola sale vacía). `clickup_get_task` con `subtasks=true` por padre; ordená bloqueantes primero, luego oldest-first (`date_created`).

**Clasificá los hijos** antes de iterar: `[SPEC]`/`[PRD]` (spec, fuera), `[DOCS]` (lo aplica 3b, fuera), HITL (`ready-for-human`, no se trabaja, registrá `🙋 HITL`), slices AFK (`ready-for-agent`, la cola real).

### 2. Confirmación única de arranque — se saltea en modo autónomo

**No confirmes** —procedé directo— si se cumple cualquiera de las dos: hay **reentrada** (bitácora o trabajo en curso en ClickUp), o `args` incluye **`--yes`/`auto`** (modo headless `-p`/Remote Control, donde no hay humano que responda; la skill no puede detectar un `/goal` activo, por eso el modo autónomo se señaliza con flag).

Si no aplica ninguna (primer run interactivo), mostrá qué vas a hacer y pedí OK:
- Un padre: "Padre `{id}` — {título}. {N} slices AFK en este orden: {lista}. {Hay/No hay} `[DOCS]` para aplicar. Creo la rama con init-task y los dreno hasta `Revisión`. ¿Arranco?"
- Cola: "Encontré {N} padres `planificado` asignados a vos: {lista con título + cantidad de slices AFK}. ¿Los trabajo a todos hasta `Revisión`?"

Si declina, parar. De acá en más, **no se vuelve a preguntar** hasta el resumen.

### 3. Garantizar la rama del padre

**Primer run** (no hay bloque `- Rama:` en la descripción):
- `git status --porcelain`. **Si hay cambios sin commitear** (trabajo ajeno) → **parar y avisar**, y en modo cola saltar al siguiente padre. **Nunca** arrastrar trabajo ajeno a la rama nueva (no `allow-dirty`).
- Creá la rama delegando a un **subagente** (`general-purpose`) que corre `init-task` con el Task ID del padre. Parseá su bloque `RESULT:`:
  - `success` → guardá `branch` (init-task ya dejó el padre `iniciado` y la rama desde la rama base).
  - `blocked` con `dirty_working_dir` → parar y avisar (no reintentar con `allow-dirty`).
  - `blocked` con `task_closed`/`git_error`/`missing_task_id` → marcá el **padre** `needs-info` (motivo del blocker) y saltá al siguiente.
- Escribí el nexo en la descripción del padre (bajo el bloque `## Planificado`): `- Rama: \`{branch}\``, preservando el resto. **Load-bearing**: lo usan las reentradas de `/goal` y el MR para reencontrar la rama.

**Reentrada** (ya existe el bloque `- Rama:`): leé el branch, `git checkout {branch}`. Si la rama no existe ni local ni en `origin` → marcá el padre `needs-info` ("no encuentro la rama planificada `{branch}`") y saltá al siguiente; no la recrees ni adivines el nombre. En modo cola, verificá working dir limpio antes del checkout.

Al empezar un padre, abrí/creá la bitácora (header: id, título, rama, fecha); si existía (reentrada), leela sin pisarla.

### 3b. Aplicar el `[DOCS]` primero — sólo si existe

Si hay un `[DOCS]` y **todavía no está en `Revisión`** (en reentrada puede estar ya aplicado — verificá con `clickup_get_task` y la línea `Docs:` de la bitácora):
1. Leé su cuerpo (`clickup_get_task`): ADRs y entradas de glosario como bloques de código.
2. **ADRs nuevos** → escribilos **verbatim** en la ruta de ADRs (`docs/agents/domain.md`; archivos nuevos, nunca conflictúan).
3. **`CONTEXT.md`** → **merge aditivo idempotente**: agregá sólo las entradas capturadas que no estén ya, respetando el formato del glosario, sin pisar entradas existentes. Si un ADR *existente* divergió en la rama base, **no lo pises**: señalalo y dejalo para revisión humana (no bloquea el resto).
4. **Primer commit** de la rama (con la bitácora incluida): `docs(context): apply planned glossary and ADR updates #{DOCS_ID}` + trailer Co-Authored-By del modelo actual; después `git push`.
5. `[DOCS]` → `Revisión`; bitácora `Docs: ✅ aplicado ({commit})`.

Va **antes** de cualquier slice: su contenido es contexto que los subagentes van a necesitar.

### 4. Ordenar los slices

Con `dependencies` entre slices → orden topológico (bloqueantes primero; el `[DOCS]` figura como bloqueante pero ya está en `Revisión`, cuenta como satisfecho). Leé el campo defensivamente; si no podés interpretarlo con confianza, caé a orden de creación y logueá que ignoraste dependencias. Sin `dependencies` → orden de creación (`date_created`/`orderindex`).

**Edge case — padre sin slices AFK** (sólo SPEC/DOCS/HITL): aplicá el `[DOCS]` si corresponde (3b), dejá los HITL pendientes, y evaluá el cierre (paso 8) — el padre puede pasar a `Revisión` si no quedó trabajo AFK.

### 5. Loop por slice — cada uno en un subagente con contexto fresco

Cada slice se delega a un **subagente** (`general-purpose`) que arranca con **contexto limpio**: todo lo pesado —leer el spec, las iteraciones red→green→refactor, output de tests, diffs— vive y muere ahí. El padre **sólo orquesta** (cola, orden, bloqueos, estado del padre, MR, resumen); su contexto casi no crece, así drena muchos más slices por corrida.

**Secuencial, nunca en paralelo:** los subagentes comparten working dir y rama. Lanzá uno, esperá su cierre + la verificación (5c), recién después el siguiente. Nunca dos sobre la misma rama.

Para cada slice **AFK** en orden:

#### 5a. (padre) Verificar bloqueos

Mirá sus dependencies "blocked by":
- Todas en `Revisión`/cerradas (incl. el `[DOCS]`) → delegar (5b).
- Bloqueante **dentro del conjunto** sin hacer → el orden topológico debería haberla puesto antes; si no, diferir.
- Bloqueante **fuera de scope** (otro padre, tarea de otra persona, sin terminar) → **diferir**: dejá el slice en `to do` (no lo toques), bitácora `⏸ diferido (bloqueado por {id})`, seguí. Vuelve a la cola en una corrida futura.

Un slice bloqueado **nunca** va a `needs-info` — eso es sólo para problemas que necesitan un humano (paso 6).

#### 5b. (padre) Delegar a un subagente

Leé [REFERENCE.md](REFERENCE.md) e **inyectá en el prompt del subagente** (a) el **mandato del subagente** y (b) el **template de needs-info** que le sigue — el subagente es `general-purpose` y **no carga REFERENCE.md**, sólo recibe lo que le pegás en el prompt. Completá `slice-id`, `parent-id`, `branch`, y la ruta de la bitácora. El subagente corre el ciclo completo de UN slice y devuelve un resultado estructurado.

#### 5c. (padre) Verificar estado durable e imprimir progreso

El mensaje del subagente es una afirmación; **la prueba es el estado durable**. Al volver:
1. `git status --porcelain`. Si quedó sucio inesperadamente (el subagente murió a mitad), NO sigas sobre un working dir contaminado: routeá **este** slice a needs-info (paso 6), limpiá/reportá, y no dejes que el próximo herede el desorden.
2. Re-leé el estado durable sin confiar en el texto devuelto: `git log --oneline -1` y el status real del slice (`clickup_get_task`).
3. Si confirma `Revisión` → imprimí las líneas verificables (las ve `/goal`):
   ```
   ✅ Slice {id} → Revisión
      git log --oneline -1: {hash} {mensaje}
   ```
4. Si el subagente dijo `Revisión` pero git/ClickUp **no** lo confirman → tratalo como problema (paso 6); no lo cuentes como hecho.
5. Si `outcome` fue `needs-info`/`bloqueado` → registralo en la bitácora y seguí con el siguiente.

### 6. Camino de bloqueo → `needs-info` (vía triage)

Cuando un slice **no puede completarse** por algo que necesita un humano: gate rojo tras reintentos, ambigüedad de diseño que el issue no resuelve, conflicto de git, o rama inexistente (paso 3). Lo aplica el **subagente** (durante la implementación) o el **padre** (5c, si la verificación de estado durable falla o el working dir quedó sucio). Aplicá el outcome `needs-info` de `triage` por su **path directo** (template en REFERENCE.md): disclaimer + Triage Notes, tag `needs-info`, el slice queda en `to do`, bitácora `⚠️ needs-info`. **No** pasa a `Revisión`. Seguí con el siguiente.

### 7. Re-pass sobre los diferidos

Al terminar una pasada por los slices de un padre, si quedaron diferidos por bloqueo (5a) y **al menos un bloqueante se resolvió durante esta corrida**, hacé otra pasada sobre los diferidos. Repetí hasta que una pasada no destrabe nada nuevo. Los que sigan bloqueados por algo externo quedan en `to do`.

### 8. Cerrar el padre

El padre pasa a `Revisión` cuando **todos sus slices AFK** están en `Revisión` (ninguno en `needs-info` ni diferido pendiente). Los HITL no bloquean el cierre: quedan para la revisión humana.
1. **Revisión de Handbook — sobre el trabajo completo del padre, no por slice.** Sólo si `task-workflow.md` define la sección **Handbook**; si no existe → skip silencioso. Mirá el diff acumulado de la rama (`git diff origin/{base}...HEAD --stat`) y el spec, y evaluá el **trigger** que define esa sección. Si no dispara → skip silencioso. Si dispara → invocá la skill productora que indica la sección (Skill tool); su confirmación de ruta destino no corre en este flujo autónomo — decidí la ruta vos y seguí. Después commiteá `docs(handbook): {descripción} #{parent-id}` (+ trailer Co-Authored-By) y `git push`. En re-runs es idempotente: la skill actualiza la página existente en vez de duplicarla. Bitácora: `Handbook: ✅ {ruta} ({commit})` o `Handbook: sin señal`.
2. **Code review del trabajo completo — antes del MR.** Invocá la skill `code-review` (Skill tool) sobre el diff acumulado de la rama contra `origin/{base}` — dos ejes: Standards (convenciones del repo) y Spec (fidelidad al spec `[SPEC]` del padre). Corre autónoma: sin preguntas al usuario. Accioná los hallazgos que sean claros y de bajo riesgo (bugs, desvíos de convención, code smells); tras cualquier fix re-corré el gate de `task-workflow.md` (tests acotados a lo tocado + el resto completo) y commiteá `refactor({scope}): address code review findings #{parent-id}` (+ trailer Co-Authored-By) y `git push`. Hallazgos ambiguos o de diseño → anotálos en el comentario roll-up para el revisor humano, no los apliques. Bitácora: `Review: ✅ sin hallazgos | ✅ aplicado ({commit}) | ⚠️ {n} hallazgos anotados para humano`.
3. **Creá el MR inline con el CLI de `task-workflow.md`** (no uses `task-finish`: es interactivo y espera un working tree con cambios sin commitear, que acá no existe). La rama ya está pusheada; target = la rama base. Comando en REFERENCE.md. Si el MR de esa rama ya existe (re-run), capturá su URL en vez de fallar.
4. Padre → `Revisión`.
5. Comentario **roll-up** (`clickup_create_task_comment`), armado leyendo la bitácora (template en REFERENCE.md), mencionando el QA HITL pendiente, los hallazgos de code review anotados para humano (si los hay), la URL del MR y la página de Handbook si se creó/actualizó.

**Si quedó algún slice AFK en `needs-info` o diferido** → el padre **no** pasa a `Revisión`: dejalo en `iniciado` y comentá qué quedó pendiente y por qué. Usá criterio sobre crear o no el MR (si es un slice menor de un conjunto grande ya en `Revisión`, el MR puede crearse con la salvedad anotada).

### 9. Resumen final

```
✅ Trabajo completo
Padres procesados: {N} · [DOCS] aplicados: {N} · Handbook: {N páginas o "sin señal"}
Slices → Revisión: {N}
Slices → needs-info: {N}  {lista con motivo}
Slices diferidos (en `to do`): {N}  {lista con bloqueante}
HITL dejados para humano: {N}  {lista, p. ej. el [QA]}
MRs creados: {URLs}
Padres → Revisión: {lista} · Padres en iniciado (pendiente): {lista}
```

## Invariantes

Reglas transversales que no viven en ningún paso (lo demás se aplica donde se ejecuta):

- [ ] Nunca trabajar desde la rama base ni la default (`dev`/`main` en este repo) — siempre sobre la rama del padre.
- [ ] **Una rama por padre, un commit por slice, un MR por padre.**
- [ ] **Si un push o checkout falla** (divergencia, permisos, working dir sucio) → detener y reportar. **Nunca `--force`.**
- [ ] La skill **no cruza a otra rama/padre** a resolver bloqueantes ajenos: sólo verifica y difiere.
- [ ] Commit message: técnico, inglés, conventional commits. Comentario de ClickUp: funcional, español, lenguaje de negocio.
- [ ] El gate de `task-workflow.md` (tdd verde + análisis estático + formato) es obligatorio antes de pasar cualquier cosa a `Revisión`.
