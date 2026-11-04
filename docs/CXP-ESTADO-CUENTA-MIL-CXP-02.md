# CxP — Estado de cuenta por proveedor (MIL-CXP-02)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (pruebas unitarias, de rutas y contra MariaDB 11.8.9 desechable; QA manual en navegador con datos sintéticos y oráculo independiente). **No aprobado para producción.** Sin migraciones ni SQL nuevo.

Rótulo permanente (pantalla y Excel):
> Estado de cuenta de documentos registrados en Novalvion. Saldos actuales, no históricos. No incluye necesariamente documentos pendientes de migración desde Milenium.

## Alcance (decisiones D1–D8 aprobadas)
- **D1 — ACTUAL, no histórico.** Muestra el saldo de HOY de los documentos registrados. No reconstruye saldos por fecha ni por fecha contable. Las fechas «documento desde/hasta» **filtran facturas**; no calculan saldos a esa fecha. El histórico requiere una decisión de Contabilidad (definición de fecha y fecha de efecto del reverso) y queda fuera.
- **D3** — Abiertas por defecto; filtros «incluir pagadas» e «incluir anuladas». **D4** — se ordena y filtra por **fecha del documento** (ascendente).
- **D5** — Una entidad por solicitud (`?entidad=`); política de autorización vigente sin cambios (ver abajo). **D7** — GTQ solo como rótulo: CxP no guarda moneda por factura. **D8** — Excel propio de Novalvion; no afirma equivalencia visual con el de Milenium.
- **No incluye** notas de crédito/débito, anticipos ni otros movimientos sin implementación y reglas contables confirmadas.

## Reglas de saldo (reutiliza lo existente; sin duplicar)
`saldo = monto pagadero (total − retención de ISR) − pagos REGISTRADOS`. Definiciones compartidas en `lectura-cxp.ts` (extraídas de MIL-CXP-01 y usadas por ambos reportes) y `desgloseFinanciero` de `saldo.ts`.
- **Abierta:** pagadero > pagado. **Pagada:** pagado ≥ pagadero (saldo `0.00`). **Anulada:** saldo exigible `0.00`; conserva sus importes solo como **informativos** y **no suma a ningún total**.
- Los pagos **REVERSADOS** se muestran (solo con permiso de Pagos) marcados «solo información» y **no suman** al pagado vigente. La retención de ISR no es un pago.
- **Totales = conjunto filtrado** (no la página): registradas (total, ISR, pagadero, pagado, saldo exigible), abiertas/pagadas, saldo por situación de vencimiento y, aparte, anuladas informativas.
- Instantánea consistente de solo lectura (`START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`) para facturas, líneas, totales y advertencias. Decimal exacto; los importes viajan como cadenas y en Excel son número solo si es exacto (≤ 15 dígitos), si no texto exacto.

## Permisos (D2/D6) — decididos en el servidor, no en la interfaz
| Permiso | Qué habilita |
|---|---|
| `cxp_facturas`:`ver` (obligatorio) | Estado de cuenta: facturas, importes, pagado y saldos; nombre comercial, NIT y días de crédito **si están registrados** |
| + `cxp_pagos`:`ver` | Además, líneas de pago (fecha, medio, referencia, monto, estado, reverso y motivo) y advertencias que involucran pagos. **Sin él, el servidor ni consulta ni envía esos datos** (ni en JSON ni en Excel; la hoja «Pagos» no existe) |
| + `cxp_proveedor_fiscal`:`ver` | Régimen fiscal y si es sujeto de ISR del proveedor (si hay configuración en la entidad) |
Nunca se muestran datos bancarios ni de contacto del proveedor. Ningún permiso nuevo. La autorización se evalúa **antes** de validar filtros (403 antes que 400).

## Autorización por entidad
Se mantiene la política vigente (`CONTABILIDAD-ACCESO-UNIFICADO.md`): el permiso central cubre todos los libros de la empresa de la sesión; `cont_entidad_usuarios` no concede ni restringe. Se valida que la entidad y el proveedor pertenezcan a la empresa (404 `ENTIDAD_NO_DISPONIBLE` / `PROVEEDOR_NO_DISPONIBLE`). La evaluación de autorización por usuario–entidad sigue en el ticket transversal **#555** y **no** se implementa aquí.

## Integridad: advertencias verificables, sin normalizar
Si hay inconsistencias se emite una advertencia con identificadores y los importes originales **no se modifican** (el saldo crudo, incluso negativo, se muestra tal cual; el saldo exigible total no se compensa con excesos):
`SOBREAPLICACION` (pagado > pagadero), `PAGO_VIGENTE_EN_ANULADA`, `PAGO_DE_OTRO_PROVEEDOR`, `PAGO_DESCUADRADO` (total del pago ≠ suma de aplicaciones) y `PAGADO_NO_COINCIDE_CON_LINEAS`. Las dos últimas y la tercera involucran pagos: solo con permiso de Pagos. Se calculan para todo el proveedor/entidad, independientemente del filtro.
Nota: el listado de **Facturas** existente (`listarFacturas`) falla con 500 ante una sobreaplicación (no es representable en `calcularSaldo`); este estado de cuenta no, porque la informa. No se modificó el listado existente.

## Filtros estrictos
`proveedorId` obligatorio. `incluirPagadas`/`incluirAnuladas` solo `0`/`1`. `desde`/`hasta` fechas reales con desde ≤ hasta. `page`/`pageSize` (1–100) enteros. Valores inválidos, vacíos o repetidos → HTTP 400 `FILTRO_INVALIDO`, sin consultar ni exportar. `corte` solo en la exportación (hoy o ayer, Guatemala) para conservar el cálculo de días de la pantalla; **no es histórico**.

## Diferencias respecto de Milenium
- El menú de Milenium incluye «estado de cuenta de proveedores»; su **formato y uso real no están documentados**. Este estado de cuenta es propio.
- Milenium maneja contraseñas de pago, notas, anticipos, liquidación de documentos varios y pólizas; aquí no existen todavía.
- El histórico de Milenium (`cc06`, `cc08`) no está importado: un proveedor con historia previa aparece incompleto (rótulo).

## Migraciones
Sin SQL nuevo. Requiere M-3A y M-3B1; sin `cxp_facturas` → 503 `MIGRACION_PENDIENTE`; sin tablas de pagos → pagado `0.00` y líneas vacías. Ver el preflight en `docs/CXP-ANTIGUEDAD-MIL-CXP-01.md`.

## Pruebas
`estado-cuenta-puro.test.ts`, `estado-cuenta-http.test.ts` y `estado-cuenta.db.test.ts` (`LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/cxp --no-file-parallelism`, MariaDB 11.8.9 desechable con las migraciones reales). La BD compara cada factura contra `obtenerFactura`, `obtenerAplicado` y la antigüedad de MIL-CXP-01 para el mismo conjunto.
