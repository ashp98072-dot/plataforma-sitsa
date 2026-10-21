# TMS — El cierre de viaje exige REPORTE_RECIBIDO

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local** (tsc, ESLint, pruebas unitarias y de BD contra MariaDB 11.8.9
desechable). No probado manualmente en navegador; no aprobado para producción. **Sin SQL, sin migración, sin backfill.**

## Secuencia de negocio

Viaje realizado → **Reporte recibido** → Ajustes / cargos → **Cerrar viaje** → Liquidar → Facturación / reportes.

Ya existían: confirmación de `REPORTE_RECIBIDO`, estados de liquidación, cargos adicionales y la regla «solo se liquida un viaje
Cerrado». Faltaba impedir el **cierre inicial** sin reporte (esto elimina el «callejón» de un viaje Cerrado que ya no puede confirmar
reporte ni liquidarse).

## 1. Discovery — TODOS los caminos que cierran un viaje [CONFIRMADO en código]

| Camino | Entrada | Cierra con |
|---|---|---|
| Cierre individual normal | `POST /tms/planes/[id]/cerrar` | `cerrarViaje` (`cierre-viaje.ts`) |
| Cierre individual manual | `POST /tms/planes/[id]/cerrar` con `manual: true` | `cerrarViajeManual` |
| Cierre masivo (ids elegidos) normal/manual | `POST /tms/planes/cerrar-masivo` | `cerrarViajesMasivo` → `cerrarViaje` / `cerrarViajeManual` |
| Cierre masivo por Día/Semana/Mes | `POST /tms/planes/cerrar-masivo-periodo` | `cerrarViajesMasivoPorPeriodo` → `cerrarViajesMasivo` → ídem |

- **Solo hay DOS escritores de `estado = 'Cerrado'`** (`cerrarViaje` y `cerrarViajeManual`, ambos en `cierre-viaje.ts`); una prueba de
  arquitectura (`git grep`) lo verifica. El resto de `UPDATE tms_planes_viaje` (PATCH de Programación, edición rápida, importador,
  salida/llegada del piloto) no puede producir `Cerrado`: el PATCH solo acepta `Programado | Cargado | Cancelado`.
- Estados de liquidación (`tms_viaje_liquidaciones`): `REPORTE_RECIBIDO` / `LIQUIDADO` / `EN_AJUSTE`; **ausencia de fila = sin reporte
  confirmado**. No existe un estado «PENDIENTE»; `LIQUIDADO`/`EN_AJUSTE` son posteriores al cierre.
- Permiso del cierre: `viajes_cerrar:editar` (sin cambios). Tercerizados usan el MISMO flujo (`tipo_viaje` solo se audita).
- Semántica del masivo (sin cambios): **parcial**, no todo-o-nada; cada viaje en su propia transacción; los no elegibles quedan en
  `omitidos` con su motivo.

## 2. Regla implementada

Un viaje solo pasa a `Cerrado` si **el reporte FUE recibido** (no «el estado actual es exactamente `REPORTE_RECIBIDO`»):

1. la liquidación actual está en `REPORTE_RECIBIDO`; **o**
2. existe el **evento append-only `REPORTE_RECIBIDO`** de ese plan (`tms_viaje_liquidacion_eventos`, `tipo = 'REPORTE_RECIBIDO'`),
   que es la **fuente autoritativa** para planes heredados que ya avanzaron antes de exigir el cierre previo.

| Liquidación / historia | ¿Habilita el cierre? |
|---|---|
| sin fila ni evento / tabla ausente | **No** (409 `REPORTE_NO_RECIBIDO`) |
| `REPORTE_RECIBIDO` actual | **Sí** (sujeto a estado/llegada/tarifa de siempre) |
| `EN_AJUSTE` / `LIQUIDADO` **con** evento `REPORTE_RECIBIDO` | **Sí** (heredado: evidencia real de que el reporte se recibió) |
| `EN_AJUSTE` / `LIQUIDADO` **sin** evento `REPORTE_RECIBIDO` (fixture inválido) | **No** — el estado posterior por sí solo no basta |

Para planes **nuevos** el flujo sigue siendo `REPORTE_RECIBIDO → Cerrar → Liquidar` (#460 impide liquidar un viaje abierto, así que
ningún plan nuevo llega a ese estado heredado). El cierre **no** modifica la liquidación ni crea eventos; no hay backfill ni fecha de
activación.
El reporte es el **último requisito**: Cancelado, ya Cerrado, sin tarifa y «llegada pendiente» conservan sus mensajes actuales.

## 3. Backend (servidor, dentro de la operación de cierre)

- `cerrarViaje`: el `UPDATE` condicional (que ya bloquea la fila del plan) y, **antes de comprometer**, `SELECT … FROM
  tms_viaje_liquidaciones … FOR UPDATE` en la misma transacción; si la liquidación actual no es `REPORTE_RECIBIDO`, se consulta el
  evento histórico (`empresa_id + plan_id + tipo = 'REPORTE_RECIBIDO'`, solo lectura, evento inmutable). Sin ninguno de los dos:
  `ROLLBACK` (el viaje NO queda cerrado) y `{ ok: false, error, codigo: "REPORTE_NO_RECIBIDO" }`.
- `cerrarViajeManual`: con el plan ya bloqueado (`FOR UPDATE`) lee la liquidación bajo lock **antes de tocar `flota_viajes` o el
  plan**; un rechazo no escribe nada.
- **Orden de locks:** plan → liquidación (→ flota en el manual), el mismo que `liquidarViaje`/`confirmarReporteRecibido`: sin
  deadlocks nuevos.
- **Nunca modifica ni crea liquidación, eventos ni cargos** (solo lee con lock).
- HTTP **409** con `{ error: "No se puede cerrar el viaje porque el reporte aún no ha sido recibido.", codigo: "REPORTE_NO_RECIBIDO" }`;
  sin detalles SQL.
- **Cierre masivo:** la consulta inicial trae `estado_liquidacion`; un viaje sin reporte se **omite con su motivo** (no se cierra ni
  aborta el lote) y cada cierre individual lo **revalida bajo lock** (cubre la carrera).
- **Cierre por período:** `obtenerCandidatosCierre` trae `reporteRecibido`; los candidatos elegibles por estado/llegada/tarifa pero sin
  reporte se devuelven en `omitidos` (con motivo), cuentan en `solicitados` y no se cierran. La vista previa
  (`candidatos-cierre`) informa `sinReporte` por tipo de cierre.
- Si la tabla de liquidaciones no existe, **falla cerrado** (ningún reporte pudo registrarse): no hay cierres silenciosos.

## 4. UI

- Planes / Viajes: elegible por estado/llegada/tarifa pero sin `REPORTE_RECIBIDO` ⇒ **«Cerrar viaje» DESHABILITADO** con el texto
  «Confirme primero la recepción del reporte.» (tooltip y aviso en el detalle; no se oculta). Con reporte, funciona como siempre. La
  selección para cierre masivo ya no incluye esos viajes.
- Si no se puede cerrar por **tarifa**, el aviso de tarifa se conserva igual que antes.
- **Backend manda:** la UI es secundaria. La pantalla legada `/e/[slug]/tms` no conoce la liquidación de cada viaje, así que su
  botón sigue visible; si se usa sin reporte, el servidor responde 409 y se muestra el mensaje.

## 5. Compatibilidad histórica y lo que NO cambia

- **Sin backfill**: no se cierra ni modifica ningún viaje; la regla aplica al **acto de cerrar** desde ahora.
- **No usa `fecha_activacion_liquidacion`** (fase posterior).
- Reabrir una liquidación **no** reabre el viaje; `Cerrado + EN_AJUSTE` y `Cerrado + LIQUIDADO` siguen Cerrados (probado).
- Sin cambios en facturación, FEL, contabilidad, fondos/gastos, RRHH/planilla, cargos ni en el flujo de liquidación.

## 6. Riesgos y puntos a decidir

1. **Impacto operativo inmediato:** todo viaje abierto necesita ahora su reporte confirmado (`viajes_confirmar_reporte`) antes de
   poder cerrarse, incluidos los «pendientes de cierre» de hoy. Conviene avisar a Operaciones y asignar el permiso.
2. **Datos heredados (resuelto por compatibilidad):** un viaje ABIERTO `LIQUIDADO`/`EN_AJUSTE` creado con la Fase 3 anterior a
   exigir cierre previo (p. ej. el plan 587: `Programado` + `EN_AJUSTE`, historia `REPORTE_RECIBIDO v1 → LIQUIDADO → REABIERTO`)
   **sí se puede cerrar** porque tiene el evento `REPORTE_RECIBIDO`; se cierra con el flujo existente (Programado ⇒ cierre manual,
   con motivo y tarifa) **sin reescribir la historia**. Solo quedaría bloqueado un caso con fila de liquidación pero SIN evento
   (inconsistente; no lo produce la aplicación). Verificación de solo lectura propuesta (NO ejecutada):
   `SELECT p.id, p.codigo, p.estado, l.estado FROM tms_planes_viaje p JOIN tms_viaje_liquidaciones l ON l.empresa_id = p.empresa_id
   AND l.plan_id = p.id WHERE p.estado NOT IN ('Cerrado','Cancelado') AND l.estado <> 'REPORTE_RECIBIDO'
   AND NOT EXISTS (SELECT 1 FROM tms_viaje_liquidacion_eventos e WHERE e.empresa_id = l.empresa_id AND e.plan_id = l.plan_id
   AND e.tipo = 'REPORTE_RECIBIDO');` (devuelve solo los que seguirían bloqueados)
3. **Falla cerrada sin la migración de liquidación:** si el código se desplegara donde no existe `tms_viaje_liquidaciones`, nada
   podría cerrarse. La migración de la Fase 1 ya está aplicada en producción; verificar antes de desplegar.
4. **Cierre manual también exige reporte** (el manual solo omite la llegada física, no el reporte). Si negocio quisiera una excepción,
   sería una decisión aparte.
5. **Pantalla legada `/e/[slug]/tms`** no deshabilita el botón (ver §4).
6. **Carrera benigna:** si el reporte se confirma al mismo tiempo que se intenta cerrar, el cierre puede rechazarse una vez; basta
   reintentar (probado: jamás queda Cerrado sin REPORTE_RECIBIDO).

## 7. Pruebas

- Unitarias/endpoint: regla pura (exactamente `REPORTE_RECIBIDO`), `cerrarViaje`/`cerrarViajeManual` (sin fila, estados
  posteriores, tabla ausente, errores de BD, orden de locks, sin escritura en liquidaciones), rutas (409 + `codigo`, tenant, permiso),
  cierre masivo/por período (válidos e inválidos, carrera bajo lock, tabla ausente), candidatos, UI (botón deshabilitado) y
  arquitectura (todos los caminos pasan por el gate).
- BD (`cierre-requiere-reporte.db.test.ts`, MariaDB 11.8.9 desechable, SQL real): sin fila, `REPORTE_RECIBIDO` (liquidación y cargos
  intactos), `EN_AJUSTE`/`LIQUIDADO` abiertos, Cancelado/Cerrado, tercerizado, En ruta con/sin llegada, cierre manual (sin tocar
  `flota_viajes`), masivo mixto, aislamiento por empresa, concurrencia confirmar-vs-cerrar y doble clic, y no escritura en
  facturación/FEL/contabilidad/fondos/gastos.
- Verificado con mutación (sin el gate fallan 26 pruebas).
- **Compatibilidad con planes heredados (BD):** `Programado + EN_AJUSTE` con historia `REPORTE_RECIBIDO v1 → LIQUIDADO v2 → REABIERTO v3`
  (equivalente al plan 587) se cierra sin modificar liquidación ni eventos (huella idéntica antes/después), `Descargado + LIQUIDADO`
  con evento, `EN_AJUSTE`/`LIQUIDADO` con fila pero sin evento bloqueados, masivo mixto y `liquidacionesDePlanes.reporteRecibido`.
