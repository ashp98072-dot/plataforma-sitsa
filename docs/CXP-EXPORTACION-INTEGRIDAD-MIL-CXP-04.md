# MIL-CXP-04 — Excel del panel de integridad CxP

Base `origin/main`: `3fbbe9cbfafd4309a504ea751bb5390d0e7eda19` (merge #564). Rama/worktree independientes `feature/mil-cxp04` / `mil-cxp04`. Sólo lectura; sin cambios financieros, migraciones ni equivalencia completa con Milenium.

## Contrato y autorización

Nuevo GET `/api/empresas/[slug]/contabilidad/cxp/integridad/export`. Empresa obtenida del guard autenticado; entidad obligatoria y comprobada dentro de esa empresa. Admite proveedor opcional, código de anomalía y estado administrativo, con las validaciones estrictas del panel. **Rechaza** page/pageSize y parámetros de empresa, usuario, permisos o filtros desconocidos: la descarga siempre representa el conjunto completo, no una página elegida por el cliente.

El listado y la exportación usan el mismo manejador privado de autorización/errores, revalidando en cada solicitud `cxp_facturas:ver` y `cxp_pagos:ver`. No usan resultados de pantalla como autoridad. Sin Pagos no se construyen las consultas exclusivas de ese permiso ni se incorporan columnas, identificadores, estados/reversos o categorías de pagos en el libro. Un filtro exclusivo de pagos sin permiso mantiene 403. Política #555 y permisos existentes intactos.

Respuesta XLSX: `Cache-Control: private, no-store`, MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, Content-Disposition con nombre seguro `cxp-integridad-entidad-<ID>-<AAAA-MM-DD-UTC>.xlsx`, sin texto editable del proveedor/documento. La descarga programática de la UI usa el nombre estable `cxp-integridad-entidad-<ID>.xlsx`. Sólo se exporta GET; no hay rutas de mutación.

## Conjunto completo y límite

`consultarIntegridad` es la implementación privada común de lectura del panel y la exportación. Se reutilizan exactamente las consultas, detecciones, mapeo, filtros, permisos y contadores de MIL-CXP-03; no se recorre el listado página por página ni se duplican reglas monetarias.

Límite: **10.000 advertencias**, no facturas. Es un límite explícito menor que otras exportaciones porque cada advertencia puede incorporar hasta 16 columnas y textos. Mantiene acotadas las filas SQL, objetos, celdas ExcelJS y buffer final; no es una medición de RAM ni rendimiento de producción.

1. En la misma conexión e instantánea READ ONLY/REPEATABLE READ se validan entidad/proveedor y se cuentan facturas y advertencias del conjunto filtrado.
2. Si hay más de 10.000, se responde **422/LIMITE_EXPORTACION** solicitando reducir filtros, antes de cargar filas y antes de crear un libro. No hay archivo parcial.
3. Si cabe, se consultan los contadores por código y las filas ordenadas, con LIMIT 10.001 y OFFSET 0 como defensa adicional. No hay N+1 ni todas las aplicaciones en memoria.
4. Se exige que las filas coincidan exactamente con el total y no superen el límite. Un desajuste responde **409/EXPORTACION_INCONSISTENTE**, sin descarga. El generador vuelve a comprobar completitud/límite antes de crear el libro.

Los contadores no se recalculan desde la página ni desde el archivo. Conservan la semántica de MIL-CXP-03: una factura puede tener varias advertencias, y un descuadre de pago sin factura individual no se reparte artificialmente entre documentos. La lectura nueva de exportación puede diferir de la pantalla si hubo cambios desde su consulta; el libro lo indica. Fecha/hora de generación ISO en UTC, obtenida en servidor tras completar la lectura.

## Libro y precisión

Dos hojas:

- **Integridad CxP:** entidad, factura ID, documento, proveedor ID/nombre, estado administrativo, pagadero, pagado vigente, exceso informativo, código y descripción. Con permiso de Pagos agrega ID/estado del pago, total, suma de aplicaciones y monto aplicado. No se serializan objetos de detalle arbitrarios, referencias, enlaces o fórmulas. Null se representa como celda vacía, no como importe inventado o cero.
- **Resumen:** entidad, filtros aplicados, facturas en ámbito/revisadas/con anomalías, total de advertencias y cantidad por código, fecha/hora UTC y limitaciones. No suma excesos ni los presenta como crédito.

Reutiliza ExcelJS y `valorCeldaImporte`: número sólo conforme al criterio existente de hasta 15 dígitos y roundtrip a dos decimales; en otro caso texto exacto. No usa Number para calcular importes. Los números monetarios tienen formato `#,##0.00`; sumas grandes mantienen sus cadenas exactas. Encabezados en negrita, filtros y filas de encabezado congeladas.

Los campos de texto se escriben como strings, nunca como objetos fórmula/hipervínculo. Se añade apóstrofo neutralizador si, tras espacios/controles/BOM, comienzan por `=`, `+`, `-` o `@`. El escape es sólo una representación segura en el archivo y no modifica datos almacenados; los IDs originales se conservan. Excel/XML puede normalizar saltos CRLF a LF. No se ejecutan enlaces, macros ni contenido externo proveniente de campos editables.

## Interfaz y errores

«Exportar Excel» usa exclusivamente filtros **aplicados**, sin page/pageSize. Está deshabilitado mientras la lista no corresponde a la consulta vigente o existe otra exportación activa. Un bloqueo síncrono impide doble clic antes del siguiente render. No cambia filas, contadores ni navegación del panel.

La operación se identifica por empresa/entidad/filtros/versión, independientemente de la página. Aplicar otros filtros, cambiar entidad/slug o desmontar cancela y descarta respuestas/blobs antiguos antes de crear una descarga. Paginar con los mismos filtros no cambia el conjunto exportado. Se verifica MIME, se liberan object URLs y se muestran errores controlados sin reemplazar los resultados visibles.

Los fallos de ámbito conservan 400/403/404; la categoría no evaluable conserva 422; migraciones pendientes conservan 503; fallos SQL/generación inesperados devuelven 500 genérico sin SQL ni mensajes internos. No se incorporan cabeceras de descarga a errores JSON.

## Limitaciones preservadas

`PAGADO_NO_COINCIDE_CON_LINEAS` no se evalúa aquí; se mantiene la nota y la respuesta 422 al solicitarla. Sin tablas de pagos, se exporta explícitamente evaluación incompleta, `pagosDisponibles=false` y cero facturas revisadas: no un certificado de ausencia de anomalías. Cero hallazgos nunca certifica integridad.

No se ejecutó integración MariaDB: no había un entorno desechable identificado/autorizado mediante LIQ_TEST_DB_PORT. No se inició VM ni servicio ni se ejecutó SQL productivo. Las pruebas usan dobles para SQL/servicio/autorización y abren los XLSX reales con ExcelJS; no acreditan plan de ejecución, concurrencia física o rendimiento en MariaDB. DOM simulado no equivale a QA visual ni apertura manual en Microsoft Excel.

## Validación reproducible

```text
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp --exclude '**/*.db.test.ts'
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

ESLint sobre todos los TS/TSX afectados. Las dependencias del lockfile se prepararon desde caché sólo en este worktree (`npm ci --offline --ignore-scripts --no-audit --no-fund`); package.json y lockfile intactos.

Pruebas: conjunto vacío y multipágina, varias advertencias por factura, contadores compartidos, filtros y ámbito empresarial/de entidad/proveedor, permisos reevaluados, encabezados y libro real, DECIMAL máximo y sumas gigantes, fórmulas maliciosas/controles, ausencia de columnas/detalles de pagos sin permiso, límite exacto/exceso antes de cargar filas y rechazo de truncamiento, pagos ausentes, anomalía no evaluable, SQL inesperado, doble clic, filtros sin aplicar, paginación y descarte de blobs tardíos.

Sin cambios a BORR-1e, Gastos operativos, PriceSmart, reglas contables, cálculos estrictos, registro/reversión de pagos, migraciones o históricos. Sin despliegue, merge ni Ready for review. Publicación como PR Draft para auditoría independiente.

Resultado final: **295/295 pruebas PASS en 19 archivos** (52 nuevas y 243 de regresión), **TypeScript global PASS**, **ESLint de los 11 TS/TSX afectados PASS sin advertencias**, y **git diff --cached --check PASS**. Comparación contra main: lecturas transaccionales compartidas, cálculos estrictos, registro de facturas/pagos, Excel de Antigüedad/Estado de cuenta y manifiestos de dependencias sin cambios.
