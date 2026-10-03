# Estándares de código

Reglas que el **revisor** (`code-review`, eje Standards) hace cumplir sobre un diff. Son las de juicio: lo mecánico (formato, estilo, tipos) lo decide el gate y no se repite acá — si una regla de este archivo se puede chequear con un linter, va al linter y se borra de acá. El agente que implementa **no** lee este archivo: implementa para que funcione, el revisor lo deja bien. `retro` propone cambios a este archivo cuando el revisor dejó pasar algo.

## Idioma

{Qué idioma llevan identificadores, comentarios, commits y MR; qué se queda en inglés (API del framework, columnas de terceros); si hay código viejo mezclado, desde qué fecha aplica lo nuevo y la regla de no unificar de paso. Borrá la sección si el repo va todo en inglés.}

## Términos del dominio

- Los nombres de dominio en código, tests y títulos usan el término canónico de `docs/GLOSSARY.md`, nunca uno de su lista *Evitar*.
- Un concepto nuevo que no está en el glosario es una señal: o se inventó un término que el proyecto no usa, o falta la entrada (y entonces va en una hija `[DOCS]`, no suelta en el diff).

## Tests

Un gate verde sólo vale si los tests pueden mentir poco. Tres mentiras que el revisor busca en cada test nuevo:

- **Tautológico**: el assert recomputa el valor esperado igual que el código (`expect(limit).toBe(LIMIT)`, un snapshot derivado a mano con la misma fórmula). Se reemplaza por un valor literal con sentido de negocio.
- **Sensible a la estructura**: prueba el orden de las líneas de un archivo, nombres internos, la forma de un módulo privado. Un rename o un reordenamiento sin cambio de comportamiento no debería romper tests. Se prueba por la interfaz pública del módulo (la *seam*), nunca por dentro.
- **Que no puede fallar**: la dependencia con modos de error reales está stubeada con métodos vacíos, o se mockea justo lo que se quiere probar. Si el stub no reproduce ningún fallo, el test no cubre nada. Fakes sólo para lo externo (red, reloj, terceros), nunca para el sujeto bajo prueba.

Además: sin mocks fuera de los archivos de test, y un test por comportamiento del spec, no por método.

## Lo que no se escribe

Commits, cuerpos y títulos de MR, nombres de rama, comentarios del tracker, bitácora y comentarios en código son registros permanentes y, en parte, visibles fuera del equipo. Dos cosas no van nunca ahí:

- **Datos personales**: nombres de clientes, pacientes, empleados o usuarios reales; emails, teléfonos, DNI, IPs de personas, IDs o filas de registros reales, extractos de datos de producción. Se describe el caso por su rol («un usuario con dos sesiones abiertas»), nunca por quién era.
- **Lo que compromete a la empresa**: la descripción de un incidente — qué dato quedó expuesto, a quién afectó, cuánto tiempo estuvo roto, qué obligación se incumplió. Se escribe el cambio, no el daño: «corrige la validación del alta», no «los pacientes de X recibieron el email de Y durante tres semanas». La causa raíz de un `fix/` se cuenta en términos técnicos o funcionales neutros («la validación aceptaba el campo vacío»), sin consecuencias.

El detalle que haga falta conservar va en una tarea privada del tracker, y el MR o el commit la enlazan y nada más. Una frase así en un diff, un commit o un MR es un hallazgo **bloqueante**: se reescribe antes de mergear.

## Forma

- Código autodocumentado: sin comentarios que expliquen *qué* hace una línea. Un comentario sólo vale si dice *por qué* algo no es lo obvio.
- Módulos profundos: interfaz chica, implementación escondida. Una función pública nueva que expone un detalle interno para que un test llegue a él es un hallazgo (vocabulario en la skill `codebase-design`).
- Términos inclusivos: `allowlist`/`blocklist`, `primary`/`replica`.
- Un slice, un commit, y la bitácora viaja con él. Un commit que mezcla dos slices o deja la bitácora para después es un hallazgo.
