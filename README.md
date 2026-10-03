# Skills de Gon

Fuente de verdad de mis skills de ciclo de vida de tareas para agentes (Claude Code y compatibles): planificar una tarea del tracker hasta dejarla lista para agentes, ejecutarla de punta a punta hasta el MR, y drenarla sin humano con el worker de sandcastle.

**El plan es un artefacto del tracker, no del repo.** La planificación no committea nada ni crea ramas: publica hijas del padre — `[SPEC]`, un slice por hija (tag de triage + dependencias), `[DOCS]` si el grill decidió docs, y `[QA]` con el checklist en su descripción. En el repo sólo vive la bitácora del trabajo, committeada con cada slice en la rama del padre (que crea `init-task` al empezar a trabajar).

Complementan las [skills de ingeniería de Matt Pocock](https://github.com/mattpocock/skills) (`grilling`, `to-spec`, `to-tickets`, `tdd`, `code-review`, `pr`, `triage`), que son dependencia.

## Inicio rápido

**Qué es.** Un set de skills (prompts) para Claude Code que llevan un issue de GitHub desde la idea hasta el PR: `plan-task` la planifica, `work-task` la ejecuta, `setup-sandcastle` instala un worker que la drena sin humano. Se instalan en cada proyecto consumidor como copia; este repo es la fuente.

**Instalar en un proyecto** (desde su raíz):

```bash
brew install gh && gh auth login   # una vez por máquina
npx skills add gonzaloramirezabella/skills --skill '*' -y
npx skills add mattpocock/skills --skill '*' -y
```

Después, en Claude Code dentro del proyecto: `/setup-project` si el repo es nuevo, `/setup-skills` si ya anda. Opcional: `/setup-sandcastle` para el worker.

**Actualizar cuando hay versión nueva** (acá o en mattpocock): volver a correr los dos `npx skills add` de arriba (**no** `npx skills update`, no trae skills nuevas). Si el repo tiene worker: `make sandcastle-update`. Si cambió lo que escriben los setups: re-correr `/setup-project` y `/setup-skills`, que sólo completan lo que falta. Detalle y prompt listo para pegar en *Actualizar*.

## Skills

| Skill | Qué hace |
|---|---|
| `plan-task` | Planifica una tarea: mapeo del área en subagente → grilling + domain-modeling → hijas `[SPEC]`, slices (tags de triage + dependencias, y tag de modelo liviano en los AFK que califican), `[DOCS]` si hubo docs y `[QA]` en el tracker. No committea nada ni crea ramas. Deja el padre en *planned*. |
| `work-task` | Ejecuta trabajo planificado de forma autónoma: rama vía `init-task`, un subagente por slice (TDD + mandato canónico), gate corrido por el padre —que es quien setea los statuses—, fase de QA antes del cierre (mandato canónico de QA sobre la hija `[QA]`, una hija `[FIX]` por fallo drenada como slice, re-verificación hasta el tope de ciclos del repo), code review del diff, MR con el detalle técnico, informe funcional (`## Resumen`) al principio de la descripción del padre y un único comentario de cierre de un párrafo. Deja todo en *in review*. |
| `init-task` | Setup mecánico no-interactivo: trae la tarea, crea la rama desde la base y pone el status en *in progress*. Lo llama `work-task` al empezar un padre. |
| `qa-task` | La fase de QA lanzada a mano: corre el mandato canónico de QA en local (navegador vía `playwright-cli`, consola o DB), persiste los veredictos en la descripción de la hija `[QA]` y crea una hija `[FIX]` por fallo, lista para `work-task`; lo que requiere ojo humano queda listado con pasos. |
| `task-finish` | Cierra una tarea a mano: commit + push + MR con el CLI del repo + comentario funcional en el tracker. No toca el status. |
| `setup-skills` | Setup por repo, idempotente: genera `docs/agents/task-workflow.md` (statuses, forma de las hijas del plan, gate con análisis estático, guardrails, ramas, entorno, rutas, review policy) y `CODING_STANDARDS.md`, copia los mandatos canónicos (slice, cierre, QA y tarea suelta) y agrega el mapa de comandos a `issue-tracker.md`. Correr una vez por proyecto. |
| `setup-project` | Setup inicial de un repo, idempotente (en marcha no re-elige el stack): Docker + Makefile con análisis estático, CI que corre el gate, targets de Docker Sandbox (`sbx`) para agentes aislados, `AGENTS.md`/`CLAUDE.md` con symlinks, layout de `docs/`, instalación de skills (mattpocock, playwright-cli), las dos páginas iniciales del handbook y revisión final del `AGENTS.md`. Correr una vez, al arrancar el repo. |
| `write-handbook` | Crea o actualiza páginas del Handbook (docs de operación para admins/operadores). Ruta, formato e idioma salen de la sección Handbook de `task-workflow.md`; sin esa sección no corre. |
| `setup-sandcastle` | Instala el **worker** de sandcastle (`@ai-hero/sandcastle`): `work-task` sin humano en el loop. Drena los slices AFK de uno o varios padres en un contenedor aislado con gate en dos tiers verificado desde afuera del agente (acotado por slice, completo al cierre con fix-loop), fase de QA antes del cierre (Chromium headless opcional en la imagen; una hija `[FIX]` por fallo, drenada como slice), routing de modelo por tag y por invocación (menú de rama base y modelo cuando se lanza a mano), y cierra con review + MR + informe `## Resumen` en el padre + un único comentario de cierre. También drena **tareas sueltas** fuera de un plan (`sandcastle-tasks`). Trae los scripts portables ya escritos en `files/`; se adaptan sólo la imagen y `project.json`. Correr una vez por proyecto. |
| `github-issues` | Referencia de uso de `gh` sobre GitHub Issues: mapeo del modelo (sub-issues, labels `status:*`, dependencias), setup, higiene del token, mapa de comandos, errores y limitaciones. Fuente de verdad única del CLI — los `issue-tracker.md` de cada repo salen de acá. |

## Instalación

Desde la raíz del proyecto consumidor:

```bash
npx skills add gonzaloramirezabella/skills --skill '*' -y
```

Notas:

- **Nunca `--all`**: implica `--agent '*'` y crea directorios basura (`agent/`, `data/skills/`) para agentes que el proyecto no usa.
- La lista con comas (`--skill a,b`) está rota en el CLI: usá `'*'` o una skill por vez.
- El instalador copia cada skill a `.agents/skills/{nombre}` y la registra en `skills-lock.json` (source + hash); `.claude/skills` queda como symlink a `.agents/skills`.

Después, en el proyecto, hay que correr el setup. **Obligatorio: `gh` instalado y autenticado** (`brew install gh && gh auth login`; verificar con `gh auth status`) — sin él, el setup no puede crear los labels ni leer los issues y queda bloqueado.

- Repo nuevo: `/setup-project` — interactiva, te va pidiendo lo que necesita (stack de Docker, credenciales de playwright, configuración del repo) y se encarga de instalar el resto de las skills (mattpocock, playwright-cli) e invocar `/setup-skills`.
- Repo ya andando: `/setup-skills` directamente — verifica dependencias, instala mattpocock/skills si falta y genera la configuración del repo (`docs/agents/task-workflow.md`).
- Worker sin humano: `/setup-sandcastle`, después de `/setup-skills` y de haber planificado al menos un padre con `plan-task`.

## Requisitos

- Repo en **GitHub**: los issues del repo son el tracker (hijas del plan = sub-issues, statuses = labels `status:*`, bloqueos = dependencias nativas), operados con [`gh`](https://cli.github.com) (elegido sobre MCP por consumo de tokens — ver `docs/agents/issue-tracker.md` del repo consumidor). Las skills del ciclo no lo nombran: piden operaciones por rol y leen el comando del mapa de `issue-tracker.md`.
- Una rama de integración (p. ej. `dev` o `main`) y `gh pr create` como CLI de MR. Si la base está protegida, mejor: el plan y el trabajo llegan sólo por PR.
- Para sandcastle: Docker en el host y Node ≥ 22 real (no un wrapper que delega al contenedor).

## Actualizar

**No uses `npx skills update`**: sólo refresca las skills ya registradas en `skills-lock.json`, así que una skill nueva —de acá o de mattpocock— nunca aparece. `add --skill '*'` hace las dos cosas (reescribe las instaladas con la última versión y suma las que falten), así que el ritual de actualización de cualquier consumidor son estas dos líneas:

```bash
npx skills add gonzaloramirezabella/skills --skill '*' -y
npx skills add mattpocock/skills --skill '*' -y
```

Si el repo tiene el worker de sandcastle instalado, hay un tercer paso: `add` refresca `.agents/skills/`, pero los `.ts` que corren viven en `.sandcastle/` y son copias.

```bash
make sandcastle-update   # copia los ocho .ts portables + corre los tests del worker
```

Y un cuarto, cuando la suite cambia lo que los setups escriben (secciones nuevas de `task-workflow.md`, `CODING_STANDARDS.md`, guardrails): re-correr `/setup-project` y `/setup-skills`. Son idempotentes — en un repo en marcha no re-eligen el stack: imprimen un tablero `✅/⚠️` y completan sólo lo que falta.

Cerrá el ciclo con una retro (`make sandcastle-retro`, que carga la skill `retro` de mattpocock por Read porque es user-invoked; sin worker, leé `.agents/skills/retro/SKILL.md` y seguilo) sobre el último drenaje y los comentarios humanos de los MRs recientes: propone cambios al entorno del agente, no al código; lo mecánico que detecte va a un check, lo de juicio a `CODING_STANDARDS.md`, que es lo que `code-review` lee en su eje Standards. Periódicamente, `/improve-codebase-architecture` sobre las zonas que más cambiaron: módulos más profundos dan tests menos frágiles.

Eso no sincroniza el `Makefile`, `project.json` ni el `Dockerfile` — son de cada repo. Si la versión nueva trae targets o variables nuevas, el diff sale de la plantilla de `skills/setup-sandcastle/REFERENCE.md` y se aplica a mano.

Queda una tercera dirección que ningún `add` cubre: las skills que **desaparecieron** del repo fuente (borradas, o renombradas) siguen instaladas para siempre, y hay que quitarlas con `npx skills remove`. Caso concreto: la antigua `clickup-cli` (el tracker ahora es GitHub Issues vía `github-issues`) — en un consumidor viejo, `npx skills remove clickup-cli -y`. Detectarlas es comparar el lock contra el repo real, source por source; el prompt de abajo lo hace.

### Prompt para actualizar un consumidor

Pegale esto tal cual a un agente parado en la raíz de un proyecto consumidor. Es autosuficiente a propósito: ese agente no ve este README.

````
Sincronizá las skills de este repo con sus repos fuente. `npx skills update` no sirve:
sólo refresca las ya registradas en skills-lock.json y nunca trae las nuevas.

1. Refrescá e incorporá las nuevas de ambos sources:

   npx skills add gonzaloramirezabella/skills --skill '*' -y
   npx skills add mattpocock/skills --skill '*' -y

   Nunca `--all` (crea directorios basura para agentes que este repo no usa) y nunca
   listas con comas (`--skill a,b` está rota en el CLI).

2. Listá las skills que quedaron instaladas pero ya no existen en su fuente
   (borradas o renombradas upstream):

   tmp=$(mktemp -d); jq -r '.skills[].source' skills-lock.json | sort -u | while read -r src; do
     case "$src" in http*) url="$src";; *) url="https://github.com/$src";; esac
     dir="$tmp/$(echo "$src" | tr -c 'a-zA-Z0-9' _)"
     git clone -q --depth 1 --filter=blob:none "$url" "$dir" 2>/dev/null || continue
     fd -g SKILL.md "$dir/skills" -x dirname | xargs -n1 basename | sort > "$dir.up"
     jq -r --arg s "$src" '.skills|to_entries[]|select(.value.source==$s)|.key' skills-lock.json | sort | comm -13 "$dir.up" -
   done

3. Por cada nombre que imprima: buscá referencias (`rg {nombre} docs/ .agents/skills/
   AGENTS.md CLAUDE.md`) y mostrámelas antes de borrar nada. Con el visto bueno,
   `npx skills remove {nombres...} -y`.

4. Re-corré `/setup-project` y `/setup-skills`: en un repo en marcha no re-eligen el
   stack, imprimen un tablero ✅/⚠️ y completan sólo lo que falta (análisis estático,
   CI que corre el gate, `CODING_STANDARDS.md`, secciones nuevas de `task-workflow.md`).

5. Retro de cierre: leé `.agents/skills/retro/SKILL.md` y seguilo (es user-invoked, no
   está en la Skill tool) sobre el último drenaje (`.sandcastle/logs/run-*.log` o
   `make sandcastle-retro` si existe) y los comentarios humanos de los últimos MRs
   mergeados. Propuestas al entorno —checks, `CODING_STANDARDS.md`, punteros—, no al
   código; mostrámelas, no las apliques.

6. Si este repo tiene `.sandcastle/` (worker de sandcastle instalado), sincronizá
   también los scripts, que son copias y no los toca `skills add`:

   make sandcastle-update

   Si ese target todavía no existe, creálo con el bloque de Makefile de
   `.agents/skills/setup-sandcastle/REFERENCE.md` (sección *Targets de Makefile*),
   que además trae los menús de rama base y modelo de `sandcastle-work`. El
   Makefile, `project.json` y el `Dockerfile` no se sincronizan solos: compará
   contra esa plantilla y aplicá el diff a mano. Cerrá con `make sandcastle-tests`.
````

## Usar las skills en este mismo repo

`.claude/skills` es un symlink a `skills/`, así que acá se invocan directo (`/setup-skills`, etc.) sin copia instalada. Las de mattpocock no están instaladas acá: este repo no es un consumidor.
