# REFERENCE — setup-sandcastle

Plantillas de los archivos que **sí** se adaptan a cada repo. Los scripts (`lib.ts`, `worker.ts`, `tasks.ts`, `runner.ts`, `clickup.ts`, `smoke.ts`, `main.ts`, `lib.test.ts`) no están acá: se copian tal cual desde [`files/`](files/). Los `{placeholders}` se rellenan con lo relevado en el paso 2; las líneas marcadas `# adapt` son las que cambian según el proyecto.

## Dockerfile — stack PHP (Laravel)

```dockerfile
FROM dunglas/frankenphp:1-php8.4                       # adapt: version to match the app

RUN install-php-extensions \
    pdo_mysql gd zip bcmath intl opcache pcntl sockets pcov   # adapt: whatever the gate loads

RUN apt-get update && apt-get install -y \
    git curl jq unzip default-mysql-client \
    && rm -rf /var/lib/apt/lists/*

RUN echo "memory_limit=512M" > /usr/local/etc/php/conf.d/99-sandcastle.ini

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# UID/GID build-args so image-built files and the bind-mounted worktree
# share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000
RUN groupadd -o -g $AGENT_GID agent \
    && useradd -o -m -u $AGENT_UID -g $AGENT_GID -s /bin/bash agent
USER ${AGENT_UID}:${AGENT_GID}

# FrankenPHP points HOME/XDG dirs at /data and /config (for Caddy);
# reset them or the Claude installer fails.
ENV HOME=/home/agent
ENV XDG_DATA_HOME=/home/agent/.local/share
ENV XDG_CONFIG_HOME=/home/agent/.config

RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/agent/.local/bin:$PATH"

# Unattended agents need two things pre-arranged, both stack-agnostic:
#  - the workspace pre-trusted, or the CLI ignores the repo's .claude/settings.json
#    allowlist and exits non-zero;
#  - git hooks neutralised, since repo hooks routinely shell out to host tooling
#    (make, Docker) that is absent here, so any plain `git commit` would fail.
# hooksPath is injected through the environment on purpose: `git config` from a
# worktree writes to the .git/config it shares with the host.
RUN printf '{"projects":{"/home/agent/workspace":{"hasTrustDialogAccepted":true}}}\n' \
      > /home/agent/.claude.json \
    && mkdir -p /home/agent/.no-hooks
ENV GIT_CONFIG_COUNT=1
ENV GIT_CONFIG_KEY_0=core.hooksPath
ENV GIT_CONFIG_VALUE_0=/home/agent/.no-hooks

# 1h prompt-cache TTL: a drain's gate + tracker round-trips between agent
# invocations routinely exceed the default 5m TTL. Writes bill at 2x base
# (vs 1.25x), a net win for multi-slice drains.
ENV ENABLE_PROMPT_CACHING_1H=1

ENV COMPOSER_CACHE_DIR=/home/agent/.composer-cache
RUN mkdir -p /home/agent/.composer-cache

WORKDIR /home/agent
# Sandcastle bind-mounts the git worktree at /home/agent/workspace and
# overrides the working directory at container start.
ENTRYPOINT ["sleep", "infinity"]
```

## Dockerfile — Chromium + playwright-cli (carril de navegador de la fase de QA)

Sólo si `task-workflow.md` § *QA* dice `Browser lane: yes`. Va **antes** del `USER ${AGENT_UID}` de cualquiera de las dos plantillas: el navegador se instala como root en una ruta global (`PLAYWRIGHT_BROWSERS_PATH`) y así el usuario `agent` lo encuentra; la versión del navegador la fija el propio `playwright` que trae `@playwright/cli`, por eso se instala desde ahí y no con un pin aparte. Node tiene que estar ya en la imagen.

```dockerfile
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN npm install -g @playwright/cli@latest \
    && npx --prefix "$(npm root -g)/@playwright/cli" playwright install --with-deps chromium \
    && chmod -R a+rX /opt/pw-browsers
```

`playwright-cli` corre headless por defecto (el mandato de QA lo exige); `--with-deps` trae las librerías del sistema que Chromium necesita en Debian. El agente levanta la app con el bloque `### Sandbox` de la sección *QA* y navega contra `127.0.0.1` dentro del contenedor — no hace falta red extra.

## Dockerfile — stack Node (React Native u otros)

```dockerfile
FROM node:22-bookworm                                  # adapt: version to match the app

RUN apt-get update && apt-get install -y \
    git curl jq \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable                                    # adapt: drop if the project uses plain npm

ARG AGENT_UID=1000
ARG AGENT_GID=1000
# node:* images ship a 'node' user at UID 1000; reuse it when the IDs match.
RUN (getent group $AGENT_GID || groupadd -o -g $AGENT_GID agent) \
    && (getent passwd $AGENT_UID || useradd -o -m -u $AGENT_UID -g $AGENT_GID -s /bin/bash agent)
USER ${AGENT_UID}:${AGENT_GID}
ENV HOME=/home/agent

RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/agent/.local/bin:$PATH"

# Unattended agents need two things pre-arranged, both stack-agnostic:
#  - the workspace pre-trusted, or the CLI ignores the repo's .claude/settings.json
#    allowlist and exits non-zero;
#  - git hooks neutralised, since repo hooks routinely shell out to host tooling
#    (make, Docker) that is absent here, so any plain `git commit` would fail.
# hooksPath is injected through the environment on purpose: `git config` from a
# worktree writes to the .git/config it shares with the host.
RUN printf '{"projects":{"/home/agent/workspace":{"hasTrustDialogAccepted":true}}}\n' \
      > /home/agent/.claude.json \
    && mkdir -p /home/agent/.no-hooks
ENV GIT_CONFIG_COUNT=1
ENV GIT_CONFIG_KEY_0=core.hooksPath
ENV GIT_CONFIG_VALUE_0=/home/agent/.no-hooks

# 1h prompt-cache TTL: a drain's gate + tracker round-trips between agent
# invocations routinely exceed the default 5m TTL. Writes bill at 2x base
# (vs 1.25x), a net win for multi-slice drains.
ENV ENABLE_PROMPT_CACHING_1H=1

ENV npm_config_cache=/home/agent/.npm-cache            # adapt: YARN_CACHE_FOLDER / PNPM store
RUN mkdir -p /home/agent/.npm-cache

WORKDIR /home/agent
ENTRYPOINT ["sleep", "infinity"]
```

El gate de un proyecto React Native dentro del sandbox es el lado JS — `npm test`, `npx eslint .`, `npx tsc --noEmit`. Builds nativos, emuladores y E2E quedan en el host.

## `.sandcastle/.gitignore`

```gitignore
.env
logs/
worktrees/
composer-cache/        # adapt: npm-cache/ etc.
```

## `.sandcastle/.env.example`

```dotenv
# Claude Code OAuth token — get one by running `claude setup-token` on your host.
# Lets the agent use your Claude subscription instead of an API key.
CLAUDE_CODE_OAUTH_TOKEN=
# Or use an Anthropic API key instead — uncomment and fill in:
# ANTHROPIC_API_KEY=
# Tracker API token, used by the worker for the parent's status and comments.
# ClickUp: a personal token (pk_...) from Settings > Apps.
CLICKUP_API_TOKEN=
# Optional: per-role models (routing documented in task-workflow.md's Model routing).
# SANDCASTLE_MODEL: default for slices and the close (claude-fable-5-1).
# SANDCASTLE_LIGHT_MODEL: slices tagged `sonnet` (default claude-sonnet-5).
# SANDCASTLE_EFFORT: reasoning effort for every run — low, medium, high, xhigh, max. Unset: low on Fable, high otherwise.
# SANDCASTLE_MODEL=claude-fable-5-1
# SANDCASTLE_LIGHT_MODEL=claude-sonnet-5
# SANDCASTLE_EFFORT=low
```

## `project.json`

Todo lo que es de **este** proyecto vive acá; los scripts lo leen y no repiten un solo valor. Un repo nuevo cambia este archivo, no el código. Lo que es del *workflow* (statuses, rama base, gate, rutas de bitácora y mandatos) no va acá: sale de `docs/agents/task-workflow.md`.

```json
{
  "image": "{project}-sandcastle:local",
  "network": "{compose-network}",
  "mounts": [
    { "hostPath": ".sandcastle/{dep-cache}", "sandboxPath": "/home/agent/{dep-cache}" }
  ],
  "setup": [
    "// adapt: el setup del worktree del paso 2, un comando por elemento (se &&-encadenan)"
  ],
  "setupTimeoutMs": 900000,
  "serviceChecks": [
    "// adapt: comandos que prueban imagen y servicios — sólo los usa el smoke"
  ],
  "environment": "descripción del entorno para el agente: servicios y credenciales dev, qué ya está instalado, cómo commitear"
}
```

`environment` es prosa que va al prompt del agente (placeholder `{{ENVIRONMENT}}` de los mandatos): es el **único** lugar donde se le cuenta cómo es este proyecto. Un test de contrato falla si un mandato la duplica en vez de usar el placeholder. Referencia de lo que tiene que decir: servicios alcanzables y sus credenciales dev, que las dependencias ya están instaladas y no hay que reinstalarlas, y que puede commitear normal porque los hooks del repo están desactivados en el sandbox.

## Targets de Makefile

`NODE_HOST` resuelve el node real cuando el del PATH es un wrapper de Docker; si `command -v node` apunta a un binario real, usá `node` directo y quitá la guarda. El nombre de la imagen sale de `project.json`, no se repite acá, y las etiquetas de los menús salen de `task-workflow.md` — ninguna rama se escribe a mano en el Makefile.

```make
NODE_HOST := $(shell ls -d $(HOME)/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
SANDCASTLE_IMAGE := $(shell jq -r .image .sandcastle/project.json 2>/dev/null)
WORKFLOW_DOC := docs/agents/task-workflow.md
# Menu labels come from the same lines the worker parses, so a branch name lives
# in one place only. Empty extraction degrades to a generic label and, either way,
# option 1 passes no flag: the worker resolves the base as it always did.
BASE_DECLARED := $(shell sed -n 's/^- Base\/integration branch: `\([^`]*\)`.*/\1/p' $(WORKFLOW_DOC) 2>/dev/null | head -1)
BASE_ALT := $(shell sed -n 's/^- .*target `\([^`]*\)` instead.*/\1/p' $(WORKFLOW_DOC) 2>/dev/null | head -1)
AWAKE ?= 1

.PHONY: sandcastle sandcastle-build sandcastle-smoke sandcastle-work sandcastle-tasks sandcastle-tests sandcastle-update sandcastle-retro

# A drain runs for hours: the machine stays awake by default (AWAKE=0 disables it).
# No prompt, because the case that needs it most is the unattended one — nohup,
# script, agent — which is exactly where nobody is around to answer it. `-m` covers
# disk sleep: the worker writes to the worktree and the caches the whole time.
# `exec` leaves node as the recipe's process, with no intermediate shell swallowing
# signals or the exit status. Without caffeinate (Linux/CI) the runner stays empty.
define sandcastle-run
	@runner=""; \
	if [ "$(AWAKE)" != "0" ] && command -v caffeinate >/dev/null 2>&1; then \
		runner="caffeinate -ims"; \
	fi; \
	extra=""; \
	$($(2)) \
	mkdir -p .sandcastle/logs; log=.sandcastle/logs/run-$$(date +%Y%m%d-%H%M%S).log; \
	echo "$$runner $(NODE_HOST) $(1)$$extra  → $$log"; \
	( $$runner $(NODE_HOST) $(1)$$extra 2>&1; echo $$? > "$$log.rc" ) | tee "$$log"; \
	rc=$$(cat "$$log.rc"); rm -f "$$log.rc"; exit $$rc
endef

# Interactive picks, and the reason they are safe: a menu is shown only when a
# human is there to answer it ([ -t 0 ]) and the variable did not come in on the
# command line, so an unattended drain — nohup, script, another agent — never
# waits on stdin. Enter takes the default, which passes *no* flag: the worker then
# resolves the base from the doc, hotfix routing included, and the model from its
# own default. Only options 2 and 3 emit a flag. A custom branch is validated by
# the worker against origin, not here. These are `=` variables, not defines: their
# value has to stay a single shell line to be spliced into the recipe above.
sandcastle-ask-model = \
	if [ -t 0 ] && [ -z "$$model" ]; then \
		printf "Model:        1) opus (claude-opus-5-5)  2) fable  [1] "; \
		read -r pick || pick=""; \
		case "$$pick" in 2) model="fable";; esac; \
	fi;

sandcastle-ask = base="$(BASE)"; model="$(MODEL)"; \
	if [ -t 0 ] && [ -z "$$base" ]; then \
		printf "Base branch:  1) %s (declared)  2) %s  3) custom  [1] " \
			"$(or $(BASE_DECLARED),declared in $(WORKFLOW_DOC))" "$(or $(BASE_ALT),custom)"; \
		read -r pick || pick=""; \
		case "$$pick" in \
			2) base="$(BASE_ALT)";; \
			3) printf "Branch: "; read -r base || base="";; \
		esac; \
	fi; \
	$(sandcastle-ask-model) \
	[ -n "$$base" ] && extra="$$extra --base $$base"; \
	[ -n "$$model" ] && extra="$$extra --model $$model"; \
	[ -n "$(LIGHT_MODEL)" ] && extra="$$extra --light-model $(LIGHT_MODEL)"; \
	[ -n "$(EFFORT)" ] && extra="$$extra --effort $(EFFORT)"; \
	true;

# Free-form runs pick a model and nothing else: there is no base branch to resolve.
sandcastle-ask-free = model="$(MODEL)"; \
	$(sandcastle-ask-model) \
	[ -n "$$model" ] && extra="$$extra --model $$model"; \
	[ -n "$(EFFORT)" ] && extra="$$extra --effort $(EFFORT)"; \
	true;

# A dry run launches no sandbox and writes nothing, so it has no business
# touching the machine's power state.
ifneq ($(DRY_RUN),)
sandcastle-work sandcastle-tasks: AWAKE = 0
endif

sandcastle-work: ## Drain one or more parents' slices, one at a time (gate verified, MR + roll-up at the end) (PARENT=x[,y] [BASE=branch] [MODEL=opus|fable|sonnet] [DRY_RUN=1] [AWAKE=0]; asks for base and model when run from a terminal)
	@[ -n "$(PARENT)" ] || { echo "PARENT task id required: make sandcastle-work PARENT=86xxxxxxx[,86yyyyyyy]"; exit 1; }
	@[ -n "$(NODE_HOST)" ] || { echo "No real node found; PATH node is a Docker wrapper"; exit 1; }
	@[ -d node_modules/@ai-hero/sandcastle ] || $(dir $(NODE_HOST))npm install
	@# Even a dry run reads the tracker, so the env file is required in both modes;
	@# only the agent credential and the image are exclusive to a real drain.
	@[ -f .sandcastle/.env ] || { echo "No .sandcastle/.env — copy .sandcastle/.env.example and fill in the tracker token"; exit 1; }
	@if [ -z "$(DRY_RUN)" ]; then \
		grep -qE '^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=..' .sandcastle/.env 2>/dev/null || \
			{ echo "No credential in .sandcastle/.env — run 'claude setup-token'"; exit 1; }; \
		docker image inspect $(SANDCASTLE_IMAGE) >/dev/null 2>&1 || $(MAKE) sandcastle-build; \
	fi
	$(call sandcastle-run,.sandcastle/worker.ts $(PARENT) $(if $(DRY_RUN),--dry-run),sandcastle-ask)

# Loose tasks: tracker tasks outside any plan that an agent can finish alone.
# Without BRANCH each task gets its own branch (prefix from the type the agent
# declares) and MR; with BRANCH every task is one commit on it and one MR.
sandcastle-tasks: ## Drain loose tasks outside any plan: one branch + MR each, or all on BRANCH with one MR (TASKS=x[,y] [BRANCH=name] [BASE=branch] [MODEL=opus|fable|sonnet] [DRY_RUN=1] [AWAKE=0]; asks for base and model when run from a terminal)
	@[ -n "$(TASKS)" ] || { echo "TASKS task ids required: make sandcastle-tasks TASKS=86xxxxxxx[,86yyyyyyy] [BRANCH=fix/varios]"; exit 1; }
	@[ -n "$(NODE_HOST)" ] || { echo "No real node found; PATH node is a Docker wrapper"; exit 1; }
	@[ -d node_modules/@ai-hero/sandcastle ] || $(dir $(NODE_HOST))npm install
	@[ -f .sandcastle/.env ] || { echo "No .sandcastle/.env — copy .sandcastle/.env.example and fill in the tracker token"; exit 1; }
	@if [ -z "$(DRY_RUN)" ]; then \
		grep -qE '^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=..' .sandcastle/.env 2>/dev/null || \
			{ echo "No credential in .sandcastle/.env — run 'claude setup-token'"; exit 1; }; \
		docker image inspect $(SANDCASTLE_IMAGE) >/dev/null 2>&1 || $(MAKE) sandcastle-build; \
	fi
	$(call sandcastle-run,.sandcastle/tasks.ts $(TASKS) $(if $(BRANCH),--branch $(BRANCH)) $(if $(DRY_RUN),--dry-run),sandcastle-ask)

# Retro: the human-review brake. Reads the drain log (and the MR discussion when
# MR= is given) with the upstream `retro` skill and proposes changes to the
# agent's environment — checks, CODING_STANDARDS.md rules, AGENTS.md pointers —
# never to the code. Interactive: you approve what gets applied.
sandcastle-retro: ## Retro over the last drain log (or LOG=path) and optionally an MR's review comments (MR=iid); proposes environment changes, applies nothing on its own
	@command -v claude >/dev/null 2>&1 || { echo "claude CLI not found on the host"; exit 1; }
	@[ -f .agents/skills/retro/SKILL.md ] || { echo "retro skill not installed — run: npx skills add mattpocock/skills --skill '*' -y"; exit 1; }
	@log="$(LOG)"; [ -n "$$log" ] || log=$$(ls -t .sandcastle/logs/run-*.log 2>/dev/null | head -1); \
	[ -n "$$log" ] || { echo "No drain log in .sandcastle/logs/ — pass LOG=path"; exit 1; }; \
	[ -f "$$log" ] || { echo "Log not found: $$log"; exit 1; }; \
	mr=""; [ -z "$(MR)" ] || mr=" Además, traé los comentarios humanos del MR !$(MR) con el MR CLI de docs/agents/task-workflow.md y tratalos como entrada principal: cada comentario es algo que un revisor no quiere volver a escribir."; \
	prompt="Leé .agents/skills/retro/SKILL.md y seguilo (es user-invoked: no está en la Skill tool). Sesión a revisar: el log del drenaje $$log, más la bitácora y los commits de la rama que nombra.$$mr Propuestas sólo al entorno del agente: lo mecánico como check del gate o de CI (docs/agents/task-workflow.md), lo de juicio como regla en CODING_STANDARDS.md, lo de navegación como puntero en AGENTS.md, lo de mandato en docs/agents/prompts/. No toques código de la app y no apliques nada sin mi OK explícito."; \
	echo "retro ← $$log$(if $(MR), + MR !$(MR))"; \
	exec claude "$$prompt"

sandcastle-tests: ## Run the sandcastle worker unit tests (includes the task-workflow.md contract)
	@[ -n "$(NODE_HOST)" ] || { echo "No real node found; PATH node is a Docker wrapper"; exit 1; }
	$(NODE_HOST) --test .sandcastle/lib.test.ts

sandcastle-build: ## Build the sandcastle sandbox image (name from .sandcastle/project.json)
	@[ -n "$(SANDCASTLE_IMAGE)" ] || { echo "No image name in .sandcastle/project.json (is jq installed?)"; exit 1; }
	docker build -f .sandcastle/Dockerfile \
		--build-arg AGENT_UID=$$(id -u) --build-arg AGENT_GID=$$(id -g) \
		-t $(SANDCASTLE_IMAGE) .sandcastle/

sandcastle-smoke: ## Verify the sandbox toolchain end to end (no agent, no tokens)
	@[ -n "$(NODE_HOST)" ] || { echo "No real node found; PATH node is a Docker wrapper"; exit 1; }
	@[ -d node_modules/@ai-hero/sandcastle ] || $(dir $(NODE_HOST))npm install
	@docker image inspect $(SANDCASTLE_IMAGE) >/dev/null 2>&1 || $(MAKE) sandcastle-build
	$(NODE_HOST) .sandcastle/smoke.ts

sandcastle: ## Run a free-form agent task in the sandbox (task: .sandcastle/prompt.md) ([MODEL=opus|fable|sonnet])
	@[ -n "$(NODE_HOST)" ] || { echo "No real node found; PATH node is a Docker wrapper"; exit 1; }
	@grep -qE '^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=..' .sandcastle/.env 2>/dev/null || \
		{ echo "No credential in .sandcastle/.env — run 'claude setup-token'"; exit 1; }
	@[ -d node_modules/@ai-hero/sandcastle ] || $(dir $(NODE_HOST))npm install
	@docker image inspect $(SANDCASTLE_IMAGE) >/dev/null 2>&1 || $(MAKE) sandcastle-build
	$(call sandcastle-run,.sandcastle/main.ts,sandcastle-ask-free)

# The eight portable files are copied, never edited in place: everything this repo
# owns (project.json, Dockerfile, .env*) is left alone. The tests run right after
# because they re-check this repo's task-workflow.md against the new parser.
sandcastle-update: ## Sync the worker from the installed skill and re-run its tests
	@[ -d .agents/skills/setup-sandcastle/files ] || \
		{ echo "setup-sandcastle not installed — run: npx skills add gonzaloramirezabella/skills --skill '*' -y"; exit 1; }
	@cp .agents/skills/setup-sandcastle/files/lib.ts \
		.agents/skills/setup-sandcastle/files/worker.ts \
		.agents/skills/setup-sandcastle/files/tasks.ts \
		.agents/skills/setup-sandcastle/files/runner.ts \
		.agents/skills/setup-sandcastle/files/clickup.ts \
		.agents/skills/setup-sandcastle/files/main.ts \
		.agents/skills/setup-sandcastle/files/smoke.ts \
		.agents/skills/setup-sandcastle/files/lib.test.ts \
		.sandcastle/
	@git status --short .sandcastle/ || true
	@$(MAKE) sandcastle-tests
```

Si el gate usa servicios del compose, agregá a `sandcastle-work`, `sandcastle-tasks`, `sandcastle-smoke` y `sandcastle` la guarda de servicios arriba (p. ej. `docker compose ps | grep -q "{db-service}.*Up"`); en `sandcastle-work` y `sandcastle-tasks` va dentro del `if [ -z "$(DRY_RUN)" ]`. Equivalentes npm si el repo no usa Makefile: `"sandcastle:work": "node .sandcastle/worker.ts"`, `"sandcastle:tasks": "node .sandcastle/tasks.ts"`, `"sandcastle:tests": "node --test .sandcastle/lib.test.ts"`, `"sandcastle:smoke"`, `"sandcastle:build"`, `"sandcastle"`.
