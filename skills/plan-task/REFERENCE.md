# plan-task — plantillas

Las plantillas que `SKILL.md` deja afuera de la espina. El cuerpo del `[DOCS]` y del `[QA]` son un **contrato con `work-task`**, que los lee: mantené el formato alineado entre las dos skills.

## `[DOCS]` — cuerpo del issue (paso 5b)

````markdown
## Cambios de documentación

Contenido decidido durante la planificación. `work-task` lo aplica como **primer commit** de la rama: ADRs verbatim, `CONTEXT.md` por merge aditivo.

### ADR — `{ruta de ADRs según domain.md}/{NNNN-slug}.md`

```markdown
{contenido completo del ADR}
```

### Glosario — `{ruta del CONTEXT.md}`

Agregar estas entradas (merge aditivo, no pisar):

```markdown
{entradas de glosario agregadas}
```
````

## `[QA]` — cuerpo del issue (paso 6)

```markdown
## Parent

{link/ID de la tarea padre}

## Plan de QA manual

Verificación humana de todo lo construido en los slices. Para cada item: pasos, dato/estado esperado, y cómo confirmarlo.

- [ ] {Item 1: qué verificar — pasos concretos — resultado esperado}
- [ ] {Item 2: ...}
- [ ] {Item N: ...}

## Blocked by

- Todos los slices de esta tarea (este issue es el último del grafo).
```

## Bloque de descripción del padre (paso 7)

Se **agrega** al final de la descripción existente (no la pises). **No** lleva línea de rama: `work-task` agrega después a este mismo bloque la línea `- Rama: \`{branch}\`` cuando crea la rama.

```markdown
## Planificado

{1-2 frases de qué se va a construir.}

- Spec: {spec-issue-id / link}
- Docs: {docs-issue-id / link, o "—" si grill no tocó docs}
- Issues hijos ({n}): {lista de IDs/links}
- QA: {qa-issue-id / link}
```
