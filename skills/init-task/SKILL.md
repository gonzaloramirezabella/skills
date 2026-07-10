---
name: init-task
description: Setup mecánico de una tarea de ClickUp — traer la tarea, crear el branch git desde la rama base y poner el status en "iniciado". Usar cuando work-task delega el setup a un subagente no-interactivo, o cuando el usuario pasa un Task ID para sólo dejar el branch creado y la tarea iniciada.
---

# Inicializar una tarea de ClickUp (setup mecánico)

**No** planifica ni encadena nada — ese es el trabajo de `work-task`, que llama a esta skill para la parte mecánica.

La rama base, el formato del nombre de branch y el string exacto del status `iniciado` están en `docs/agents/task-workflow.md` — leelo antes del paso 3.

## Contrato: esta skill es no-interactiva

Está pensada para correr como **subagente headless**, así que **no usa `AskUserQuestion`** en su flujo. Las decisiones que normalmente requerirían preguntar se resuelven así:

- **Task ID** → llega como argumento. Si no vino, abortá con `RESULT: blocked` / `blocker: missing_task_id`.
- **Prefijo del branch** → se **infiere** del contexto, sin confirmar.
- **Tarea ya cerrada** y **working dir sucio** → son **bloqueos**: no toques nada y devolvé `RESULT: blocked`. El llamador decide si re-invocar con el permiso correspondiente.

El llamador puede pre-autorizar pasando flags en los argumentos: `allow-closed` y/o `allow-dirty`.

## Entrada

Argumentos (texto libre del llamador):

- Task ID de ClickUp (obligatorio).
- Opcional: `prefix={feature|fix|chore}` para forzar el prefijo en vez de inferirlo.
- Opcional: `allow-closed` para seguir aunque la tarea esté cerrada.
- Opcional: `allow-dirty` para seguir aunque haya cambios sin commitear.

## Pasos

### 1. Validar Task ID

Si no recibiste un Task ID en los argumentos, terminá inmediatamente con:

```
RESULT: blocked
blocker: missing_task_id
detail: No se pasó un Task ID de ClickUp.
```

### 2. Traer tarea de ClickUp

Usá `clickup_get_task` para obtener título, descripción, status y tags.

**Bloqueo — tarea ya cerrada:** si el status es `Done`/`closed`/`completada` y **no** recibiste `allow-closed`, terminá sin tocar nada con:

```
RESULT: blocked
blocker: task_closed
detail: La tarea {task-id} ya está cerrada (status "{status}").
```

### 3. Determinar nombre del branch

Si recibiste `prefix=...`, usalo. Si no, inferí el prefijo desde el contexto (título, tags, descripción), **sin confirmar**:

- Bug/error/fix → `fix`
- Feature/funcionalidad nueva → `feature`
- Refactor/mantenimiento/config/docs → `chore`

Generá el nombre con formato `{prefix}/{task-id}-{slug}`.

**Reglas del slug**:
- Lowercase
- Espacios → `-`
- Sin tildes ni caracteres especiales
- Máximo 60 caracteres totales del branch

Ejemplo: `feature/abc123-agregar-filtro-clientes`.

### 4. Verificar working directory limpio

Corré `git status --porcelain`. Si hay cambios sin commitear y **no** recibiste `allow-dirty`, terminá sin tocar nada con:

```
RESULT: blocked
blocker: dirty_working_dir
detail: Hay cambios sin commitear en el working directory.
```

### 5. Crear branch desde la rama base

Con `{base}` = la rama base de `task-workflow.md`:

```bash
git checkout {base}
git pull origin {base}
git checkout -b {branch-name}
```

Si `git pull` o `git checkout` fallan (conflictos, conexión, branch ya existe), terminá con:

```
RESULT: blocked
blocker: git_error
detail: {mensaje del error de git, sin inventar resoluciones}
```

### 6. Actualizar status de ClickUp

Usá `clickup_update_task` para poner el status en **iniciado** (string exacto en `task-workflow.md`).

### 7. Devolver resultado

Tu mensaje final **es el valor de retorno** para el llamador. Devolvé exactamente:

```
RESULT: success
branch: {branch-name}
task_id: {task-id}
task_title: {título de la tarea}
status: iniciado
```
