# MIL-CXP-03 — panel de integridad de Cuentas por pagar

Base `origin/main`: `0c793ba3fabf1360a931e20170b1b984aac8208c` (incluye #562). Rama/worktree independientes `feature/mil-cxp03` / `mil-cxp03`. Implementación exclusivamente de lectura; sin migraciones, correcciones automáticas o equivalencia completa con Milenium.

## Acceso, filtros y contrato

Nueva pestaña **Contabilidad → Cuentas por pagar → Integridad**, sólo con `cxp_facturas:ver`. Mantiene Facturas, Pagos, Proveedores, Estado de cuenta, Antigüedad y Bitácora. Endpoint GET `/api/empresas/[slug]/contabilidad/cxp/integridad`, respuesta `private, no-store`.

La empresa procede del guard existente; la entidad es obligatoria y se verifica su pertenencia a esa empresa dentro de la instantánea. Se conserva la autorización actual por libros de empresa: no se modifica la política transversal #555 ni se agregan permisos. El guard de Facturas se evalúa antes de validar filtros.

Filtros estrictos: `entidad` (entero positivo hasta INT_MAX), `proveedorId` opcional, `codigo` de advertencia, `estado` REGISTRADA/ANULADA, `page` 1–1,000,000 y `pageSize` 1–100 (25 por defecto). Ausentes opcionales no restringen; vacíos, duplicados, espacios, decimales, valores fuera de rango y parámetros desconocidos se rechazan con 400. No se admiten empresa, usuario o permiso de pagos desde el cliente. Un proveedor que no pertenece a la empresa responde 404.

La respuesta incluye ámbito, cantidad de facturas revisadas, contadores de advertencias, filas de la página y limitaciones. Cada fila es **una advertencia**, no necesariamente una factura distinta. Incluye ID/documento y proveedor de factura cuando existen, entidad, estado administrativo, pagadero, pagado vigente y exceso informativo, junto con código/descripción.

Los importes son cadenas DECIMAL, calculados con el desglose compartido `saldo-lectura.ts` y Decimal. El formato de pantalla reutiliza `formatearImporte`, sin convertir importes a Number. Nunca se presenta un exceso como crédito ni se compensan documentos.

## Comprobaciones y permisos

| Código existente | Evidencia utilizada | Permiso |
|---|---|---|
| SOBREAPLICACION | Aplicaciones de pagos REGISTRADOS mayores al pagadero, incluida anulada si corresponde | Facturas |
| PAGO_VIGENTE_EN_ANULADA | Anulada con aplicaciones REGISTRADAS positivas | Facturas |
| PAGO_DE_OTRO_PROVEEDOR | Aplicación cuyo pago pertenece a un proveedor distinto del de la factura | Facturas + Pagos |
| PAGO_DESCUADRADO | Total del pago distinto de la suma de **todas** sus aplicaciones dentro del ámbito; incluye pagos sin aplicaciones | Facturas + Pagos |
| PAGADO_NO_COINCIDE_CON_LINEAS | **No evaluable en este panel**: no dispone de líneas visibles/fuente independiente para comparar con el agregado | Véase limitación |

Las dos primeras reutilizan los códigos, descripciones y exceso de `desgloseFacturaLectura`. La definición SQL de pagado vigente es `subPagos`/`PAGADO` de `lectura-cxp.ts`: los reversos no suman. Las advertencias estructurales de pagos de otro proveedor y descuadres incluyen pagos REGISTRADOS y REVERSADOS, como el estado de cuenta existente; la UI distingue reversos como información que no suma al pagado vigente.

Sin `cxp_pagos:ver`, no se construyen/ejecutan las ramas de diagnóstico de pagos, no se proyectan IDs ni estados de pagos y no se exponen referencias, medios, reversos o detalles de ese permiso. Se usa únicamente el agregado autorizado de aplicaciones para clasificar facturas; sus joins internos no devuelven claves de pago al cliente. Tampoco aparecen contadores de categorías exclusivas de pagos. Solicitar expresamente una de esas categorías sin permiso responde 403 antes de consultar la BD.

Con permiso, los descuadres se muestran **una vez por pago**, sin asignar su importe arbitrariamente a una factura. `facturaId`, estado, pagadero y pagado de factura son null cuando no hay factura individual; los detalles agregados de pago se presentan aparte. No se prorratea el total. Para PAGO_DE_OTRO_PROVEEDOR, el proveedor del evento es el de la factura; para PAGO_DESCUADRADO, el del pago. El filtro de proveedor sigue esa propiedad. El filtro administrativo en un descuadre exige que exista al menos una factura vinculada con ese estado; un pago sin aplicaciones queda fuera de ese filtro. La suma del pago conserva **todas** sus aplicaciones, nunca sólo las de las facturas que cumplen el filtro.

`PAGADO_NO_COINCIDE_CON_LINEAS` conserva su implementación previa en el estado de cuenta. Este panel no carga líneas completas ni fabrica discrepancias comparando la misma suma consigo misma. Su opción aparece deshabilitada con permiso de Pagos y se explica en las limitaciones; solicitarla por API devuelve 422/ANOMALIA_NO_EVALUABLE. No es una nueva categoría contable, ni se devuelve un cero como si se hubiera comprobado.

## Consistencia, contadores y paginación

Una sola conexión y transacción `READ ONLY` con instantánea consistente y `REPEATABLE READ` explícito para el panel abarcan validación de ámbito, inventario revisado, contadores y página. `enInstantanea` incorpora una opción optativa de aislamiento; los demás callers conservan su comportamiento previo. No se cambia el aislamiento de sesión del pool.

- `facturasEnAmbito`: todas las facturas de empresa/entidad, acotadas por proveedor/estado.
- `facturasRevisadas`: ese mismo conjunto cuando se dispone de tablas de pagos para evaluar aplicaciones. El filtro de código no reduce este universo.
- `totalAdvertencias` y `porCodigo`: todo el conjunto de hallazgos autorizado y filtrado por código/proveedor/estado; no sólo la página.
- `facturasConAnomalias`: COUNT DISTINCT de facturas identificadas en esos hallazgos. Excluye eventos que sólo identifican un pago; una anulada con exceso puede producir dos advertencias y contar como una factura.

Las ramas forman un UNION ALL parametrizado con scope empresarial y de entidad en facturas, agregados, pagos y aplicaciones. Se cuentan y paginan en SQL con orden estable por código/factura/pago; la unicidad pago-factura de las aplicaciones existentes impide empates de la misma advertencia. Las lecturas tienen un número fijo de consultas (sin N+1): sólo se traen a memoria la página (máximo 100 filas), hasta cuatro contadores y los escalares de resumen. Las consultas de conteo sí examinan el conjunto filtrado en el motor; no se afirma una medición de rendimiento en producción ni se agregan índices.

La UI usa el reductor compartido de cargas y AbortController: al cambiar filtros, página o entidad no muestra filas ni contadores anteriores como si fueran actuales; descarta respuestas tardías. «Consultar proveedor» usa la navegación existente a Estado de cuenta, con proveedor inicial y pagadas/anuladas incluidas. No habilita escrituras ni permisos adicionales.

## Migraciones, errores y límites

Si faltan tablas de facturas u otro esquema requerido: 503/MIGRACION_PENDIENTE. Si faltan tablas de pagos se reutiliza la lectura de compatibilidad existente, pero el panel marca `pagosDisponibles=false`, `facturasRevisadas=0` e indica revisión incompleta: cero hallazgos **no** demuestra ausencia de anomalías. No fabrica validaciones sobre pagos ausentes. Los errores SQL inesperados son 500 genéricos sin SQL, mensajes del motor ni datos privados en la respuesta.

Sin consultas o datos productivos; no se modifica ISR, registro/reversión de pagos, cálculos estrictos, saldo de históricos, migraciones, BORR-1d, Requerimientos de compra ni PriceSmart. El panel cubre las comprobaciones documentadas sobre documentos presentes en Novalvion, no una auditoría completa de todas las formas de corrupción posible.

## Validación

```text
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp --exclude '**/*.db.test.ts'
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

ESLint se ejecuta sobre todos los archivos TS/TSX afectados. Se prepararon dependencias exactas del lockfile desde caché sólo en este worktree, sin scripts de instalación ni cambios a manifiestos/lockfile.

Pruebas nuevas: filtros estrictos, compilación de scope/parámetros SQL, precisión DECIMAL, clasificación con helpers compartidos, múltiples advertencias y proveedores, exclusión de datos de pagos sin permiso, controles de entidad/proveedor, una sola instantánea, conteos distintos de la página, límite/offset, migraciones y errores; GET real con guard de autorización real y sesión/permisos/servicio simulados; DOM de filtros, permisos, paginación, estados de carga/error, respuestas tardías y navegación a proveedor. Se conservan las regresiones de Facturas, Pagos, Estado de cuenta/Excel, Antigüedad y Bitácora.

Los tests de servicio usan un doble de conexión y los de HTTP simulan el servicio: comprueban contratos, composición SQL y comportamiento sin atribuirles la ejecución del motor. **No se ejecutó integración contra MariaDB**: no hay un entorno desechable identificado/autorizado mediante LIQ_TEST_DB_PORT. No se inició un servicio ni VM para obtenerlo. Quedan sin medir plan de ejecución/rendimiento y ejecución SQL/consistencia concurrente en MariaDB real; la evidencia de instantánea en tests es de protocolo y conexión, no concurrencia física. DOM simulado no equivale a QA visual en un navegador real.

Publicación exclusivamente como PR Draft para auditoría independiente. Sin merge, Ready for review o despliegue.

Resultado final: **243/243 pruebas PASS en 16 archivos** (63 nuevas y 180 de regresión), **TypeScript global PASS**, **ESLint de los 12 archivos TS/TSX afectados PASS** y **git diff --check PASS**. Comparación contra main: facturas.ts, pagos.ts, saldo.ts, saldo-lectura.ts, estado-cuenta.ts, package.json y package-lock.json sin cambios. El ajuste de la aserción de cableado del estado de cuenta mantiene la verificación de remonte por entidad y añade la identidad del proveedor inicial; el comportamiento de navegación se prueba además en DOM.
