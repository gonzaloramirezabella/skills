---
name: work-task
description: Ejecutar trabajo ya planificado (plan como hijas del padre en el tracker) hasta dejarlo en revisión, de forma autónoma y sin preguntar en el camino.
disable-model-invocation: true
---

# Ejecutar tareas planificadas hasta revisión

**Principio rector: cero preguntas en el camino feliz.** Una sola confirmación al arranque (paso 2); de ahí en más la skill decide sola (mensajes de commit, prefijos, gates) y sólo se detiene ante un problema real, que marca y saltea.

El detalle operativo —tabla de sustituciones del mandato, plantillas, comando del MR, formato de bitácora, condición de `/goal`— vive en [REFERENCE.md](REFERENCE.md).

**Nada de este repo está escrito acá.** La configuración vive en `docs/agents/` y **se lee al arrancar**:

- `task-workflow.md` — statuses del ciclo (strings exactos), rama base, CLI de MR, gate de calidad, rutas (bitácora, mandatos) y sección Handbook. Los statuses que nombra esta skill son **roles** (*planned*, *in-progress*, *in-review*, *backlog*); el string exacto sale de la tabla de ese archivo.
- `issue-tracker.md` — el **mapa de comandos** del tracker. Esta skill pide operaciones por su rol (*get task*, *list subtasks*, *set status*, *add tag*, *replace description*, *comment*, *search by status + assignee*, *my user id*) y copia el comando de ahí; nunca nombra un tracker ni un binario.

## Estados

- **Padre:** *planned* → *in-progress* (al crear la rama) → *in-review* (cuando **todos** los slices están en *in-review*, AFK y HITL — los HITL bloquean el cierre; la hija `[QA]` no).
- **Slices (hijas del tracker):** *backlog* → *in-progress* (al delegarlo) → *in-review*. **Los statuses de un slice los setea este agente principal, nunca el subagente que implementa**: el status es el veredicto del verificador, no la afirmación del implementador. Un slice bloqueado o diferido se queda en *backlog*; uno trabado por algo que necesita un humano vuelve a *backlog* con el tag `needs-info` (paso 6).
- Si *set status* falla porque el string no existe, **parar y avisar**; no inventar un status.

## El plan del padre

`plan-task` cuelga del padre, identificables por prefijo de título y/o tag (*list subtasks*):

- **`[SPEC]`** — requisitos. No es trabajo: se lee como spec, se excluye de la cola.
- **`[DOCS]`** (sólo si el grill tocó docs, tag `ready-for-agent`) — porta glosario/ADRs ya decididos. No es un slice: lo aplica el agente principal como primer commit (paso 3b) y se excluye de la cola.
- **Slices** — las unidades de trabajo, cada una con tag de triage:
  - `ready-for-agent` (**AFK**) → se trabaja autónomamente.
  - `ready-for-human` (**HITL**) → **no se trabaja**: se deja para un humano. Es trabajo sin construir, así que **bloquea** el cierre del padre: el padre se queda en *in-progress* hasta que un humano lo drene (regla en `task-workflow.md`).
- **`[QA]`** — el checklist de QA en su descripción. No es trabajo: lo drena la **fase de QA** (paso 7b) antes del cierre. Por sí misma **no** bloquea el cierre: es la verificación *de* la revisión, no trabajo dentro de ella.
- **`[FIX]`** — slices nacidos de un ❌ de la fase de QA (los crea el orquestador: esta skill, `qa-task` o el worker). Llevan tag `ready-for-agent` y entran en la cola **como cualquier slice**: mismo mandato, mismo gate, mismo status por verificación — y bloquean el cierre como tales.

**Padre sin hijas `[SPEC]`/slices** (planificado con otro flujo, o sin planificar): avisá y proponé al usuario correr `plan-task` primero — esta skill no inventa un plan.

## Modos

- **Con Task ID → un padre:** recorre los slices de ese padre.
- **Sin argumento → cola:** busca todos los padres *planned* asignados a mí, los ordena (oldest-first) y los procesa uno por uno.

Es el mismo loop por slices; el modo cola lo envuelve en un loop externo por padres.

## `/goal` y reentrada

El **motor es el loop interno** de esta skill: confirmada al arranque, drena la cola sola. `/goal` es un envoltorio opcional de garantía: si una corrida se corta (límite de turno/contexto, error transitorio), re-lanza la skill hasta cumplir la condición (string exacto en REFERENCE.md). El evaluador de `/goal` **no corre comandos ni lee archivos** y sólo ve el transcript del padre — por eso el padre **imprime progreso verificable al cerrar cada slice** (5c).

**Reentrada:** antes de la confirmación del paso 2, mirá si existe la bitácora (ruta en `task-workflow.md`) o hay trabajo en curso en el tracker (padre *in-progress*, slices en *in-progress*/*in-review* o con tag `needs-info`). Si lo hay, **salteá la confirmación**, leé la bitácora y los statuses para saber qué slices ya están ✅ y reanudá desde el primero no terminado — no rehagas lo hecho.

Por cada padre mantené la **bitácora versionada** en la ruta que define `task-workflow.md` (formato en REFERENCE.md): registra el plan de cada slice, alimenta el informe y el comentario del cierre, y es el estado de reentrada. El subagente la commitea junto al trabajo de cada slice.

## Pasos

### 1. Resolver la cola

**Un padre** (hay Task ID): *get task* para status y descripción. Validá que el status sea *planned*; si no, avisá y seguí (puede ser un re-run).

**Cola** (sin args): resolvé tu user id (*my user id*) y buscá con *search by status + assignee* usando el string de *planned*. **Ojo con los límites que documenta `issue-tracker.md`** (p. ej. búsquedas que no devuelven subtareas): si la cola parece incompleta, aplicá el fallback que indica ese archivo. Ordená oldest-first por fecha de creación.

**Traé las hijas** (*list subtasks*) y **clasificálas**: `[SPEC]`/`[PRD]` (spec, fuera), `[DOCS]` (lo aplica 3b, fuera), `[QA]` (fuera, no bloquea), HITL (`ready-for-human`, no se trabaja, registrá `🙋 HITL`), con tag `needs-info` (esperan humano), en *in-review* (hechos), y AFK en *backlog* (la cola real). **Materializá el spec**: guardá la descripción completa del `[SPEC]` en un archivo temporal — es el `{{SPEC_FILE}}` que consumen los mandatos.

### 2. Confirmación única de arranque — se saltea en modo autónomo

**No confirmes** —procedé directo— si se cumple cualquiera de las dos: hay **reentrada** (bitácora o trabajo en curso), o `args` incluye **`--yes`/`auto`** (modo headless `-p`/Remote Control, donde no hay humano que responda; la skill no puede detectar un `/goal` activo, por eso el modo autónomo se señaliza con flag).

Si no aplica ninguna (primer run interactivo), mostrá qué vas a hacer y pedí OK:
- Un padre: "Padre `{id}` — {título}. {N} slices AFK en este orden: {lista}. {Hay/No hay} `[DOCS]` para aplicar. Creo la rama con init-task y los dreno hasta revisión. ¿Arranco?"
- Cola: "Encontré {N} padres planificados asignados a vos: {lista con título + cantidad de slices AFK}. ¿Los trabajo a todos?"

Si declina, parar. De acá en más, **no se vuelve a preguntar** hasta el resumen.

### 3. Garantizar la rama del padre

**Primer run** (no hay bloque `- Rama:` en la descripción):
- `git status --porcelain`. **Si hay cambios sin commitear** (trabajo ajeno) → **parar y avisar**, y en modo cola saltar al siguiente padre. **Nunca** arrastrar trabajo ajeno a la rama nueva (no `allow-dirty`).
- Creá la rama delegando a un **subagente** (`general-purpose`, `model: sonnet` — es setup mecánico) que corre `init-task` con el Task ID del padre. Parseá su bloque `RESULT:`:
  - `success` → guardá `branch` (init-task ya dejó el padre *in-progress* y la rama desde la rama base).
  - `blocked` con `dirty_working_dir` → parar y avisar (no reintentar con `allow-dirty`).
  - `blocked` con `task_closed`/`git_error`/`missing_task_id` → comentá el motivo en el **padre** (*comment*, template de needs-info) y saltá al siguiente.
- Escribí el nexo en la descripción del padre (bajo el bloque `## Planificado`): `- Rama: \`{branch}\``, preservando el resto (*replace description* es destructiva: traé, editá local, subí entera). **Load-bearing**: lo usan las reentradas de `/goal`, `qa-task`, cualquier worker automatizado y el MR para reencontrar la rama.

**Reentrada** (ya existe el bloque `- Rama:`): leé el branch, `git fetch origin {branch}`, checkout, pull. Si la rama no existe ni local ni en `origin` → comentá en el padre ("no encuentro la rama planificada `{branch}`", template de needs-info) y saltá al siguiente; no la recrees ni adivines el nombre. En modo cola, verificá working dir limpio antes del checkout.

Al empezar un padre, abrí/creá la bitácora (header: id, título, rama, fecha); si existía (reentrada), leela sin pisarla.

### 3b. Aplicar el `[DOCS]` primero — sólo si existe

Si hay un `[DOCS]` y **todavía no está en *in-review*** (en reentrada puede estar ya aplicado — verificá su status y la línea `Docs:` de la bitácora):
1. Leé su cuerpo (*get task (full description)*): ADRs y entradas de glosario como bloques de código.
2. **ADRs nuevos** → escribilos **verbatim** en la ruta de ADRs (rutas en `docs/agents/domain.md`; archivos nuevos, nunca conflictúan).
3. **Glosario** → **merge aditivo idempotente**: agregá sólo las entradas capturadas que no estén ya, respetando el formato, sin pisar entradas existentes. Si un ADR *existente* divergió en la rama base, **no lo pises**: señalalo y dejalo para revisión humana (no bloquea el resto).
4. **Primer commit** de la rama (con la bitácora incluida): `docs(glossary): apply planned glossary and ADR updates #{parent-id}`; después `git push`.
5. `[DOCS]` → *in-review* (*set status*); bitácora `Docs: ✅ aplicado ({commit})`.

Va **antes** de cualquier slice: su contenido es contexto que los subagentes van a necesitar.

### 4. Ordenar los slices

Con dependencias entre slices en el tracker → orden topológico (bloqueantes primero; el `[DOCS]` figura como bloqueante pero ya está en *in-review*, cuenta como satisfecho). Leé el campo defensivamente; si no podés interpretarlo con confianza, caé a orden de creación y logueá que ignoraste dependencias. Sin dependencias → orden de creación.

**Edge case — padre sin slices AFK** (sólo SPEC/DOCS/HITL): aplicá el `[DOCS]` si corresponde (3b), dejá los HITL pendientes, y evaluá el cierre (paso 8) — el padre puede pasar a *in-review* si no quedó trabajo AFK ni HITL.

### 5. Loop por slice — cada uno en un subagente con contexto fresco

Cada slice se delega a un **subagente** (`general-purpose`) que arranca con **contexto limpio**: todo lo pesado —leer el spec, las iteraciones red→green→refactor, output de tests, diffs— vive y muere ahí. El padre **sólo orquesta** (cola, orden, bloqueos, statuses, MR, resumen); su contexto casi no crece, así drena muchos más slices por corrida.

**Secuencial, nunca en paralelo:** los subagentes comparten working dir y rama. Lanzá uno, esperá su cierre + la verificación (5c), recién después el siguiente. Nunca dos sobre la misma rama.

Para cada slice **AFK** en orden:

#### 5a. (padre) Verificar bloqueos

Mirá sus dependencias *blocked by*:
- Todas en *in-review*/cerradas (incl. el `[DOCS]`) → delegar (5b).
- Bloqueante **dentro del conjunto** sin hacer → el orden topológico debería haberlo puesto antes; si no, diferir.
- Bloqueante **fuera de scope** (otro padre, tarea de otra persona, sin terminar) → **diferir**: dejá el slice en *backlog* (no lo toques), bitácora `⏸ diferido (bloqueado por {id})`, seguí. Vuelve a la cola en una corrida futura.

Un slice bloqueado **nunca** recibe el tag `needs-info` — eso es sólo para problemas que necesitan un humano (paso 6).

#### 5b. (padre) Delegar a un subagente

Slice → *in-progress* (*set status*). El **mandato del slice es un único archivo canónico**, en la ruta que declara `task-workflow.md` § *Paths* (*Slice mandate — canonical*) — el mismo que consume cualquier worker automatizado del repo. **No lo reescribas ni lo parafrasees acá.** Leelo, sustituí sus placeholders `{{...}}` con los valores de **este** entorno (tabla de sustituciones en [REFERENCE.md](REFERENCE.md) — incluye la descripción del slice, que traés vos con *get task (full description)*: el subagente no toca el tracker) y pegá el resultado en el prompt del subagente `general-purpose` — no carga archivos por su cuenta, sólo recibe lo que le pegás. El subagente corre el ciclo completo de UN slice y devuelve el bloque `<result>`.

#### 5c. (padre) Verificar estado durable + gate, setear el status e imprimir progreso

El mensaje del subagente es una afirmación; **la prueba es el commit en git y el gate corrido por vos — y el status lo ponés vos según eso**. Al volver:
1. `git status --porcelain`. Si quedó sucio inesperadamente (el subagente murió a mitad), NO sigas sobre un working dir contaminado: routeá **este** slice a needs-info (paso 6), limpiá/reportá, y no dejes que el próximo herede el desorden.
2. Verificá el trabajo sin confiar en el texto devuelto: `git log --oneline -1` (el commit del slice existe y está pusheado).
3. **Corré vos el gate** (bloque *Host* del *Quality gate* de `task-workflow.md`, sobre el commit del slice) — que el subagente diga que está verde no es prueba. Si sale rojo: pasale al subagente la salida del fallo y dale **un** intento de arreglo; si sigue rojo, routeá el slice a needs-info (paso 6) con el comando que falló como motivo.
4. Si el commit existe **y** el gate salió verde → slice → *in-review* (*set status*) e imprimí las líneas verificables (las ve `/goal`):
   ```
   ✅ Slice {id} → {status in-review} (gate verde)
      git log --oneline -1: {hash} {mensaje}
   ```
5. Si el subagente dijo que terminó pero git **no** lo confirma → tratalo como problema (paso 6); no lo cuentes como hecho.
6. Si `outcome` fue `blocked` → registralo en la bitácora y seguí con el siguiente. El subagente **no revisa estándares** (el mandato se lo prohíbe): esa revisión es una sola, al cierre (8.2), con contexto fresco.

### 6. Camino de bloqueo → needs-info

Cuando un slice **no puede completarse** por algo que necesita un humano: gate rojo tras reintentos, ambigüedad de diseño que el spec no resuelve, conflicto de git, o rama inexistente (paso 3). Lo detecta el **subagente** (devuelve `blocked`) o el **padre** (5c, si la verificación falla o el working dir quedó sucio); lo **aplica siempre el padre**:

1. Slice → *backlog* (*set status*, si lo habías movido) + tag `needs-info` (*add tag*), bitácora `⚠️ needs-info` con el motivo.
2. **Comentario en el padre** (operación *comment*) con el template de needs-info de REFERENCE.md, mencionando el slice — es la señal que ve el equipo.

**No** pasa a *in-review*. Seguí con el siguiente.

### 7. Re-pass sobre los diferidos

Al terminar una pasada por los slices de un padre, si quedaron diferidos por bloqueo (5a) y **al menos un bloqueante se resolvió durante esta corrida**, hacé otra pasada sobre los diferidos. Repetí hasta que una pasada no destrabe nada nuevo. Los que sigan bloqueados quedan en *backlog*.

### 7b. Fase de QA — antes del cierre, sólo si el repo la declara

Condición: `task-workflow.md` § *Paths* tiene la línea *QA mandate* **y** el padre tiene hija `[QA]` **y** **todos** los slices quedaron en *in-review* — AFK y HITL (un HITL sin construir convertiría sus items en trabajo `[FIX]` para un agente; sin `needs-info` ni diferidos). Tope de ciclos = verificaciones; el último ciclo sólo verifica. Si falta cualquiera → skip silencioso (anotá `QA: no declarado` o `QA: no corrió — {motivo}` en la bitácora).

Ciclo, hasta el tope de *QA↔fix cycles* de la sección *QA*:

1. **Levantá la app** con el bloque **Host** de la sección *QA* (y migrá si hace falta, *Environment*). Traé la descripción de la hija `[QA]` (*get task (full description)*) y parseá el checklist: pendientes = items `- [ ]` sin línea 🙋 (los ❌ de un ciclo anterior se re-verifican). Sin pendientes → fin de la fase.
2. **Delegá la verificación a un subagente** `general-purpose` con el mandato de la línea *QA mandate*, sustituido con la tabla de REFERENCE.md § *Mandato de QA*. Es sólo lectura: al volver, `git status --porcelain` tiene que estar vacío; si no, descartá (`git checkout -- . && git clean -fd`). Parseá su bloque `<qa>`.
3. **Persistí vos** (el subagente no toca el tracker): la descripción de la hija `[QA]` con una línea de veredicto bajo cada item reportado (formato exacto en `task-workflow.md` § *QA*; *replace description* es destructiva: traé, editá, subí entera), y un comentario roll-up en la misma hija (*comment*). Bitácora: `QA ciclo {n}: ✅ {a} · ❌ {b} · 🙋 {c}`.
4. **Sin ❌** → fin de la fase. **Con ❌ y ciclos restantes** → por cada ❌, *create child task* del padre `[FIX] {texto del item}` (tag `ready-for-agent`, status *backlog*, descripción = esperado vs observado + pasos + criterio «vuelve a pasar en la siguiente corrida de QA») y drenalos con el **loop del paso 5** (5a–5c, igual que un slice). Si todos quedaron en *in-review* → siguiente ciclo (vuelve a 1). Si alguno quedó `needs-info` → cortá: el padre no va a *in-review* (regla de slices) y seguís al cierre.
5. **Con ❌ en el último ciclo** → no creés más `[FIX]`: los ❌ quedan escritos, la `[FIX]` del ciclo anterior (si existe) pasa a `needs-info` (paso 6) con motivo «su item de QA sigue ❌ tras {tope} ciclos», y el padre no va a *in-review*. El cierre (paso 8) corre igual: el código es revisable y el MR lo dice en `⏳ Pendiente:`.

Imprimí al cerrar cada ciclo una línea verificable (la ve `/goal`): `🧪 QA ciclo {n}: ✅ {a} · ❌ {b} · 🙋 {c} · [FIX] creados: {ids}`.

### 8. Cerrar el padre

Con **todos los slices AFK en *in-review*** (ninguno con `needs-info` ni diferido pendiente) el trabajo autónomo terminó: corré la secuencia de cierre completa —Handbook, code review, MR— porque el código ya es revisable. **El status del padre es otra decisión**: pasa a *in-review* sólo si tampoco quedan slices HITL sin drenar; si quedan, el padre se queda en *in-progress* y la línea `⏳ Pendiente:` del comentario de cierre dice qué falta. La hija `[QA]` nunca bloquea.
1. **Revisión de Handbook — sobre el trabajo completo del padre, no por slice.** Sólo si `task-workflow.md` define la sección **Handbook**; si no existe → skip silencioso. Mirá el diff acumulado de la rama (`git diff origin/{base}...HEAD --stat`) y el spec, y evaluá el **trigger** que define esa sección. Si no dispara → skip silencioso. Si dispara → invocá la skill productora que indica la sección (Skill tool); su confirmación de ruta destino no corre en este flujo autónomo — decidí la ruta vos y seguí. Después commiteá `docs(handbook): {descripción} #{parent-id}` y `git push`. En re-runs es idempotente: la skill actualiza la página existente en vez de duplicarla. Bitácora: `Handbook: ✅ {ruta} ({commit})` o `Handbook: sin señal`.
2. **Code review del trabajo completo — antes del MR.** Es la **única** revisión de estándares del padre: los implementadores sólo hicieron que funcione (implementar y revisar son dos ventanas de contexto distintas, como red-green y refactor). Eje Standards contra `CODING_STANDARDS.md` de la raíz —su sección *Tests* incluida— más lo que **sólo se ve en conjunto**: duplicación entre slices, abstracciones a medio camino, naming inconsistente; y el eje Spec. Invocá la skill `code-review` (Skill tool) sobre el diff acumulado de la rama contra `origin/{base}` — dos ejes: Standards y Spec (fidelidad al `[SPEC]` del padre, materializado en el paso 1). Corre autónoma: sin preguntas al usuario. **El default es el commit, no la anotación**: accioná todo hallazgo claro y de riesgo acotado (bugs, desvíos de convención, code smells) — el revisor humano recibe un artefacto terminado; tras cualquier fix re-corré el gate y commiteá `refactor({scope}): address code review findings #{parent-id}` y `git push`. Hallazgos ambiguos o de diseño → anotálos para la descripción del MR (van al revisor humano, no al tracker), no los apliques. Bitácora: `Review: ✅ sin hallazgos | ✅ aplicado ({commit}) | ⚠️ {n} hallazgos anotados para humano`.
3. **Creá el MR inline con el CLI de `task-workflow.md`** (no uses `task-finish`: es interactivo y espera un working tree con cambios sin commitear, que acá no existe). La rama ya está pusheada; target = la rama base. Comando en REFERENCE.md — la descripción del MR tiene la forma de la skill `pr` (resumen, evidencia antes/después, riesgo de merge) y es el **destino de todo el detalle técnico del cierre**: cambios por slice, el gate que corriste vos como evidencia, puerta y radio de impacto, hallazgos de code review que el cierre dejó sin aplicar y página de Handbook. Si el MR de esa rama ya existe (re-run), capturá su URL en vez de fallar.
4. **Informe de cierre → descripción del padre.** Redactá el informe para **negocio** (template y regla fix vs feature en REFERENCE.md — el prefijo de la rama decide el tono) y publicalo como bloque `## Resumen` **al principio** de la descripción del padre (lo primero que se lee; `## Planificado` y el resto quedan debajo): *replace description* (destructiva: traé, editá local, subí entera), reemplazando el `## Resumen` previo si existe (re-run) y preservando el resto — en particular la línea `- Rama:`, que es load-bearing.
5. Padre → *in-review* sólo si se cumplen las condiciones que fija `task-workflow.md`: no quedan slices HITL sin drenar, ningún `[FIX]` quedó sin construir ni ningún item de QA ❌ sin resolver (7b), **el working tree quedó limpio** (lo que no está commiteado no viaja en el MR, así que lo verificado no es lo que revisaría un humano) y el gate quedó verde. Si falta alguna, dejalo en *in-progress* y decí cuál en la línea `⏳ Pendiente:` del comentario.
6. **Comentario de cierre** en el padre (operación *comment*), el **único** del cierre: un párrafo (2-4 frases) con qué funcionalidad quedó o qué se arregló — sin cómo, sin rama, sin archivos (template en REFERENCE.md). Es lo que lee negocio en el feed; rama, MR y pendientes ya están en `### Estado` de la descripción, y el detalle técnico viajó en el MR (paso 3). Sólo si hay pendientes (HITL sin drenar, needs-info), agregá la línea `⏳ Pendiente:` debajo.

**Si quedó algún slice AFK con `needs-info` o diferido** → el padre **no** pasa a *in-review*: dejalo en *in-progress* y comentá qué quedó pendiente y por qué. Usá criterio sobre crear o no el MR (si es un slice menor de un conjunto grande ya en revisión, el MR puede crearse con la salvedad anotada).

### 9. Resumen final

```
✅ Trabajo completo
Padres procesados: {N} · [DOCS] aplicados: {N} · Handbook: {N páginas o "sin señal"}
Slices → revisión: {N}
Slices → needs-info: {N}  {lista con motivo}
QA: {"no declarado" | "{ciclos} ciclos · ✅ {a} · ❌ {b} · 🙋 {c} · [FIX] creados: {N}"}
Slices diferidos (en backlog): {N}  {lista con bloqueante}
HITL dejados para humano (bloquean el cierre): {N}  {lista, más la hija [QA] de cada padre, que no bloquea}
MRs creados: {URLs, con la rama target}
Padres → revisión: {lista} · Padres que siguen en progreso: {lista}
```

## Invariantes

Reglas transversales que no viven en ningún paso (lo demás se aplica donde se ejecuta):

- [ ] Nunca trabajar desde la rama base ni la default del repo — siempre sobre la rama del padre.
- [ ] **Una rama por padre, un commit por slice, un MR por padre.** El commit de un slice incluye la bitácora — el registro viaja con el código.
- [ ] **Si un push o checkout falla** (divergencia, permisos, working dir sucio) → detener y reportar. **Nunca `--force`.**
- [ ] La skill **no cruza a otra rama/padre** a resolver bloqueantes ajenos: sólo verifica y difiere.
- [ ] Commit message: técnico, inglés, conventional commits. Comentario del tracker: funcional, español, lenguaje de negocio.
- [ ] **Los statuses del tracker los setea el agente principal, nunca el subagente que implementa** — el status de un slice es el veredicto de la verificación (commit real + gate verde corrido por el padre), no la afirmación del que escribió el código.
- [ ] El gate de `task-workflow.md` (tests verdes + análisis estático + formato) es obligatorio antes de pasar cualquier cosa a *in-review*, **y lo corre el padre, no el subagente que escribió el código**.
- [ ] La fase de QA es sólo lectura para el subagente que verifica: veredictos, hijas `[FIX]` y comentarios los escribe esta skill. Un `[FIX]` es un slice: pasa por 5a–5c y nunca se marca hecho sin commit real + gate verde.
- [ ] El mandato del slice vive en **un** archivo (ruta en `task-workflow.md`), compartido con cualquier worker automatizado. Si hay que cambiar cómo se implementa un slice, se cambia ahí — nunca duplicándolo en esta skill.
- [ ] Ningún valor de este repo (status, rama, comando del tracker, gate, ruta) se escribe en esta skill: sale de `docs/agents/`.
