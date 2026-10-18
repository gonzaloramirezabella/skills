# Referencia de `dirigir`

Recetas que la skill consulta a demanda. Lo específico de cada workspace (qué repos hay, cuál es cada cosa, nombres reservados, cómo elegir repo por ticket) vive en el `CLAUDE.md` del cwd del capitán; los strings de status y la rama base **salen del `docs/agents/task-workflow.md` de cada repo** y los lee el worker.

## Tablero

`herdr-panel` es el binario del plugin `bcnquark.panel` (en `~/.local/bin` tras el setup). Devuelve el estado del workspace en JSON: repos, worktrees, agentes unidos por cwd, MRs y tokens.

```bash
herdr-panel snapshot --no-report | jq -c '.Rows[] | {repo: .RepoName, path: .Path, branch: .Branch, task: .TaskID, main: .Main, mr: .MR.web_url, stack: .Stack, drain: .Drain, agents: [.Agents[]? | {pane: .pane_id, name, status: .agent_status, tokens}]}'
```

Repos "con ciclo" = los que tienen `docs/agents/task-workflow.md`: `test -f "$REPO/docs/agents/task-workflow.md"`. El tablero visual es el tab `Tablero` del mismo workspace (`herdr plugin pane open --plugin bcnquark.panel --entrypoint board`); el usuario lo mira, vos usás el JSON.

Agentes ajenos (del usuario) en el workspace:

```bash
herdr agent list | jq -r --arg ws "$HERDR_WORKSPACE_ID" '.result.agents[] | select(.workspace_id == $ws and .pane_id != env.HERDR_PANE_ID) | "\(.pane_id) \(.name // "-") \(.cwd)"'
```

## Capitán

Quién sos en este workspace: `${XDG_CONFIG_HOME:-$HOME/.config}/dirigir/$HERDR_WORKSPACE_ID/capitan.md`. Lo escribe el usuario (o vos con su sí, cuando te dice "a partir de ahora…"). Corto: lo que no entra en una pantalla sobra. Plantilla:

```markdown
# Capitán de <workspace>

Soy <nombre>. Manejo <qué proyectos y qué es cada uno, dos líneas>.

Prioridades: <qué va primero cuando compite; qué no se toca sin preguntar>.

Tono: <dos líneas>.
```

Si el usuario pide algo que el archivo contradice (otra prioridad, otro tono), gana el usuario y le proponés actualizar el archivo.

## Foco

Tickets en curso del workspace, durable entre sesiones y compacts: `${XDG_STATE_HOME:-$HOME/.local/state}/dirigir/$HERDR_WORKSPACE_ID.json`. El tablero lo lee y marca con `★` la fila del activo y con `☆` las demás en foco.

```json
{
  "activo": "1245m0vpr5w",
  "tickets": {
    "1245m0vpr5w": { "titulo": "prueba rápida ui", "repo": "wdetail-app", "rama": "fix/1245m0vpr5w-prueba-rapida-ui", "desde": "2026-10-16" },
    "1245m0vpnd5": { "titulo": "mejorar tests en la app", "repo": "wdetail-app", "rama": "sandcastle/feature/1245m0vpnd5-mejorar-tests-en-la-app", "desde": "2026-10-15", "vinculado": "1245m0vq111" }
  }
}
```

Leer: `jq -r '.activo as $a | .tickets | to_entries[] | "\(.key) \(.value.titulo) \(.value.repo)" + (if .key == $a then " (activo)" else "" end)' "$FOCO"`. Escribir siempre el archivo entero con `jq` (`mkdir -p` del directorio la primera vez); título y repo salen de `clickup-cli task get <id>` al agregarlo. Un ticket que el usuario cierra o que llega a *done* en ClickUp se saca; si era el activo, el siguiente del foco pasa a activo y lo decís. `vinculado` (opcional) es el padre hermano en otro repo de la misma tarea: se escribe en los dos; el tablero lo muestra como `↔ <id>`.

## Decisiones

Lo que necesita al usuario (lista de la regla **Orden**) no se pregunta suelto: se encola en `${XDG_STATE_HOME:-$HOME/.local/state}/dirigir/$HERDR_WORKSPACE_ID-decisiones.json` con `scripts/decision`, y el trabajo que no depende de eso sigue.

```bash
D="$SKILL/scripts/decision"
bash "$D" agregar --ticket 1245m0vpr5w --pregunta "¿Cargo 90 min de tiempo?" --opciones "a) sí|b) otro número" --recomendacion a   # imprime el id
bash "$D" agregar --pregunta "¿Borro el worktree sucio de app-vpnd5?" --opciones "a) borrar|b) dejar" --recomendacion b --destructiva
bash "$D" listar              # abiertas, numeradas, con default y minutos de espera
bash "$D" vencidas            # no destructivas con más de 15 min: "<id> <recomendacion>"
bash "$D" aplicar 3           # resuelve por la recomendación (lo hacés al despertar con cada vencida)
bash "$D" resolver 3 b        # respuesta del usuario ("1a 2b" son dos resolver)
bash "$D" recordada 3         # ya la recordaste una vez; no la repitas más
```

Campos: `id`, `ticket`, `pregunta`, `opciones` (`a) …|b) …`), `recomendacion` (letra), `destructiva`, `creada`, `recordada`, `respuesta`, `resuelta`. Una destructiva nunca vence: espera al usuario. El reporte de fin de turno lista las abiertas tal cual las imprime `listar`; el usuario responde `1a 2b` acá o desde el chat del tablero.

## Datos de prueba

Lo que un worker necesita para probar y no vive en el repo (usuarios de prueba por tenant, admin del backoffice local, perfil de AWS, qué hay delante de la API) está en `~/.secrets/pruebas/<repo>.env`, un archivo por repo con el nombre del directorio del repo. `lanzar-worker` lo detecta y se lo monta al worker con `--add-dir`, con la ruta en el mandato: el worker lo lee él, no pasa por tu contexto. Si falta un dato, es decisión (lista **Orden**, punto 2); cuando el usuario lo da, pedile que lo escriba ahí (o escribilo vos con su sí) para que no se vuelva a preguntar. Credenciales nunca en el repo, en la bitácora ni en tus respuestas.

## Planificar

Desde una descripción (argumento o `[tablero] … planificá: …`):

```bash
LIST=$(clickup-cli task get "$OTRO_TICKET_DEL_FOCO" --output json | jq -r '.[0].list.id')
ID=$(clickup-cli task create --list "$LIST" --name "$TITULO" --description @- --output json <<<"$RESUMEN_EN_TRES_LINEAS" | jq -r '.[0].id // .id')
```

La lista sale de otro ticket del mismo repo (del foco o del último cerrado en la bitácora); sin ninguno, o si esa lista es un sprint ya pasado (`.list.name`), es decisión con las listas candidatas como opciones (`clickup-cli list list --folder <id>`). Después: foco (activo) y `lanzar-worker --model fable --objetivo "planificar $ID" --comando "/plan-task $ID"`. Al `estado: hecho`, `clickup-cli task get "$ID" --subtasks` y reportás `n` hijas (`[SPEC]`, slices, `[QA]`) y si hay slices AFK, con orden lanzás el drenaje; sin orden, lo ofrecés.

## Retro

Commits posteriores al fin del worker (`FIN_ISO` de la bitácora, en ISO 8601) o comentarios de revisión:

```bash
(cd "$REPO" && glab api "projects/:id/merge_requests/$IID/commits" | jq -r --arg fin "$FIN_ISO" '[.[] | select(.created_at > $fin)] | length')
(cd "$REPO" && glab mr view "$IID" --output json | jq -r '.user_notes_count')
```

Cualquiera de los dos mayor que cero, o un drenaje con rojos o `needs-info`, justifica lanzar `make sandcastle-retro MR=$IID` (pane sin agente, checkout principal, tab `retro <corto> !<iid>`). Lo que la retro propone se resume al usuario en tres líneas y queda como decisión.

## Nombres

Dos nombres por worker:

- **Nombre de agente** (`--name`, lo usa Herdr para `agent prompt`/`agent wait`): `<corto>-<últimos 5 del task-id>`, p. ej. `api-vnjhx`. Regex `[a-z][a-z0-9_-]{0,31}`. Los reservados los declara el `CLAUDE.md` del workspace.
- **Label del tab** (`--label`, lo lee el usuario en la barra): `<corto> · <qué hace>`, tres o cuatro palabras, sin el id: `api · fix logs crm`, `app · build ipad`, `drenaje vpnd5 tests app`, `api · qa unifarco`. Cuando el tab cambia de propósito (terminó el build y ahora corre metro), `herdr tab rename <tab-id> "<nuevo label>"`.

## Lanzar un drenaje (sandcastle)

```bash
bash "$SKILL/scripts/lanzar-drenaje" --repo "$REPO" --label "$LABEL" --base "$BASE" --parent "$TASK_ID"
# → {"tab":…,"pane":…,"cwd":…,"parent":…,"fin":"herdr pane wait-output <pane> --match \"── Resumen ──\" --timeout 600000"}
herdr pane wait-output "$pane" --match '── Resumen ──' --timeout 600000
herdr pane read "$pane" --source recent-unwrapped --lines 30
```

El script abre el tab sin agente en el checkout principal y corre `make sandcastle-work PARENT=… BASE=… MODEL=opus` (`BASE` y `MODEL` explícitos saltan el menú interactivo). `BASE` es la rama de integración del repo según su `task-workflow.md`; `MODEL=opus` siempre (el drenaje codifica). Varios padres: `--parent x,y`. Tareas sueltas sin plan: `--tasks x[,y]` (corre `make sandcastle-tasks`). El log queda en `$REPO/.sandcastle/logs/run-*.log`. Un drenaje tarda horas: dejalo en su tab y volvé por `wait-output`.

`drain` en el snapshot es el `state.json` que deja el worker (`phase` draining/qa/closing/done/stopped/failed, `slices` done/total, `gate`, `qa` pass/fail/human, `mr`): dice en qué va un drenaje sin leer su log.

## Lanzar un agente

```bash
bash "$SKILL/scripts/lanzar-worker" --repo "$REPO" --name "$NAME" --label "$LABEL" \
  --objetivo "ejecutar $TASK_ID" --ticket "$TASK_ID" --model opus \
  --branch "$BRANCH" --base "$BASE" \
  --orden "$ORDEN_TEXTUAL_DEL_USUARIO" --comando "/work-task $TASK_ID"
# → {"tab":…,"pane":…,"name":…,"cwd":…,"model":…,"status":"working","comando":…}
herdr agent wait "$NAME" --timeout 600000
```

Qué hace, en orden: con `--branch`, crea el worktree `$REPO/.claude/worktrees/<slug>` desde `origin/$BASE` (o lo reutiliza; con `git`, no con `herdr worktree create`/`open`, que abren **un workspace nuevo**); marca el directorio como confiable en `~/.claude.json` (lo mismo que hace el Dockerfile de sandcastle, así no hay diálogo de confianza); detecta `~/.secrets/pruebas/<repo>.env` y lo monta con `--add-dir`; abre el tab (`--no-focus`); arranca Claude con `--model`, `--permission-mode auto` y `$CLAUDE_ARGS`; manda el mandato (abajo) y espera el `estado: pendiente`; con `--comando`, lo manda como prompt propio y vuelve apenas el worker está `working`. Sin `--branch`, el worker corre en `$REPO` (QA, sólo preguntas).

- `--model`: **planificar** (`/plan-task`, grilling, orientación, sólo preguntas) → `fable`; **codificar** (`/work-task`, `/init-task`, `/qa-task`, `/task-finish`) → `opus`. Acepta también un id completo.
- `--orden`: la frase textual del usuario. Va al mandato para que el worker y su clasificador de permisos sepan que ese trabajo está aprobado.
- `--comando`: el comando del ciclo según el `task-workflow.md` del repo. Sólo preguntas: la pregunta misma como `--comando`, y `--objetivo "consulta de sólo lectura: …"`.
- `CLAUDE_ARGS`: vacío. Los workers ya corren en modo auto (el clasificador aprueba lo rutinario y sólo frena lo destructivo); `acceptEdits` sería un retroceso (vuelve a preguntar cada Bash). `--dangerously-skip-permissions` sólo dentro de un contenedor, como hace sandcastle, nunca en un worktree del host.
- `--branch` según la convención del repo (`feature/<id>-<slug>`); QA corre en el checkout principal salvo que el repo declare stack por slot (`make slot N=` en `task-workflow.md` § Host): entonces en el worktree de la tarea con su slot levantado (`make slot N=<libre> && make up` ahí; el slot nace con la base vacía, así que antes `make install` o un dump).

Si el script falla con `agent_not_ready` después del reintento de confianza, leé el pane (`herdr pane read "$pane" --source visible --lines 12`) y respondé con `send-keys`.

## Estado

El hook `herdr-panel-report.sh` (instalado por el setup en `~/.claude/settings.json`, eventos `Stop` y `UserPromptSubmit`) deja en el pane del worker los tokens de sus tres líneas finales y el contexto usado:

```bash
herdr pane get "$pane" | jq -r '.result.pane.tokens | "estado=\(.estado // "-") mr=\(.mr // "-") siguiente=\(.siguiente // "-") ctx=\(.ctx // "?")"'
```

`estado` y `siguiente` se borran al enviar un prompt nuevo y reaparecen cuando el worker para. Si tras `agent wait` no hay `estado`, el worker no cerró con las tres líneas: `herdr agent read "$NAME" --source recent-unwrapped --lines 20` y pedíselas.

Antes de cada `agent prompt` a un worker **idle o done**, `herdr pane send-keys "$PANE" esc`: limpia un modal o un menú que quedó abierto y que haría rebotar el prompt. Nunca a un worker `working`: esc lo interrumpe.

Responder un diálogo de permiso o confirmación: `herdr agent read "$NAME" --source visible --lines 12`, y `herdr agent send-keys "$NAME" enter` (opción resaltada) o `down enter` para la siguiente. Texto libre: otro `agent prompt`.

## Mandato de arranque

Lo manda `lanzar-worker`; esto es lo que recibe el worker, por si hay que mandarlo a mano:

```
Sos el worker `{NAME}` del repo {REPO}. Tu cwd ya es el repo (o un worktree suyo): cargá su CLAUDE.md y docs/agents/.
Objetivo: {OBJETIVO}. Ticket: {TASK_ID}.
Orden textual del usuario, que cubre todo lo que este objetivo necesita: «{ORDEN}».
Datos de prueba (usuarios, admin, perfiles): {RUTA}. Leelo cuando los necesites; nunca los copies a un repo ni a un commit.
El capitán corre en otro pane de Herdr y te lee con `herdr agent read`; no lanzás comandos de skill hasta que él te los mande. Lo que te falte y no esté en el repo ni en los datos de prueba, lo marcás con 🙋 y seguís con lo demás.
Respondé sólo `estado: pendiente` en su renglón y esperá el comando.
Después, cada vez que termines o te trabes, dejá como ÚLTIMO mensaje tres líneas, cada una en su renglón: `estado:` (hecho|bloqueado|pendiente), `mr:` (URL o -), `siguiente:` (una frase). Nada después de eso.
Si cambiás la forma de algo que consume otro repo (ruta, campo, status), decilo en `siguiente:` con el prefijo `CONTRATO:`.
```

## Cierre

Por ticket, con `ID`, `REPO` y `MR` (la URL del token `mr`):

```bash
clickup-cli task get "$ID" --subtasks | rg -i 'to do|in progress' && echo "hijas abiertas"
clickup-cli time list --task "$ID" | rg -q . || echo "sin tiempo registrado"
BASE=$(rg -o 'Base/integration branch: `\K[^`]+' "$REPO/docs/agents/task-workflow.md")
(cd "$REPO" && glab mr view "$MR" --output json | jq -r '[.target_branch, .has_conflicts, .head_pipeline.status, .title] | @tsv')
```

Una rama `hotfix/` apunta a `main`, no a `$BASE`. Tiempo faltante, con la duración que salió de la bitácora (inicio del worker → `estado: hecho`): `decision agregar` con el número como recomendación y, resuelta (respuesta o default a los 15 min):

```bash
clickup-cli time create --task "$ID" --start "$INICIO_MS" --duration "$((MINUTOS * 60000))" --description "<qué se hizo, una línea>"
``` El MR que apunta a otra base o tiene conflictos vuelve al worker: `agent prompt` con el arreglo concreto (`retarget a dev`, `rebase sobre origin/dev`).

Foco: sacar el ticket es reescribir el JSON sin esa clave; si era el activo, el siguiente pasa a activo.

## Nota de continuación para `/compact`

Dos prompts: el comando con la nota como foco, y cuando `agent wait` vuelva, el arranque.

```
/compact Continuar: foco en ${XDG_STATE_HOME:-$HOME/.local/state}/dirigir/{WS}.json. {TASK_ID} en {REPO}, rama {RAMA}. Slice en curso: {SLICE}. Verificado: {QUÉ PASÓ EL GATE}. Próximo paso: {ACCIÓN CONCRETA}. Reportar al capitán con las tres líneas estado/mr/siguiente.
```

```
Continuá según la nota.
```

Umbral: **100k** en el token `ctx` (`"134k"`). La nota del `/compact` va **corta** (una línea). Si el usuario dejó texto tipeado sin enviar en el pane, `agent prompt` lo concatena: leé la línea `❯` antes de mandar (`--source visible --lines 6`). Para vos mismo: `herdr pane get "$HERDR_PANE_ID" | jq -r '.result.pane.tokens.ctx'`.

## Bitácora

`$TMPDIR/dirigir-$(date +%Y%m%d-%H%M).md`:

```markdown
# Dirigir — {fecha} — {workspace} — {objetivo en una línea}

## Repos con ciclo
- {ruta} ({corto}, base {rama}, sandcastle sí/no)

## Ajenos (no tocar)
- {pane} ({nombre}) {cwd}

## Workers
| name | tipo | tab | pane | cwd | ticket | inicio | estado | mr | ctx | último siguiente |
|---|---|---|---|---|---|---|---|---|---|---|

## Decidido solo
- {hora} {qué y por qué}

## Decisiones encoladas
- {id} {ticket} {pregunta} → {respuesta o default}

## Contratos avisados
- {de} → {a}: {qué cambió}
```
