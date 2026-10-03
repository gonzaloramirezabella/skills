---
name: qa-task
model: sonnet
description: Correr a mano la fase de QA de un padre — ejecutar el mandato canónico de QA en local sobre la hija [QA] del tracker, persistir los veredictos en su descripción y crear una hija [FIX] por cada fallo, lista para que work-task la drene. Acepta el ID del padre.
disable-model-invocation: true
---

# Correr la fase de QA a mano

La fase de QA ya forma parte del flujo: `work-task` y el worker automatizado la corren solos antes del cierre (mandato canónico, veredictos en la hija `[QA]`, una hija `[FIX]` por fallo, re-verificación). Esta skill es la **misma fase, lanzada por un humano**: para un padre que cerró sin QA (repo sin mandato declarado, drenaje viejo), para re-verificar después de arreglar algo a mano, o para drenar los items que quedaron 🙋 con el humano al lado.

**Nada de este repo está escrito acá.** Config en `docs/agents/`, leída al arrancar: `task-workflow.md` (sección *QA*: carriles, ciclos, credenciales, bloque **Host** con el comando que levanta la app y su URL; sección *Paths*: la línea *QA mandate*; tabla de statuses) e `issue-tracker.md` (mapa de comandos: *get task (full description)*, *list subtasks*, *replace description*, *create child task*, *add tag*, *set status*, *comment*).

**Principio rector: veredicto con evidencia.** El mandato lo dice y acá se repite porque es lo único que no se negocia: un item se marca por comportamiento observado, nunca por inferencia.

## Pasos

### 1. Resolver el plan de QA

Con el Task ID del padre:

- *Get task (full description)* del padre: de ahí sale la rama (bloque `- Rama:`).
- *List subtasks*: la hija con prefijo `[QA]` y su descripción completa (es el checklist, con los veredictos que ya tenga).
- Sin hija `[QA]` → parar: "El padre `{id}` no tiene plan de QA — corré `plan-task` primero."
- Sin línea *QA mandate* en `task-workflow.md` → parar: "Este repo no declara mandato de QA — corré `setup-skills` (D4)."

### 2. Gates de arranque

1. **Working tree limpio**: `git status --porcelain` vacío. Con cambios sin commitear → parar: el QA hace checkout de otra rama.
2. **Rama del padre**: `git fetch origin {branch}`, checkout, pull. Si la rama ya no existe (MR mergeado) → preguntá en texto plano si corrés sobre la rama base o abortás.
3. **App levantada**: corré los comandos del bloque **Host** de la sección *QA* y esperá a que la URL de host responda. Si el diff contra la base trae migraciones, aplicalas con el comando de *Environment*.
4. **Navegador**: `playwright-cli --version`. Si falta, no pares: los items de pantalla salen 🙋 (es lo que fija el carril). Avisá una línea.

### 3. Ejecutar el mandato en un subagente

Leé el archivo de la línea *QA mandate* y sustituí sus placeholders (tabla en `work-task/REFERENCE.md` § *Mandato de QA — sustituciones*, columna in-session; el checklist se le pasa con los items pendientes numerados y los ya resueltos tachados — regla de re-corrida en `task-workflow.md` § *QA*). Pegá el resultado en el prompt de un subagente `general-purpose` y parseá su bloque `<qa>`. Si devolvió archivos modificados, descartalos (`git checkout -- . && git clean -fd`): el mandato es sólo lectura.

Si estás con el humano al lado y hay items 🙋, ofrecé drenarlos juntos: vos corrés lo que se pueda, él mira lo subjetivo, y registrás su veredicto como `✅ humano: {evidencia}` — es el único caso en que un 🙋 cambia de estado.

### 4. Persistir — lo hacés vos, no el subagente

Editá la **descripción de la hija `[QA]`** (traela completa, editala local, subila entera con *replace description* — es destructiva), escribiendo bajo cada item reportado su línea de veredicto con el formato exacto de `task-workflow.md` § *QA* (`→ ✅ agente:` con `- [x]`; `→ ❌ FALLÓ:` y `→ 🙋 humano:` con `- [ ]`). Lo no reportado queda como estaba.

Por cada ❌: *create child task* del padre con nombre `[FIX] {texto del item}`, tag `ready-for-agent` (*add tag*), status *backlog* (*set status*), y descripción = esperado vs observado + pasos para reproducir + criterio de aceptación («el item vuelve a pasar en la siguiente corrida de QA»). Es un slice más: lo drena `work-task` (o el worker) con el mismo mandato y el mismo gate, y re-corre esta fase al terminar.

Comentario roll-up en la **misma hija `[QA]`** (*comment*), en español: totales por veredicto, cada fallo con su hija `[FIX]`, y la lista para el humano con sus pasos.

Al terminar, `playwright-cli close` si lo abriste, y volvé a la rama en la que estabas.

### 5. Resumen final

```
🧪 QA hija [QA] {qa-id} — {título del padre}
✅ Verificados: {n}
❌ Fallos: {n} → hijas [FIX]: {ids}
🙋 Para humano: {n}  {lista breve}
Rama: {branch}
Siguiente paso: {"work-task {parent-id} drena los [FIX] y re-verifica" | "nada: todo verde" | "quedan 🙋 para el humano"}
```

## Invariantes

- Veredicto sólo por evidencia observada; la lectura de código orienta, jamás reemplaza.
- qa-task **no toca código ni commitea nada**; los fallos se reportan como `[FIX]`, no se arreglan acá.
- Reentrante: una re-corrida procesa sólo los items sin `- [x]` ni 🙋 (los ❌ se re-verifican).
- El tracker lo escribe esta skill (el orquestador), nunca el subagente que verificó.
- Si un checkout o pull falla → parar y reportar. Nunca `--force`.
