# Referencia de `worktrees`

Valores y recetas que la skill consulta a demanda. Lo que varía por repo se marca como `{placeholder}` y vive en el `docs/agents/task-workflow.md` del consumidor.

## Convención

Un solo lugar por repo: `<repo>/.claude/worktrees/<slug>`, con `<slug>` = rama con `/` → `-` (`feature/86cax7u8f-centros` → `feature-86cax7u8f-centros`). Por qué ahí y no en una carpeta hermana:

- Es el default de Claude Code: `claude --worktree <name>` crea "under `.claude/worktrees/<name>/` at your repository root" y `EnterWorktree` entra sin pedir aprobación sólo a paths bajo ese directorio; fuera de él "Claude Code asks for your approval first" ([worktrees](https://code.claude.com/docs/en/worktrees)).
- Las skills, agents y commands del main checkout se leen desde el worktree cuando el worktree no tiene `.claude/skills` propio (read-through, v2.1.277+), y las aprobaciones de permisos se guardan en el `settings.local.json` del main y valen para todos los worktrees (misma fuente).
- El slug cumple la restricción de nombre de proyecto de Compose: "must contain only lowercase letters, decimal digits, dashes, and underscores" y empezar por letra o dígito ([project-name](https://docs.docker.com/compose/how-tos/project-name/)). Una carpeta hermana llamada `worktrees/` compartida entre repos obliga a prefijar el repo en cada nombre y mezcla apps distintas en un mismo listado.
- Hay que tenerlo en `.gitignore` (la doc lo pide explícitamente); un worktree dentro del repo no aparece como untracked si está ignorado.

`.sandcastle/worktrees/` es territorio del worker (`sandcastle/<rama>`, mirror branch): se lista y se deja.

**Main checkout**: queda en la rama base del repo, limpio. Es donde vive el runtime por defecto y donde `qa-task` e `init-task` checkoutean (`task-workflow.md` § Branching del consumidor). Un main en detached HEAD o en una rama de tarea es deuda: se vuelve a la base cuando esté limpio.

## Crear

Rama nueva desde la base actualizada:

```bash
git fetch origin {base}
git worktree add -b {branch} .claude/worktrees/{slug} origin/{base}
git -C .claude/worktrees/{slug} push -u origin {branch}   # cuando haya algo que pushear; antes, opcional
```

Rama que ya existe en remoto (p. ej. para revisar una MR ajena):

```bash
git fetch origin {branch}
git worktree add .claude/worktrees/{slug} {branch}        # crea la local con tracking si sólo existe en origin
```

Si git responde `fatal: '{branch}' is already checked out at '<path>'`, ese path es el worktree de la tarea: usalo. `--force` existe pero crea dos checkouts de la misma rama, y el segundo commit que hagas deja al otro con HEAD desincronizado.

Desde Herdr (tab propio con cwd en el worktree):

```bash
herdr worktree create --cwd "$REPO" --branch {branch} --base origin/{base} --path "$REPO/.claude/worktrees/{slug}" --label {slug} --no-focus
herdr worktree open   --cwd "$REPO" --path "$REPO/.claude/worktrees/{slug}" --label {slug} --no-focus   # uno ya existente
herdr worktree list   --cwd "$REPO"   # JSON: path, branch, is_detached, is_prunable, is_linked_worktree
```

(Sintaxis de `herdr worktree` en 0.8.0: `herdr worktree` pelado imprime la ayuda; `herdr worktree remove --workspace ID` borra worktree **y** workspace, por eso la limpieza se hace con git.)

Desde Claude Code: `claude -w {slug}` (rama `worktree-{slug}` si no existe; con `#123` o URL de MR de GitLab, fetch de `merge-requests/123/head` a `.claude/worktrees/pr-123`). Al salir, un worktree sin cambios y sin nombre de sesión se borra solo; con cambios pregunta keep/remove ([worktrees § Clean up](https://code.claude.com/docs/en/worktrees)). Los `-p` no limpian y dejan lock: `git worktree unlock` antes de `remove`.

## Archivos locales

Un worktree es un checkout limpio: lo gitignorado no viene. `.worktreeinclude` (sintaxis `.gitignore`, en la raíz del repo) copia esos archivos en cada worktree que crea **Claude Code**; `git worktree add` y `herdr worktree create` no lo leen. Lista por repo en `task-workflow.md` § Environment; a falta de ella, lo mínimo es el `.env` de la app (`{env-files}`).

Hooks: viven en `$GIT_DIR/hooks` o `core.hooksPath` ([githooks](https://git-scm.com/docs/githooks)); como el `config` y los hooks son del common dir, un worktree hereda los del main. `post-checkout` corre también en `git worktree add` (misma fuente).

## Stack por worktree

Compose nombra contenedores, red y volúmenes con el project name, que sale de (mayor a menor prioridad) `-p`, `COMPOSE_PROJECT_NAME`, `name:` del compose, nombre del directorio del compose ([project-name](https://docs.docker.com/compose/how-tos/project-name/)). Dos worktrees del mismo repo tienen directorios distintos → proyectos distintos automáticamente; lo que choca son los **puertos de host fijos** y los **`container_name` fijos** del compose. Lo que el repo tiene que ofrecer (cambio al repo, no a esta skill):

```yaml
# docker-compose.yml: sin container_name; puertos parametrizados con default
services:
  app:
    ports:
      - "${APP_PORT:-8000}:8000"
  db:
    ports:
      - "${DB_PORT:-3368}:3306"
```

```make
# Makefile: WT=1 activa el perfil de worktree
COMPOSE := docker compose -f docker-compose.yml $(if $(WT),-p $(notdir $(CURDIR)) --env-file .env.worktree)
```

Con `.env.worktree` (gitignorado, generado al crear el worktree) fijando `APP_PORT`, `DB_PORT` y demás con un offset libre. Qué puertos son libres: `docker compose ls --format json` + `lsof -nP -iTCP -sTCP:LISTEN`. Registrar en `task-workflow.md` § Environment: `Worktree stack: {comando}` y `Worktree ports: {variables}`.

Volúmenes: con project name propio, `mysql_data` pasa a ser `<slug>_mysql_data`, vacío. Migrar y seedear es parte de "levantar". Cuidado con repos cuyo nombre de volumen es contrato (`~/dev/CLAUDE.md`: los `wdetail-*` conservan el nombre porque los volúmenes dependen de él): el main sigue como está, sólo los worktrees usan `-p`.

Un tablero lee el estado así:

```bash
docker compose ls --all --format json | jq -r '.[] | "\(.Name)\t\(.Status)\t\(.ConfigFiles)"'
```

`ConfigFiles` apunta al compose del worktree, así que mapear proyecto → worktree es comparar prefijos de path. Un proyecto cuyo nombre es `docker` (visto en este parque: `legacy/wdetailcrm/docker/docker-compose.yml`) es el síntoma del default por directorio sin `name:`.

## Gotchas con fuente

| Gotcha | Fuente |
|---|---|
| `remove` sólo acepta worktrees limpios ("no untracked files and no modification in tracked files"); `--force` para sucios, dos veces para locked. El main no se puede borrar. | [git-worktree](https://git-scm.com/docs/git-worktree) |
| Borrar el directorio a mano deja la entrada en `$GIT_DIR/worktrees`; `git worktree prune` la saca (`-n -v` para ver antes). Mover a mano exige `git worktree repair <path>`. | ídem |
| `list --porcelain` es formato estable; `-z` para paths con newline. | ídem |
| `extensions.worktreeConfig true` + `git config --worktree` habilita config por worktree (`core.sparseCheckout` no debe compartirse). Gits viejos rechazan el repo con la extensión. | ídem |
| Rebase o merge adentro de un worktree es normal: refs bajo `refs/` son compartidas; sólo `HEAD`, índice y `refs/bisect|worktree|rewritten` son por worktree. | ídem |
| Claude Code bloquea ediciones y `git` dirigidos al main checkout desde una sesión aislada en worktree (cuatro checks). | [worktrees § isolation](https://code.claude.com/docs/en/worktrees) |
| Claude Code sostiene `git worktree lock` mientras un agente corre en su worktree; el sweep periódico libera locks de procesos muertos pero nunca los manuales. | ídem |
| `worktree.baseRef`: `fresh` (default, `origin/HEAD`, fetch si hace >24 h) o `head`; no acepta un nombre de rama. | ídem |
| `${CLAUDE_PROJECT_DIR}` de los hooks no sigue al worktree; el `cwd` del JSON de entrada sí. | ídem |
| Compose: nombre de proyecto por directorio si no hay `-p`/`COMPOSE_PROJECT_NAME`/`name:`. | [project-name](https://docs.docker.com/compose/how-tos/project-name/) |

## Lo que va en `task-workflow.md` del consumidor

```markdown
## Worktrees
- Root: `.claude/worktrees/` (slug = branch with `/` → `-`)
- Main checkout stays on: `{base}`
- Local files to copy: `{env-files}` (also listed in `.worktreeinclude`)
- Stack per worktree: `{command}` — ports: `{variables}` (empty = main checkout only)
```

## Ejemplo: estado de `wdetail-api` (2026-10-15)

Tres ubicaciones conviviendo: `~/dev/crm-quark/worktrees/` (7, nombres `wdetail-api-<id>` y `fix-<id>-slug`), `.claude/worktrees/` (3, nombres cortos sin id), `.sandcastle/worktrees/` (2, del worker). Main en detached HEAD. Compose con `container_name` fijos (opensearch, mailpit, dashboards) y puertos fijos (8000, 3368, 9201, 8025, 5602), `COMPOSE := docker compose -f docker-compose.yml` sin `-p`: hoy sólo el main levanta stack. Plan de migración = paso 6 de la skill sobre esta tabla.
