---
name: setup-project
description: Setup inicial de un proyecto nuevo — Docker + Makefile, AGENTS.md/CLAUDE.md con symlinks, skills (mattpocock, gon, playwright-cli), layout de docs/ y handbook, y primera página del handbook. Correr una vez, al arrancar el repo.
disable-model-invocation: true
---

# Setup inicial de un proyecto

Deja un repo nuevo con el andamiaje estándar. Ejecutá los pasos en orden — cada uno termina cuando se cumple su **criterio**. Antes de crear algo, mirá si ya existe (re-run parcial es válido: salteá lo que ya cumple su criterio).

## 1. Docker + Makefile

Toda la infra vive en `docker/` con `docker-compose.yml` en la raíz, y el `Makefile` raíz es el **único punto de entrada** de comandos de dev: `up`, `down`, `shell`, `logs`, `test`, `help` como mínimo; los args pasan directo (`make test ARGS="--filter=X"`). Nada de comandos docker sueltos en docs ni skills — siempre vía make.

**Criterio:** `make up` levanta el stack y `make help` lista todos los targets.

## 2. AGENTS.md + symlinks

- `AGENTS.md` real en la raíz: identidad del proyecto (una línea), layout y entry points, tabla de comandos make, y una tabla "dónde mirar según la intención" que rutea a `docs/`.
- `CLAUDE.md` → symlink a `AGENTS.md` (`ln -s AGENTS.md CLAUDE.md`).
- `.agents/skills/` real; `.claude/skills` → symlink a `../.agents/skills`.

**Criterio:** `ls -la` muestra los dos symlinks y `AGENTS.md` es el único archivo real.

## 3. Skills de mattpocock y de Gon

```bash
npx skills add mattpocock/skills --skill '*' -y
npx skills add gonzaloramirezabella/skills --skill '*' -y
```

Nunca `--all` (crea directorios basura para todos los agentes); la lista con comas está rota — `'*'` o una por una. Después correr `/setup-gon-skills` (interactiva, con el usuario presente): verifica dependencias, corre `setup-matt-pocock-skills` si falta y genera `docs/agents/task-workflow.md` — incluida la sección **Handbook**, que el paso 6 necesita.

**Criterio:** `skills-lock.json` registra ambas fuentes y existe `docs/agents/task-workflow.md` con sección Handbook.

## 4. playwright-cli

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

## 5. Layout de documentación

Dos audiencias, dos casas:

- `docs/` — técnica, para devs, **en inglés**: `docs/CONTEXT.md` (glosario del lenguaje ubicuo), `docs/adr/` (decisiones numeradas `NNNN-slug.md`), `docs/agents/` (config de skills), y `docs/README.md` como índice por área. La tabla de ruteo de `AGENTS.md` apunta acá.
- **Handbook** — operación, para admins/operadores, **en español**; su ruta, formato e idioma los define la sección Handbook de `docs/agents/task-workflow.md` (paso 3), no esta skill.

**Criterio:** la estructura de `docs/` existe y `AGENTS.md` la referencia.

## 6. Primera página del handbook

Con `/write-handbook`, crear la primera página del handbook documentando lo definido en este setup: cómo se levanta el entorno (`make up` y compañía), qué hace cada target del Makefile, y dónde vive cada tipo de documentación.

**Criterio:** la página existe en la ruta del handbook con el frontmatter que exige `task-workflow.md`.
