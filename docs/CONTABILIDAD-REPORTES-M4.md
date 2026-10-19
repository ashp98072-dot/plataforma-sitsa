# M-4 — Reportes contables base (Libro Diario, Libro Mayor, Balance de comprobación)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (tests contra MariaDB 11.8.9 local con las tablas reales de `schema.sql`). No probado manualmente en navegador, no comparado todavía contra Milenium, no aprobado para producción. **Sin cambio de esquema ni SQL.**

## Discovery (confirmado en `sql/schema.sql` y en el código)

| # | Punto | Hallazgo |
|---|---|---|
| 1 | `cont_asientos` | `id, empresa_id, entidad_id, fecha DATE, numero VARCHAR(40), glosa, estado VARCHAR(20) DEFAULT 'Borrador', creado_por VARCHAR(100), creado_en`. UNIQUE `(empresa_id, entidad_id, numero)` y `(empresa_id, entidad_id, id)`. |
| 2 | `cont_asiento_detalle` | `id, empresa_id, entidad_id, asiento_id, cuenta_id, debe DECIMAL(14,2), haber DECIMAL(14,2)`. FK compuestas al asiento y a la cuenta por `(empresa_id, entidad_id, …)`. |
| 3 | Catálogo | `cont_cuentas(id, empresa_id, entidad_id, codigo, nombre, tipo, nivel, activa)`, código único por `(empresa, entidad)`. **No hay columna de cuenta padre**: la jerarquía es solo `nivel` + el código. Los reportes agrupan por cuenta con movimiento (sin consolidar padres). |
| 4 | Empresa / entidad | `empresa_id` de la sesión; `entidad_id` (libro: Mónaco, KuiqTrans) obligatoria en todas las tablas; FK compuestas impiden cruzar entidades. |
| 5 | Estados | El único writer (`registrarAsientoTx`) escribe `'Registrado'`; `'Borrador'` es solo el default de la columna (ningún código lo usa). Los reportes incluyen **solo `Registrado`**. |
| 6 | Numeración | `numero` es manual (texto, único por libro); no hay correlativo automático. Se muestra tal cual. |
| 7 | Fechas | `fecha` (DATE, la del asiento) y `creado_en` (cuándo se registró). Los rangos filtran por `fecha`. |
| 8 | Anulados / reversados | **No existen**: ningún código hace UPDATE/DELETE de asientos (solo limpieza administrativa). No hay estado «Anulado» que excluir ni reversión que representar. Si algún día se agregan, el filtro `estado = 'Registrado'` ya los deja fuera. |
| 9 | Saldo inicial | **No existe** (ni tabla ni columna). |
| 10 | Períodos | **No existen** (el propio `registrarAsientoTx` lo declara: «PR A no implementa control de periodos»). |

Ningún punto impide construir los tres reportes correctamente.

## Decisiones y limitaciones documentadas

* **Mayor / saldo inicial:** el saldo acumulado se calcula únicamente con los asientos registrados **dentro del rango consultado**; no se arrastra saldo anterior al rango ni se inventa uno. La pantalla y el Excel lo dicen siempre (`NOTA_SALDO_ACUMULADO`). Si se filtra «desde» una fecha posterior al primer asiento, el saldo NO es el saldo contable a esa fecha. Cuando exista un saldo inicial/cierre formal habrá que sumarlo (`conSaldoAcumulado` ya acepta un saldo inicial).
* **Balance:** «débito/crédito acumulados» = movimientos del rango (sin `desde` = desde el primer asiento). Saldo deudor = max(débito − crédito, 0); acreedor = max(crédito − débito, 0). Cuentas sin movimiento solo con la opción «Incluir cuentas sin movimientos».
* **Integridad visible:** un asiento que no cuadra se marca «NO CUADRA» y se cuenta; la diferencia del balance no se oculta. Líneas cuya cuenta no pertenece a la entidad aparecen como «(sin cuenta)».
* **Entidades inactivas** siguen siendo consultables (historia). Una entidad de otra empresa o inexistente = 404.
* **Acceso por entidad:** hoy el código no usa `cont_entidad_usuarios`; cualquier usuario con el permiso del reporte ve las entidades de su empresa (mismo comportamiento que el resto de Contabilidad).
* **Límites:** Diario pagina de 100 asientos (los totales son del rango completo); Mayor falla con 422 si una cuenta tiene más de 5000 movimientos en el rango (no muestra un saldo truncado).
* Aritmética en centavos (BigInt), nunca con punto flotante.
* Lecturas en transacción `READ ONLY` / `REPEATABLE READ` (instantánea consistente) y **sin** `FOR UPDATE` (no bloquean a quien registra asientos).

## Permisos (propios, no se conceden a ningún rol por defecto; Admin pasa por catálogo)
`contabilidad_diario`, `contabilidad_mayor`, `contabilidad_balance` (acciones de catálogo `contabilidad_ver_diario|mayor|balance`). El permiso general de Contabilidad, CxC o CxP **no** los concede, ni ellos conceden registrar asientos.

## Superficie
* `GET /api/empresas/[slug]/contabilidad/reportes/{diario|mayor|balance}?entidad=&desde=&hasta=` (+ `numero`/`page` en diario, `cuentaId` en mayor, `sinMovimiento=1` en balance, `formato=xlsx` para Excel).
* `GET …/reportes/opciones` (entidades de la empresa y cuentas de la entidad; basta cualquiera de los tres permisos).
* Pantalla: Contabilidad → **Reportes** (`/e/[slug]/contabilidad/reportes`).
* Excel: ExcelJS se carga **bajo demanda** (import dinámico al exportar). **PDF no se implementó** en esta fase (no hay un renderizador tabular reutilizable; queda como paso aparte).

## Fuera de alcance
Estados financieros, cierres, períodos, conciliación bancaria, bancos, CxC/CxP, retenciones, FEL, generación automática de asientos, SQL productivo.
