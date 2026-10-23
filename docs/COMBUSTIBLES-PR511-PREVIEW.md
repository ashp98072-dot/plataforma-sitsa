# Combustibles PR #511 — preview y reconocimiento flexible

Base: `468ec843571c2d4a5f29458bbdf1f3a4e43ae1a4` (main, PR #510). Rama: `feature/combustibles-pr511-preview-mejoras`.

## Excel

El parser 2 reconoce por alias de encabezados el formato A tabular (FECHA, VALE, serie, factura, MONTO, GLS, PRODUCTO, PRECIO, PILOTO, PLACAS, OBS) y el B por lotes (FECHA, Placas, No. Vale, Galones, Precio, Costo Total, Kilometraje, PILOTO, SERIE, NO. FACTURA). No exige posiciones fijas ni encabezados entre las primeras 25 filas. Cada encabezado repetido actualiza el mapa de columnas. Los encabezados ambiguos siguen rechazándose.

Los títulos aislados `LOTE 2054` (también celdas combinadas) establecen el lote hasta el siguiente título en esa hoja. Una columna explícita de lote prevalece para esa fila. El contexto no pasa a otra hoja. Se preservan ceros iniciales. Títulos, encabezados, subtotales, notas y filas sin operación se conservan como ignorados con hoja, fila, lote y celdas originales. `textos` conserva los campos leídos; `celdas` conserva direcciones, valores y fórmulas, incluido el título literal del lote. El archivo privado conserva el original completo.

PRODUCTO ausente queda en null y se informa como no indicado; no se infiere combustible. Kilometraje ausente no añade avisos. Kilometraje textual conserva el original y advierte solo cuando fue informado y no es interpretable.

La estructura no decide el proveedor. Proveedor, empresa, perfil HALEL/SHELL y moneda siguen siendo decisiones explícitas, revalidadas por backend. Las fórmulas autorizadas de SHELL y la prohibición de fórmulas de HALEL no cambian; tampoco límites del archivo, precisión, fechas, identificadores ni conflictos. Varias hojas/lotes aportan apariciones, no consumos adicionales: se agrupan por la clave existente y se bloquean contradicciones.

## Vehículos

La búsqueda usa exclusivamente el catálogo autenticado: vehículos propios o explícitamente compartidos según las reglas existentes. Para comparar se unifican mayúsculas, espacios, guiones ASCII y variantes Unicode permitidas. Se preservan prefijos, ceros y todos los caracteres; otros separadores no se descartan silenciosamente.

`C-570BZT` y `C 570 BZT` son exactas. La coincidencia exacta única se propone al analizar, sin confirmar la importación. Se puede borrar o corregir la selección. La aceptación final comienza desmarcada y se invalida al cambiar asignaciones. Así no se repite la misma selección decenas de veces. Múltiples coincidencias exactas requieren selección manual.

`570 BZT` frente a `C-570BZT` es aproximada porque las reglas de placas conservan el prefijo. Diferencias de caracteres también son aproximadas. Se muestran sugerencias ordenadas, nunca se asignan automáticamente. El backend mantiene la exigencia de coincidencia exacta conservadora: caracteres distintos o prefijo ausente requieren corregir el Excel y reanalizar. Seleccionar un vehículo no permite saltarse esa validación. No cambian la placa persistida, claves ni payloads históricos.

## Pilotos: catálogo existente y limitación comprobada

Existe `tms_personal` con empresa, nombre, tipo y estado. Se leen únicamente pilotos activos de la empresa autenticada; no se llama a helpers que reparan vínculos ni se consultan personas de otras empresas. Si el catálogo no está disponible, se declara esa situación y se conserva el piloto original.

La comparación ignora tildes, mayúsculas/minúsculas y espacios repetidos o exteriores. `JOSE CHAY` reconoce `José Chay`; `HECTOR SET` reconoce `Héctor Set`. Un resultado exacto único se propone visualmente. Homónimos exactos son ambiguos. Reordenamientos, nombres incompletos y errores leves son sugerencias aproximadas ordenadas: no identifican automáticamente a alguien por compartir nombres/apellidos.

**CB2 solo tiene `piloto_informado` textual: no dispone de relación con empleados ni con `tms_personal`.** Conforme a la excepción solicitada, no se crean tablas, columnas ni relaciones improvisadas. Las sugerencias son informativas; no hay asignación persistida ni selector que prometa guardarla. La UI declara el límite y explica que para corregir el nombre persistido debe corregirse el Excel y reanalizar. Asociar el piloto al consumo requiere una decisión posterior sobre el modelo; queda fuera de este PR sin SQL. El reconocimiento visual sí funciona automáticamente para todos los consumos.

## Preview y confirmación

Indicadores por candidato único, filtros por estado/placa/vale/lote, detalles expandibles, advertencias con valores originales y diferencia decimal, paginación de 25 y revisión de selección. Ignoradas tienen sección y paginación propias. Los importes separan monedas, cuentan una vez por candidato calculable y no incluyen ignoradas ni prometen consumos registrados. Cada aparición conserva su origen y comparte asignación con su candidato.

LISTO, ADVERTENCIA, PENDIENTE, BLOQUEADO, IGNORADO y RESUELTO tienen texto y símbolo además de color. La elegibilidad procede del backend, nunca del texto de una advertencia. El preview añade lote, kilometraje y textos originales de forma aditiva. React escapa el contenido del archivo. Las sugerencias no confirman ni escriben datos.

Se conservan CSRF/origen, guard multiempresa, recibo firmado, revalidaciones bajo bloqueo, confirmación explícita parcial, claves de reintento y diario ORIGEN/RESOLUCION. El recibo nuevo firma `parser: 2`; para ejecutar una operación nueva un recibo anterior requiere regenerar preview. La recuperación de una operación ya confirmada sigue ocurriendo antes de verificar el recibo.

## Compatibilidad de evidencia

Las importaciones nuevas guardan `version_parser=2` usando la columna existente, cuyo esquema ya admite versiones >= 1. Al reanudar se reproduce parser 1 o 2 según la cabecera persistida. Versiones desconocidas fallan antes de leer el archivo. Parser 1 conserva el mapa original y su límite histórico de búsqueda, sin heredar títulos de lote. No se reinterpreta evidencia guardada con el parser nuevo.

`parser-legacy-audit.test.ts` contiene hashes de los JSON completos obtenidos con las fixtures y el parser original del commit base. Antes de fijarlos se compararon ambos resultados completos con deepEqual. Esta prueba verifica la reproducción histórica sin copiar otro parser en producción.

## Validación reproducible

Desde esta rama en PowerShell, con dependencias instaladas mediante `npm.cmd ci --ignore-scripts --no-audit --no-fund`:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
.\node_modules\.bin\eslint.cmd src/components/flota/cb2 src/lib/flota/cb2/model.ts src/lib/flota/cb2/service.ts src/lib/flota/cb2/http-origin.test.ts src/lib/flota/cb2/parser-version.test.ts src/lib/flota/cb2/coincidencias-service.test.ts src/lib/flota/combustible-importacion-v2.ts src/lib/flota/combustible-importacion-v2-types.ts src/lib/flota/combustible-importacion-v2.test.ts src/lib/flota/combustible-coincidencias.ts src/lib/flota/combustible-coincidencias.test.ts src/lib/flota/combustible-formatos-flexibles.test.ts src/lib/flota/parser-legacy-audit.test.ts 'src/app/api/empresas/[slug]/flota/combustible/catalogos/route.ts' --max-warnings=0
.\node_modules\.bin\vitest.cmd run src/components/flota/cb2 src/lib/flota/cb2/model.test.ts src/lib/flota/cb2/originales.test.ts src/lib/flota/cb2/http.test.ts src/lib/flota/cb2/http-origin.test.ts src/lib/flota/cb2/origin.test.ts src/lib/flota/cb2/repository.test.ts src/lib/flota/cb2/storage.test.ts src/lib/flota/cb2/parser-version.test.ts src/lib/flota/cb2/coincidencias-service.test.ts src/lib/flota/parser-legacy-audit.test.ts src/lib/flota/combustible-formatos-flexibles.test.ts src/lib/flota/combustible-coincidencias.test.ts src/components/flota/combustible-preview-v2.test.ts src/lib/flota/combustible-permisos.test.ts src/lib/tenant-combustible.test.ts src/components/app-shell-operaciones.test.ts src/lib/flota/combustible-ux-captura.test.ts src/lib/flota/combustible-importacion-v2.test.ts src/lib/flota/combustible-importacion-v2-resumen.test.ts src/lib/flota/combustible-preview-v2-http.test.ts src/lib/flota/combustible-importaciones.test.ts src/lib/flota/combustible-importacion-parser.test.ts src/lib/flota/combustible-ooxml-v2.test.ts src/lib/flota/combustible-c2c-shared.test.ts src/lib/flota/combustible-c2c-http.test.ts src/lib/flota/combustible-staff.test.ts --maxWorkers=2
git diff --check
```

Resultados: **355 pruebas aprobadas en 33 archivos**, TypeScript y ESLint sin errores. Los resultados y hashes de fuentes UTF-8/LF están en `docs/evidence/combustibles-pr511-preview/`. Las pruebas usan archivos sintéticos y dobles de autorización/BD; no requieren una base real ni ejecutan la suite de integración MariaDB.

No se modifican archivos SQL, dependencias ni workflows. No se ejecutaron consultas ni importaciones reales en producción, migraciones ni merge. No se realizó inspección visual en navegador: DOM verifica contenido y comportamiento, no apariencia ni dimensiones. La revisión visual y la confirmación en una base de laboratorio quedan para revisión independiente autorizada.
