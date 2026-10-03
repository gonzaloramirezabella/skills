# REFERENCE — setup-project

Plantillas que `SKILL.md` referencia bajo demanda.

## Plantilla: targets de Docker Sandbox (sbx) para el Makefile

Las variables de color van arriba del Makefile si no existen ya; los targets nuevos se agregan a `.PHONY`. El nombre del sandbox no tiene default: `NAME=x` (o `name=x`) o el target lo pregunta.

```make
SBX    := sbx
PROMPT ?=
NAME   ?= $(name)

RED    := $(shell printf '\033[31m')
GREEN  := $(shell printf '\033[32m')
YELLOW := $(shell printf '\033[33m')
CYAN   := $(shell printf '\033[36m')
NC     := $(shell printf '\033[0m')

.PHONY: sandbox sandbox-auth sandbox-diff

# ─── Sandbox (Docker Sandboxes / sbx) ────────────────────────────────────────
# Runs Claude Code in a disposable, isolated microVM on the HOST (not the app
# container). With --clone each run gets its own Git worktree, so it never touches
# your working tree; review the result with `make sandbox-diff`.
# Setup: brew install docker/tap/sbx  &&  make sandbox-auth

sandbox: ## Run Claude in an isolated sandbox (make sandbox NAME=x [PROMPT="..."])
	@command -v $(SBX) >/dev/null 2>&1 || { echo "$(RED)sbx not found. Install: brew install docker/tap/sbx$(NC)"; exit 1; }
	@name="$(NAME)"; \
	while [ -z "$$name" ]; do \
		printf "$(CYAN)Sandbox name: $(NC)"; \
		read -r name || { echo ""; echo "$(RED)A sandbox name is required.$(NC)"; exit 1; }; \
	done; \
	$(SBX) ls 2>/dev/null | awk 'NR>1 {print $$1}' | grep -qx "$$name" || { \
		echo "$(CYAN)Creating sandbox '$$name' (--clone)...$(NC)"; \
		$(SBX) create --clone claude . --name "$$name"; \
	}; \
	if [ -f "$(HOME)/.claude/statusline.sh" ]; then \
		$(SBX) cp "$(HOME)/.claude/statusline.sh" "$$name:/home/agent/.claude/statusline.sh" && \
		$(SBX) exec "$$name" -- sh -c 'chmod +x ~/.claude/statusline.sh && jq ".statusLine = {\"type\":\"command\",\"command\":\"~/.claude/statusline.sh\",\"padding\":0}" ~/.claude/settings.json > /tmp/settings.json && mv /tmp/settings.json ~/.claude/settings.json' \
		&& echo "$(GREEN)Statusline synced into '$$name'$(NC)" \
		|| echo "$(YELLOW)Statusline sync failed; continuing without it$(NC)"; \
	fi; \
	echo "$(CYAN)Attaching to sandbox '$$name'...$(NC)"; \
	if [ -z "$(PROMPT)" ]; then \
		$(SBX) run --name "$$name"; \
	else \
		$(SBX) run --name "$$name" -- "$(PROMPT)"; \
	fi

sandbox-auth: ## Store the Anthropic credential for sandboxes (choose OAuth/subscription)
	@command -v $(SBX) >/dev/null 2>&1 || { echo "$(RED)sbx not found. Install: brew install docker/tap/sbx$(NC)"; exit 1; }
	@echo "$(YELLOW)Clearing any stored Anthropic credential (OAuth + API key)...$(NC)"
	-$(SBX) secret rm -g anthropic -f
	@echo "$(CYAN)Pick the subscription/OAuth option (not API key) to use your plan.$(NC)"
	$(SBX) secret set -g anthropic
	@$(SBX) secret ls | grep -i anthropic || true

sandbox-diff: ## Review changes a sandbox produced (make sandbox-diff NAME=x)
	@name="$(NAME)"; \
	while [ -z "$$name" ]; do \
		printf "$(CYAN)Sandbox name: $(NC)"; \
		read -r name || { echo ""; echo "$(RED)A sandbox name is required.$(NC)"; exit 1; }; \
	done; \
	git fetch "sandbox-$$name" 2>/dev/null || { echo "$(RED)No remote 'sandbox-$$name'. Run a sandbox first.$(NC)"; exit 1; }; \
	echo "$(CYAN)Branches on sandbox-$$name:$(NC)"; \
	git branch -r --list "sandbox-$$name/*"; \
	echo ""; \
	echo "$(YELLOW)Diff a branch:$(NC) git diff main..sandbox-$$name/<branch>"
```

Notas para adaptar:

- `sandbox-diff` asume que la rama base es `main`; si el repo usa otra (según `docs/agents/task-workflow.md`), ajustar el mensaje final.
- El bloque de statusline requiere `jq` en el host; si falla, sólo emite un warning y el sandbox sigue.
- El nombre es deliberadamente obligatorio y sin default: un default derivado del branch hace que dos invocaciones paralelas resuelvan al mismo sandbox y se pisen.

## Plantilla: pipeline de CI que corre el gate (paso 1b)

Un solo job, los mismos comandos del bloque **Host** del gate de `task-workflow.md`, nativo en la imagen del job. Ajustá imagen, cache y servicios al stack; no agregues pasos que el gate no tenga — si algo vale la pena chequear en CI, vale la pena en el gate, y va a los dos.

### GitLab — `.gitlab-ci.yml`

```yaml
stages: [gate]

gate:
  stage: gate
  image: {imagen del runtime, e.g. php:8.4-cli}
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  cache:
    key: { files: [{lockfile, e.g. src/composer.lock}] }
    paths: [{directorio de deps, e.g. src/vendor/}]
  before_script:
    - {instalar deps, e.g. cd src && composer install --no-interaction --prefer-dist}
    - {preparar entorno de test, e.g. cp .env.example .env && php artisan key:generate}
  script:
    - {test command, full}
    - {static analysis command}
    - {formatting command in check mode}
```

### GitHub — `.github/workflows/gate.yml`

```yaml
name: gate
on:
  pull_request:
  push:
    branches: [{base branch}]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - {setup del runtime, e.g. uses: shivammathur/setup-php@v2 with php-version: "8.4"}
      - run: {instalar deps}
      - run: {test command, full}
      - run: {static analysis command}
      - run: {formatting command in check mode}
```

## Plantilla: hook de pre-commit sin Node (paso 1b, opcional)

`.githooks/pre-commit` versionado; se activa por máquina con `make hooks`.

```bash
#!/usr/bin/env sh
set -e
{formatting command in check mode, sobre los archivos staged si la herramienta lo permite}
{static analysis command}
```

```makefile
hooks: ## Activate the versioned git hooks for this clone
	git config core.hooksPath .githooks
	chmod +x .githooks/*
```
