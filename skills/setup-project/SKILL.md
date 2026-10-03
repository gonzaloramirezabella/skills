---
name: setup-project
description: "Setup inicial de un proyecto — Docker + Makefile con análisis estático, CI que corre el gate, Docker Sandbox (sbx), AGENTS.md/CLAUDE.md con symlinks, skills (mattpocock, playwright-cli), layout de docs/ y handbook. Idempotente — en un proyecto en marcha no re-elige el stack: audita y completa lo que falte."
disable-model-invocation: true
---

# Setup inicial de un proyecto

Deja un repo nuevo con el andamiaje estándar. Ejecutá los pasos en orden — cada uno termina cuando se cumple su **criterio**. Antes de crear algo, mirá si ya existe (re-run parcial es válido: salteá lo que ya cumple su criterio).

## Modo: proyecto nuevo o en marcha

- **Nuevo** (sin `Makefile` ni compose): todos los pasos, con la entrevista del paso 1 completa.
- **En marcha** (ya hay stack): **no se vuelve a elegir el stack** ni se reescribe la infra. Evaluá la criterio de cada paso, imprimí un tablero `✅/⚠️` (análisis estático en el Makefile, CI, hook, symlinks, `docs/`, skills instaladas, `task-workflow.md`, `CODING_STANDARDS.md`, handbook) y ejecutá sólo los ⚠️, confirmando cada uno. En este modo el paso 1 se reduce a su pata de análisis estático y el 1b a verificar o crear el guardrail; el paso 5 termina en `/setup-skills`, que trae su propio tablero.

> **Opcional, por máquina (no por repo):** [`rtk`](https://github.com/rtk-ai/rtk) (`brew install rtk` + `rtk init -g`) instala un hook que reescribe los comandos Bash del agente (`git status` → `rtk git status`) y compacta su salida —fallos en vez de la suite entera, logs deduplicados—: menos tokens de contexto por comando. No toca Read/Grep/Glob ni lo que corre dentro del sandbox. No se instala en el repo ni lo exige ninguna skill.

## 1. Docker + Makefile

Antes de escribir infra, definí el stack entrevistando al usuario con la skill `grilling` de mattpocock (si aún no está instalada, adelantá su instalación del paso 5). La entrevista cubre, como mínimo:

- Lenguaje y framework — sin default: se eligen por proyecto, en su última versión estable.
- Base de datos — ¿MySQL sí o no? Si no, ¿cuál? (una embebida, tipo SQLite, no suma servicio al compose).
- Sentry: ¿sí o no?
- Mailpit: ¿sí o no?
- Cómo se sirve la app — dev server del framework (un solo servicio) o web server + fpm — y si hay build de assets (Vite/Node y dónde corre).
- Dónde vive la app: en la raíz o bajo `src/` — obligado `src/` si el repo tiene otra identidad además de la app (docs, skills, etc.).
- **Análisis estático** — la herramienta del stack (PHP: larastan/phpstan con nivel acordado; TS: `tsc --noEmit`; Python: mypy/pyright; Go: `go vet` + staticcheck). No es opcional: es la pata del gate que no confía en los tests, y `setup-skills` rechaza un gate sin ella. En un proyecto en marcha, si falta, se instala acá y se agrega el target.

Las versiones se deciden contra el registro real (imagen oficial de Docker, registro del package manager del stack) — buscá las últimas estables y presentalas como opciones. Lo instalado en la máquina del usuario no pinta nada: el stack corre en Docker.

Cada respuesta se traduce en un servicio (o su ausencia) en el compose — nada entra al stack sin haber salido de la entrevista. Los puertos del host van parametrizados con default (`"${APP_PORT:-8080}:8000"`) para convivir con otros stacks del usuario.

Toda la infra vive en `docker/` con `docker-compose.yml` en la raíz, y el `Makefile` raíz es el **único punto de entrada** de comandos de dev: `up`, `down`, `shell`, `logs`, `test`, `help` como mínimo; los args pasan directo (`make test ARGS="--filter=X"`). Nada de comandos docker sueltos en docs ni skills — siempre vía make.

Los targets de calidad son tres y el gate los nombra: `test`, `analyse` (análisis estático) y `lint` (formato en modo check; `ARGS=--fix` o equivalente para aplicar). Si el repo ya mezcla formato y análisis en un solo target, no lo partas: anotá qué cubre.

**Criterio:** cada decisión de la entrevista tiene su reflejo en el compose (todo servicio confirmado presente, todo descartado ausente), `make up` levanta el stack, `make help` lista todos los targets y existe un target de análisis estático que sale en 0 sobre el código actual (baseline aceptada si hace falta).

## 1b. Guardrail: el gate sin nadie en el loop

El gate del paso 1 lo corren el orquestador de `work-task` y el worker, pero ambos son agentes. El freno determinista es que **también corra solo**, en CI, sobre cada MR a la rama base: el MR que llega con el gate rojo no se revisa. Es obligatorio; el hook es opcional.

- **CI** — detectá el host con `git remote -v` y escribí el pipeline desde la plantilla de REFERENCE.md (GitLab: `.gitlab-ci.yml`; GitHub: `.github/workflows/gate.yml`). Un solo job `gate` que corre los **mismos comandos** del bloque Host del gate, nativo (sin compose: la imagen del job trae el runtime). Si el runner necesita servicios (DB), declaralos como `services` del job o usá la embebida de tests.
- **Hook (opcional)** — rápido y acotado a lo staged: formato + análisis estático, nunca la suite entera. En repos Node, `setup-pre-commit` (de mattpocock, Husky); en el resto, `.githooks/pre-commit` + `git config core.hooksPath .githooks`, con un target `make hooks` que lo activa (el config no se versiona). Dejalo en `README`.
- Anotá ambos en `## Guardrails` de `docs/agents/task-workflow.md` (lo escribe `setup-skills`, decisión B2; si ya corrió, agregá la sección a mano desde su plantilla).

**Criterio:** el archivo de CI existe, corre el gate Host y está verde en la rama base; si hay hook, `make hooks` lo activa y un commit con formato roto lo rechaza.

## 2. Docker Sandbox (sbx)

Targets de Makefile para correr Claude Code en una microVM aislada y desechable en el **host** (Docker Sandboxes, CLI `sbx`) — no en el contenedor de la app. Cada sandbox se crea con `--clone`: un worktree git propio clonado del repo, así el agente nunca toca el working tree del usuario; al terminar, sus ramas quedan expuestas como remote `sandbox-<NAME>` y se revisan con `git diff` antes de integrar nada.

Agregá al Makefile los tres targets de la plantilla en REFERENCE.md (`sandbox`, `sandbox-auth`, `sandbox-diff`), ajustando:

- El nombre del sandbox es obligatorio y sin default: se pasa con `NAME=x` (con `name=x` como alias) o el target lo pregunta interactivamente. Nunca un default derivado del branch — dos invocaciones paralelas resolverían al mismo sandbox y se pisarían.
- Las variables de color (`$(RED)`, `$(CYAN)`, etc.): si el Makefile no las tiene, definilas como en la plantilla o quitá los echo coloreados.
- El bloque de sincronización de statusline es opcional (depende de `jq` en el host y de `~/.claude/statusline.sh`); si el usuario no usa una statusline custom, borralo entero y dejá sólo el create + run.

La instalación del CLI es por máquina y por usuario, no del repo — indicale al usuario:

```bash
brew install docker/tap/sbx   # instala el CLI `sbx`
make sandbox-auth             # una sola vez; elegir OAuth/suscripción, NO API key
```

**Criterio:** `make help` lista los tres targets `sandbox*`, y `sandbox`/`sandbox-diff` piden el nombre interactivamente cuando no reciben `NAME=x`.

## 3. AGENTS.md + symlinks

- `AGENTS.md` real en la raíz: identidad del proyecto (una línea), layout y entry points, tabla de comandos make, y una tabla "dónde mirar según la intención" que rutea a `docs/`. Si ya existe un `CLAUDE.md` real con contenido, fusionalo dentro de `AGENTS.md` antes de reemplazarlo por el symlink — no se pierde nada.
- `CLAUDE.md` → symlink a `AGENTS.md` (`ln -s AGENTS.md CLAUDE.md`).
- `.agents/skills/` real; `.claude/skills` → symlink a `../.agents/skills`.

**Criterio:** `ls -la` muestra los dos symlinks y `AGENTS.md` es el único archivo real.

## 4. Layout de documentación

Dos audiencias, dos casas:

- `docs/` — técnica, para devs, **en inglés**: `docs/GLOSSARY.md` (glosario del lenguaje ubicuo), `docs/adr/` (decisiones numeradas `NNNN-slug.md`), `docs/agents/` (config de skills), y `docs/README.md` como índice por área. La tabla de ruteo de `AGENTS.md` apunta acá.
- **Handbook** — operación, para admins/operadores, **en español**; su ruta, formato e idioma los define la sección Handbook de `docs/agents/task-workflow.md` (paso 5), no esta skill.

Este paso va antes que las skills a propósito: los setups del paso 5 exploran el repo y proponen lo que encuentran — con `docs/` ya en pie, sus propuestas (docs de dominio, rutas) salen alineadas con este layout en vez de sus defaults.

**Criterio:** la estructura de `docs/` existe y `AGENTS.md` la referencia.

## 5. Skills de mattpocock

```bash
npx skills add mattpocock/skills --skill '*' -y
```

Nunca `--all` (crea directorios basura para todos los agentes); la lista con comas está rota — `'*'` o una por una.

Antes de correr `/setup-skills`, garantizá el acceso al tracker — **`gh` autenticado es obligatorio** (los issues del repo son el tracker y el setup crea los labels). Verificá con `gh auth status` y resolvé lo que falte con la sección Setup de la skill [`github-issues`](../github-issues/SKILL.md) (instalación por máquina; `gh auth login` lo corre el usuario).

Después correr `/setup-skills` (interactiva, con el usuario presente): verifica dependencias, corre `setup-matt-pocock-skills` si falta y genera `docs/agents/task-workflow.md` — incluida la sección **Handbook**, que el paso 7 necesita.

**Criterio:** `gh auth status` sale en 0, `skills-lock.json` registra `mattpocock/skills` y existe `docs/agents/task-workflow.md` con sección Handbook.

## 6. playwright-cli

Diferible: si el repo todavía no tiene un entorno navegable que testear, salteálo y volvé cuando exista.

```bash
npm install -g @playwright/cli@latest
```

Copiar la skill que trae el paquete (la ruta a su `SKILL.md` aparece en la cabecera de `playwright-cli --help`; llevate también su carpeta `references/`) a `.agents/skills/playwright-cli/`.

Configuración de credenciales:

- `.playwright.env` en la raíz — URLs y credenciales reales, **nunca versionado**.
- `.playwright.env.example` versionado con las variables esperadas y valores vacíos, convención `PLAYWRIGHT_{SCOPE}_URL` / `PLAYWRIGHT_{SCOPE}_{ROL}_USER` / `_PASSWORD`.
- `.gitignore`: agregar `.playwright.env` y `.playwright-cli/`.
- Antes de una sesión: `set -a && source .playwright.env && set +a` — nunca hardcodear hosts ni credenciales.

**Criterio:** la skill es visible en `.claude/skills/playwright-cli/`, `.playwright.env.example` está versionado y el gitignore cubre los dos paths.

## 7. Primeras páginas del handbook

El handbook arranca siempre con dos páginas, creadas con `/write-handbook`:

1. **Puesta en marcha** — cómo se levanta el entorno (`make up` y compañía), qué hace cada target del Makefile, y dónde vive cada tipo de documentación.
2. **Stack y decisiones** — página **híbrida**: prosa con las decisiones de la entrevista del paso 1 y su porqué (servicios elegidos y descartados, dónde vive la app, puertos), seguida de un bloque dinámico de versiones del stack: *en uso* (leídas en runtime de los manifests reales — lockfiles, runtime del lenguaje) contra *última* (consultada on-demand a los registros — Packagist, npm, endoflife.date o equivalentes), con un estado por tecnología (al día / actualización disponible / sin soporte).

Si el handbook lo sirve la app y todavía no soporta páginas híbridas, implementá el mecanismo —la página declara en su frontmatter una vista que la app renderiza a continuación del cuerpo markdown— y registralo en la sección Handbook de `task-workflow.md`, bloques dinámicos incluidos. Si el handbook son archivos sueltos que ninguna app sirve, la tabla de versiones va estática con la fecha de la última comprobación.

**Criterio:** las dos páginas existen con el frontmatter que exige `task-workflow.md`, y la de stack muestra versiones leídas del sistema, no tipeadas a mano.

## 8. Revisar el AGENTS.md resultante

El setup fue agregando secciones al `AGENTS.md` (pasos 3-5); antes de cerrar, revisalo entero contra las directrices de [Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md):

- Cubre **WHAT** (stack, layout del repo), **WHY** (para qué existe el proyecto y cada pieza) y **HOW** (cómo buildear, testear y verificar).
- Corto: bien por debajo de 300 líneas — sólo instrucciones universales, las que aplican a *cualquier* sesión.
- Progressive disclosure: lo específico de una tarea (convenciones, schemas, workflows) vive en archivos propios referenciados desde acá, no incrustado.
- Punteros a ubicaciones del código, nunca snippets copiados.
- Cero guías de estilo de código — lo mecánico es trabajo del linter del gate y lo de juicio va a `CODING_STANDARDS.md` (lo escribe `setup-skills`, decisión F), que lee el revisor y no el implementador. En `AGENTS.md` queda un puntero de una línea.

Podá o mové a `docs/` lo que no pase el filtro, confirmando los cambios con el usuario.

**Criterio:** cada línea del `AGENTS.md` final es una instrucción universal o un puntero, y el archivo baja de 300 líneas.
