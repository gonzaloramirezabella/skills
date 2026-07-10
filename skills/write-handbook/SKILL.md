---
name: write-handbook
description: Crear o actualizar una página del Handbook — la documentación de operación que leen los admins/operadores de la plataforma, no los devs. Usar cuando un cambio afecta lo que un admin ve, opera o usa (feature visible, flujo de configuración, runbook). La ubicación, formato e idioma del Handbook del repo están en la sección Handbook de docs/agents/task-workflow.md. Para convenciones/patrones que sólo importan a un dev leyendo el código, usar la skill de docs técnicas del repo, no esta.
---

El **Handbook** es la documentación de operación del repo: la leen admins/operadores de la plataforma, no devs. Dónde vive, cómo se formatea una página y en qué idioma se escribe **no está acá**: lo define la sección **Handbook** de `docs/agents/task-workflow.md` del repo. Esta skill trae el _cómo_ genérico; los valores concretos salen de esa config.

## Qué va en el Handbook

El discriminador, una sola pregunta:

> ¿Lo necesita un **dev leyendo el código** (convención, patrón, decisión técnica) → docs técnicas del repo? ¿O lo necesita un **admin operando o usando la plataforma** (feature visible, flujo de configuración, runbook, comportamiento observable) → **Handbook**?

Los dos ejes pueden co-disparar: una feature nueva puede merecer una convención en docs técnicas _y_ una página de Handbook. No son mutuamente excluyentes.

## Steps

1. **Leer la config.** Abrí `docs/agents/task-workflow.md` y localizá la sección **Handbook**: de ahí salen la **ruta raíz**, la **estructura** (profundidad, naming de carpetas/archivos), el **formato de página** (frontmatter obligatorio, links, assets, restricciones de render), el **idioma** y —si existe— el doc de _rationale_ (leelo si algo del formato te resulta sorprendente). Si la sección no existe, esta skill no aplica en este repo: avisá al usuario y sugerí correr `/setup-gon-skills` si quiere configurarla. Completion: tenés los valores concretos del repo en contexto.

2. **Escanear el árbol antes de escribir.** Listá la ruta raíz para conocer las categorías y páginas existentes. Sin este mapa no podés decidir crear-vs-actualizar ni ubicar la categoría correcta. Completion: tenés el árbol actual en contexto.

3. **Decidir crear o actualizar.** Si ya existe una página cuyo tema cubre el cambio → actualizala preservando su estructura y su frontmatter. Si no existe tema afín → creá una página nueva en la categoría que corresponda; si ninguna categoría encaja, creá una nueva siguiendo el naming de carpetas de la config. Completion: tenés ruta destino exacta y sabés si es alta o edición.

4. **Confirmar la ruta destino con el usuario** en texto plano antes de escribir (categoría + nombre de archivo, y si es alta o edición). Esperá el OK.

5. **Escribir la página** cumpliendo el formato de la config del paso 1: frontmatter obligatorio, naming de archivo, idioma, forma de los links entre páginas y de los assets. Completion: la página existe en la ruta confirmada, con frontmatter válido y en el idioma configurado.

6. **Verificar que la página es renderizable**, no sólo que el archivo existe: frontmatter presente y parseable, cada link relativo a otra página resuelve a una página real del árbol, cada imagen referenciada existe en disco junto al `.md`. Corregí cualquier link o asset roto. Completion: ningún link ni imagen apunta a algo inexistente.

## Rules

- Los valores concretos (ruta, formato, idioma) salen **siempre** de la sección Handbook de `task-workflow.md` — no los inventes ni los recuerdes de otro repo.
- No dupliques una página existente por no haber escaneado el árbol (step 2) — actualizá la que ya cubre el tema.
- No agregues presentación que el render del repo no soporte (estilos inline, clases): si la config no lo permite explícitamente, markdown plano.
