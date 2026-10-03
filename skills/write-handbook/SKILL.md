---
name: write-handbook
model: sonnet
description: Crear o actualizar una página del Handbook — la documentación de operación que leen los admins/operadores de la plataforma. Usar cuando un cambio afecta lo que un admin ve, opera o usa (feature visible, flujo de configuración, runbook). La ubicación, formato e idioma del Handbook del repo están en la sección Handbook de docs/agents/task-workflow.md.
---

El **Handbook** es la documentación de operación del repo: la leen admins/operadores de la plataforma, no entra en detalles de implementación. Dónde vive, cómo se formatea una página y en qué idioma se escribe **no está acá**: lo define la sección **Handbook** de `docs/agents/task-workflow.md` del repo. Esta skill trae el _cómo_ genérico; los valores concretos salen de esa config.

## Qué va en el Handbook

El discriminador, una sola pregunta:

> ¿Lo necesita un **dev leyendo el código** (convención, patrón, decisión técnica) → docs técnicas del repo? ¿O lo necesita un **admin operando o usando la plataforma** (feature visible, flujo de configuración, runbook, comportamiento observable) → **Handbook**?

Los dos ejes pueden co-disparar: una feature nueva puede merecer una convención en docs técnicas _y_ una página de Handbook. No son mutuamente excluyentes.

## Steps

1. **Leer la config.** Abrí `docs/agents/task-workflow.md` y localizá la sección **Handbook**: de ahí salen la **ruta raíz**, la **estructura** (profundidad, naming de carpetas/archivos), el **formato de página** (frontmatter obligatorio, links, assets, restricciones de render), el **idioma** y —si existe— el doc de _rationale_ (leelo si algo del formato te resulta sorprendente). Si la sección no existe, esta skill no aplica en este repo: avisá al usuario y sugerí correr `/setup-skills` si quiere configurarla. Completion: tenés los valores concretos del repo en contexto.

2. **Escanear el árbol antes de escribir.** Listá la ruta raíz para conocer las categorías y páginas existentes. Sin este mapa no podés decidir crear-vs-actualizar ni ubicar la categoría correcta. Completion: tenés el árbol actual en contexto.

3. **Decidir crear o actualizar.** Si ya existe una página cuyo tema cubre el cambio → actualizala preservando su estructura y su frontmatter. Si no existe tema afín → creá una página nueva en la categoría que corresponda; si ninguna categoría encaja, creá una nueva siguiendo el naming de carpetas de la config. Completion: tenés ruta destino exacta y sabés si es alta o edición.

4. **Confirmar la ruta destino con el usuario** en texto plano antes de escribir (categoría + nombre de archivo, y si es alta o edición). Esperá el OK.

5. **Escribir la página** cumpliendo el formato de la config del paso 1: naming de archivo, idioma, forma de los links entre páginas y de los assets. Poné en el frontmatter la **fecha de la edición** (fecha de hoy, en el campo que la config nombre) tanto al crear como al actualizar, para que se sepa cuándo se tocó la página. Si la config indica que la página se renderiza en el panel con un índice por secciones, estructurá el cuerpo en consecuencia: un único título de nivel superior en la primera línea, y una sección por cada bloque navegable (los encabezados de sección son las entradas del índice). Completion: la página existe en la ruta confirmada, en el idioma configurado, con la fecha de hoy en el frontmatter y con la estructura de secciones que pide la config.

6. **Capturar la pantalla cuando lo que documentás es visual.** Si el bloque describe algo que el admin _ve y opera_ (una pantalla, un formulario de configuración, un flujo con UI), levantá la app y capturá la pantalla real, guardala en la ubicación de assets de la config e incrustala junto a la prosa que la explica. Si el bloque es de arquitectura, decisiones técnicas o comportamiento sin superficie visual, no fuerces una captura: no aporta. Completion: cada bloque con superficie visual tiene su captura incrustada y los bloques sin UI quedan sólo en prosa.

7. **Registrar la página donde la config lo indique.** Si el Handbook del repo se sirve desde el panel (o desde cualquier índice/navegación con orden explícito), añadí el slug de la página nueva al registro de orden que señale la config (p. ej. un `config/*.php`) en la posición que corresponda. Si es una edición de una página existente, salteá este paso. Completion: la página aparecerá en la navegación en el orden correcto.

8. **Verificar que la página es renderizable**, no sólo que el archivo existe: cada link relativo a otra página resuelve a una página real del árbol, cada imagen y captura referenciada existe en la ubicación de assets que indique la config (para que el render pueda mostrarla/incrustarla), y —si el repo la sirve en el panel— la página se ve en el panel (grupo/navegación que indique la config) con su índice listando las secciones esperadas. Corregí cualquier link o asset roto. Completion: ningún link, imagen ni captura apunta a algo inexistente y, si aplica, la página renderiza en el panel.

## Rules

- Los valores concretos (ruta, formato, idioma, dónde se renderiza, registro de orden) salen **siempre** de la sección Handbook de `task-workflow.md` — no los inventes ni los recuerdes de otro repo.
- No dupliques una página existente por no haber escaneado el árbol (step 2) — actualizá la que ya cubre el tema.
- Usá sólo las features de markdown que el render del repo soporta (lo lista la config): la estructura expresiva es markdown —encabezados, listas, tablas, código, énfasis, anclas internas—. El HTML crudo suele escaparse por seguridad, y algunos renders no sirven imágenes ni reescriben enlaces entre páginas: si la config las marca como no soportadas, no dependas de ellas (el contenido saldría roto o escapado).
- Estructurá siempre en secciones con encabezados claros: cuando el Handbook se sirve con índice, cada encabezado de sección es una entrada navegable, así que un buen esqueleto de H2/H3 es parte del formato, no un extra.
- Toda página lleva la **fecha de la edición** en el frontmatter, tanto al crearla como al actualizarla — es lo que dice cuándo se tocó el documento. El nombre exacto del campo sale de la config; el valor es siempre la fecha de hoy.
- La **captura de pantalla** acompaña sólo a lo que el admin ve y opera (pantallas, formularios de configuración, flujos con UI); en bloques de arquitectura o técnicos sin superficie visual no va — sería ruido.
- El contenido que cambia con el sistema (versiones, estados, conteos) va en un **bloque dinámico** si la config los define (línea "Dynamic blocks" de la sección Handbook): el markdown queda con la prosa estable y el bloque lo renderiza la app en runtime. Si el repo no soporta bloques dinámicos, acompañá el dato volátil con la fecha de la comprobación.
