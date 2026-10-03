---
name: plan-task
description: Planificar una tarea del tracker — grilling con docs, spec y slices publicados como hijas del padre en el tracker, dejando el padre en el status de planificado. No committea nada ni crea ramas.
disable-model-invocation: true
---

# Planificar una tarea del tracker

**Nada de este repo se escribe acá.** La configuración vive en `docs/agents/` y se lee al arrancar: `issue-tracker.md` (el **mapa de comandos** del tracker — esta skill pide operaciones por su rol: *get task*, *my user id*, *create child task*, *add tag*, *mark blocked by*, *replace description*, *set status*, *list subtasks*, *comment*), `domain.md` (rutas de los docs de dominio) y `task-workflow.md` (statuses del ciclo). Los statuses que nombra esta skill son **roles** (*planned*, *backlog*); el string exacto sale de la tabla de `task-workflow.md`. Las plantillas —cuerpo de slice, del `[DOCS]`, del `[QA]`, bloque de descripción— están en [REFERENCE.md](REFERENCE.md). No dupliques esas reglas acá.

**El plan vive en el tracker, no en el repo.** La planificación no committea nada, no crea ramas y deja el árbol exactamente como lo encontró. Todo lo que produce son hijas del padre:

- **`[SPEC]`** — los requisitos del padre (paso 4).
- **Slices** — una hija por unidad de trabajo, con tag de triage y dependencias (paso 5).
- **`[DOCS]`** — sólo si el grill tocó docs de dominio: porta el contenido decidido, capturado y **revertido** del árbol (pasos 3c y 5b).
- **`[QA]`** — el checklist de QA manual en su descripción (paso 6).

La rama del padre **no existe todavía**: la crea `work-task` (vía `init-task`) cuando el trabajo empieza.

## Pasos

### 1. Obtener Task ID

Si el usuario lo pasó en el prompt, usalo. Si no, pedilo en texto plano: "¿Cuál es el Task ID? (ej. `FV-123` o `abc123def`)".

### 2. Traer la tarea y el baseline de docs

*Get task (full description)*: título, descripción, status, tags. Sirve de contexto para el grilling y para resolver el `parent` de las hijas.

**Buscá research previa** en la descripción y los comentarios del padre — ahí queda lo investigado en sesiones anteriores; si alguien ya investigó esta zona, sus hallazgos **reemplazan preguntas del grill**.

**Baseline de docs de dominio** — antes del grill, tomá una foto del árbol acotada a las rutas que declara `domain.md`, para distinguir después lo que tocó el grill de la suciedad preexistente (p. ej. cambios de otra tarea):

```bash
git status --porcelain -- {rutas del glosario y ADRs según domain.md}
```

Guardá esa salida: es el baseline del paso 3c.

### 3. Generar el plan — mapeo del área + `grilling` + `domain-modeling`

#### 3a. Mapeá el área en un subagente

Explorar el código es el ítem más caro de toda la planificación y su producto útil es un resumen corto: hacelo **fuera de esta ventana**. Si lo leés vos, los archivos quedan en el contexto hasta el final y el spec y los slices —el razonamiento que más rinde de esta skill— salen con la ventana ya cargada.

Delegá a un subagente de exploración read-only (`Explore` con `model: sonnet`; si el proyecto no lo tiene, `general-purpose` con `model: sonnet`) y **esperá el informe antes de la primera pregunta del grill**:

> Contexto: {título y descripción del padre, del paso 2}.
>
> Mapeá el área de este repo que ese trabajo tocaría. Leé los docs de dominio que declara `docs/agents/domain.md` (glosario y ADRs) y el código de la zona. Research previa a incorporar: {hallazgos de los comentarios del padre, o "ninguna"}. Devolvé **sólo un informe, sin volcados de código, máximo 40 líneas**:
>
> - Archivos y módulos que el trabajo tocaría: ruta + una línea de por qué.
> - Patrones vigentes que debe respetar, nombrando el doc o el ADR que los fija.
> - Términos del glosario que aplican, verbatim.
> - ADRs relevantes: número, título, y una línea de qué deciden.
> - Restricciones o trampas ya conocidas de la zona.
> - Profundidad de los módulos que se tocan, con el vocabulario de `codebase-design` (módulo, interfaz, seam, profundidad): ¿la interfaz pública alcanza para testear el cambio desde afuera, o un test tendría que meterse en internals? Si es lo segundo, nombrá la seam que falta — es insumo de `to-spec` y candidato para `/improve-codebase-architecture`.
> - Preguntas que no pudiste resolver leyendo.
>
> No propongas diseño ni solución: mapeás, no decidís. Si el área todavía no existe, decilo en una línea y nombrá dónde debería vivir.

Pegá el informe tal cual como contexto del grill. **No abras los archivos que cita** salvo que una pregunta del usuario lo exija: el informe reemplaza esa lectura, no es su índice. Las *preguntas que no pudiste resolver* son insumo directo de la primera ronda del grill — llevalas ahí en vez de resolverlas leyendo.

#### 3b. El grill

Avisá en una línea ("🎯 Arrancando sesión de planificación con grilling + domain-modeling.") e invocá las skills `grilling` y `domain-modeling` juntas (con la Skill tool). **Delegá completamente — no generes el plan vos mismo.** `domain-modeling` puede crear/editar el glosario y los ADRs (rutas en `domain.md`) inline a medida que se cierran decisiones — dejalo: el paso 3c captura esos cambios y los revierte. Esperá a que termine y a que el usuario confirme que el plan está cerrado.

**Hechos de afuera del repo → `research`, en background.** Si una pregunta del grill se contesta con una fuente primaria externa (docs oficiales de una librería, API de un tercero, el CRM legacy) y no con este código, invocá la skill `research` (Skill tool) y **seguí preguntando mientras corre**: es un background agent y su lectura se paga en su propia ventana, no en esta. El discriminador con el paso 3a es la frontera del repo — 3a mapea adentro, `research` investiga afuera. Sus hallazgos alimentan el spec; **el archivo de research no se committea** (la planificación no toca el árbol) y **no se vuelca entero en el padre**: los comentarios del padre son para señales humanas, no un archivo de adjuntos. Lo durable va como apéndice `## Research` en la descripción del `[SPEC]` (paso 4); en el padre comentá a lo sumo la **conclusión en ≤5 líneas** — y sólo si la sesión corre riesgo de cortarse antes de crear el `[SPEC]`. Si `research` escribió archivos, borrálos tras volcarlos.

#### 3c. Capturar y revertir las ediciones de docs del grill

Volvé a correr el `git status --porcelain` del paso 2 y compará contra el baseline. **Sólo** las rutas que aparecieron o cambiaron respecto del baseline las tocó el grill; **no toques nada fuera de esas rutas** (cambios de otra tarea quedan intactos).

- **Si no hay diferencias contra el baseline** → no hay `[DOCS]`; saltá al paso 4.
- **Si el grill tocó docs:**
  1. **Capturá el contenido literal.** ADRs nuevos → su texto completo. Glosario → sólo las **entradas agregadas, no el archivo entero** (`git status` dice *qué* archivo cambió, no *qué líneas*): si ya existía (modificado) → `git diff -- {ruta}` y quedate con las líneas `+`; si es nuevo sin trackear → su contenido completo es lo agregado. Guardalo para crear el `[DOCS]` (se sube en el **paso 5b**, porque encodear "slices blocked-by `[DOCS]`" necesita que los slices del paso 5 ya existan).
  2. **Revertí quirúrgicamente sólo esas rutas**, para dejar el árbol como estaba: modificado (trackeado) → `git checkout -- {ruta}`; nuevo sin trackear → `rm {ruta}`.
  3. Verificá con el mismo `git status --porcelain` que esas rutas volvieron al estado del baseline.

El contenido capturado viaja durable en el `[DOCS]`; el árbol no transporta nada (planificación y `work-task` son sesiones separadas).

### 4. Convertir el plan en spec con `to-spec`

Avisá ("📝 Convirtiendo el plan en spec con to-spec.") y **leé `.agents/skills/to-spec/SKILL.md` y seguilo** (es user-invoked: no aparece en la Skill tool — se carga por Read). Sintetiza el contexto en un spec. **No** rehagas la interrogación — sólo sintetiza lo que ya está en contexto; la confirmación de seams con el usuario que pide `to-spec` sí corre (es una sola pregunta y el usuario está presente). Además:

- **El spec es una hija del padre**: operación *create child task*, título con prefijo **`[SPEC]`** (así `work-task` y cualquier worker lo excluyen de la cola de trabajo), descripción = el spec completo.
- **Si hubo `research` (paso 3b)**, sus hallazgos completos van como apéndice `## Research` al final de esa misma descripción — no como comentarios en el padre.

Guardá el ID del `[SPEC]`.

### 5. Romper el spec en slices con `to-tickets`

Avisá ("🪓 Rompiendo el spec en slices con to-tickets.") y **leé `.agents/skills/to-tickets/SKILL.md` y seguilo** (user-invoked, igual que `to-spec`) con el spec del paso 4. Rompe el spec en vertical slices (tracer bullets) con sus blocking edges. Además:

- **Cada slice es una hija del padre**: *create child task* con el cuerpo del template de REFERENCE.md — el cuerpo debe bastarle a un agente con contexto fresco (el `[SPEC]` está disponible, pero el alcance exacto del slice vive en su propia descripción.)
- **Asignámelos a mí**: resolvé tu user id (*my user id*) y asignalo.
- **Clasificá cada slice como AFK o HITL** — `to-tickets` no trae esta clasificación, la decidís vos. Un HITL **bloquea el cierre del padre** (es trabajo sin construir, no una nota al pie): no es una etiqueta gratis, y tampoco un cajón para lo incómodo. Es HITL si y sólo si cae en uno de estos casos:
  1. **Decisión de diseño abierta** que el spec deliberadamente no cierra (si el spec la cierra, es AFK).
  2. **Acceso o credencial que el agente no tiene** (consola de un tercero, dato de producción, aprobación de alguien).
  3. **Criterio de aceptación no verificable por código** — se juzga mirando (estética, copy, UX).
  4. **Cambio irreversible o de alto riesgo** (migración destructiva, borrado masivo, algo que toca datos de producción).

  Todo lo demás es **AFK**, incluso si es grande o incierto: la incertidumbre técnica se resuelve con TDD, no con un humano. Ante la duda entre "AFK grande" y "HITL", partí el slice: la parte construible va AFK y la decisión queda HITL. Tag de triage por slice (*add tag*): AFK → `ready-for-agent`; HITL → `ready-for-human`. En el breakdown que aprueba el usuario, cada HITL va con **cuál de los cuatro casos** lo justifica.
- **Modelo por slice (sólo AFK)** — el worker corre todo en el modelo por defecto (Fable 5.1); un slice con el **tag de modelo liviano** (string exacto en la sección *Model routing* de `task-workflow.md`) corre en Sonnet. Recomendá el tag **sólo si el slice cumple todas** estas condiciones:
  1. El spec cierra todas sus decisiones — no queda diseño abierto ni ambigüedad de integración.
  2. Los criterios de aceptación los verifica el gate solo (tests/lint), sin juicio.
  3. Sigue un patrón existente que el mapa del 3a nombró (endpoint calcado de otro, campo nuevo, test de comportamiento existente, config).
  4. Superficie chica: un módulo, pocos archivos.
  5. No fija la arquitectura del padre — el primer tracer bullet nunca califica.
  6. Nada sensible: sin seguridad, migraciones destructivas ni borrado de datos.

  Ante la duda, sin tag: el defecto (Fable 5.1) es el camino seguro. En el breakdown que aprueba el usuario, cada recomendación de modelo liviano va con su justificación en una línea; aplicá el tag (*add tag*) recién tras la aprobación.
- **Si una pregunta abierta sólo se contesta con código corriendo**, decidí por lo que bloquea:
  - Bloquea **un slice** → slice HITL (caso 1 o 3) y la planificación sigue: el spec deja esa decisión abierta a propósito. Es el caso frecuente.
  - Bloquea **la forma del breakdown** — no sabés el modelo de estado, así que no sabés cuáles son los slices → **detené la skill acá**. No inventes un spec: avisale al usuario que esto pide un `prototype` en sesión aparte (`handoff` afuera → `prototype` → `handoff` de vuelta) y que vuelva a plan-task con la respuesta. No se pierde nada del grill: si el paso 3c capturó docs, dejálos como comentario en el padre para que la próxima sesión los levante.
- **Encodeá los blocking edges** en el tracker: por cada edge, operación *mark blocked by* del slice bloqueado hacia su bloqueante.
- Todos los slices nacen en el status de *backlog* (*set status* si la lista no los crea ahí).

Esperá a que el usuario apruebe el breakdown antes de seguir.

### 5b. Crear el `[DOCS]` (sólo si el paso 3c capturó docs) y encodear su dependencia

Creá una hija **`[DOCS]`** (*create child task*) que **porta el contenido literal** capturado (template en REFERENCE.md): prefijo `[DOCS]` en el título, asignada a mí, tag `ready-for-agent` **y el tag de modelo liviano** (aplica contenido ya decidido verbatim, cero razonamiento — siempre califica). `work-task` lo aplica como **primer commit** de la rama, antes de cualquier slice.

**Encodeá el orden en el grafo**: marcá **cada slice del paso 5** como *blocked by* el `[DOCS]`. Guardá su ID.

### 6. La hija `[QA]` en el tracker (siempre, última en el grafo)

Redactá un plan de QA **detallado y ejecutable** (template en REFERENCE.md), cubriendo todo lo que no cubren los tests automáticos (flujos en backoffice/app, datos, regresiones, edge cases), y creá una hija **`[QA] {título del padre}`** (*create child task*) cuya **descripción es el checklist completo**. Marcala *blocked by* **cada** slice del paso 5 — es el último nodo del grafo.

El checklist lo va a correr **un agente primero** (la fase de QA de `work-task` y del worker, antes del cierre) y un humano después, así que cada item declara su **carril** y trae pasos que un agente con contexto fresco pueda ejecutar tal cual:

- **agente** — observable en local: URL concreta, acciones (click, fill, select), dato o estado esperado, cómo confirmarlo (pantalla, respuesta HTTP, consulta a la DB, comando de consola). Con las credenciales de `task-workflow.md` § *QA*.
- **humano** — necesita algo que el agente no tiene: dispositivo físico, producción, sistema externo sin credenciales locales, juicio subjetivo («se ve bien»). Igual lleva pasos.

Un item vago («probar que el export funciona») no cumple la criterio: el agente lo va a marcar 🙋 y el humano lo va a tener que redactar. **No es un slice**: ningún worker lo toma como trabajo y no bloquea el cierre por sí mismo; cada ❌ que deje la fase de QA se convierte en una hija `[FIX]` (ésa sí es un slice y bloquea como tal — reglas en `task-workflow.md` § *QA*).

En un re-plan, si ya existe una hija con prefijo `[QA]` (*list subtasks*), actualizale la descripción en vez de duplicarla — preservando los veredictos ya registrados en sus items.

### 7. Apuntar al plan desde la descripción del padre

Con la operación *replace description* (es destructiva: traela completa, editala local, subila entera), **agregá** al final de la descripción del padre el bloque `## Planificado` (template en REFERENCE.md): link al `[SPEC]` y el resumen del breakdown (slices AFK/HITL, `[DOCS]` si hay, QA). Preservá la descripción existente. **No** agregues una línea de rama: en este flujo la rama no existe todavía (la crea `work-task`, que suma la línea `- Rama:` a este mismo bloque).

**La descripción del padre es para humanos, no para el plan**: el detalle vive en las hijas. No dupliques acá el spec, los criterios de aceptación ni la lista razonada de slices — el bloque `## Planificado` no crece más que su template. Al cierre, `work-task` agrega el bloque `## Resumen` (informe funcional para negocio): no lo anticipes ni lo pises en un re-plan.

### 8. Cerrar la planificación

Status del padre → *planned* (operación *set status*, string exacto en `task-workflow.md`). Si el tracker rechaza el string, probá variantes de casing/acento antes de pedir ayuda al usuario.

### 9. Resumen final

```
✅ Tarea {task-id} planificada
   📝 Spec: hija [SPEC] {id}
   📚 Docs: hija [DOCS] {id}, o "sin cambios de docs"
   🪓 Slices: {n} AFK ({k} con tag de modelo liviano), {m} HITL (hijas del padre, orden y bloqueos como dependencias)
   🧪 QA: hija [QA] {id} ({n} items agente, {m} items humano)
   🔄 Tracker: status de planificado, descripción apunta al plan
   🌳 Árbol: intacto (sin commits ni ramas — la rama la crea work-task)
```
