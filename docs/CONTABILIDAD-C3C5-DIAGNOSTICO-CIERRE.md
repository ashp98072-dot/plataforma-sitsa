# C3C-5: diagnóstico de preparación de cierre

Base: main `09204fb5b1d66199ef6f6ee9fa7b262b19c3b133`.

En Calendario contable, seleccionar un libro y un ejercicio, y pulsar **Diagnosticar preparación de cierre**. Se puede repetir la consulta para obtener una nueva fecha y una nueva instantánea. Cambiar libro/ejercicio descarta y cancela la consulta anterior. No hay acciones de cierre.

API: `GET /api/empresas/[slug]/contabilidad/ejercicios/[id]/diagnostico?entidad=ID`. Reutiliza `requireTenantCalendario(slug, 'ver')`, igual que la consulta de control C3C-2. No agrega permisos ni los concede por defecto. No invoca el diagnóstico de activación C3C-2, porque este persiste evidencia y bloquea datos; solo reutiliza sus reglas puras de calendario.

## Alcance

- Una transacción REPEATABLE READ / READ ONLY para libro, ejercicio, períodos, control y movimientos. Sin locks de escritura ni auditoría persistida.
- Estados de todos los períodos, identificadores de abiertos y no cerrados, cobertura/orden/solapamientos según C3C-2. Un período CONFIGURADO también se considera pendiente.
- Control: disponibilidad de su tabla/columnas, estado y versión; la ausencia de fila significa NO_ACTIVADO. No se crea una fila al consultar. Fallos internos inesperados cancelan el diagnóstico; no se presentan como éxito parcial.
- Solo Registrado integra los importes y el cuadre. Se verifica cada asiento, aunque los descuadres individuales se compensen globalmente. Los borradores y otros estados se cuentan por separado y producen advertencia.
- Integridad básica: dos líneas como mínimo, cuenta existente en el mismo libro, coherencia de ámbitos y una sola columna positiva por línea, sin nulos. Las cuentas históricas inactivas son válidas. Los importes de detalles de otro ámbito nunca se suman ni se exponen.
- Los detalles sin padre válido se cuentan para todo el libro: no tienen fecha de ejercicio atribuible. El resultado explicita este alcance.
- Totales completos y muestras de hasta 100 asientos por categoría con ID, número y fecha. No se trunca el conteo de problemas.
- Fechas inclusivas del ejercicio; SQL DECIMAL y sumas/restas BigInt, con cadenas decimales exactas en API y pantalla.

## Límite contable

**SIN_BLOQUEANTES_TECNICOS no autoriza un cierre formal.** Siempre se advierte que la regularización formal no está verificada y que la política de cierre definitivo/apertura sigue pendiente. Si hay asientos anteriores al ejercicio se señala su existencia. C3C-4 acumula historia registrada incluso entre ejercicios: no equivale a asiento de apertura ni prueba de arrastre aprobado.

No se reconoce ni se genera automáticamente regularización de ingresos/gastos/resultados, cierre de ejercicio o apertura. No se modifican períodos ni asientos históricos. El diagnóstico no certifica un cierre anterior ni sustituye su evidencia.

Si falta el calendario base, la API devuelve 503 mediante el manejo contable existente. Si solo falta el control C3C-2, devuelve el diagnóstico con ese bloqueante. No instala esquemas ni ejecuta migraciones.

## Validación

Pruebas unitarias del cálculo, transacción, errores, permisos HTTP, aislamiento y render del resultado. Integración MariaDB 11.8.9 temporal con identidad verificada, pipe único y red deshabilitada: estados de períodos, borradores, historia anterior, ámbitos ajenos, exactitud, corrupción sintética, ausencia de escrituras y reapertura concurrente con snapshot consistente.

Ejecutor nuevo: `node scripts/ci/c3c5/run-windows.mjs --run-isolated --engine=mariadb`. Reutiliza las utilidades/fixture existentes sin modificarlos y completa columnas de reportes solo en la instancia temporal. Requiere la distribución verificada en `.lab-runtime` y dependencias locales. Esos enlaces locales no son archivos para commit.

No se requiere SQL nuevo de aplicación. No se accede a bases operativas, Hostinger, .env, schema.sql ni respaldos. No se ha realizado validación visual en navegador.
