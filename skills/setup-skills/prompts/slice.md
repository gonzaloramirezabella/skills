# Contexto

Estás trabajando en {{ENVIRONMENT}}

Rama: `{{BRANCH}}` (base: `{{BASE_BRANCH}}`).

{{PUSH_POLICY}}

El plan vive en el tracker y **no lo tocás vos**: el status del slice lo setea el verificador externo después de comprobar tu commit y correr el gate. Lo único que cuenta como "hecho" es tu trabajo commiteado y pusheado.

# Tarea: slice {{SLICE_ID}} — {{SLICE_TITLE}}

Sos responsable de implementar UN slice de trabajo, de forma autónoma y sin preguntar nada.

- **Spec del padre**: `{{SPEC_FILE}}` — leelo primero.
- **Spec de este slice** — tu alcance exacto:

{{SLICE_SPEC}}

## Cómo trabajar

1. **Planificá desde el spec**: plan corto — comportamientos a testear, archivos/áreas a tocar, enfoque en 1-2 frases. Antes de planificar consultá la documentación de dominio vigente en la rama (glosario y decisiones: rutas en `{{DOMAIN_DOC}}`) para alinear terminología y respetar decisiones ya tomadas. Registrá el plan en la bitácora `{{WORK_LOG}}`: agregá (o actualizá) el bloque de este slice con el formato:

   ```markdown
   ## {{SLICE_ID}} — {{SLICE_TITLE}}
   Estado: ⏳ en progreso
   Plan:
   - Comportamientos: ...
   - Archivos/áreas: ...
   - Enfoque: ...
   Resultado: pendiente
   ```

   Si el archivo no existe, crealo con el header `# Work — {{PARENT_ID}}` y la rama.

2. **Implementá con TDD**: primero el test que expresa el comportamiento del spec (rojo), después el mínimo código para pasarlo (verde). Iterá comportamiento por comportamiento. Las seams y las decisiones de diseño ya están tomadas en los specs de arriba — no reinterpretes el alcance ni pidas OK.

   **Si el slice es documentación ya decidida** (una hija `[DOCS]`: su cuerpo trae el contenido literal), aplicalo tal como indica su cuerpo — ADRs verbatim, glosario por merge aditivo idempotente, sin pisar entradas existentes — y salteá este paso y el 4; el gate y el commit corren igual, con mensaje `docs(glossary): apply planned glossary and ADR updates #{{PARENT_ID}}`.

3. **Gate** — el trabajo no se acepta si estos comandos no salen verdes:

{{GATE}}

   Mientras iterás, acotá los tests a lo tuyo (`--filter=`); antes de cerrar, corré la variante completa de arriba. **El gate lo re-corre un verificador externo después de tu commit**: si te lo salteás o lo dejás rojo, el slice te vuelve con la salida del fallo, o termina marcado para un humano. No hay crédito por afirmar que está verde.

   Corré cada comando de verificación **en primer plano y juzgá por su exit code**. No lo lances a un log para esperarlo con un bucle de `sleep` + `grep`: si el proceso muere sin imprimir la línea que esperás, el bucle no termina nunca y el run entero se cae por inactividad. Si un comando largo lo pide, usá un timeout explícito y comprobá que el proceso siga vivo.

4. **No revises tus propios estándares.** Tu trabajo es que funcione y pase el gate; la revisión de estándares (`CODING_STANDARDS.md`, code smells, naming) la hace un revisor aparte al cierre del padre, con contexto fresco, y aplica sus fixes él. No invoques `code-review` ni te desvíes a refactorizar lo que no pide el slice.

5. **Un único commit** con todo el trabajo del slice, incluida la bitácora actualizada (`Estado: ✅ hecho`, `Resultado: {resumen}`).

   Conventional commit en inglés, tipo según el prefijo de la rama (`feature/`→`feat`, `fix/`→`fix`, `chore/`→`chore`):

   ```
   {type}({scope}): {description} #{{PARENT_ID}}

   {detalle técnico — qué cambió, qué comportamiento}
   ```

6. **Camino de bloqueo** — si no podés completar el slice (gate rojo persistente, ambigüedad que el spec no resuelve, error de entorno): no fuerces una implementación dudosa. Actualizá la bitácora (`Estado: ⚠️ needs-info` con el motivo), commiteá sólo ese archivo, y reportá `outcome: "blocked"` en el resultado con un motivo específico y accionable — el verificador externo se encarga de marcar el slice en el tracker.

# Resultado

Al terminar, emití el resultado estructurado dentro de tags `<result>` y después la señal de finalización:

<result>
{
  "outcome": "done",
  "summary": "resumen funcional de 1-2 frases en español, lenguaje de negocio, sin nombres de archivo, sin datos personales ni consecuencias de un incidente",
  "attempted": "qué se hizo, 1 frase",
  "reason": null
}
</result>

- `outcome`: `"done"` si el slice quedó implementado, con gate verde y commiteado; `"blocked"` si aplicaste el camino de bloqueo.
- `reason`: sólo con `"blocked"` — la pregunta específica y accionable que necesita un humano (no "dar más info").

Después del resultado, emití `<promise>COMPLETE</promise>`.
