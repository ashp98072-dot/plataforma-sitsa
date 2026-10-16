# C-2C — Conciliación controlada: reporte de proveedor (C-2B) ↔ vale interno

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (tests unitarios + BD real MariaDB 11.8.9 desechable). **NO aprobado para producción**; la migración SQL **no fue ejecutada en ninguna BD real**.

## Regla primaria
`empresa_id` + `proveedor_id` + número de vale normalizado (trim, NFC, espacios internos = uno, mayúsculas). **No** se quitan ceros a la izquierda ni guiones (`00157301` ≠ `157301`). Placa, monto, galones, precio, fecha y piloto **nunca** emparejan por sí solos.
El proveedor del vale sale de su estación (#477); la estación no es requisito del match.

## Qué participa
Solo filas **canónicas** de C-2B (`VALIDA`/`ADVERTENCIA` y `duplicado_de_linea_id IS NULL`). Duplicados exactos, inválidas e ignoradas no participan ni se borran. Las advertencias «posible duplicado» siguen visibles.

## Modelo (extiende C-2B; no hay tabla paralela)
Columnas nuevas, todas NULL, en `flota_combustible_conciliacion_filas`: `estado_c2c`, `modo_c2c` (AUTO|MANUAL), `carga_vinculada_id`, `carga_sugerida_id`, `diferencias_c2c` (JSON por campo), `calculado_en`, `confirmado_por_usuario_id`, `confirmado_en`.
`UNIQUE (empresa_id, carga_vinculada_id)` (MariaDB no tiene UNIQUE parcial; los NULL no chocan) ⇒ un vale ↔ máximo una fila; una sola columna ⇒ una fila ↔ máximo un vale. CHECKs de estados/modo/JSON y de que el vínculo solo exista con EXACTA/CON_DIFERENCIAS. FKs a `flota_combustible_cargas` y `usuarios`. `carga_combustible_id` (legacy) **no se reutiliza**.
SQL: `sql/preflight-…`, `sql/migrate-…`, `sql/postcheck-2026-10-combustibles-c2c-conciliacion.sql`, generados por `scripts/generar-sql-c2c.py` con el mismo bloque de **auditoría contractual exacta** (18 objetos: 8 columnas, 3 índices, 4 CHECK, 3 FK; tipo, signo, nulabilidad, collation, orden de columnas, UNIQUE, cláusula CHECK y FK RESTRICT/RESTRICT; más C-2B FINAL, MariaDB 11.8.x e InnoDB).
Estados: `CLEAN` (ninguno existe) → migrate aplica DDL determinista (sin `IF NOT EXISTS`); `FINAL` → NOOP; cualquier otro (parcial o definición distinta) → `DIVERGENTE`: SIGNAL antes de cualquier DDL. Tras el DDL se repite la auditoría en la misma sesión (exige FINAL) y se comparan conteos antes/después (sin DML). Postcheck exige FINAL y 0 vínculos duplicados/huérfanos.

## Estados
`PENDIENTE`, `COINCIDENCIA_EXACTA`, `COINCIDENCIA_CON_DIFERENCIAS`, `SIN_VALE_INTERNO`, `AMBIGUA`, `DESCARTADA_MANUAL` (por fila) y `VALE_INTERNO_SIN_REPORTE` (vales sin fila; vista aparte). Separados de `estado_parseo`.

## Comparaciones secundarias
Placa (normalizada), monto (±Q0.01), galones (±0.001), precio (±Q0.01), fecha (igualdad). Faltante en un lado = `FALTANTE`, no cuenta como diferencia. La **fecha del reporte no certifica consumo**: una fecha distinta mantiene la coincidencia (por vale) y solo añade el badge FECHA. El **piloto es informativo** y nunca bloquea.

## Automático vs manual
- EXACTA única ⇒ vínculo AUTO propuesto. Un candidato con diferencias ⇒ solo `carga_sugerida_id`, requiere revisión. AMBIGUA (varios vales, varias filas con la misma clave o vale ya vinculado a otra fila) ⇒ nunca se asigna sola.
- Acciones manuales (`confirmar`, `quitar`, `descartar` con motivo, `restablecer`) marcan la fila MANUAL; **el recálculo no las pisa**. `restablecer` la devuelve a automático.
- **Recalcular** es idempotente (segunda corrida: 0 cambios) y se hace en transacción.

## Concurrencia
Transacción READ COMMITTED; orden de bloqueos proveedor → fila → vale; revalida empresa, proveedor y disponibilidad; `ER_DUP_ENTRY`/`ER_CHECKREAD`/deadlock ⇒ 409 «Actualiza y vuelve a intentar.». Opcionalmente el cliente envía el estado esperado y, si cambió, 409.

## Permisos y auditoría
Lecturas: `flota_combustible:ver`. Recalcular y acciones: `flota_combustible_conciliar`. Sin permisos nuevos; Admin con bypass. Empresa y usuario siempre del servidor. Auditoría (`recalcular_conciliacion_proveedor`, `conciliacion_proveedor_{confirmar,quitar,descartar,restablecer}`) con usuario, empresa, importación, fila, vale, antes/después y fecha.

## Fondos
La línea de fondo se muestra como información solo vía **reporte → vale → línea**; el reporte nunca se enlaza al fondo. C-2C no modifica vales, fondos, Contabilidad, Milenium, CxC ni CxP.

## API / UI
- `GET|POST …/combustible/importaciones/[id]/conciliacion` (listar con resumen y filtros / recalcular)
- `GET|POST …/combustible/conciliacion-proveedor/filas/[id]` (candidatos / acción)
- `GET …/combustible/conciliacion-proveedor/vales-sin-reporte` (filtros: `fecha_consumo` desde/hasta, proveedor, estado, placa)
- UI: Combustibles → Conciliación → «Reportes de proveedor».

## Verificación
Ver PR. Pendiente: aplicar preflight/migrate/postcheck en el entorno autorizado, prueba manual con datos reales y aprobación de negocio.
