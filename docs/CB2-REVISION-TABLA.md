# CB2: revisión en tabla compacta

Base: `67bf48a2`, main posterior a la fusión del PR #515. Rama: `feat/cb2-revision-tabla`.

## Presentación

La revisión compartida por Importar Excel e Historial conserva una tabla semántica en escritorio y móvil. Cada candidato ocupa una fila con selección, vale, fecha, placa/unidad, piloto original, empleado identificado, combustible, galones, monto, estado y acciones. Las apariciones repetidas siguen agrupadas con las reglas existentes; no se multiplican consumos ni importes.

El botón Editar abre una fila de detalle con controles existentes de unidad, empleado, combustible y justificación, además de estado, advertencias y evidencia. Cerrar o Escape ocultan el detalle sin limpiar decisiones; Escape devuelve el foco al botón. Se mantienen los controles montados mientras la fila está en la página. Las decisiones de negocio permanecen en sus estados originales, fuera del estado visual de apertura.

El texto original se distingue del empleado identificado, de la clasificación y de la procedencia automática/manual. Las advertencias completas y todas las apariciones siguen disponibles. Los mensajes de pendiente describen el dato a revisar sin cambiar qué permite confirmar.

Hay filas alternadas, cifras tabulares, encabezado fijo dentro de un contenedor con scroll, columna de selección y acciones fijas, filtros rápidos y filtros avanzados desplegables. El resumen usa los contadores existentes y añade el número de exclusiones explícitas. Los filtros rápidos se combinan con los filtros anteriores; Limpiar filtros restablece ambos grupos. No alteran selección, revisión, exclusiones ni decisiones. La paginación sigue siendo de 25 candidatos.

En móvil se conserva la tabla, con desplazamiento horizontal contenido y accesible por teclado: once columnas requieren ese desplazamiento para evitar textos truncados y controles diminutos. El editor pasa a una columna. No se convierten consumos en tarjetas. Las tarjetas superiores contienen únicamente contadores.

## Alcance

Solo componentes y estilos locales de CB2, pruebas de interfaz y esta documentación. No se crean componentes globales ni dependencias. No hay cambios en backend, contratos, payloads, parser, validaciones, permisos, recibos, claves de idempotencia, base de datos ni lógica de selección o coincidencias. AsignacionCB2 conserva los controles y callbacks; se retira únicamente su desplegable redundante porque ahora está dentro del editor de la fila.

## Verificación

- `npx.cmd tsc --noEmit --incremental false`.
- ESLint de todos los archivos TypeScript modificados.
- 30 archivos CB2, 256 pruebas automatizadas, excluyendo `*.db.test.ts` (revisión previa a fusión).
- Regresiones: once encabezados con scope, controles accesibles, editor inicialmente oculto, abrir/cerrar, Escape y foco, conservación de cambios, selección/exclusión entre páginas y filtros, prioridad de empleado manual y borrado manual después de cerrar el editor, confirmación/reintento con el mismo payload y clave, historial y reanudación.
- `git diff --check`.

No se ejecutó SQL, no se crearon bases de datos, no se accedió a producción y no se desplegó ni fusionó.

## Límites de auditoría

No hay navegador disponible en esta sesión: el intento de abrir el navegador local indicó que iab no está disponible y el inventario de navegadores devolvió una lista vacía. Por ello no se obtuvieron capturas anteriores/nuevas ni se verificaron visualmente escritorio grande, laptop, tablet y teléfono. Quedan pendientes esas verificaciones, el comportamiento real del encabezado/columnas fijas y el contraste en ambos temas. Las pruebas DOM comprueban estructura, interacciones y accesibilidad básica; no equivalen a una auditoría WCAG ni a mediciones de layout.

## Revisión adicional del PR #516 — 24 de octubre de 2026

Se trabajó únicamente en su rama existente, `feat/cb2-revision-tabla`. Se volvió a consultar el inventario de navegadores y devolvió `[]`.

### Columnas fijas

La inspección del CSS confirma fondos opacos `--card` y `--thead` en selección, acciones y encabezados en ambos temas. Los encabezados tienen z-index 2, sus esquinas 3 y la selección del cuerpo 1; acciones usa el orden de pintura de su posición sticky. La celda expandida restablece position:static para no convertirse en columna fija. No se identificó un defecto de superposición demostrable por esta revisión estática, por lo que no se modificaron tamaños, offsets ni apilamiento.

**No verificado visualmente:** scroll horizontal al inicio, centro y final; cruce con scroll vertical; solapamiento entre las columnas fijas o cobertura indebida de datos; anchuras extremas, zoom y foco que se desplaza a un control detrás de una columna fija. La lectura del CSS no certifica el resultado geométrico real.

### Editores ocultos y conservación de decisiones

La fila cerrada mantiene el atributo nativo hidden y la regla local `.detailRow[hidden] { display:none; }`. Los selectores se renderizan dentro de la fila, sin portales; no se encontró una regla que vuelva a mostrar la fila oculta. Esa es la protección nativa para retirarla de la presentación, navegación secuencial y árbol accesible. No se cambió este mecanismo sin un defecto confirmado.

Las pruebas DOM comprueban hidden/aria-expanded, apertura/cierre con Escape y devolución del foco al botón. Se reforzó la regresión de importación para comprobar que, después de cerrar, filtrar fuera de la vista y paginar, se conservan la unidad elegida, empleado manual, borrado manual y combustible manual, incluidos en el payload final. No se detectó pérdida de decisiones ni se cambió su lógica.

**No verificado en navegador:** recorrido real con Tab/Shift+Tab, intentos de focus() sobre descendientes ocultos, comportamiento al ocultar un control que tenía foco y árbol de accesibilidad con lector de pantalla. Happy DOM no sustituye esas comprobaciones.

### Temas y único defecto corregido

Se confirmó mediante cálculo de luminancia que el texto secundario claro `#64748b` tenía contraste 4,26:1 sobre `--bg` y 4,07:1 sobre `--thead`, inferior a 4,5:1 para su tamaño. La tabla ahora mezcla localmente 85 % del color secundario con 15 % del texto principal, sin cambiar los tokens globales. Se aplica al encabezado, metadatos y texto/insignia de exclusión.

| Tema | Sobre card | Sobre bg | Sobre thead |
| --- | --- | --- | --- |
| Claro | 5,83:1 | 5,22:1 | 4,99:1 |
| Oscuro | 7,81:1 | 8,38:1 | 8,19:1 |

`tabla-temas.test.ts` lee los colores reales del CSS y comprueba ambos temas contra esas tres superficies. La prueba es numérica; quedan pendientes la apariencia, los estados hover/focus, los bordes y las columnas fijas en ambos temas a distintas resoluciones. No se afirma una auditoría WCAG completa.

Se repitieron TypeScript, ESLint de todos los TypeScript del PR, pruebas CB2 sin BD y git diff --check. No hubo SQL, producción, cambios de backend/lógica, fusión ni despliegue. El PR sigue como borrador.
