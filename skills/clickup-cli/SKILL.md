---
name: clickup-cli
description: Operar ClickUp desde la terminal con el binario `clickup-cli`, gastando el mínimo de tokens. Usar ante cualquier operación sobre tareas de ClickUp — leer, crear, buscar, cambiar status, tags, comentarios, dependencias — que no esté cubierta por una skill del ciclo de vida.
---

# clickup-cli

El binario [`clickup-cli`](https://clickup-cli.com) (repo `nicholasbester/clickup-cli`) es la única vía al tracker — elegido sobre los MCP de ClickUp porque su salida aplanada cuesta una fracción de los tokens del JSON crudo del API y no carga tool definitions en cada sesión.

Los valores del repo — space, listas, convenciones de títulos y triage, statuses del ciclo de vida — no viven acá: salen de `docs/agents/issue-tracker.md`, `triage-labels.md` y `task-workflow.md` del repo consumidor. Para flujos ya envueltos (planificar, ejecutar, QA), preferí la skill del ciclo de vida sobre llamadas crudas.

## Setup (una vez por máquina)

```bash
clickup-cli auth check                        # exit 0 = listo
npm install -g @nick.bester/clickup-cli@1     # sólo si el binario falta
```

El token va **siempre** en el entorno, nunca leído desde disco por el agente:

```bash
[ -n "$CLICKUP_TOKEN" ] || { echo "Falta CLICKUP_TOKEN — pedíselo al usuario y frená"; exit 1; }
```

Si `CLICKUP_TOKEN` no está seteado, **parás y se lo pedís al usuario** (ClickUp → Settings → Apps). No lo busques en el config ni lo copies a una variable con `rg`/`grep`/`cat`: el comando y su salida terminan en el contexto, y de ahí en cualquier transcript que se exporte o se pase a un subagente. Un token filtrado es acceso completo al workspace y no expira solo.

Si el usuario prefiere el config del CLI en vez del env, que lo cargue él en su shell — el agente igual sólo consume `$CLICKUP_TOKEN`. Al archivo de config, `chmod 600` en la ruta que reporta `setup` (`~/.config/clickup-cli/config.toml` en Linux, `~/Library/Application Support/clickup-cli/config.toml` en macOS). Nunca crees un `.clickup.toml` dentro de un repo (token en texto plano, fácil de commitear).

## Reglas de tokens y latencia

- La salida por defecto (tabla aplanada) es la más barata — dejala.
- **`--output json` siempre pipeado por `jq`, nunca impreso.** Si no vas a filtrar, usá `--output json-compact`. Un `task get` pasa de ~170 bytes en tabla a ~3.4KB en json crudo; imprimir eso entero paga el costo del MCP que esta skill existe para evitar.
- `--fields` para pedir sólo las columnas que usás; `-q` cuando sólo necesitás IDs.
- `task get {id} --markdown` cuando importan las URLs de los links de la descripción (la tabla aplanada los pierde).
- Texto multilínea (descripciones, comentarios) entra por `@{archivo}` o `@-` (stdin), nunca inline en el shell.
- Cada llamada tarda ~0.5s: el binario no es el cuello de botella, el patrón N+1 sí. Encadená comandos independientes en una sola invocación de shell (`cmd1; cmd2`) y usá el patrón de cola de abajo en vez de un `task get` por subtarea.
- Si la tarea está en `CLICKUP_TASK_ID` (env) o la rama contiene `CU-{id}` (p. ej. `fix/CU-abc123-slug`), los comandos task-scoped resuelven el ID solos y podés omitirlo. Un ID crudo en la rama (`fix/abc123-slug`) **no** se detecta.

## Cuando algo falla

- **429 (rate limit):** el API son 100 req/min en Free/Unlimited/Business. Esperá lo que diga `Retry-After` (o 60s), reintentá **una sola vez** y si vuelve a fallar, pará y avisá. No entres en loop de reintentos.
- **401 / 403:** token vencido, revocado o sin permiso sobre ese space. Pará y avisá al usuario — no reintentes ni busques otro token.
- **404 en un ID que antes existía:** puede ser una tarea archivada. Reintentá con `--include-closed` antes de asumir que se borró.

## Cacheo de IDs

Los IDs de jerarquía (space, folder, list) no cambian. Resolvelos **una vez al principio de la sesión** y reusá los valores desde el contexto — no vuelvas a llamar `space list` / `list list` en la misma sesión.

Si el repo tiene `.claude/clickup-ids.json` (gitignoreado), leelo de ahí primero y sólo consultá el CLI si falta o está incompleto. Si lo resolvés desde cero y el archivo no existe, ofrecé escribirlo.

## Mapa de comandos

| Operación | Comando |
| --- | --- |
| Leer una tarea (con subtareas) | `clickup-cli task get {id} --subtasks` |
| Cambiar status | `clickup-cli task update {id} --status "{status}"` |
| Editar descripción | `clickup-cli task update {id} --description @{archivo}` (reemplaza la descripción entera — traé con `--markdown`, editá local, subí) |
| Crear tarea / subtarea | `clickup-cli task create --list {LIST_ID} --name "..." --description @{archivo} --parent {parent-id} --assignee {user-id} --tag {tag}` |
| Comentar una tarea | `clickup-cli comment create --task {id} --text @{archivo}` |
| Agregar / quitar tag | `clickup-cli task add-tag {id} {tag}` / `clickup-cli task remove-tag {id} {tag}` |
| Marcar "bloqueada por" | `clickup-cli task add-dep {id} --depends-on {blocker-id}` |
| Mi user id (para `--assignee`) | `clickup-cli auth whoami` |
| Buscar / filtrar tareas | `clickup-cli task search --status "{status}" --assignee {user-id}` (sumá `--list`/`--space`/`--tag`) |
| Descubrir los statuses de una lista | `clickup-cli list get {LIST_ID} --output json \| jq '[.[].statuses[].status]'` (`json-compact` los pierde — acá sí hace falta `json`) |
| Descubrir IDs de la jerarquía | `clickup-cli space list`, `folder list --space {id}`, `list list --folder {id}`, `workspace list -q` — ver "Cacheo de IDs" |
| Referencia completa del CLI | `clickup-cli agent-config show` (~6KB) — sólo si necesitás un comando que no está en este mapa |

## Cola de subtareas con triage y dependencias — una sola llamada

> **Una de las dos excepciones al uso del CLI en toda la skill** — la otra es leer un comentario entero, abajo. Cualquier otra operación va por `clickup-cli`, aunque un endpoint del API parezca más directo o más rápido. Si te tienta escribir un tercer `curl`, buscá el comando en `agent-config show`.

`task get {id} --subtasks` **no renderiza las subtareas** en tabla ni `json-compact` (sólo la fila del padre), y en `--output json` el payload embebido trae `tags` y `dependencies` **vacíos** — no sirve para clasificar triage ni ordenar por bloqueos. En vez de un `task get` por subtarea (N+1), armá la cola entera con el endpoint de filtro (~1s, respuesta ~1MB: **siempre por `jq`**):

```bash
curl -s -H "Authorization: $CLICKUP_TOKEN" \
  "https://api.clickup.com/api/v2/team/{workspace-id}/task?list_ids%5B%5D={LIST_ID}&subtasks=true&include_closed=true" |
  jq '[.tasks[] | select(.parent=="{parent-id}") | . as $t |
      {id, name, status: .status.status, tags: [.tags[].name],
       blocked_by: [$t.dependencies[] | select(.task_id==$t.id) | .depends_on]}]'
```

El `{workspace-id}` lo reporta `clickup-cli status`. El token sale de `$CLICKUP_TOKEN` y de ningún otro lado.

Si querés que el token no aparezca ni siquiera en la línea de comando (visible en `ps` en máquinas compartidas), pasá el header por config:

```bash
curl -s --config <(printf 'header = "Authorization: %s"\n' "$CLICKUP_TOKEN") \
  "https://api.clickup.com/api/v2/team/{workspace-id}/task?..." | jq '...'
```

Si sólo necesitás nombres y statuses (sin triage ni deps), alcanza el json del padre: `task get {id} --subtasks --output json | jq '.[0].subtasks | map({id, name, status: .status.status})'`.

## Limitaciones conocidas

**El texto de los comentarios llega cortado, y en los cuatro formatos.** `comment list` trunca
`comment_text` a unos 60 caracteres y lo remata con «…» en `table`, `json`, `json-compact` y `csv`; no hay
flag que lo evite. Para **leer** un comentario entero —la respuesta de un humano a un `needs-info`, un
checklist de QA pegado en la tarea— el CLI no sirve:

```bash
curl -s -H "Authorization: $CLICKUP_TOKEN" \
  "https://api.clickup.com/api/v2/task/{task-id}/comment" | jq -r '.comments[] | .comment_text'
```

Y como `comment update` responde con una fila vacía en vez del comentario que escribió, **una edición sólo
se verifica por ese endpoint**: el listado truncado no distingue dos textos que empiezan igual, así que da
por buena una escritura que quizá no entró. Escribir comentarios sí va por el CLI, como todo lo demás.

`task search` no incluye subtareas — una tarea que matchea pero es subtarea de otra no aparece (un padre `planificado` que cuelga de otra tarea se pierde). Fallback cuando una cola parece incompleta: el mismo endpoint de filtro de arriba con `statuses%5B%5D={status}` en vez de `list_ids`.

---

*Mapa de comandos escrito contra `clickup-cli` v0.16.0. Si un comando falla con error de flag desconocido, no improvises variantes: verificá contra `clickup-cli agent-config show` y actualizá este archivo.*