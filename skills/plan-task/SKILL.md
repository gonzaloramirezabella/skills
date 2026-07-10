---
name: plan-task
description: Planificar una tarea de ClickUp — grilling con docs, spec, slices con dependencias y QA, dejando el padre en "planificado".
disable-model-invocation: true
---

# Planificar una tarea de ClickUp

La configuración por repo vive en `docs/agents/`: issue tracker (`issue-tracker.md`), tags de triage (`triage-labels.md`), rutas de docs de dominio (`domain.md`) y statuses del ciclo de vida (`task-workflow.md`) — **leé `task-workflow.md` al arrancar**; los nombres de status que usa esta skill son roles y el string exacto sale de ahí. Las plantillas —cuerpo del `[DOCS]`, del `[QA]`, bloque de descripción— están en [REFERENCE.md](REFERENCE.md). No dupliques esas reglas acá.

## Pasos

### 1. Obtener Task ID

Si el usuario lo pasó en el prompt, usalo. Si no, pedilo en texto plano: "¿Cuál es el Task ID de ClickUp? (ej. `FV-123` o `abc123def`)".

### 2. Traer la tarea (contexto)

`clickup_get_task`: título, descripción, status, tags. Sirve de contexto para el grilling y para resolver el `parent` de los hijos.

### 3. Generar el plan con `grilling` + `domain-modeling`

**Antes de invocar grill**, tomá un baseline del árbol acotado a las rutas de docs de dominio (las define `docs/agents/domain.md`), para distinguir después lo que tocó grill de la suciedad preexistente (p. ej. cambios de otra tarea):

```bash
git status --porcelain -- CONTEXT.md '**/CONTEXT.md' docs/adr/   # ajustá a las rutas de domain.md
```

Guardá esa salida como baseline. Avisá en una línea ("🎯 Arrancando sesión de planificación con grilling + domain-modeling.") e invocá las skills `grilling` y `domain-modeling` juntas (con la Skill tool). **Delegá completamente — no generes el plan vos mismo.** `domain-modeling` puede crear/editar `CONTEXT.md` y ADRs en `docs/adr/` inline a medida que se cierran decisiones. Esperá a que termine y a que el usuario confirme que el plan está cerrado.

### 3b. Capturar y revertir las ediciones de docs del grill

Volvé a correr el `git status --porcelain` del paso 3 y compará contra el baseline. **Sólo** las rutas que aparecieron o cambiaron respecto del baseline las tocó grill; **no toques nada fuera de esas rutas** (cambios de otra tarea quedan intactos).

- **Si no hay diferencias contra el baseline** → no hay `[DOCS]`; saltá al paso 4.
- **Si grill tocó docs:**
  1. **Capturá el contenido literal.** ADRs nuevos → su texto completo. `CONTEXT.md` → sólo las **entradas de glosario agregadas, no el archivo entero** (`git status` dice *qué* archivo cambió, no *qué líneas*): si ya existía (modificado) → `git diff -- {ruta}` y quedate con las líneas `+`; si es nuevo sin trackear → su contenido completo es lo agregado. Guardalo para crear el `[DOCS]` (se sube en el **paso 5b**, porque encodear "slices blocked-by `[DOCS]`" necesita que los slices del paso 5 ya existan).
  2. **Revertí quirúrgicamente sólo esas rutas**, para dejar el árbol como estaba y la rama base limpia: modificado (trackeado) → `git checkout -- {ruta}`; nuevo sin trackear → `rm {ruta}`.
  3. Verificá con el mismo `git status --porcelain` que esas rutas volvieron al estado del baseline.

El contenido capturado viaja durable en el `[DOCS]`; el árbol no transporta nada (planificación y `work-task` son sesiones separadas).

### 4. Convertir el plan en spec con `to-spec`

Avisá ("📝 Convirtiendo el plan en spec con to-spec.") y **leé `.agents/skills/to-spec/SKILL.md` y seguilo** (es user-invoked: no aparece en la Skill tool — se carga por Read). Sintetiza el contexto y publica el spec como issue con tag `ready-for-agent`. **No** rehagas la interrogación — sólo sintetiza lo que ya está en contexto; la confirmación de seams con el usuario que pide `to-spec` sí corre (es una sola pregunta y el usuario está presente). Además:
- **Colgarlo del padre**: `parent` = el Task ID del paso 1.
- **Prefijo `[SPEC]`** en el título: `work-task` lo identifica por ese prefijo y lo excluye de la iteración de trabajo.

Guardá el ID del spec recién creado.

### 5. Romper el spec en tickets con `to-tickets`

Avisá ("🪓 Rompiendo el spec en tickets con to-tickets.") y **leé `.agents/skills/to-tickets/SKILL.md` y seguilo** (user-invoked, igual que `to-spec`) con la referencia al spec del paso 4. Rompe el spec en vertical slices (tracer bullets) con sus blocking edges y publica un issue por slice. Además:
- **Clasificá cada slice como AFK o HITL** — `to-tickets` no trae esta clasificación, la decidís vos: HITL cuando el slice necesita interacción humana (decisión de diseño, revisión, acceso externo); el resto AFK. Incluí la clasificación en el breakdown que aprueba el usuario.
- **Asignármelos a mí**: resolvé tu user con `clickup_resolve_assignees` (`"me"`) y pasalo como `assignees`.
- **Colgarlos del padre**: cada issue con `parent` = el Task ID del paso 1 (no hermanos del spec).
- **Tag de triage por slice**: AFK → `ready-for-agent`; HITL → `ready-for-human` (`clickup_add_tag_to_task`).

Esperá a que el usuario apruebe el breakdown antes de seguir.

### 5b. Crear el `[DOCS]` (sólo si grill tocó docs) y encodear dependencias

**Sólo si el paso 3b capturó cambios**, creá un issue hijo `[DOCS]` (`clickup_create_task`) que **porta el contenido literal** capturado (template en REFERENCE.md): prefijo `[DOCS]` en el título, `parent` = Task ID del paso 1, asignado a mí (mismo user del paso 5), tag `ready-for-agent`.

**Encodeá el orden en el grafo**: marcá **cada slice del paso 5** como **"blocked by" el `[DOCS]`** (`clickup_add_task_dependency`). Guardá el ID del `[DOCS]`.

### 6. Issue de QA manual (siempre, último en el grafo)

Creá **siempre** un issue `[QA]` (`clickup_create_task`, template en REFERENCE.md): prefijo `[QA]` en el título, `parent` = Task ID del paso 1, asignado a mí, tag `ready-for-human` (HITL). **Bloqueado por todos los slices del paso 5**: agregá una dependencia "blocked by" hacia **cada** slice (`clickup_add_task_dependency`) — es el último nodo del grafo. Cuerpo: un plan de QA manual **detallado**, cubriendo todo lo que requiere verificación humana (flujos en backoffice/app, datos, regresiones, edge cases fuera de los tests automáticos).

### 7. Apuntar al plan desde la descripción del padre

Con `clickup_update_task`, **agregá** al final de la descripción del padre un bloque que **apunte** al spec y liste los hijos (template en REFERENCE.md). **No copies** el spec en la descripción — sólo referenciá dónde está. Preservá la descripción existente. **No** agregues una línea de rama: en este flujo la rama no existe todavía (la crea `work-task`).

### 8. Cerrar la planificación

Status del padre → **planificado** (string exacto en `docs/agents/task-workflow.md`). Si falla con `Status does not exist`, probá variantes de casing/tilde antes de pedir ayuda al usuario.

### 9. Resumen final

```
✅ Tarea {task-id} planificada
   📝 Spec: {spec-issue-id}
   📚 Docs: {docs-issue-id, o "sin cambios de docs"}
   🪓 Issues hijos: {n} publicados (tags de triage aplicados)
   🧪 QA: {qa-issue-id} (HITL, bloqueado por todos los slices)
   🔄 ClickUp: status "planificado"
```
