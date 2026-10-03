---
name: github-issues
description: "Operar GitHub Issues desde la terminal con `gh`, gastando el mínimo de tokens. Usar ante cualquier operación sobre issues — leer, crear, buscar, cambiar status (labels), sub-issues, dependencias, comentarios — que no esté cubierta por una skill del ciclo de vida."
---

# github-issues

El tracker es **GitHub Issues** del mismo repo, operado con el CLI [`gh`](https://cli.github.com) — elegido sobre los MCP de GitHub porque su salida acotada (`--json` + `--jq`) cuesta una fracción de los tokens del JSON crudo y no carga tool definitions en cada sesión.

Los valores del repo — strings de los labels de status, convenciones de títulos y triage — no viven acá: salen de `docs/agents/issue-tracker.md`, `triage-labels.md` y `task-workflow.md` del repo consumidor. Para flujos ya envueltos (planificar, ejecutar, QA), preferí la skill del ciclo de vida sobre llamadas crudas.

## Cómo se mapea el modelo de la suite

| Concepto de la suite | En GitHub |
| --- | --- |
| Tarea / padre | Issue (`#N`; el id que usan las skills es el número) |
| Hija del plan (`[SPEC]`, slice, `[DOCS]`, `[QA]`, `[FIX]`) | **Sub-issue** del padre, en el mismo repo |
| Status del ciclo (backlog, planned, in progress, in review) | Label con prefijo `status:` — **uno solo por issue**; strings exactos en `task-workflow.md` |
| Tag (triage, `needs-info`, modelo liviano) | Label sin prefijo |
| «Bloqueada por» | Dependencia nativa (*blocked by*) |
| Descripción | Body del issue (markdown) |
| Comentario | Comentario del issue |

Abrir/cerrar el issue no es un status del ciclo: el PR enlaza al padre bajo `## Tarea` sin keyword de cierre, y lo cierra un humano después del merge (un PR mergeado puede dejar slices HITL pendientes).

## Setup (una vez por máquina)

```bash
gh auth status            # exit 0 = listo
brew install gh           # sólo si falta (o el package manager del SO)
gh auth login             # interactivo: lo corre el usuario, no el agente
```

Si `gh auth status` falla, **parás y se lo pedís al usuario**: `gh auth login` es interactivo y suyo. El agente **nunca** corre `gh auth token`, ni lee `~/.config/gh/hosts.yml`, ni busca `GH_TOKEN`/`GITHUB_TOKEN` con `rg`/`grep`/`cat`/`env`: el comando y su salida terminan en el contexto, y de ahí en cualquier transcript. Un token filtrado es acceso a todos los repos del usuario. Tampoco crees archivos con tokens dentro de un repo.

## Reglas de tokens y latencia

- **`--json` siempre con `--jq` o con la lista mínima de campos**; nunca `gh api` sin `--jq` sobre un issue entero (~5KB por issue con labels, reactions y user).
- `gh issue view N --json body --jq .body` para la descripción; `gh issue view N` a secas imprime además metadata que casi nunca hace falta.
- Texto multilínea (bodies, comentarios) entra por `--body-file {archivo}` o `--body-file -` (stdin), nunca inline en el shell.
- `gh issue list` devuelve **30 por defecto**: pasá `--limit` explícito cuando armás una cola.
- Encadená comandos independientes en una sola invocación de shell; `gh` tarda ~0.5s por llamada, el patrón N+1 es el cuello de botella, no el binario.
- Los `--label` admiten lista con comas (`--add-label a,b`, `--remove-label a,b`).
- Si la rama contiene el número (`feature/42-slug`), el id de la tarea sale de ahí sin preguntar.

## Cuando algo falla

- **403 con `rate limit`**: 5000 req/h autenticado; esperá lo que diga `x-ratelimit-reset` (o 60s), reintentá **una sola vez** y si vuelve a fallar, pará y avisá. No entres en loop.
- **401 / 403 sin rate limit**: token vencido, revocado o sin scope sobre el repo. Pará y avisá — no reintentes ni busques otro token.
- **404 en un issue que existía**: puede estar en otro repo (transferido) o ser un PR. Verificá con `gh issue view N --json url`.
- **422 al crear sub-issue**: el `sub_issue_id` es el **id de base de datos** (`gh api repos/{o}/{r}/issues/N --jq .id`), no el número ni el `node_id` que devuelve `gh issue view --json id`.
- **`label not found`**: `gh issue edit --add-label` no crea labels. Los crea `setup-skills` una vez por repo (`gh label create`); si falta, crealo con el string exacto de `task-workflow.md`/`triage-labels.md`.

## Mapa de comandos

`{o}/{r}` es `owner/repo` del remoto `origin`; dentro del repo `gh` lo infiere y en `gh api` se puede escribir `repos/{owner}/{repo}/...` literal.

| Operación | Comando |
| --- | --- |
| Health check | `gh auth status` |
| Mi usuario | `gh api user --jq .login` (o `@me` en flags de `gh issue`) |
| Leer un issue (campos) | `gh issue view N --json number,title,labels,state --jq '{number,title,state,labels:[.labels[].name]}'` |
| Leer la descripción completa | `gh issue view N --json body --jq .body` |
| Listar sub-issues | `gh api 'repos/{owner}/{repo}/issues/N/sub_issues?per_page=100' --jq '.[] \| {number,title,labels:[.labels[].name]}'` |
| Buscar por status + assignee | `gh issue list --label "{status label}" --assignee @me --state open --limit 100 --json number,title,createdAt` |
| Cambiar status | `gh issue edit N --add-label "{nuevo}" --remove-label "{anterior}"` (un solo `status:*` por issue: quitá el que tenía) |
| Reemplazar descripción | `gh issue edit N --body-file {archivo}` (reemplaza el body entero: traé, editá local, subí) |
| Crear sub-issue | `gh issue create --title "..." --body-file {archivo} --label "{status},{tags}" --assignee @me` → `id=$(gh api repos/{owner}/{repo}/issues/{nuevo} --jq .id)` → `gh api -X POST repos/{owner}/{repo}/issues/{padre}/sub_issues -F sub_issue_id=$id` |
| Comentar | `gh issue comment N --body-file -` |
| Agregar / quitar label | `gh issue edit N --add-label {tag}` / `gh issue edit N --remove-label {tag}` |
| Marcar «bloqueada por» | `gh api -X POST repos/{owner}/{repo}/issues/N/dependencies/blocked_by -F issue_id=$(gh api repos/{owner}/{repo}/issues/{bloqueante} --jq .id)` |
| Leer bloqueos de un issue | `gh issue view N --json blockedBy --jq '[.blockedBy[].number]'` |
| Leer un comentario entero | `gh api repos/{owner}/{repo}/issues/N/comments --jq '.[-1].body'` (`gh issue view --comments` renderiza con decoración) |
| URL web | `https://github.com/{o}/{r}/issues/N` |
| Labels del repo | `gh label list --limit 100 --json name --jq '.[].name'` / `gh label create "{name}" --color {hex} --description "..."` |

## Cola de sub-issues con triage y dependencias — una sola llamada

`sub_issues` trae labels y body de cada hija pero **no sus dependencias**. Para la cola entera (status, tags y bloqueos) sin un `view` por hija, usá GraphQL:

```bash
gh api graphql -F owner='{o}' -F repo='{r}' -F number=N -f query='
  query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ issue(number:$number){
    subIssues(first:100){ nodes{ number title createdAt labels(first:20){nodes{name}} blockedBy(first:50){nodes{number}} } } } } }' \
  --jq '.data.repository.issue.subIssues.nodes[] | {number,title,createdAt,labels:[.labels.nodes[].name],blocked_by:[.blockedBy.nodes[].number]}'
```

Si sólo necesitás títulos y labels, alcanza el endpoint REST `sub_issues` del mapa.

## Limitaciones conocidas

- Un issue tiene **un solo padre**: una hija no se puede colgar de dos planes.
- `gh issue list` no filtra por «es sub-issue de N»: la cola de un padre siempre sale de `sub_issues`/GraphQL, no de `list`.
- Los labels se crean por repo: un repo nuevo arranca sin `status:*` ni triage; `setup-skills` los crea.
- `gh issue create` no acepta `--parent`: la vinculación es la segunda llamada del mapa, siempre.

---

*Mapa escrito contra `gh` 2.102. Si un flag falla como desconocido, no improvises variantes: `gh {cmd} --help` y actualizá este archivo.*
