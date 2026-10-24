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
- 29 archivos CB2, 254 pruebas automatizadas, excluyendo `*.db.test.ts`.
- Regresiones: once encabezados con scope, controles accesibles, editor inicialmente oculto, abrir/cerrar, Escape y foco, conservación de cambios, selección/exclusión entre páginas y filtros, prioridad de empleado manual y borrado manual después de cerrar el editor, confirmación/reintento con el mismo payload y clave, historial y reanudación.
- `git diff --check`.

No se ejecutó SQL, no se crearon bases de datos, no se accedió a producción y no se desplegó ni fusionó.

## Límites de auditoría

No hay navegador disponible en esta sesión: el intento de abrir el navegador local indicó que iab no está disponible y el inventario de navegadores devolvió una lista vacía. Por ello no se obtuvieron capturas anteriores/nuevas ni se verificaron visualmente escritorio grande, laptop, tablet y teléfono. Quedan pendientes esas verificaciones, el comportamiento real del encabezado/columnas fijas y el contraste en ambos temas. Las pruebas DOM comprueban estructura, interacciones y accesibilidad básica; no equivalen a una auditoría WCAG ni a mediciones de layout.
