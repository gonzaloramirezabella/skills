---
name: worktrees
description: Manejo de git worktrees para trabajo en paralelo — crear uno por tarea o rama, diagnosticar los existentes (huérfanos, mergeados, sucios), levantar o bajar su stack docker con puerto propio, entrar con Claude Code o lanzarle un agente de Herdr, limpiar, y migrar un repo con worktrees desordenados a la convención. Usar cuando el usuario nombra un worktree o pide trabajar varias ramas a la vez.
---

# Worktrees

Un worktree es un checkout más del mismo repo: comparte `.git`, refs, remotes y hooks, pero tiene su propio directorio, índice y `HEAD`. La regla que gobierna todo: **una rama vive en un solo worktree a la vez**; git se niega a checkoutearla en dos (`git worktree add` "refuses to create a new worktree when <commit-ish> is a branch name and is already checked out by another worktree", [git-worktree](https://git-scm.com/docs/git-worktree)).

Convención, comandos exactos, override de docker y gotchas con fuente: [REFERENCE.md](REFERENCE.md). Lo que depende del repo (rama base, comando de stack, puertos) sale de su `docs/agents/task-workflow.md`; sin ese dato, preguntá antes de inventarlo.

## 0. Orientarse

Siempre antes de tocar nada:

```bash
git rev-parse --show-toplevel          # dónde estás: main checkout o worktree
git worktree list --porcelain          # formato estable; `-v` agrega prunable/locked
```

Anotá tres cosas: el **main checkout** (primera línea), si está en la rama base y limpio, y qué worktrees ya existen con su rama. Los que viven bajo `.sandcastle/worktrees/` son del worker: se listan, no se tocan.

*Criterio:* tabla path → rama → estado (clean/dirty/detached/prunable/locked) en tu respuesta.

## 1. Crear uno para una tarea o rama

1. Resolvé la rama: si viene un task-id, el nombre lo da la convención del repo (`{feature|fix|chore}/{task-id}-{slug}`, misma regla que `init-task`); si la rama ya existe local o en `origin`, se usa tal cual.
2. Path canónico: `<repo>/.claude/worktrees/<slug>`, con `<slug>` = la rama con `/` → `-`. Razón en REFERENCE § Convención.
3. Si la rama ya está checkouteada en otro worktree, **ese** es el worktree de la tarea: entrá ahí, no fuerces un segundo.
4. Creá con la receta de REFERENCE (git; `herdr worktree create` sólo si querés un **workspace** nuevo para ese worktree: siempre abre uno, aun con `--workspace`). Rama nueva: desde la rama base actualizada (`git fetch origin` primero). Rama existente en remoto: `git worktree add <path> <branch>` con tracking.
5. Copiá lo gitignorado que el stack necesita (`.env` y similares): `.worktreeinclude` lo hace automático sólo para worktrees que crea Claude Code; a mano, copialo vos (lista en REFERENCE § Archivos locales).

*Criterio:* `git -C <path> status -sb` muestra la rama esperada, limpia, con upstream si la rama existe en remoto.

## 2. Diagnosticar

Por cada worktree de `git worktree list --porcelain`:

| Señal | Cómo se ve | Qué significa |
|---|---|---|
| Huérfano | `prunable` en `list -v`, o el path no existe | Se borró el directorio a mano; falta `git worktree prune` |
| Mergeado | `git branch --merged <base>` lo incluye, o el MR está merged y la rama remota ya no existe | Candidato a limpieza (paso 5) |
| Sucio | `git -C <path> status --porcelain` no vacío | Hay trabajo sin commitear: nunca se borra sin preguntar |
| Detached | `detached` en porcelain | Nadie "tiene" ese checkout; en el main es un bloqueo para `qa-task` e `init-task` |
| Locked | `locked` en porcelain | Protegido (Claude Code lo bloquea mientras un agente corre; o lock manual). Se respeta |
| Sin upstream | `git -C <path> rev-parse --abbrev-ref @{u}` falla | Nunca se pusheó: todo lo commiteado vive sólo acá |

Mostrá el resultado como tabla y una recomendación por fila. Los de `.sandcastle/worktrees/` se reportan como "del worker".

*Criterio:* cada worktree tiene exactamente una recomendación: mantener, limpiar, pedir decisión.

## 3. Levantar o bajar su stack

El stack dockerizado de un repo suele estar pensado para el main checkout: puertos fijos y `container_name` fijos chocan si se levanta dos veces. Un stack por worktree exige dos cosas del repo: nombre de proyecto propio y puertos parametrizados. Verificá si ya las tiene (`task-workflow.md` § Environment, o `rg -n 'container_name|ports:' docker-compose.yml`):

- **Las tiene**: `COMPOSE_PROJECT_NAME=<slug> PORT_OFFSET=<n> make up` (o el comando que diga el repo). El project name aísla contenedores, red y volúmenes: cada worktree tiene su DB vacía; migrá y seedeá antes de probar.
- **No las tiene**: no levantes nada. Proponé el override de REFERENCE § Stack por worktree como cambio al repo (tarea normal), y mientras tanto usá el main checkout para probar, como hoy.

Bajar: `docker compose -p <slug> down` (con `-v` sólo si el worktree se va a borrar). `docker compose ls --format json` lista los proyectos vivos y es la fuente de la columna "stack" de cualquier tablero.

*Criterio:* `docker compose ls` muestra el proyecto `<slug>` running y la app responde en su puerto; o un plan concreto de cambio al repo si no se puede.

## 4. Entrar o lanzarle un agente

Tres formas, elegí por contexto:

- **Vos en Claude Code**: `claude -w <nombre>` desde el main checkout abre (o crea) `.claude/worktrees/<nombre>`; con una MR: `claude -w 'https://gitlab.com/.../merge_requests/123'`. Dentro de una sesión: `EnterWorktree` con `path` apunta a uno existente. Salir con `ExitWorktree` `keep`, nunca `remove` con trabajo.
- **Agente en Herdr** (`HERDR_ENV=1`): `herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd <path> --label <texto> --no-focus` abre un tab con cwd ahí en el workspace actual (`herdr worktree open` abriría otro workspace); después `herdr agent start` en su pane (sintaxis en la skill `herdr`).
- **Subagente aislado**: `isolation: "worktree"` del Agent tool crea uno temporal bajo `.claude/worktrees/` desde la rama base, salvo `worktree.baseRef: "head"`.

*Criterio:* `pwd`/`cwd` del agente es el path del worktree y `git branch --show-current` da la rama esperada.

## 5. Limpiar

Orden fijo, un worktree por vez, y **nunca con cambios sin commitear ni commits sin pushear** sin confirmación explícita del usuario:

1. `git -C <path> status --porcelain` vacío y `git log @{u}..` vacío (o rama mergeada en la base).
2. Stack abajo: `docker compose -p <slug> down -v` si lo tenía.
3. `git worktree remove <path>` (`--force` sólo para untracked que el usuario descartó; locked: `git worktree unlock` primero).
4. `git branch -d <rama>` si está mergeada (`-d`, no `-D`; si `-d` se niega, parar y decir por qué).
5. `git worktree prune` al final, siempre: barre entradas huérfanas.

*Criterio:* la rama no aparece en `git worktree list` ni en `git branch`, y `docker compose ls -a` no lista su proyecto.

## 6. Migrar un repo desordenado a la convención

Sólo como **plan**, no se ejecuta en el mismo turno: lista de movimientos (`git worktree move <viejo> <nuevo>` conserva todo; para los que tienen stack levantado, bajar antes), qué queda en su lugar (sandcastle), qué se limpia (paso 5) y qué decisión falta (main checkout detached → `git checkout <base>` cuando esté limpio). Presentalo como tabla path actual → acción → path nuevo, y pedí el OK. Herdr y Claude Code encuentran el worktree por `git worktree list`, así que mover no rompe sesiones cerradas; una sesión abierta en el path viejo sí se queda sin cwd válido: cerrala primero.

*Criterio:* tabla completa con una fila por worktree del repo y ninguna acción ejecutada.
