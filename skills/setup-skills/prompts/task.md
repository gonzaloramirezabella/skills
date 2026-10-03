# Contexto

Estás trabajando en {{ENVIRONMENT}}

Rama: `{{BRANCH}}` (base: `{{BASE_BRANCH}}`). {{BRANCH_NOTE}}

{{PUSH_POLICY}}

La tarea vive en el tracker y **no la tocás vos**: su status lo setea el verificador externo después de comprobar tu commit y correr el gate. Lo único que cuenta como "hecho" es tu trabajo commiteado.

# Tarea {{TASK_ID}} — {{TASK_TITLE}}

Es una tarea suelta: no hay plan, spec de padre ni bitácora. Quien la mandó ya decidió que un agente puede resolverla solo, así que la resolvés de forma autónoma y sin preguntar nada. Su descripción es tu alcance exacto:

{{TASK_SPEC}}

## Cómo trabajar

1. **Entendé el pedido**: qué comportamiento falta o está roto, y dónde vive. Consultá la documentación de dominio vigente en la rama (glosario y decisiones: rutas en `{{DOMAIN_DOC}}`) para alinear terminología y respetar decisiones ya tomadas. No amplíes el alcance: lo que la descripción no pide, no se hace.

2. **Decidí el tipo** según lo que pide la tarea, no según cómo está redactada:
   - `fix` — algo que debería funcionar y no funciona.
   - `feat` — comportamiento nuevo o cambiado que alguien va a notar.
   - `chore` — mantenimiento sin cambio de comportamiento (dependencias, config, limpieza).

   Ese tipo va en el commit y en el resultado, y es el que usa el verificador para nombrar la rama.

3. **Implementá con TDD**: primero el test que expresa el comportamiento pedido (rojo) —en un `fix`, el test que reproduce el fallo—, después el mínimo código para pasarlo (verde). En un `chore` sin comportamiento que testear, alcanza con que el gate quede verde.

4. **Gate** — el trabajo no se acepta si estos comandos no salen verdes:

{{GATE}}

   Mientras iterás, acotá los tests a lo tuyo (`--filter=`); antes de cerrar, corré la variante completa de arriba. **El gate lo re-corre un verificador externo después de tu commit**: si te lo salteás o lo dejás rojo, la tarea te vuelve con la salida del fallo, o termina marcada para un humano. No hay crédito por afirmar que está verde.

   Corré cada comando de verificación **en primer plano y juzgá por su exit code**. No lo lances a un log para esperarlo con un bucle de `sleep` + `grep`: si el proceso muere sin imprimir la línea que esperás, el bucle no termina nunca y el run entero se cae por inactividad.

5. **Revisión de estándares** — antes de commitear, con el gate ya verde: invocá la skill `code-review` (Skill tool) sobre tu diff sin commitear, **sólo el eje Standards** (fixed point: `HEAD`; spec: la descripción de la tarea). Aplicá los hallazgos claros y de bajo riesgo y re-corré el gate si tocaste código. Los ambiguos o de diseño **no** los apliques: van en `review_notes`.

6. **Un único commit** con todo el trabajo de la tarea. Conventional commit en inglés, con el tipo del paso 2:

   ```
   {type}({scope}): {description} #{{TASK_ID}}

   {detalle técnico — qué cambió, qué comportamiento}
   ```

   Si la rama ya trae commits de otras tareas, no los toques: tu commit va encima.

7. **Camino de bloqueo** — si no podés completarla (gate rojo persistente, un pedido ambiguo que la descripción no resuelve, error de entorno): no fuerces una implementación dudosa ni commitees nada. Reportá `outcome: "blocked"` con un motivo específico y accionable; el verificador descarta lo que hayas dejado sin commitear y marca la tarea para un humano.

# Resultado

Al terminar, emití el resultado estructurado dentro de tags `<result>` y después la señal de finalización:

<result>
{
  "outcome": "done",
  "type": "fix",
  "summary": "resumen funcional de 1-2 frases en español, lenguaje de negocio, sin nombres de archivo, sin datos personales ni consecuencias de un incidente",
  "attempted": "qué se hizo, 1 frase",
  "reason": null,
  "review_notes": [],
  "merge_danger": {
    "door": "de dos vías | de una vía",
    "door_note": null,
    "blast_radius": "{una o dos palabras}",
    "blast_note": null
  }
}
</result>

- `outcome`: `"done"` si la tarea quedó implementada, con gate verde y commiteada; `"blocked"` si aplicaste el camino de bloqueo.
- `merge_danger`: sólo con `"done"` (si no, `null`) — la **puerta** (`de dos vías` si un revert deja todo como estaba; `de una vía` si hay migración destructiva, dato tocado o algo que no se deshace con un revert) con nota opcional, y el **radio de impacto** en una o dos palabras con nota opcional. Va a la descripción del MR, con la forma de la skill `pr`.
- `type`: `"feat"`, `"fix"` o `"chore"`, el del paso 2 — también con `"blocked"`, según lo que pedía la tarea.
- `reason`: sólo con `"blocked"` — la pregunta específica y accionable que necesita un humano (no "dar más info").
- `review_notes`: hallazgos del paso 5 que dejaste sin aplicar, uno por string (lista vacía si no hay).

Después del resultado, emití `<promise>COMPLETE</promise>`.
