---
name: setup-sandcastle
description: Instalar el worker de sandcastle en un repo — drena los slices planificados de un padre en un contenedor aislado, con el gate verificado desde afuera y el MR al final. Correr una vez por proyecto.
disable-model-invocation: true
---

# Setup de sandcastle

sandcastle (`@ai-hero/sandcastle`) corre Claude Code dentro de un contenedor Docker sobre un **worktree** git propio. Lo que este setup instala no es "un agente con un prompt suelto": es el **worker del flujo de tareas de esta suite**. `make sandcastle-work PARENT={id}` lee del tracker el plan que dejó `plan-task` (las hijas del padre), implementa cada slice AFK en su propio agente, verifica el gate él mismo, setea los statuses, cierra el padre y abre el MR. Es `work-task` sin humano en el loop, y comparte con él el mismo mandato.

**El worker no sabe nada de este repo, y eso es el diseño.** Cada status, ruta, rama y comando sale de `docs/agents/task-workflow.md`; el stack sale de `.sandcastle/project.json`; todo lo que tiene forma de tracker vive en un único archivo adapter. Un repo nuevo cambia configuración, nunca código. Por eso el paso 1 es el contrato con el flujo: si el repo no lo tiene configurado, este setup no aplica todavía.

Ejecutá los pasos en orden — cada uno cierra con su **criterio**. Antes de crear algo, mirá si ya existe: un re-run parcial es válido, salteá lo que ya cumple su criterio. En un repo **ya instalado** (existe `.sandcastle/worker.ts`) no releves el stack de nuevo: imprimí un tablero `✅/⚠️` con la criterio de cada paso (contrato del `task-workflow.md` incluidas sus secciones nuevas, `.ts` al día contra `files/`, entry points, escalera de verificación, cierre del ciclo) y ejecutá sólo los ⚠️ — para los `.ts` eso es el paso 7. Los archivos portables se copian tal cual desde [`files/`](files/) y **no se editan al instalar**; las plantillas que sí hay que adaptar están en [`REFERENCE.md`](REFERENCE.md).

## 1. Verificar el flujo de tareas — sin esto no hay worker

El worker parsea `docs/agents/task-workflow.md`. No es prosa decorativa: es su archivo de configuración. Abrilo y verificá que tenga las cinco cosas de abajo; si falta cualquiera, **frená y corré `/setup-skills` primero** — no las inventes acá.

- **Tabla de statuses** con las cinco filas de rol (`Backlog`, `Planned`, `In progress`, `In review`, `Blocked on a human`), cada una con su string exacto en backticks. Las etiquetas de fila son literales que el parser busca.
- **`Base/integration branch:`** y **`MR CLI:`**, cada uno con su valor en backticks.
- **Opcional: destinos especiales en Branching** — una línea como «Hotfix branches (`hotfix/`) target `main` instead». El worker la lee (prefijo en backticks terminado en `/`, la palabra `target`, destino en backticks): un padre cuya rama lleva ese prefijo se trae, se gatea y se mergea contra ese destino, y `{{BASE_BRANCH}}` en los bloques del gate resuelve a él. Sin la línea, todo va a la rama base.
- **`## Quality gate` con un bloque `### Sandbox`** en bash. Es el gate completo que corre el worker **una vez al cierre del padre**, y es distinto del de Host a propósito: **sin acotar** (un verificador que elige su propio filtro se pierde la regresión que causó) y con el formateador en modo *check*, no reescribiendo. Si el repo sólo tiene bloque Host, proponé el Sandbox derivándolo del Host y confirmalo con el usuario.
- **Opcional: un bloque `### Sandbox — slice`** — el gate acotado que corre después de **cada slice** (tests mapeados a lo cambiado, tsc incremental), para que un drain no pague la suite completa N veces. Sin este bloque el worker corre el gate completo por slice, que sigue siendo correcto — sólo más lento. Si lo agregás: el bloque `### Sandbox` sigue siendo la autoridad al cierre, y los archivos de estado de las herramientas acotadas (base de testmon, `.tsbuildinfo`) van al `.gitignore` del repo.
- **`## Paths`** con `Work log`, `Domain docs`, `Slice mandate — canonical` y `Parent close mandate`. El work log conserva `{parent-id}` literal — el worker lo sustituye.
- **Los dos mandatos existen** en las rutas declaradas y son los canónicos (los mismos que usa `work-task`). Si faltan, los shippea `setup-skills` en `prompts/`.
- **Opcional: la fase de QA** — una línea `QA mandate` en `## Paths` (el archivo lo shippea `setup-skills`, D4) y una sección `## QA` con `Browser lane:`, `QA↔fix cycles:`, `Credentials:` y un bloque `### Sandbox` en bash que migra/semilla y sirve la app **nativa, dentro de la imagen** (el comando que sirve se desprende con `nohup … &`), más su `App URL (sandbox):`. Con esto el worker verifica el checklist de la hija `[QA]` antes del cierre y crea una hija `[FIX]` por fallo, que drena como un slice. Sin la línea, la fase se saltea. Si `Browser lane` es `yes`, la imagen necesita Chromium + `playwright-cli` (paso 4).

El plan no está en el repo: **el worker drena las hijas del padre en el tracker** (slices por tag de triage, `[SPEC]`/`[DOCS]`/`[QA]` por prefijo), así que `plan-task` tiene que haber corrido al menos una vez antes del primer run real.

**Criterio:** las cinco verificaciones en verde, y el bloque `### Sandbox` acordado con el usuario.

## 2. Relevar el stack

El sandbox no tiene socket de Docker: **todo el toolchain del proyecto corre nativo dentro de la imagen**. Relevá leyendo el repo (Makefile, compose, manifests, CI) y confirmá con el usuario lo que no cierre:

- **Binarios que pide el gate** — el bloque Sandbox del paso 1 define qué tiene que haber en la imagen. Un proyecto Laravel pide PHP + extensiones + composer; uno React Native pide Node + su package manager, y su gate es el lado JS (jest, eslint, tsc) — emuladores y builds nativos quedan fuera del sandbox, en el host.
- **Servicios** — si el gate necesita una base de datos u otros servicios y el proyecto los levanta con compose, el sandbox se **adjunta a la red del compose** y los alcanza por nombre de servicio. Anotá red (`docker network ls`), hostnames y credenciales dev. Sin servicios (típico React Native), no hay red que declarar.
- **Setup del worktree** — qué necesita un checkout fresco para que el gate corra: instalar dependencias, `.env` desde el example, generar claves, crear directorios.
- **Dónde vive la app** — raíz o `src/`; todos los comandos del setup y del gate se prefijan acorde.
- **Node del host** — sandcastle corre con Node ≥ 22 en el host. Verificá con `command -v node && node --version` que el `node` del PATH sea real: en repos dockerizados suele ser un wrapper que delega al contenedor y rompe todo. Si lo es, resolvé el binario real (p. ej. el último de `~/.nvm/versions/node/*/bin/node`) y usalo en los entry points del paso 5.

**Criterio:** binarios, servicios (o su ausencia), setup del worktree, raíz de la app y ruta del node real — los cinco anotados y confirmados.

## 3. Tooling Node en la raíz

El worker se instala como devDependency de un `package.json` de tooling en la raíz del repo (si la app ya es Node y vive en la raíz, va en el suyo):

```bash
npm install --save-dev @ai-hero/sandcastle zod
```

`zod` valida el bloque de resultado del agente; sin él el worker no arranca. Los scripts se escriben en TypeScript y los ejecuta Node directo (strip-only): sin enums, sin parameter properties en constructores — tipos que se borran y nada más.

**Criterio:** `node -e "import('@ai-hero/sandcastle')"` sale sin error usando el node real del paso 2.

## 4. Directorio `.sandcastle/`

Todo lo de sandcastle vive junto en `.sandcastle/`. Dos grupos, y no se mezclan.

**Se copian tal cual desde [`files/`](files/)** — son portables por diseño, y editarlos al instalar es el error que este setup evita:

| Archivo | Qué es |
|---|---|
| `lib.ts` | Parsers y lógica pura: el contrato con `task-workflow.md` y `project.json`, la clasificación de las hijas del plan, la cola, las decisiones de cierre, los textos del roll-up. |
| `worker.ts` | El drenaje de un padre, punto a punto. El entry point del flujo. |
| `tasks.ts` | El drenaje de tareas sueltas, fuera de un plan: una rama y un MR por tarea, o todas en una rama con un MR. Mismas garantías que `worker.ts` (commit verificado, gate corrido afuera, status puesto por él), sin spec, bitácora ni cierre. |
| `runner.ts` | Los pasos atados al sandbox que comparten los dos drenajes: el gate, los restos sin commitear, el sleep-and-retry del rate limit, el MR y los worktrees huérfanos. |
| `github.ts` | Adapter del tracker: lo único con forma de GitHub — sub-issues como hijas, labels `status:*` como status, dependencias nativas como bloqueos, comenta. Otro tracker = se reescribe este archivo y nada más. |
| `smoke.ts` | Harness de depuración de la imagen: sin agente y sin credencial. |
| `main.ts` | Escape hatch de prompt libre (`prompt.md`). No es el camino del flujo. |
| `lib.test.ts` | Los tests, incluidos los de contrato que leen los archivos reales del repo. |

**Se escriben a medida de este repo**, desde las plantillas de REFERENCE.md:

- **`project.json`** — imagen, red, mounts, setup del worktree, checks de servicios y la prosa de entorno para el agente, con lo relevado en el paso 2. **Es el único archivo con valores de este repo**: los scripts lo leen y no repiten ninguno. Los valores del *workflow* no se copian acá — salen de `task-workflow.md`.
- **`Dockerfile`** — partí de la plantilla que corresponda al stack (PHP o Node) y ajustá con los binarios del gate. Si `task-workflow.md` § *QA* declara `Browser lane: yes`, sumá el bloque *Chromium + playwright-cli* de REFERENCE.md **antes** del `USER` (los navegadores se instalan como root en una ruta global que el usuario `agent` lee). Un simulador iOS/Android **no** corre dentro de la imagen: en un repo móvil el carril de navegador es `no` y la fase de QA del sandbox verifica sólo lo observable por consola; la pantalla queda para `work-task`/`qa-task` en el host. Invariantes de cualquier variante: usuario `agent` con UID/GID parametrizados por build-arg (los archivos del worktree bind-monteado y los de la imagen comparten dueño, sin chown en runtime); Claude Code CLI vía `curl -fsSL https://claude.ai/install.sh | bash`; si la imagen base redefine `HOME` o los `XDG_*` (FrankenPHP lo hace), resetearlos al home del agente o el instalador falla; **workspace pre-trusted y hooks de git neutralizados** (el bloque de la plantilla — sin lo primero el CLI ignora el allowlist del repo y sale con error; sin lo segundo cualquier `git commit` muere porque los hooks del repo llaman a herramientas del host que acá no existen, y el trabajo del agente se pierde sin commitear); `ENTRYPOINT ["sleep", "infinity"]`.
- **`.gitignore`** propio: `.env`, `worktrees/`, `logs/` y el directorio de cache de dependencias.
- **`.env.example`** versionado, con las variables esperadas vacías y un comentario de cómo obtener cada una. sandcastle carga `.sandcastle/.env` solo — sin dotenv ni flags. Va la credencial de Claude; el token de GitHub es opcional (`GH_TOKEN`): sin él, el worker usa el login de `gh` del host.
- **Cache de dependencias** — un directorio (`composer-cache/`, `npm-cache/`) que el run monta dentro del sandbox y apunta vía la variable de cache del package manager, para que el primer install sea el único lento.

**Criterio:** `docker build` sale verde, y `git status` no muestra nada de `.env`, `worktrees/`, `logs/` ni caches.

## 5. Entry points

El repo manda: si los comandos de dev pasan por un Makefile, agregá los **ocho** targets de la plantilla de REFERENCE.md; si el repo se maneja con npm scripts, los equivalentes en `scripts`.

| Entry point | Para qué |
|---|---|
| `sandcastle-build` | Construye la imagen (nombre leído de `project.json`, no repetido acá). |
| `sandcastle-smoke` | Verifica la imagen sin agente ni credencial. |
| `sandcastle-tests` | Corre `lib.test.ts` — incluye los tests de contrato contra `task-workflow.md`. |
| `sandcastle-work` | **El del flujo**: drena uno o varios padres, de a uno (`PARENT={id}[,{id}]`, `DRY_RUN=1` para ver la cola sin lanzar nada). Corrido desde una terminal, **pregunta rama base y modelo** con un menú; `BASE=`/`MODEL=` saltean la pregunta y sin terminal no pregunta nada. |
| `sandcastle-tasks` | Drena **tareas sueltas** que no pasan por `plan-task` (un bug, un cambio chico) con el mandato de la tarea suelta de `task-workflow.md`: `TASKS={id}[,{id}]` le da a cada una su rama —el prefijo sale del tipo que declara el agente— y su MR; con `BRANCH={rama}` van todas a esa rama, un commit cada una, con un solo MR. Rechaza padres, slices, tareas cerradas o en revisión. Mismo menú y `DRY_RUN=1` que `sandcastle-work`. |
| `sandcastle` | Prompt libre (`prompt.md`), para depurar. Pregunta modelo con el mismo criterio. |
| `sandcastle-update` | Sincroniza los ocho archivos portables desde la skill instalada y corre los tests. |
| `sandcastle-retro` | El freno humano: corre la skill `retro` de mattpocock en el host sobre el último log del drenaje (`LOG=` para otro) y, con `MR=iid`, sobre los comentarios humanos de ese MR. Propone cambios al entorno (checks, `CODING_STANDARDS.md`, punteros, mandatos); no aplica nada sin OK. |

Cada uno trae sus guardas: node real presente, credencial en `.sandcastle/.env` (sólo los que usan agente), dependencias instaladas, imagen construida (o la construye), servicios arriba si el gate los usa. El dry run no necesita credencial de agente ni imagen — no las exijas; sí necesita que `.sandcastle/.env` exista, porque el worker lo lee en los dos modos; y `gh auth status` en verde (o `GH_TOKEN` en ese archivo), porque el dry run lee el tracker.

El menú no puede colgar una corrida desatendida: se muestra sólo si hay TTY (`[ -t 0 ]`) **y** la variable no vino por línea de comandos, y la opción por defecto **no pasa flag** — el worker resuelve la base del doc (routing de `hotfix/` incluido) y el modelo de su default. Las etiquetas del menú se derivan con `$(shell sed …)` de las mismas líneas de `task-workflow.md` que parsea el worker: en el Makefile no se escribe ningún nombre de rama.

**Criterio:** el entry point de ayuda del repo (`make help` o `npm run`) lista los ocho; correrlos sin prerequisitos falla con un mensaje que dice cómo resolverlo, no con un stack trace; y `rg` del nombre del proyecto dentro de `.sandcastle/*.ts` no devuelve nada.

## 6. Credencial y verificación en escalera

```bash
claude setup-token   # en el host; pegar el token en .sandcastle/.env
```

`CLAUDE_CODE_OAUTH_TOKEN=` en `.sandcastle/.env` (o `ANTHROPIC_API_KEY=` si se prefiere API key). El tracker lo autentica el `gh` del host (`gh auth status`), u opcionalmente `GH_TOKEN=` en el mismo archivo para corridas sin `gh`. Ninguno se versiona, se pega en issues ni se muestra en output.

Verificá en este orden — cada escalón aísla una clase de falla, y saltearlos hace que el primer run real falle sin decirte dónde:

1. **`sandcastle-tests`** — el contrato con `task-workflow.md` y los mandatos. Falla acá si el paso 1 quedó a medias, y es la falla más barata de arreglar.
2. **`sandcastle-build`** + **`sandcastle-smoke`** — la imagen corre el gate real del repo. Cada comando que falla acá fallaría en silencio bajo el agente.
3. **`sandcastle-work PARENT={id} DRY_RUN=1`** sobre un padre ya planificado — muestra la cola, los HITL y los needs-info sin lanzar sandbox ni escribir nada.
4. **`sandcastle-work PARENT={id}`** de verdad, sobre un padre con pocos slices.

**Criterio:** los tests pasan, el smoke imprime `SMOKE TEST PASSED`, el dry run lista la cola esperada, y el run real deja al menos un slice en *in review* con su commit en la rama — verificalo desde el host con `git log` de la rama del padre, no por lo que reportó el agente.

## 7. Actualizar un repo ya instalado

Los ocho `.ts` portables se copiaron en el paso 4 y **nada los vuelve a sincronizar solo**. El ritual, en el repo consumidor:

```bash
npx skills add gonzaloramirezabella/skills --skill '*' -y   # refresca .agents/skills/
make sandcastle-update                                              # copia los ocho .ts + corre los tests
```

`npx skills update` **no** sirve: sólo refresca lo ya registrado en `skills-lock.json` (ver *Actualizar* del README de la suite). Los archivos copiados se committean como cualquier dependencia versionada.

Cerrá la actualización con una retro: `make sandcastle-retro` sobre el último drenaje que corrió con la versión anterior (o, sin logs, leé `.agents/skills/retro/SKILL.md` y seguilo sobre los MRs recientes). Es el momento en que más rinde: la versión nueva cambia mandatos y gate, y la retro dice qué del entorno de **este** repo (standards, checks, punteros) hay que ajustar para acompañarla.

**Lo que `sandcastle-update` no toca, porque es de este repo:** `project.json`, `Dockerfile`, `.env*`, `.gitignore` y el **Makefile**. Si la versión nueva agrega targets o variables (menús, `BASE=`, `MODEL=`), el bloque de Makefile de REFERENCE.md es la fuente: compará contra él y aplicá el diff a mano. Después, `make sandcastle-tests` en verde es la señal de que el `task-workflow.md` del repo sigue casando con el parser nuevo; si falla ahí, el doc quedó viejo, no el worker.

## 8. Cerrar el ciclo: retro

Un drenaje produce código **y evidencia de cómo trabajó el agente**: cada run deja su log en `.sandcastle/logs/run-{fecha}.log` (lo escribe la macro de los targets, gitignorado) y el MR recibe la revisión humana. Esa evidencia es lo que mejora la siguiente corrida, y sólo si alguien la mira. El worker ya hace la primera pasada solo: si el drenaje tuvo **fricción** (gate rojo con reintento, needs-info, slice fallido, cierre con restos sin commitear o review caído), tras crear el MR corre la skill `retro` en el sandbox, en modo sólo lectura, y publica sus propuestas como **comentario del MR** titulado «Retro del agente» — separado del cuerpo, que revisa el código. Un drenaje limpio no paga esa pasada. Lo que falta después es la mitad humana; dejala escrita en el `AGENTS.md` (tabla de comandos, fila `/retro` — la escribe `setup-skills`, decisión G; verificá que esté) y en el README del repo, como ritual con dos entradas:

- **Después de cada drenaje que salió torcido** (needs-info inesperados, gate rojo que el agente no destrabó, fixes del cierre que un humano revirtió): `make sandcastle-retro` (toma el último log; `LOG=` para otro).
- **Después de que un humano revisó el MR**: `make sandcastle-retro MR={iid}` — suma los comentarios del MR como entrada principal. La regla es «nunca escribir el mismo comentario dos veces»: lo que un revisor señaló una vez se convierte en un check del gate (si es mecánico) o en una regla de `CODING_STANDARDS.md` (si es de juicio), nunca en un segundo comentario.

`retro` es user-invoked (no aparece en la Skill tool), así que el target la carga por Read: el prompt dice «leé `.agents/skills/retro/SKILL.md` y seguilo». No toca código: propone cambios al entorno del agente (checks, punteros en `AGENTS.md`, standards, mandatos). Lo que proponga sobre los mandatos o el gate va a `task-workflow.md` y los `prompts/` del repo, no a los `.ts`.

La retro automática necesita `.agents/skills/retro/SKILL.md` versionado en el repo (lo instala `npx skills add mattpocock/skills`); si falta, el worker la saltea en silencio.

**Criterio:** `make sandcastle-retro` sin logs falla diciendo cómo pasarle uno; `AGENTS.md` y el README nombran el ritual con sus dos entradas.
