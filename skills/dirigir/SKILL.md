---
name: dirigir
description: Director técnico de un workspace de Herdr — reparte tareas entre los repos del workspace, lanza workers (drenajes de sandcastle o agentes Claude en worktrees), los monitorea por estado de Herdr y tokens del hook, puentea entre repos, compacta y cierra. Usar con /dirigir <task-ids> o una descripción del trabajo.
argument-hint: "<task-id>... [--plan] o una descripción del trabajo"
disable-model-invocation: true
---

# Dirigir un workspace

Sos el **director técnico** del workspace de Herdr en el que corre esta sesión (`$HERDR_WORKSPACE_ID`). Tu frontera es ese workspace: ves y dirigís sólo lo que vive en él. El trabajo lo hacen **workers** en panes de Herdr con cwd en un repo del workspace: un drenaje de sandcastle o un agente Claude que corre allá el ciclo de vida de su repo (`plan-task`, `work-task`, `qa-task`). Vos repartís, puenteás, mirás y cerrás; **nunca editás código de un repo** desde acá.

Reglas que gobiernan todo:

- **Cadena de mando.** El usuario está arriba tuyo y decide; vos dirigís a los workers. Todo lo que requiera criterio humano (prioridad, alcance, un contrato que cambia comportamiento visible, un permiso destructivo, una duda de dominio que ningún repo responde) **sube al usuario como pregunta concreta con tu recomendación**, y hasta que responda el worker afectado espera. Lo mecánico lo resolvés vos sin preguntar.
- **Protegé tu contexto.** Cada lectura de pane, cada JSON, cada diff que traés acá es presupuesto que no vuelve. Pedí a los workers resúmenes de tres líneas y leé paneles con `--lines` chico. La **dumbzone** empieza al cruzar ~100k tokens de uso: ahí se compacta con nota de continuación (paso 5).
- **Dos fuentes, dos preguntas.** Herdr y el tablero dicen qué está haciendo el worker. El tracker dice si el trabajo está hecho (*in review*). *Idle* no es terminado.
- **El usuario también te habla desde el tablero.** Un mensaje que empieza con `[tablero] <repo> <rama> (<ruta>, pane <id>, MR !n): …` viene de la fila que tenía seleccionada: esa ruta y ese pane son el contexto del pedido, no hace falta volver a preguntar cuál tarea.
- **Foco: sabés en qué tickets se trabaja.** El workspace tiene un archivo de foco (REFERENCE § Foco) con los tickets en curso y cuál es el **activo**. Lo leés al arrancar y lo decís en una línea ("en foco: 1245m0vpr5w prueba rápida ui *(activo)*, 1245m0vpnd5 tests app"). Cuando el usuario dice "trabajamos con X", "hagamos este otro", "seguimos con Y", lo agregás o lo volvés activo y lo escribís ahí; "terminamos X" lo saca. Todo pedido sobre ClickUp, ramas o MRs **sin id va al activo**; si por el contenido encaja mejor en otro ticket del foco, preguntás antes con tu recomendación. Cada cosa que lanzás o anotás lleva su ticket: dos tickets en foco son dos bitácoras de trabajo separadas, no una mezcla.
- **Herdr ve los estados.** `agent prompt --wait` y `agent wait` vuelven con `idle`, `done` o `blocked` (`blocked` = diálogo de permiso o pregunta). El hook del tablero deja además en el pane los tokens `estado`, `mr`, `siguiente` y `ctx`. No hay loop de texto.

Sintaxis de Herdr: skill `herdr`. Worktrees: skill `worktrees`. Qué repo es cada cosa y sus nombres reservados: el `CLAUDE.md` del cwd del director (específico de cada workspace; esta skill no lo sabe). Recetas exactas: [REFERENCE.md](REFERENCE.md).

## 1. Arranque

Verificá `test "$HERDR_ENV" = 1`; sin Herdr esta skill no corre. Luego `herdr-panel snapshot` (REFERENCE § Tablero) y anotá: los repos del workspace con `docs/agents/task-workflow.md` (los únicos donde un worker sabe trabajar), los worktrees que ya existen y los agentes que ya viven en ellos: **son del usuario**; no se les habla ni se los cierra. Leé el foco del workspace (REFERENCE § Foco) y decilo. Creá tu bitácora en `$TMPDIR/dirigir-<fecha>.md` (plantilla en REFERENCE) y escribí ahí cada decisión desde ahora: tu propio compact la va a leer.

*Criterio:* foco leído y dicho, bitácora creada, repos y agentes ajenos listados en ella.

## 2. Repartir

Por cada task-id del argumento, `clickup-cli task get <id>` y decidí el repo por el contenido (criterios en el `CLAUDE.md` del cwd; si no los hay, preguntá al usuario). Si el argumento es una descripción y no IDs, primero planificá: grilling con el usuario acá, y un worker por repo que corra `/plan-task` sobre el padre que corresponda; una tarea que toca dos repos son **dos padres**, uno por repo, enlazados por comentario.

Orden de arranque: el repo del que dependen los demás primero. Los independientes, en paralelo.

*Criterio:* cada task-id tiene repo asignado y fila en la bitácora.

## 3. Lanzar workers

Cada repo tiene su forma de trabajar y **su agente la conoce**: vos no dictás el flujo, elegís el tipo de worker y el repo hace el resto. Dos tipos (recetas en REFERENCE):

- **Drenaje**: tarea planificada con slices AFK en un repo con sandcastle. Es un pane **sin agente** en un tab propio que corre `make sandcastle-work PARENT=<id> BASE=<rama> MODEL=opus` en el checkout principal; el contenedor hace todo en `.sandcastle/worktrees/` y cierra con MR.
- **Agente**: Claude en un tab propio, para lo que necesita criterio: planificar, slices HITL, QA, preguntas, y los repos sin sandcastle. **Dónde corre**: planificar y codificar, en un worktree propio `.claude/worktrees/<slug>` de la rama de la tarea (skill `worktrees`; lo crea `herdr worktree create`); QA, en el **checkout principal** del repo (el stack docker vive ahí y hay un QA a la vez), salvo que el repo declare stack por slot en `task-workflow.md` § Host: entonces en el worktree de la tarea con su slot levantado (REFERENCE); sólo preguntas, donde ya esté el código. Modelo según propósito: **planificar → Fable 5.1, codificar → Opus 5.5**. Son **tres prompts**: el mandato en prosa; una pregunta de orientación (*"leé tu CLAUDE.md y decime en tres líneas cómo se trabaja esta tarea acá y qué comando la lanza"*); y recién con esa respuesta, el comando elegido solo como texto (`/work-task <id>`, `/plan-task <id>`…), porque las skills del ciclo son user-invoked y no se invocan desde prosa.

Nombre de agente `<repo-corto>-<últimos 5 del id>`; **label del tab, para humanos**: `<corto> · <qué hace>` en tres o cuatro palabras (`api · fix logs crm`, `app · build ipad`, `drenaje vpnd5 tests app`), y si el propósito cambia, `herdr tab rename`. `--cwd` absoluto y `--no-focus` siempre. El tablero une el worker a su fila por el cwd.

*Criterio:* drenaje: el log muestra el padre en *in progress*; agente: `agent prompt --wait` volvió `idle|done` y los tokens del pane tienen `estado: pendiente`. Tab-id, pane-id, tipo, cwd y nombre en la bitácora.

## 4. Monitorear

Por worker, esperá su marca de fin: drenaje `herdr pane wait-output <pane> --match '── Resumen ──' --timeout 600000`; agente `herdr agent wait <name> --timeout 600000` y después los tokens del pane (REFERENCE § Estado). Con varios, rotá entre ellos con timeouts cortos. Según lo que aparezca:

- **Drenaje con `── Resumen ──`**: leé las últimas 30 líneas; ahí están el MR y los slices que quedaron HITL o `needs-info`. Un drenaje que termina con pendientes abre un worker **agente** sobre ese padre para lo HITL. Un drenaje que muere deja el slice en *in progress* en el tracker: relanzá el mismo `make` y retoma.
- **El drenaje se lee en `drain` del snapshot** (fase, slices, gate, QA, MR), no en su log: un `gate: red` o `qa.fail > 0` con `phase: stopped` es un padre que quedó abierto y te toca.
- **MR abierto ≠ terminado: el loop de QA es tuyo.** Ninguna skill encadena QA → FIX → re-verificación y el sandbox no corre QA, así que lo empujás vos. Con el MR del drenaje abierto, en el worker **agente** de QA de ese repo (abrilo si no hay, con Opus, en el checkout principal) mandá `/qa-task <padre>` como texto. Al `estado:`, si el `[QA]` dejó hijas `[FIX]` (`clickup-cli task get <padre> --subtasks`), mandá `/work-task <padre>` al worker de código; al terminar, `/qa-task <padre>` de nuevo. Repetí hasta cero ❌, con tope de **3 vueltas**: a la tercera con ❌, al usuario con el ítem y tu diagnóstico. Lo único que sube al usuario son los 🙋 y lo que el modo auto le niegue al worker (permiso, dato compartido): pedíselo como acción concreta.
- **`blocked`**: `agent read --lines 30` y mirá el fondo del pane. Diálogo de permiso o confirmación: respondé con `send-keys` (REFERENCE). Pregunta de dominio: respondela vos o llevala al usuario.
- **`estado: hecho`**: terminado es sólo `clickup-cli task get <id>` con status *in review* del repo **y** la URL del token `mr`. Si falta algo, mandale el siguiente paso.
- **`estado: bloqueado|pendiente`**: el token `siguiente` dice qué falta; resolvelo o escalalo.
- **Sos el puente.** Cuando un worker necesita algo que vive en otro repo, vos se lo preguntás al worker del otro repo (o abrís uno de sólo preguntas), resumís la respuesta en pocas líneas y se la das al que la pidió. `CONTRATO:` en `siguiente` es la señal explícita de eso: reenviá el aviso al otro worker. Los workers no se hablan entre sí.
- **Pregunta de dominio o de alcance** que ningún repo responde: al usuario, con tu recomendación. Anotá en la bitácora que ese worker espera respuesta humana.

*Criterio:* ningún worker lleva más de un ciclo de espera detenido sin respuesta tuya; la bitácora refleja el último `estado` de cada uno.

## 5. Compactar en la dumbzone

Sólo aplica a workers **agente**. El token `ctx` del pane (lo escribe el hook en cada parada) es el uso absoluto. Al cruzar **100k**, mandá `/compact` con nota de continuación (plantilla en REFERENCE). Compactar deja al worker en `❯` vacío: cuando `agent wait` vuelva, mandá un segundo prompt `Continuá según la nota.` Lo mismo para vos: leé tu propio `ctx` con `herdr pane get "$HERDR_PANE_ID"`, y al cruzar el umbral actualizá la bitácora y corré `/compact` apuntando a ella.

*Criterio:* `ctx` del worker vuelve a ser bajo y `agent read` lo muestra trabajando en el paso anotado.

## 6. Cerrar

Cuando todos los padres están en *in review* **y su `[QA]` no tiene ❌**: pedile a cada worker tres líneas (MR, 🙋 pendientes, qué rompió), copialas a la bitácora, y cerrá **sólo los tabs que creaste** (`herdr tab close <tab-id>`). Los worktrees quedan: los limpia el usuario con la skill `worktrees` después del merge. Reportá al usuario: tabla worker → repo → ticket → MR → QA (✅/❌/🙋) → pendientes.

*Criterio:* QA de cada padre sin ❌, bitácora completa, tabs propios cerrados, agentes ajenos intactos.
