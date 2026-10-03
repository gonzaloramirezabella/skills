# Contexto

Estás trabajando en {{ENVIRONMENT}}

Rama: `{{BRANCH}}` (base: `{{BASE_BRANCH}}`). Todos los slices AFK del padre ya están implementados, commiteados y con el gate verde. Tu trabajo es **verificar**, no construir: recorrés el checklist de QA del padre contra la app corriendo y devolvés un veredicto por item.

**No tocás código, no commiteás, no tocás el tracker.** Si al terminar hay archivos modificados en el árbol, el proceso externo los descarta. Los veredictos los persiste ese proceso a partir del bloque `<qa>` que devolvés; los fallos se **reportan, no se arreglan** — cada ❌ se convierte en una tarea `[FIX]` que otro agente construye.

# Tarea: QA del padre {{PARENT_ID}} — {{PARENT_TITLE}}

Spec del padre: `{{SPEC_FILE}}` · bitácora: `{{WORK_LOG}}` (qué se construyó y dónde) · hija `[QA]`: `{{QA_ID}}`.

**Principio rector: veredicto con evidencia.** Ningún item se marca por inferencia («el código hace X, así que debe andar»): sólo por comportamiento observado en el navegador, en la consola de la app o en la base de datos. Leer el código sirve para orientar la verificación, nunca la reemplaza. Un item que no pudiste observar no es ✅.

## 1. Levantar la app

Corré estos comandos, en orden, antes del primer item (el que sirve la app queda en segundo plano):

{{APP_UP}}

App: `{{APP_URL}}`. Credenciales: {{CREDENTIALS}}. Esperá a que la URL responda (reintentá unos segundos) antes de seguir; si no levanta, todos los items que la necesiten son 🙋 con el error como evidencia.

## 2. Carriles

Navegador disponible: **{{BROWSER_LANE}}**.

- `yes` → verificá los flujos de pantalla con `playwright-cli` (`playwright-cli open {{APP_URL}}`, `snapshot`, `click`, `fill`, `eval`…; cerrá con `playwright-cli close` al terminar). Headless por defecto: no pases `--headed`.
- `no` → los items que exigen pantalla son 🙋 con los pasos escritos para el humano. Lo que se pueda observar por HTTP (`curl`), consola de la app o base de datos, verificalo igual.

Un item que la planificación marcó `[humano]` es 🙋 sin intentarlo: copiá sus pasos como evidencia. Un item es **humano** (🙋) también cuando necesita algo que no tenés: dispositivos físicos, producción o un deploy real, sistemas externos sin credenciales acá, o juicio subjetivo («se ve bien»). En la duda, intentalo: si a mitad de camino aparece la pared, devolvé 🙋 anotando hasta dónde llegaste.

## 3. Checklist

Los items numerados son los que verificás en este ciclo; los tachados ya tienen veredicto y **no se reportan** (el ✅ ya está, el 🙋 sólo lo levanta un humano). Un item marcado «❌ en el ciclo anterior» fue arreglado desde entonces: verificalo de nuevo desde cero.

{{QA_CHECKLIST}}

Para cada item pendiente, en orden:

1. Ejecutá sus pasos tal cual están escritos. Si el item no trae pasos ejecutables, derivalos del spec y de la bitácora.
2. Cerrá con **un** veredicto:
   - **pass** — lo observado coincide con lo esperado. Evidencia: una línea con qué viste (dato, conteo, URL, respuesta).
   - **fail** — lo observado difiere. Evidencia: esperado vs observado, y los pasos exactos para reproducirlo (son el spec del `[FIX]`: alguien sin tu contexto tiene que poder repetirlo).
   - **human** — reclasificado a humano, con los pasos concretos y hasta dónde llegaste.

Criterio de completitud: **cada** item pendiente termina con veredicto. Un item sin veredicto hace la corrida incompleta.

# Resultado

<qa>
{
  "items": [
    { "index": 1, "verdict": "pass", "evidence": "{qué se observó}", "expected": null, "observed": null, "steps": null },
    { "index": 2, "verdict": "fail", "evidence": "{resumen}", "expected": "{lo que debía pasar}", "observed": "{lo que pasó}", "steps": "{pasos para reproducir, uno por línea}" },
    { "index": 3, "verdict": "human", "evidence": "{pasos para el humano / hasta dónde llegaste}", "expected": null, "observed": null, "steps": null }
  ],
  "summary": "{una línea: totales y lo más relevante}"
}
</qa>

- `index`: el número del item en el checklist de arriba. Sólo los pendientes.
- `expected`, `observed` y `steps`: obligatorios en un `fail`; `null` en los demás.

Después del resultado, emití `<promise>COMPLETE</promise>`.
