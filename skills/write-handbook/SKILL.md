---
name: write-handbook
description: Crear o actualizar una página del Handbook — la documentación de plataforma que se renderiza read-only en el ADM. Usar cuando un cambio afecta lo que un admin ve, opera o usa en la plataforma (feature del ADM, flujo de configuración de tenant, runbook operativo, comportamiento visible). Para convenciones/patrones que sólo importan a un dev leyendo el código, usar create-doc, no esta skill.
---

El **Handbook** es la documentación de la plataforma versionada en git y renderizada read-only en el ADM (`auth:admin`), distinta de la Wiki-IA por entidad. Vive en `src/resources/handbook/{categoría}/{página}.md`, un nivel de profundidad. El _por qué_ de estas reglas está en `docs/adr/0031-handbook-git-backed-markdown-rendered-read-only-in-adm.md`; acá está el _cómo_ de escribir una página válida.

## Qué va en el Handbook

El discriminador, una sola pregunta:

> ¿Lo necesita un **dev leyendo el código** (convención, patrón, decisión técnica) → `create-doc`, carpeta `docs/`? ¿O lo necesita un **admin operando o usando la plataforma** (feature del ADM, flujo de configuración, runbook, comportamiento visible) → **Handbook**?

Los dos ejes pueden co-disparar: una feature nueva del ADM puede merecer una convención en `docs/` _y_ una página de Handbook. No son mutuamente excluyentes.

## Steps

1. **Escanear el árbol antes de escribir.** Listá `src/resources/handbook/` para conocer las categorías (`{prefijo-numérico}-{slug}/`) y páginas existentes. Sin este mapa no podés decidir crear-vs-actualizar ni ubicar la categoría correcta. Completion: tenés el árbol actual en contexto.

2. **Decidir crear o actualizar.** Si ya existe una página cuyo tema cubre el cambio → actualizala preservando su estructura y su frontmatter. Si no existe tema afín → creá una página nueva en la categoría que corresponda; si ninguna categoría encaja, creá una nueva carpeta `{NN}-{slug}` con prefijo numérico que la ordene en el sidebar. Completion: tenés ruta destino exacta y sabés si es alta o edición.

3. **Confirmar la ruta destino con el usuario** en texto plano antes de escribir (categoría + nombre de archivo, y si es alta o edición). Esperá el OK.

4. **Escribir la página** cumpliendo todas las convenciones de formato:
   - Frontmatter obligatorio: `title` (título legible, en español) y `order` (entero; siguiente hueco en la categoría, o el existente si es edición).
   - Nombre de archivo en kebab-case con prefijo numérico (`03-configuracion-clm.md`); el slug de la URL se deriva descartando el prefijo.
   - **Contenido en español** — el Handbook es documentación de plataforma para admins.
   - Links a otras páginas: rutas relativas al `.md` (`./02-navegacion.md`, `../otra-categoria/pagina.md`); se reescriben a URLs del ADM al renderizar.
   - Imágenes/assets: archivo junto al `.md`, referenciado relativo (`![alt](./diagrama.png)`).
   - Markdown que renderiza vía `Str::markdown()` (GFM: headings, listas, tablas, code, blockquote). HTML crudo permitido (fuente confiable), sin agregar clases de estilo — el CSS `.handbook-content` ya estiliza.
   Completion: la página existe en la ruta confirmada con frontmatter y contenido en español.

5. **Verificar que la página es renderizable**, no sólo que el archivo existe: frontmatter `title`+`order` presentes y parseables, cada link relativo `.md` resuelve a una página real del árbol, cada imagen referenciada existe en disco junto al `.md`. Corregí cualquier link o asset roto. Completion: ningún link ni imagen apunta a algo inexistente.

## Rules

- Contenido del Handbook siempre en **español**; el nombre de archivo, el frontmatter `title` en español, y la prosa en español.
- Nunca más de un nivel de profundidad: `{categoría}/{página}.md`. No hay subcategorías.
- No dupliques una página existente por no haber escaneado el árbol (step 1) — actualizá la que ya cubre el tema.
- No agregues estilos inline ni clases: el render los ignora y el CSS del ADM ya resuelve la presentación.
