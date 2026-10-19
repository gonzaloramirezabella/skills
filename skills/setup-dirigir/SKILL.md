---
name: setup-dirigir
description: Configurar el capitán de un workspace de Herdr (skill dirigir) con una entrevista corta — instala la skill en el cwd del capitán, escribe su capitan.md (nombre, qué maneja, prioridades, tono, ajustes a la regla Orden), deja los datos de prueba por repo en ~/.secrets/pruebas y las reglas allow globales que un worker necesita. Idempotente — en un workspace en marcha imprime un tablero ✅/⚠️ y completa sólo lo que falta. Correr con /setup-dirigir en el pane donde va a correr /dirigir.
disable-model-invocation: true
---

# Setup de dirigir

Deja un workspace de Herdr listo para `/dirigir`: la skill instalada donde corre el capitán, quién es el capitán (`capitan.md`), qué datos de prueba tiene cada repo y qué permisos globales necesita un worker para no frenar. Es una skill guiada por prompt: explorá, proponé, confirmá, y al final **no escribís vos**: dejás una spec y el usuario corre un script.

Por qué un script y no vos: en modo auto el clasificador de permisos bloquea como auto modificación las escrituras en `~/.claude/settings.json`, `~/.secrets` y `capitan.md`. El script es fijo y está probado (`scripts/aplicar-setup`); lo único que varía por workspace es la spec JSON que armás en la entrevista.

`SKILL` es el directorio base que anunció la carga de esta skill; `S="$SKILL/scripts/aplicar-setup"`.

## 1. Tablero

Verificá `test "$HERDR_ENV" = 1`; sin Herdr esta skill no corre. Después:

```bash
bash "$S" --tablero
```

Descubre los repos del workspace por los cwd de sus panes (`git rev-parse --git-common-dir`, así los worktrees cuentan para su repo) y marca con `✅/⚠️`: dirigir instalada en el cwd, `capitan.md` del workspace, reglas `allow` globales, hook del tablero, y por repo con `docs/agents/task-workflow.md` su archivo de datos de prueba y qué claves tiene vacías. Los repos sin `task-workflow.md` se listan como ignorados: ningún worker sabe trabajar ahí; si uno tiene que entrar, primero `/setup-skills` en ese repo.

Si sale `0` (todo ✅), terminá: no hay nada que preguntar. Si falta un repo que sí es del workspace (no tenía pane abierto), agregalo a mano a la spec.

## 2. Entrevista — una decisión por vez

Sólo sobre las ⚠️ del tablero. En texto plano, con tu propuesta ya armada; esperá la respuesta antes de pasar a la siguiente.

- **A. Capitán** (si falta `capitan.md`, o el usuario quiere cambiarlo). Leé el `CLAUDE.md` de cada repo y del cwd y proponé el borrador completo con la plantilla de abajo: nombre, qué maneja (dos líneas por repo), prioridades (qué va primero cuando compite; qué no se toca sin preguntar), tono. Preguntá también si sube o baja la lista de lo que la regla **Orden** de `dirigir` le consulta (destructivo, datos que faltan, salirse del plan, dominio, merge a protegida): lo que agregue o quite va como una línea más. Si ya existe, leelo y preguntá sólo qué cambia.
- **B. Datos de prueba** (por repo con ⚠️). Qué necesita un worker para probar y no vive en el repo: usuario de prueba por tenant, admin del backoffice local, perfil de AWS. Leé la sección *QA* y la línea *Credentials* de `docs/agents/task-workflow.md`: si nombra un archivo (p. ej. `.playwright.env`), proponelo como **semilla**: el script copia de ahí las claves que falten, vos no lo abrís. Razón de que exista `~/.secrets/pruebas` aunque el repo ya tenga ese archivo: está gitignorado y un worktree nuevo no lo trae. Si el repo documenta un usuario sembrado y público (factory default), no hace falta clave para eso. Sin pistas, proponé las cinco por defecto (`USUARIO_PRUEBA`, `PASSWORD_PRUEBA`, `ADMIN_BACKOFFICE_USUARIO`, `ADMIN_BACKOFFICE_PASSWORD`, `AWS_PROFILE`). **Nunca pidas valores en el chat**: quedan en la transcripción. Las claves que no salgan de una semilla las llena el usuario en el archivo.
- **C. Permisos.** No se pregunta: la lista `allow` global es fija (`make`, `clickup-cli`, `glab`, `herdr`, `herdr-panel`, `git fetch/worktree/switch/add/commit`) y son las que un worker en modo auto resuelve antes del clasificador. Decile cuáles son y que, por ser globales, también aflojan el pane del capitán. Si quiere sumar alguna, va en `allow_extra`.

Plantilla de `capitan.md` (corto: lo que no entra en una pantalla sobra):

```markdown
# Capitán de <workspace>

Soy <nombre>. Manejo <qué repos y qué es cada uno, dos líneas>.

Prioridades: <qué va primero cuando compite; qué no se toca sin preguntar>.

Tono: <dos líneas>.

Datos de prueba: `~/.secrets/pruebas/<repo>.env` (lo monta `lanzar-worker`). Lo que falte ahí es decisión; lo que el usuario responda se guarda ahí.
```

## 3. Spec y script

Escribí en `$TMPDIR` el borrador de `capitan.md` (si cambió) y la spec:

```json
{
  "workspace": "wH",
  "cwd": "/ruta/del/cwd/del/capitan",
  "capitan": "/tmp/dirigir-setup-wH-capitan.md",
  "repos": [
    { "path": "/ruta/repo", "claves": ["AWS_PROFILE"], "semilla": "/ruta/repo/.playwright.env" },
    { "path": "/ruta/otro" }
  ],
  "allow_extra": []
}
```

`capitan` es opcional (sin él no se toca el existente); `claves` vacío usa las cinco por defecto; `semilla` es opcional. Mostrá la spec y decile al usuario la línea exacta, con rutas absolutas:

```
! bash <ruta absoluta de $S> /tmp/dirigir-setup-wH.json
```

Qué hace el script, en orden e idempotente: instala `dirigir` en `cwd` si falta (`npx skills add`); escribe `capitan.md` con respaldo si existía y difiere; agrega a `~/.claude/settings.json` las reglas `allow` que falten, con respaldo; crea `~/.secrets/pruebas/<repo>.env` (700/600) o le agrega sólo las claves que falten, copiando de la semilla las que tenga; imprime el tablero. Una segunda corrida no cambia nada.

## 4. Listo

Cuando el tablero del script salga en verde, o con ⚠️ sólo por claves vacías que el usuario va a llenar a mano: abrí `/dirigir` en el pane (o `/dirigir` de nuevo si ya corría: la skill se lee al cargar). Re-correr `/setup-dirigir` después sólo hace falta para cambiar al capitán o sumar un repo; el tablero del paso 1 lo dice.
