# Contexto

Estás trabajando en {{ENVIRONMENT}}

Rama: `{{BRANCH}}` (base: `{{BASE_BRANCH}}`). Todos los slices AFK del padre ya están implementados, commiteados y con el gate verde — pero **nadie revisó todavía sus estándares**: los implementadores sólo hicieron que funcione. Tu trabajo es el cierre del **padre completo**, una sola vez, antes de que un proceso externo abra el MR contra `{{BASE_BRANCH}}`.

{{PUSH_POLICY}}

**Todo lo que toques tiene que quedar commiteado.** El verificador externo exige el árbol limpio al terminar: si dejás cambios sin commitear no viajan en el MR, así que da el cierre por fallido y el padre no se cierra. No alcanza con declarar en `<close>` que aplicaste algo — vale el commit.

# Tarea: cerrar el padre {{PARENT_ID}} — {{PARENT_TITLE}}

Spec del padre: `{{SPEC_FILE}}` · bitácora: `{{WORK_LOG}}`.
Diff acumulado a revisar: `git diff origin/{{BASE_BRANCH}}...HEAD` · commits: `git log origin/{{BASE_BRANCH}}..HEAD --oneline`.

## 1. Code review de dos ejes

Invocá la skill `code-review` (Skill tool) con fixed point `origin/{{BASE_BRANCH}}` y spec `{{SPEC_FILE}}`. Corre autónoma, sin preguntas.

- **Standards**: es la **única** revisión de estándares del padre. `code-review` lee `CODING_STANDARDS.md` de la raíz; prestá atención a su sección *Lo que no se escribe* (datos personales o daño de un incidente en commits, bitácora o comentarios: bloqueante, se reescribe), a su sección *Tests* (asserts tautológicos, tests atados a la estructura, stubs que no pueden fallar) y a lo que sólo se ve en conjunto — duplicación entre slices, abstracciones a medio camino, naming inconsistente entre archivos de distintos slices.
- **Spec**: fidelidad del trabajo completo al spec — requisitos faltantes o parciales, y scope creep.

Para juzgar naming y terminología de dominio, el glosario y las decisiones vigentes están en las rutas que declara `{{DOMAIN_DOC}}`.

**El default es el commit, no el comentario**: accioná todo hallazgo claro y de riesgo acotado — el revisor humano recibe un artefacto terminado, no una lista de deberes. Sólo lo ambiguo o de diseño queda sin tocar y va en `findings_for_human`.

Si tocaste código, dejá el gate verde antes de commitear:

{{GATE}}

Commit (sólo si hubo cambios):

```
refactor({scope}): address code review findings #{{PARENT_ID}}
```

## 2. Handbook

Handbook habilitado en este repo: **{{HANDBOOK}}**. Si es `no`, salteá este paso en silencio y devolvé `handbook: null`.

Si es `yes`: leé la sección **Handbook** de `docs/agents/task-workflow.md` y evaluá su trigger contra el diff acumulado y el spec. Si no dispara → `handbook: null`, sin comentarios. Si dispara → invocá la skill productora que indica esa sección (Skill tool); su confirmación de ruta destino no corre acá: decidí la ruta vos según las reglas de la sección y seguí. Es idempotente: si la página ya existe, actualizala en vez de duplicarla.

Commit:

```
docs(handbook): {descripción} #{{PARENT_ID}}
```

## 3. Informe de cierre

Redactá el informe que va a leer **negocio** en el tracker: español, lenguaje funcional, sin nombres de archivos, clases ni comandos. Vos sos quien tiene el spec y el diff completo — nadie más puede escribirlo. El tipo lo da el prefijo de la rama:

- **`fix/`** — abrí con qué estaba pasando (el síntoma como lo ve un usuario) y su **causa raíz** en una frase de negocio neutra; si aporta, una línea de por qué no se notaba antes.
- **`feature/` / `chore/`** — abrí con qué se pidió y para qué; más corto que un fix (no hay causa que explicar).

Todo lo que redactás en este paso y en el 3b queda como registro permanente: sin datos personales (personas reales, emails, IDs de registros) y sin describir el daño de un incidente (qué quedó expuesto, a quién afectó, cuánto duró) — la sección *Lo que no se escribe* de `CODING_STANDARDS.md` manda, y aplica también a lo que ya venga escrito en commits o bitácora del diff: señalalo como hallazgo bloqueante en la review.

Formato exacto (un proceso externo lo publica bajo `## Resumen` en la descripción del padre y le agrega el bloque de estado — no incluyas rama, MR ni pendientes):

```markdown
{Apertura: 1-3 frases según el tipo de arriba.}

### Qué se hizo

- {un bullet por resultado funcional — qué cambia para quien usa la plataforma; ni slices ni archivos}

{Sólo si existe: "⚠️ {advertencia de puesta en producción — orden de deploy, migración, dato a tocar}".}
```

Además del informe, redactá el **comentario de cierre**: un único párrafo (2-4 frases) que diga qué funcionalidad quedó o qué se arregló — sin cómo, sin rama, sin archivos, sin pendientes. Es lo único que lee negocio en el feed de comentarios; quien quiera más abre la descripción.

## 3b. Riesgo de merge y evidencia — para el MR

Un proceso externo arma la descripción del MR con la forma de la skill `pr` (resumen, evidencia antes/después, riesgo de merge). Vos aportás, en español de España, lo que sólo se ve con el diff y el spec delante:

- **`evidence_before`**: una línea con el estado de partida — el síntoma tal como lo veía un usuario (fix) o lo que no existía (feature), sin consecuencias ni afectados. El «después» lo pone el verificador con el gate que corre él.
- **`merge_danger`**: la **puerta** (`de dos vías` si un revert deja todo como estaba; `de una vía` si hay migración destructiva, dato tocado, contrato publicado o algo que no se deshace con un revert) con una nota opcional de por qué, y el **radio de impacto** en una o dos palabras (qué parte de la plataforma se ve afectada si sale mal) con una nota opcional de ramificaciones (orden de deploy, consumidores, móvil).

## 4. Bitácora

Completá en el header de `{{WORK_LOG}}` las dos líneas del cierre, y commiteá con el commit del paso que corresponda (o uno propio `docs(work): cierre {{PARENT_ID}}`):

```
Handbook: ✅ {ruta} ({commit}) | — (sin señal)
Review: ✅ sin hallazgos | ✅ aplicado ({commit}) | ⚠️ {n} hallazgos anotados
```

# Resultado

<close>
{
  "review": "sin hallazgos | fixes aplicados ({commit}) | {n} hallazgos anotados para el revisor",
  "handbook": null,
  "findings_for_human": [],
  "report": "{el informe del paso 3, markdown completo en un string}",
  "comment": "{el párrafo del comentario de cierre, texto plano}",
  "evidence_before": "{una línea: el estado de partida}",
  "merge_danger": {
    "door": "de dos vías | de una vía",
    "door_note": null,
    "blast_radius": "{una o dos palabras}",
    "blast_note": null
  }
}
</close>

- `review`: una línea, en español, para la descripción del MR.
- `handbook`: la ruta de la página creada o actualizada, o `null` si no hubo señal.
- `findings_for_human`: hallazgos que dejaste sin aplicar, uno por string (lista vacía si no hay). Van a la descripción del MR, no al tracker.
- `report`: el informe de cierre del paso 3, tal cual (sin el heading `## Resumen`).
- `comment`: el párrafo único del comentario de cierre — sólo qué se hizo o arregló, a nivel funcional.
- `evidence_before` y `merge_danger`: lo del paso 3b, para la descripción del MR. Las notas (`door_note`, `blast_note`) van en `null` si no aportan.

Después del resultado, emití `<promise>COMPLETE</promise>`.
