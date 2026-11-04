# CxP — Antigüedad de saldos de proveedores (MIL-CXP-01)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (pruebas unitarias, de rutas y contra MariaDB 11.8.9 desechable; QA manual en navegador con datos sintéticos y oráculo independiente). **No aprobado para producción.** Sin migraciones ni SQL nuevo.

## Qué hace
Contabilidad → Cuentas por pagar → **Antigüedad de saldos**. Solo lectura. Facturas de proveedor `REGISTRADA` con saldo actual > 0:
`saldo = total_neto_pagar (total − ISR) − pagos REGISTRADOS` (misma definición que `saldo.ts` / `aplicaciones.ts`). Pagos reversados vuelven a contar; la retención no es un pago; las anuladas no adeudan.
Antigüedad **desde la fecha del documento** (0–15, 16–30, 31–60, 61–90, +90). «Días vencidos» solo si hay `fecha_vencimiento`; sin ella: «Sin vencimiento» (nunca se infiere). Importes en quetzales (CxP no registra moneda).

## Alcance de la autorización por entidad (hallazgo de auditoría 1)
Capas que se aplican en **ambos** endpoints (`GET …/contabilidad/cxp/antiguedad` y `…/antiguedad/export`):

| # | Control | Dónde | Resultado si falla |
|---|---|---|---|
| 1 | Sesión válida | `requireTenant` | 401/403 |
| 2 | La empresa de la sesión tiene el módulo Contabilidad | `requireTenantCxp` | 403 |
| 3 | Permiso propio `cxp_facturas`:`ver` (Admin pasa; **ningún rol lo trae por defecto**; `cxp_pagos`, `cxp_bitacora`, `facturacion`, etc. **no** lo conceden) | `requireTenantCxp` | 403 |
| 4 | `?entidad=` exactamente una, entero positivo | `ambitoDesdeRequest` | 400 |
| 5 | **La entidad pertenece a la empresa de la sesión** (agregado en esta revisión; las inactivas siguen siendo consultables por historia) | `antiguedad.ts` | **404** `ENTIDAD_NO_DISPONIBLE` |
| 6 | Todas las consultas filtran `empresa_id` y `entidad_id` | SQL | — |

**Lo que NO existe: autorización por usuario–entidad.** La política confirmada del módulo (`docs/CONTABILIDAD-ACCESO-UNIFICADO.md`, «Libros separados, permisos centralizados») establece que el permiso central cubre **todos los libros activos de las empresas a las que el usuario tiene acceso**, y que `cont_entidad_usuarios` **permanece como tabla legada que no concede ni restringe acceso** (las asignaciones legadas se rechazan). Ningún endpoint de CxP (facturas, pagos, proveedores, bitácora), CxC ni Contabilidad la aplica (ver también `CXP-M3A-BASE.md` §10, `CXP-M3B1-PAGOS-ISR.md` §7, `CONTABILIDAD-REPORTES-M4.md`).
Consecuencia, idéntica a la del resto de CxP: **un usuario con `cxp_facturas`:`ver` puede consultar cualquier entidad de su propia empresa** (nunca de otra). Este reporte no amplía ese alcance: no añade datos que el usuario ya no pueda ver en la pestaña Facturas de la misma entidad. Está fijado por pruebas (`antiguedad-http.test.ts`, «política vigente»; `antiguedad.db.test.ts`, «entidad de OTRA empresa… 404»).

### Solución compatible propuesta (NO implementada; requiere decisión de Contabilidad)
Autorización por entidad **transversal** (no solo para este reporte, para no crear inconsistencias):
- Función única `autorizarEntidad(session, empresaId, entidadId)` en `contabilidad/ambito.ts`, llamada por todos los endpoints de CxP/CxC/Contabilidad.
- **Solo estrecha, nunca concede:** un usuario sin el permiso del módulo sigue sin acceso; Admin exento.
- Fuente: `cont_entidad_usuarios` (`activo = 1`; `puede_editar` para escrituras), que **ya existe** (sin migración).
- Activación **opt-in por empresa** (p. ej. una bandera de configuración) para no romper a nadie al desplegar; con la bandera activa y sin filas para el usuario → sin acceso (fail-closed).
- Pruebas: matriz usuario × entidad × acción; regresión de todos los endpoints.
- Revierte parcialmente una decisión ya confirmada, por eso se deja como ticket aparte con decisión previa.

## Preflight de las migraciones M-3A y M-3B1 (hallazgo 4) — sin ejecutarlas
Las migraciones **no** se ejecutan en este PR ni en producción. Para verificar el estado real de una base **antes** de usar el reporte:

1. `sql/preflight-2026-11-cxp-m3a-base.sql` — **solo lectura** (SELECT/SHOW y `SELECT … INTO` variables de sesión). Audita 74 objetos (tablas, columnas, índices, CHECK, FK). Resultado `estado_cxp_rollout`: `CLEAN` (ninguna tabla CxP: M-3A aún no aplicada), `FINAL` (aplicada y exacta) o `DIVERGENTE` (**detenerse**, no migrar).
2. `sql/preflight-2026-11-cxp-m3b1-pagos.sql` — solo lectura. Audita 43 objetos. Exige M-3A en `FINAL`; sin ella es `DIVERGENTE`. Resultado `estado_cxp_pagos`.
3. Misma sesión de BD para cada script, sin escrituras ni DDL concurrentes (los scripts lo indican). Los archivos se generan con `scripts/generar-sql-cxp-m3a.py` / `…m3b1.py` (no editar a mano).
4. Solo con `CLEAN` se aplican `migrate-…` (con autorización expresa) y luego `postcheck-…` (debe quedar `FINAL`). `rollback-…m3b1` solo con ambas tablas vacías.

Qué hace el reporte según el estado de la base:

| Estado de la base | Reporte de antigüedad |
|---|---|
| M-3A y M-3B1 `FINAL` | funciona completo |
| M-3A `FINAL`, M-3B1 `CLEAN` (sin tablas de pagos) | funciona con pagado 0.00 (exacto: no puede haber pagos), igual que las lecturas existentes |
| M-3A `CLEAN` (sin `cxp_facturas`) | 503 `MIGRACION_PENDIENTE` |
| `DIVERGENTE` | no usar hasta corregir (el preflight indica los objetos) |

Evidencia de la matriz `CLEAN → FINAL → DIVERGENTE` ejecutada **solo sobre una base desechable local**: `04-preflight-evidencia.txt` del paquete de auditoría.

## Pantalla: no exportar con una lista anterior (hallazgo 2)
El estado de carga es un reductor puro (`reducirCargaAntiguedad`): cada solicitud lleva una clave (entidad + filtros + página); la respuesta solo se acepta si corresponde a la **última** clave solicitada (las tardías se descartan) y `puedeExportarAntiguedad` exige lista cargada, sin recarga en curso y de la clave vigente. El botón y `descargar()` usan esa función. Probado con transiciones (filtros, página, entidad, respuestas fuera de orden, fallos) y en navegador con una respuesta retrasada artificialmente.

## Pruebas
`src/lib/contabilidad/cxp/antiguedad-puro.test.ts`, `antiguedad-http.test.ts` y `antiguedad.db.test.ts` (`LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/cxp --no-file-parallelism`, MariaDB 11.8.9 desechable).
