# plan-task — plantillas

Las plantillas que `SKILL.md` deja afuera de la espina. El cuerpo de cada hija es un **contrato con `work-task`, `qa-task` y cualquier worker automatizado**, que los leen: mantené el formato alineado entre las skills. La semántica de los statuses está en `docs/agents/task-workflow.md` — acá sólo los cuerpos.

## Slice — descripción de la hija (paso 5)

```markdown
## Slice

{el tracer bullet: qué comportamiento entrega este slice de punta a punta}

## Criterios de aceptación

- {comportamiento verificable 1}
- {comportamiento verificable 2}

## Notas

{decisiones ya tomadas que este slice debe respetar; referencias al [SPEC]}
```

- El orden de trabajo lo dan las dependencias (*mark blocked by*) y, a igualdad, el orden de creación: creá los slices en orden topológico (bloqueantes primero).
- El cuerpo debe bastarle a un agente con contexto fresco: el `[SPEC]` del padre está disponible, pero el alcance exacto del slice vive acá.

## `[DOCS]` — descripción de la hija (paso 5b)

````markdown
## Cambios de documentación

Contenido decidido durante la planificación. `work-task` lo aplica como **primer commit** de la rama: ADRs verbatim, glosario por merge aditivo (rutas en `docs/agents/domain.md`).

### ADR — `{ruta de ADRs según domain.md}/{NNNN-slug}.md`

```markdown
{contenido completo del ADR}
```

### Glosario — `{ruta del glosario según domain.md}`

Agregar estas entradas (merge aditivo, no pisar):

```markdown
{entradas de glosario agregadas}
```
````

## Hija `[QA]` — checklist en la descripción (paso 6)

Nombre: `[QA] {título del padre}`. La descripción **es** el checklist:

```markdown
Verificación de todo lo construido en los slices. Cada item: carril, pasos ejecutables, resultado esperado y cómo confirmarlo. Lo corre la fase de QA (agente, antes del cierre) y después un humano para lo marcado `humano`; los veredictos se registran acá mismo, bajo cada item, y el roll-up va en los comentarios. Cada ❌ se convierte en una hija [FIX].

- [ ] [agente] {qué verificar} — ir a {URL}, {acciones concretas} — esperado: {dato/estado} — confirmar: {pantalla | respuesta HTTP | consulta DB | comando}
- [ ] [agente] {...}
- [ ] [humano] {qué verificar} — {pasos} — esperado: {...} — por qué humano: {dispositivo | producción | juicio visual}
```

Los veredictos que la fase escribe debajo de cada item (`→ ✅ agente:`, `→ ❌ FALLÓ:`, `→ 🙋 humano:`) y su regla de re-corrida están en `task-workflow.md` § *QA*: no los anticipes en el checklist, y en un re-plan preservalos.

## Bloque de descripción del padre (paso 7)

Se **agrega** al final de la descripción existente (no la pises). **No** lleva línea de rama: `work-task` agrega después a este mismo bloque la línea `- Rama: \`{branch}\`` cuando crea la rama — esa línea es **load-bearing** (la leen `work-task`, `qa-task` y cualquier worker automatizado), no la pierdas en ediciones posteriores. Al cierre, `work-task` suma un bloque `## Resumen` **al principio** de la descripción (informe para negocio — lo primero que se lee; este bloque queda debajo): en un re-plan preservalo igual que el resto.

```markdown
## Planificado

{1-2 frases de qué se va a construir.}

- Spec: [SPEC] {id / link}
- Docs: [DOCS] {id / link, o "—" si el grill no tocó docs}
- Slices ({n} AFK, {k} en modelo liviano + {m} HITL): {lista de ids} (orden y bloqueos como dependencias)
- QA: hija [QA] ({id}) — {n} items agente, {m} humano
```
