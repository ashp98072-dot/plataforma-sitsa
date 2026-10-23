# PR #514 — Empleado, combustible, trazabilidad y resumen mensual

Base inspeccionada: `main` posterior al PR #513, commit `ffd58664`.

## Descubrimiento previo

- `sql/schema.sql`: `empleados.id` es INT, con `empresa_id`, `nombre` y `estado`; el catálogo de asignación de inventario de flota usa empleados activos de la empresa. Se reutiliza esa regla de autorización, sin exigir un vínculo TMS ni repararlo durante consultas.
- CB2 solo tenía `piloto_informado` y `producto` como texto, sin relación de empleado ni clasificación independiente. Se revisaron el DDL PR2 y la evidencia de esquema existente en el repositorio; no se consultó una base de datos real.
- `catalogosCombustible`, `requireTenantFlotaCombustible`, los guards CB2, `vehiculos` y el predicado de acceso compartido delimitan empresa y capacidad. Se conserva el acceso compartido expresamente autorizado; otro vehículo sin acceso vigente se rechaza, incluso con justificación manual.
- El importador CB2 tiene parser versionado, recibos firmados, transacciones, diario original y claves idempotentes. No se cambian parser, identidad candidata ni huella del Excel.
- El resumen histórico consulta únicamente cargas `APROBADO` por `creado_at`. No incluía consumos CB2. Se conserva esa función y su presentación como reporte histórico separado.

## Cambios

### Empleados y producto

El catálogo de empleados es RRHH activo de la empresa del guard. Se compara por caso, tildes, espacios y tokens completos sin exigir orden. La igualdad normalizada única, con al menos dos tokens distintos, admite autopropuesta. Nombres incompletos como JOSE CHAY, HECTOR SET, JORGE SARCEÑO y JOSE ORDOÑEZ producen candidatos parciales; incluso una parcial única exige elección manual para evitar identificar personas por nombres débiles. No se autopropone un empleado ante homónimos. El selector busca el nombre completo en el catálogo autorizado. Backend valida empresa y estado activo bajo bloqueo.

Si falla el catálogo de empleados, se declara su indisponibilidad y no se proponen vínculos; los otros catálogos siguen disponibles. Un vínculo manual que desaparece del catálogo deja de ser elegible. No se reemplaza el nombre original del Excel.

Clasificación separada: DIÉSEL, GASOLINA REGULAR, GASOLINA SUPERIOR/SÚPER, V-POWER DIÉSEL, V-POWER GASOLINA, V-POWER con variante no determinada y NO DETERMINADO. Variantes textuales conocidas se clasifican conservadoramente. Ausencia, texto desconocido o V-Power sin variante exigen elegir explícitamente, incluso para confirmar NO DETERMINADO. No se infiere por proveedor ni placa. Los consumos CB2 anteriores sin clasificación persistida se muestran y filtran como NO DETERMINADO, aunque conserven un producto textual reconocible; requieren corrección explícita para establecer su clasificación, sin backfill.

Importar y reanudar conservan las decisiones durante filtros/páginas/recargas. El resumen previo muestra empleado y combustible; cambiar decisiones invalida la aceptación del importador. Una clasificación pendiente queda fuera de LISTO y no puede confirmarse, salvo exclusión expresa de esa fila del lote. Las nuevas decisiones quedan en el diario junto con su candidato; el original permanece separado.

### Unidad y correcciones

Se mantienen las exactas y abreviadas únicas del PR #513. Una unidad distinta o una abreviada ambigua admite elección manual autorizada con justificación de al menos diez caracteres. Sin justificación no se habilita; el backend vuelve a validar acceso. Una placa realmente ausente o una identidad original inválida sigue bloqueada por el parser: no se inventa una identidad para forzarla.

Consumos ofrece corrección explícita de unidad, empleado y clasificación. Requiere **Admin y permiso de conciliar**, el mismo endurecimiento existente para reanudar. Tiene confirmación, motivo, revisión optimista, transacción, revalidación de permiso y clave idempotente. Actualiza el mismo consumo y registra anterior/nuevo/motivo/actor/fecha en `flota_cb2_asignaciones` y auditoría general. No cambia placa, piloto, producto original, importes, huella ni datos originales. No reimporta resueltos ni modifica cargas históricas.

### Historial y consultas

Se amplían Consumos e Historial existentes. El listado muestra unidad actual frente a placa original, empleado vinculado frente a texto original, clasificación frente a producto original, perfil, proveedor, factura/serie, archivo, hoja/lote/fila, fecha/responsable y advertencias originales. Se añaden filtros parametrizados de unidad, empleado, combustible e importación, conservando proveedor, fechas y búsqueda por archivo/vale/placa.

El detalle compacto de consumo muestra hasta 25 referencias de origen; Historial conserva y permite consultar todas las apariciones, incluidas resueltas, y descargar el Excel privado. Se conservan las protecciones de reanudación y de importación repetida. Las correcciones se consultan en el mismo detalle de consumo.

### Resumen integrado

El endpoint entrega el reporte histórico existente y una sección integrada independiente. Histórico: solo APROBADO y corte por fecha de registro. CB2: corte por fecha de consumo. Se agrupa por origen, unidad, combustible y moneda dentro del mes. Se muestran subtotales por origen/moneda y total consolidado GTQ; USD no se convierte ni suma a quetzales. Gasolina histórica sin variante se conserva genérica; producto desconocido no se convierte en diésel.

Regla de conciliación reproducible, solo de lectura: excluir CB2 únicamente si hay una pareja única con carga aprobada de igual proveedor, vale textual normalizado conservando ceros, vehículo ID, fecha de consumo, galones, precio y monto decimal exactos, en GTQ. No se usan nombres ni similitud de placa. Se muestran IDs y valores de prueba. Una carga histórica registrada en otro mes conserva su corte: no se traslada al mes CB2.

Parejas múltiples o la misma identidad verificable con diferencias monetarias quedan sin excluir y marcan el total **PROVISIONAL**, pendiente de conciliación manual; no se presenta como deduplicado definitivo. Datos históricos sin proveedor, vale, fecha o precio no autorizan una exclusión. Se mantienen ambos orígenes cuando no hay prueba suficiente. No se crean vínculos ni se modifican operaciones mediante el reporte.

## Migración requerida — NO ejecutada

**Sí requiere migración SQL aprobada antes de desplegar esta aplicación.**

1. `sql/preflight-2026-10-combustibles-pr514-asignaciones.sql`: lectura de esquema, motores, tipos, índice compuesto y estado inicial. Cualquier instalación parcial/incompatible exige abortar. El resultado no autoriza automáticamente el DDL.
2. `sql/migrate-2026-10-combustibles-pr514-asignaciones.sql`: añade tres columnas a consumos (`empleado_id` nullable, `producto_clasificado` nullable, `revision_asignacion` con valor inicial cero) y una tabla de correcciones idempotentes. FK real a empleados y FK compuesta de corrección a consumo; no se reutiliza una columna con otro significado ni se hace backfill.
3. `sql/postcheck-2026-10-combustibles-pr514-asignaciones.sql`: verificar DDL completo, conteos, ausencia de metadatos inesperados y aislamiento antes de habilitar escrituras.

Preparar backup y ventana controlada. El DDL no es una transacción reversible: puede quedar parcial si falla un paso. Revisar cada resultado y no repetir a ciegas. La reversión está descrita como comentarios en la migración: retirar primero la aplicación nueva, exportar asignaciones y después retirar columnas/tabla con aprobación. Perdería los metadatos nuevos; no altera evidencia original. No se preparó ni ejecutó ninguna operación en Hostinger.

## Validación y riesgos pendientes

- Vitest local: **71 archivos, 815 pruebas aprobadas** (flota, combustible y tenant; sin suites que requieren BD).
- Incluye fixtures de formatos HALEL/SHELL, hojas/lotes, repetición, resueltos, permisos, aislamiento, tildes/tokens/homónimos, catálogo tardío, justificación manual, paginación y clasificación obligatoria. Prueba DOM con 26 consumos verifica conservación de decisiones, payload y aceptación explícita. Correcciones prueban revisión obsoleta, revocación, idempotencia y evidencia intacta. Resumen prueba exclusiones fuertes, ambigüedad, monedas, cortes y precisión con 10.000 operaciones.
- TypeScript (`tsc --noEmit --incremental false`), ESLint de todos los archivos TypeScript modificados/añadidos y `git diff --check`: aprobados.
- No se ejecutó SQL, migración, importación real, conexión productiva ni GitHub Actions. Sin cambios de dependencias o workflows. Las pruebas de persistencia usan mocks; **no certifican DDL, restricciones ni consultas en MariaDB real**.
- Pendiente antes del despliegue: aprobación de migración, laboratorio MariaDB 11.8 con pre/postcheck, concurrencia real, consultas con `JSON_ARRAYAGG`, volumen de historial y plan de ejecución, comprobación visual móvil/escritorio y aceptación operativa de la conciliación/cortes.
- La aplicación nueva depende del esquema nuevo; sin migración fallan lecturas de consumos, escrituras y resumen integrado. Los errores no deben interpretarse como totales cero. No desplegar la aplicación aisladamente.
- El FK de empleado garantiza existencia; empresa/estado se validan en los servicios y en el postcheck. Mantener esas validaciones en cualquier escritor futuro. No existe una asociación automática de TMS ni conversión de IDs entre catálogos.
