# Referencia de `dirigir`

Recetas que la skill consulta a demanda. Lo específico de cada workspace (qué repos hay, cuál es cada cosa, nombres reservados, cómo elegir repo por ticket) vive en el `CLAUDE.md` del cwd del director; los strings de status y la rama base **salen del `docs/agents/task-workflow.md` de cada repo** y los lee el worker.

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

## Nombres

Esquema `<corto>-<últimos 5 del task-id>`, p. ej. `api-vnjhx`. Regex de Herdr `[a-z][a-z0-9_-]{0,31}`. Los reservados los declara el `CLAUDE.md` del workspace.

## Lanzar un drenaje (sandcastle)

```bash
out=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$REPO" --label "$NAME" --no-focus)
tab=$(echo "$out" | jq -r '.result.tab.tab_id')
pane=$(echo "$out" | jq -r '.result.root_pane.pane_id')
sleep 2
herdr pane run "$pane" make sandcastle-work PARENT="$TASK_ID" BASE="$BASE" MODEL=opus
herdr pane wait-output "$pane" --match '── Resumen ──' --timeout 600000
herdr pane read "$pane" --source recent-unwrapped --lines 30
```

`BASE` y `MODEL` explícitos saltan el menú interactivo. `BASE` es la rama de integración del repo según su `task-workflow.md`; `MODEL=opus` siempre (el drenaje codifica). Varios padres: `PARENT=x,y`. Tareas sueltas sin plan: `make sandcastle-tasks TASKS=x[,y]`. El log queda en `$REPO/.sandcastle/logs/run-*.log`. Un drenaje tarda horas: dejalo en su tab y volvé por `wait-output`.

## Lanzar un agente

Planificar o codificar: primero el worktree de la tarea (skill `worktrees`; `BRANCH` según la convención del repo, p. ej. `feature/<id>-<slug>`; `SLUG` = la rama con `/` → `-`):

```bash
herdr worktree create --cwd "$REPO" --branch "$BRANCH" --base "origin/$BASE" --path "$REPO/.claude/worktrees/$SLUG" --label "$SLUG" --no-focus
CWD="$REPO/.claude/worktrees/$SLUG"
```

`drain` es el `state.json` que deja el worker (`phase` draining/qa/closing/done/stopped/failed, `slices` done/total, `gate`, `qa` pass/fail/human, `mr`): dice en qué va un drenaje sin leer su log.

QA o sólo preguntas: `CWD="$REPO"` (checkout principal). Si el repo declara stack por slot (`make slot N=` en `task-workflow.md` § Host), QA puede correr en el worktree de la tarea: tecla `u` en su fila del tablero (o `make slot N=<libre> && make up` ahí) y `l` abre la app en su puerto; el slot nace con la base vacía, así que antes `make install` o un dump. Después, igual para todos:

```bash
out=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$CWD" --label "$NAME" --no-focus)
tab=$(echo "$out" | jq -r '.result.tab.tab_id')
pane=$(echo "$out" | jq -r '.result.root_pane.pane_id')
sleep 2
herdr agent start "$NAME" --kind claude --pane "$pane" --timeout 90000 -- --model "$MODEL" $CLAUDE_ARGS
herdr agent prompt "$NAME" "$MANDATO" --wait --timeout 600000
herdr pane get "$pane" | jq -c '.result.pane.tokens'
herdr agent prompt "$NAME" "$COMANDO_QUE_ELIGIO" --wait --timeout 3600000
```

El `sleep 2` evita `agent_pane_busy`. Si `agent start` devuelve `agent_not_ready` ... `blocked during startup`, es el diálogo de confianza de carpeta de Claude Code (worktree nuevo): `herdr agent send-keys "$NAME" down enter` y `herdr agent wait "$NAME"`. `MODEL` lo fija el propósito del worker: **planificar** (`/plan-task`, grilling, orientación, sólo preguntas) → `claude-fable-5-1`; **codificar** (`/work-task`, `/init-task`, `/qa-task`, `/task-finish`) → `claude-opus-5-5`. `CLAUDE_ARGS` es la política de permisos; por defecto vacío (hereda la config del repo y pregunta → vos respondés). Para un trabajo AFK largo que el usuario pidió explícitamente: `--permission-mode acceptEdits`.

`--wait` vuelve con el primer estado asentado: `idle`/`done` (terminó el turno) o `blocked` (diálogo). Rechaza con `agent_blocked` si el agente ya está en un diálogo: leé y respondé antes.

## Estado

El hook `herdr-panel-report.sh` (instalado por el setup en `~/.claude/settings.json`, eventos `Stop` y `UserPromptSubmit`) deja en el pane del worker los tokens de sus tres líneas finales y el contexto usado:

```bash
herdr pane get "$pane" | jq -r '.result.pane.tokens | "estado=\(.estado // "-") mr=\(.mr // "-") siguiente=\(.siguiente // "-") ctx=\(.ctx // "?")"'
```

`estado` y `siguiente` se borran al enviar un prompt nuevo y reaparecen cuando el worker para. Si tras `agent wait` no hay `estado`, el worker no cerró con las tres líneas: `herdr agent read "$NAME" --source recent-unwrapped --lines 20` y pedíselas.

Responder un diálogo de permiso o confirmación: `herdr agent read "$NAME" --source visible --lines 12`, y `herdr agent send-keys "$NAME" enter` (opción resaltada) o `down enter` para la siguiente. Texto libre: otro `agent prompt`.

## Mandato de arranque

```
Sos el worker `{NAME}` del repo {REPO}. Tu cwd ya es el repo (o un worktree suyo): cargá su CLAUDE.md y docs/agents/.
Objetivo: {OBJETIVO: "ejecutar {TASK_ID}" | "planificar {TASK_ID}" | "QA de {TASK_ID}" | pregunta}.
El director técnico corre en otro pane de Herdr y te lee con `herdr agent read`; vos no lanzás comandos de skill hasta que él te los mande.
Primero: en tres líneas, cómo se trabaja este objetivo en este repo y qué comando exacto lo lanza (skill del ciclo, make, o pasos directos). Terminá con `estado: pendiente`.
Después, cada vez que termines o te trabes, dejá como ÚLTIMO mensaje tres líneas, cada una en su renglón: `estado:` (hecho|bloqueado|pendiente), `mr:` (URL o -), `siguiente:` (una frase). Nada después de eso.
Si cambiás la forma de algo que consume otro repo (ruta, campo, status), decilo en `siguiente:` con el prefijo `CONTRATO:`.
```

Sólo preguntas (cualquier repo):

```
Sos `{NAME}`, consulta de sólo lectura sobre {REPO}. Respondé con ruta y línea como evidencia; leé, buscá y ejecutá consultas, sin editar nada. Pregunta: {PREGUNTA}. Terminá con `estado: hecho` en su renglón.
```

## Nota de continuación para `/compact`

Dos prompts: el comando con la nota como foco, y cuando `agent wait` vuelva, el arranque.

```
/compact Continuar: {TASK_ID} en {REPO}, rama {RAMA}. Slice en curso: {SLICE}. Verificado: {QUÉ PASÓ EL GATE}. Próximo paso: {ACCIÓN CONCRETA}. Reportar al director con las tres líneas estado/mr/siguiente.
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
| name | tipo | tab | pane | cwd | ticket | estado | mr | último siguiente |
|---|---|---|---|---|---|---|---|---|

## Decisiones
- {hora} {qué y por qué}

## Contratos avisados
- {de} → {a}: {qué cambió}
```
