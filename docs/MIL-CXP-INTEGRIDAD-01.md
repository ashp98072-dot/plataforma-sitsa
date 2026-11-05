# MIL-CXP-INTEGRIDAD-01 — lectura segura de facturas sobreaplicadas

Base: `origin/main` `4eeb5f3506eba0c6cbc4cdf95262d8e065a60a16`. Worktree y rama independientes `mil-cxp-integridad01` / `fix/mil-cxp-integridad01`.

## Fallo reproducido

El mapeo de facturas del listado y de la consulta individual invocaba `desgloseFinanciero`, que exige la invariante de escritura `aplicado <= monto pagadero`. Con monto pagadero 107.00 y aplicaciones vigentes 107.01, `calcularSaldo` lanzaba RangeError; ambos GET devolvían 500 y la lista completa desaparecía. Las regresiones se ejecutaron antes de cambiar la implementación y reprodujeron RangeError y HTTP 500.

## Comportamiento de lectura

`saldo-lectura.ts` reutiliza el desglose estricto para documentos normales y representa explícitamente dos anomalías de lectura. Reutiliza los tipos, códigos de advertencia y etiquetas de MIL-CXP-02; no cambia el estado de cuenta ni sus exportaciones/totales.

| Situación | saldo de respuesta | estadoFinanciero | Advertencia |
|---|---|---|---|
| Pendiente sin pagos | monto pagadero | PENDIENTE | ninguna |
| Parcial | pagadero menos aplicaciones vigentes | PARCIAL | ninguna |
| Pagada válida | 0.00 | PAGADA | ninguna |
| Aplicaciones superiores al pagadero | null | SOBREAPLICADA | SOBREAPLICACION |
| Anulada sin pagos vigentes | 0.00 | ANULADA | ninguna |
| Anulada con pagos vigentes | null | ANULADA | PAGO_VIGENTE_EN_ANULADA; también SOBREAPLICACION si corresponde |

`null` significa revisión de integridad pendiente, no saldo cero, deuda negativa ni saldo a favor. No determina una nueva deuda para las anuladas. La UI muestra ese texto, las etiquetas y advertencias visibles, conservando cada fila normal/anómala y todos los importes. No se compensan documentos ni se altera su clasificación para hacerlos parecer correctamente pagados.

El contrato agrega `excesoAplicado` (diferencia positiva informativa cuando hay sobreaplicación; no es crédito) y `advertenciasIntegridad` por factura. `saldo` pasa de string a string|null y `estadoFinanciero` admite SOBREAPLICADA. Los consumidores de lectura deben manejar explícitamente null. Los consumidores locales están adaptados, incluido el selector existente que ofrece saldos pagables: null nunca se formatea como Q0 ni se usa en «Pagar saldo».

Se mantienen totalDocumento, isrMonto, montoPagadero y pagado; los cálculos usan Decimal sobre strings DECIMAL de dos decimales. No se redondea un exceso para hacerlo desaparecer. No se atrapan genéricamente RangeError ni errores de base de datos para convertirlos en cero.

## Seguridad y límites

- Los GET mantienen `cxp_facturas:ver`, el ámbito empresa/entidad y `Cache-Control: private, no-store`. No se modifica el guard ni la política transversal #555. Las advertencias sólo contienen identidad de factura e importes agregados ya visibles, sin IDs/detalles de pagos, referencias, medios o reversos. No se amplía `cxp_pagos:ver`.
- `obtenerAplicado` conserva la suma de aplicaciones de pagos REGISTRADOS, excluyendo reversos y sin sustituirla por montos de cabecera. Una discrepancia de cabecera no se corrige ni se oculta modificando la suma. El diagnóstico detallado de pagos permanece en el estado de cuenta existente, sujeto a su permiso; este ticket no introduce consultas de detalle adicionales.
- La tolerancia preexistente de tablas de pagos aún no migradas se conserva sólo en lecturas. La falta de tablas de facturas mantiene 503/MIGRACION_PENDIENTE; los errores desconocidos siguen propagándose de forma controlada por HTTP.
- `calcularSaldo`, `desgloseFinanciero`, registro/reversión de pagos, cálculo fiscal y consultas SQL quedan intactos. El servicio de pagos sigue rechazando una nueva sobreaplicación antes de INSERT; sobre un saldo previamente anómalo conserva su rechazo estricto original. No se cambia ese comportamiento de escritura en este ticket.
- Sin actualizaciones de históricos, migraciones, SQL productivo, VM, servicios nuevos, PriceSmart, BORR-1d, Requerimientos de compra o despliegue.

## Validación reproducible

```text
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp --exclude '**/*.db.test.ts'
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/lib/contabilidad/cxp/facturas.ts src/lib/contabilidad/cxp/saldo-lectura.ts src/lib/contabilidad/cxp/facturas-integridad.test.ts src/lib/contabilidad/cxp/facturas-integridad.dom.test.ts src/lib/contabilidad/cxp/saldo-lectura.test.ts src/lib/contabilidad/cxp/pagos-invariantes.test.ts src/components/contabilidad/cxp-client.tsx src/components/contabilidad/cxp-situacion-factura.tsx
git diff --check
```

Las nuevas pruebas ejercitan servicios y GET reales con la BD/guard doblados; pendientes, parciales, pagadas, sobreaplicadas, anuladas, importes exactos grandes y exceso de un centavo, lista mixta, proveedores/empresas/entidades diferentes, permiso denegado y migración pendiente. Verifican la suma y scope del SQL agregado sin atribuir al doble una validación del motor SQL. También ejecutan el servicio de escritura con conexión doblada para demostrar rechazo, rollback y ausencia de INSERT/commit.

La UI se verifica mediante renderizado de etiquetas/advertencias y montaje React en happy-dom del listado completo con fetch doblado; no equivale a una sesión visual de navegador. Se incluyen regresiones de antigüedad, estado de cuenta/Excel, pagos, permisos, HTTP y bitácora.

No se ejecutan suites MariaDB: no hay conexión desechable identificada/autorizada mediante LIQ_TEST_DB_PORT. No se inició un servicio para obtenerla ni se consultó producción. La concurrencia, constraints y ejecución SQL en motor real quedan fuera de la evidencia de esta entrega.

Las dependencias del lockfile se preparan sólo en este worktree mediante `npm ci --ignore-scripts --no-audit --no-fund`; no se modifican package.json, lockfile ni otros worktrees.

Resultado final: **180/180 pruebas PASS en 13 archivos** (29 nuevas y 151 de regresión), TypeScript global **PASS**, ESLint de los ocho archivos TS/TSX afectados **PASS** y `git diff --check` **PASS**. Se verificó además que saldo.ts, pagos.ts, aplicaciones.ts, package.json y package-lock.json no difieren de main. Los errores iniciales de TypeScript y del entorno DOM por dependencias compartidas ausentes quedaron resueltos al preparar las dependencias propias del worktree, sin cambios de código ajeno.
