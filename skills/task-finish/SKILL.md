---
name: task-finish
description: Cerrar una tarea — commit aprobado, push, MR con el CLI del repo y comentario funcional en el tracker. No modifica el status.
disable-model-invocation: true
---

Cierra una tarea: stage + commit (conventional commits) + push + MR + comentario funcional en el tracker. **No cambia el status** — eso lo hace el usuario.

Config por repo en `docs/agents/`, leída al arrancar: `task-workflow.md` (rama base, naming de ramas, *MR CLI*, URL web de MR nuevo, ruteo de documentación) e `issue-tracker.md` (mapa de comandos: *get task (fields)*, *comment*, *task web URL*).

## Steps

1. **Validar estado inicial.**
   - `git status` para confirmar que hay cambios.
   - `git branch --show-current` para obtener la rama.
   - Si la rama es la base o la default del repo (`task-workflow.md`): detener con mensaje "No se puede cerrar ticket desde `{branch}`. Debés estar en una rama de trabajo.".

2. **Extraer Task ID.**
   - Si los `args` lo contienen, usarlo.
   - Si no, extraerlo del nombre de la rama (`feature/abc123-desc` → `abc123`).
   - Si no se puede, pedírselo al usuario en texto plano y esperar la respuesta.

3. **Cargar contexto de la tarea.** Operación *get task (fields)* (sólo lectura).

4. **Generar conventional commit.** Mapear prefijo de rama a tipo:
   - `feature/` → `feat`
   - `fix/` → `fix`
   - `chore/` → `chore`
   - `hotfix/` → `fix`

   Analizar cambios con `git diff --cached` y `git diff` para inferir scope (el área principal que toca) y descripción concisa.

   Formato:
   ```
   {type}({scope}): {description} #{TASK_ID}

   {detalle técnico — qué archivos, qué cambió, qué comportamiento}
   ```

   Presentar el mensaje al usuario y preguntarle en texto plano: "¿Aprobás este mensaje de commit?". Esperar aprobación explícita antes de seguir.

5. **Stage, commit y push.**
   - Stage selectivo (preferir archivos específicos; `git add -A` sólo si los cambios son intencionalmente amplios).
   - Commit via HEREDOC para preservar formato:
     ```
     git commit -m "$(cat <<'EOF'
     {commit message}
     EOF
     )"
     ```
   - `git push -u origin {branch}`.

6. **Crear el MR con el *MR CLI*.** Target según `task-workflow.md` (la base para las ramas de trabajo, y lo que ese archivo indique para `hotfix/`).

   Preparar título y descripción. La descripción tiene la forma de la skill `pr` —invocala (Skill tool) para elegir el visual del resumen— con los encabezados en español de España, igual que los MR de `work-task`:
   ```
   Título:  {type}({scope}): {description}

   Descripción:
   ## Resumen
   {el visual mínimo que explica el cambio: lista, diff de árbol, call tree o pseudocódigo}

   ## Evidencia
   - **Antes:** {síntoma o ausencia, como lo ve un usuario}
     **Después:** {test que ahora pasa, salida, o gate verde sobre `{hash}` con sus comandos}

   ## Riesgo de merge
   **Puerta:** {de dos vías | de una vía}

   **Radio de impacto:** {una o dos palabras, con nota opcional}

   ## Tarea
   {URL de la tarea — operación *task web URL*}
   ```

   Preguntar en texto plano: "¿Creo el MR ahora con el CLI, o sólo te imprimo el link?" y esperar la respuesta.
   - **Sí, crear MR** — ejecutar el `mr create` del CLI y mostrar URL.
   - **No, solo el link** — imprimir URL manual y continuar.

   Si el usuario elige **Sí**:
   ```
   {MR CLI} mr create \
     --source-branch "{branch}" \
     --target-branch "{target}" \
     --title "{title}" \
     --description "$(cat <<'EOF'
   {descripción}
   EOF
   )" \
     --yes
   ```
   Mostrar la URL del MR que devuelve el CLI.

   Si el usuario elige **No**: imprimir el link armando la plantilla de URL web de `task-workflow.md` con `{branch}` y `{target}`.

7. **Comentar en la tarea.** Operación *comment*, con:
   ```
   Cambios realizados

   {Resumen funcional, no técnico, max 2 párrafos, qué se resolvió en términos de valor para el usuario. SIN nombres de archivos ni detalles técnicos; SIN datos personales ni descripción del daño de un incidente — `CODING_STANDARDS.md` § *Lo que no se escribe*, que aplica también al título y cuerpo del MR del paso 6.}

   Branch: {branch-name}
   ```

8. **Revisar necesidad de documentación (siempre).** La revisión corre en todo cierre; sólo aflora una pregunta cuando un eje dispara. Analizá el diff del step 4 y el título/descripción de la tarea contra dos ejes independientes que pueden co-disparar:

   Los ejes, sus señales y la skill productora de cada uno están en `task-workflow.md` § *Documentation routing* — leelo y evaluá cada eje contra el diff. Si ese archivo no tiene la sección, skip silencioso.

   Si **ningún** eje dispara (sólo tests, config, migraciones, traducciones, assets) → skip silencioso, continuar. Si dispara al menos uno, preguntar en texto plano listando los ejes activos y sus skills:
   ```
   ¿Esta tarea generó cambios que vale documentar?
   (Detecté: {ejes activos con su skill})

   - {eje} → {skill}
   - No, no hace falta documentar
   ```

   Invocá cada skill que el usuario seleccione (puede elegir ambas). Si elige "No" o no hay señales, continuar sin acción.

9. **Resumen final.**
   ```
   ✅ Cambios commiteados y pusheados a origin/{branch}
   🔀 MR: {URL del MR creado, o link manual si el usuario eligió No}
   💬 Tracker: comentario funcional agregado
   ⚠️  Recordá actualizar el status del ticket manualmente
   ```

## Rules

Reglas transversales que no viven en ningún paso:

- El comentario en el tracker es funcional (lenguaje de negocio, español); el commit message es técnico (inglés, conventional commits).
- Si el push falla (rama divergente, permisos), detener y reportar — no forzar.
