# Programación — Edición rápida tipo Excel + intercambio de recursos · DISCOVERY (PR-0)

Estado: **discovery + PR-0 (preparación de backend sin cambio funcional)**. La edición rápida en sí (endpoints y UI) aún NO existe.
Base analizada: `origin/main` `1705ef7` (incluye #347 requerimientos de viáticos y #348 motor de intervalos A1).

## 1. Problema operativo

Ayer se programaron rutas; hoy un piloto no llegó: hay que quitarlo, tomar a un piloto asignado a otra ruta, reasignarlo, modificar la otra ruta y a veces **intercambiar** pilotos entre dos rutas. Hoy cada viaje se abre completo (`PlanForm`), se baja hasta piloto, se guarda, se vuelve y se repite.

Objetivo futuro: una vista **compacta, una fila por viaje**, con selects inline (piloto, auxiliar principal, auxiliares adicionales, unidad, TC), borrador local con cambios pendientes (Descartar / Validar / Guardar), y **validación del ESTADO FINAL del lote** (no fila por fila contra el estado viejo).

## 2. Arquitectura encontrada

| Tema | Hallazgo |
|---|---|
| Página / tablero | `src/app/e/[slug]/programacion/page.tsx` + `programacion-client.tsx` (tarjetas por viaje) |
| Edición actual | `plan-form.tsx` (formulario completo, crea y edita). No existe un botón literal "Ajustar" |
| Endpoints | `GET/POST/PATCH /api/empresas/[slug]/tms/planes` (`route.ts`, PATCH de **un** plan con el id en el body); `GET …/planes/disponibilidad-recursos`; catálogos `GET /tms/catalogos`, `/rrhh/personal-ops`, `/tms/viaticos-config` |
| Permiso | PATCH: `programacion:editar` (`requireTenantProgramacion`); lecturas: `requireTenantProgramacionOTms` |
| Actualización masiva | No existe para planes. Solo creación en lote (`programacion-lote.ts`: copiar/importar, todo-o-nada, máx. 200) |
| Piloto | `pilotoPersonalId` (id de `tms_personal`) o `pilotoNombre` (legado) → `tms_planes_viaje.piloto_id` |
| Auxiliares | `auxiliarPersonalIds` / `auxiliarEmpleadoIds` / nombres → `tms_plan_auxiliares (orden)`; `auxiliar_id` = principal |
| Unidad | `flotaVehiculoId` o `placa` → `tms_unidades.id` (upsert) en `unidad_id` |
| TC | `tcVehiculoId` (interno) → `tc_vehiculo_id` + `tc_placa_historica`; tercerizado: `tc_externo_placa` (texto) |
| Motivo | piloto/unidad/auxiliares exigen `motivoCambio` (400 si falta) |
| Estados | Cerrado/Cancelado bloquean (409). En ruta: solo notas (con llegada registrada: también piloto/unidad/auxiliares/comercial, no fecha/hora). Programado/Cargado/Descargado: edición operativa |
| Fecha pasada | `fecha_plan < hoy` (Guatemala) no se edita ni se reprograma hacia el pasado (**400**) |
| Candado | `GET_LOCK('tms_traslape_<empresaId>', 8)`; el PATCH lo toma en la conexión de la transacción; `confirmarLote` en una conexión aparte |
| Revalidación | Bajo el candado, con lectura `FOR UPDATE`, antes del UPDATE |
| Concurrencia | `UPDATE … WHERE id AND empresa_id AND estado = ?`; **no hay** `version` ni `updated_at` en `tms_planes_viaje` |
| Auditoría | `registrarAuditoria` DESPUÉS del commit; detalle `Plan #<id> <código> · …` (la bitácora filtra por ese prefijo) |
| Viáticos | Quitar a alguien con viático no PROGRAMADO da 409; `sincronizarViaticosPlan` solo toca filas PROGRAMADO |
| Disponibilidad hoy | Política **diaria** (`primerConflictoProgramacionDia`): un recurso no puede estar en dos planes el mismo día |
| Motor A1 (#348) | `primerConflictoProgramacionIntervalo` ya en main pero **sin flujos conectados** |

## 3. Decisiones de negocio confirmadas

1. **Fechas pasadas: se mantiene la regla actual.** `fecha_plan < hoy` NO editable; `= hoy` y `> hoy` editables según estado. El caso "ayer se programó y hoy faltó el piloto" es un plan de HOY. No se habilita edición histórica.
2. **Motivo de cambio: UNO obligatorio por lote** (p. ej. "Piloto no se presentó", "Cambio operativo", "Unidad no disponible", "Reorganización de programación"), copiado a la auditoría de cada plan afectado.

## 4. Validación del estado final del lote (diseño)

1. `final = esperado + nuevo` por cada plan del lote; los planes fuera del payload no cambian.
2. Contra la BD: ocupación de cada recurso **excluyendo todos los planes del lote** (`excluirPlanIds`, hecho en PR-0), porque esos planes se representan por su estado final.
3. Dentro del lote: para cada recurso, los planes que lo usan en el estado final se comparan entre sí (mismo día hoy; intervalos con A2). Cada solape marca error en ambas filas.
4. Un **intercambio** (A=Carlos,B=Juan → A=Juan,B=Carlos) es válido si sus ventanas no se solapan; rotaciones de 3+ funcionan igual.
5. Reglas por fila: las mismas del PATCH (estado, fecha pasada, incidencias, inactivos, unidad/TC, viáticos avanzados, motivo).
6. Guardar: lock → transacción → recargar planes `FOR UPDATE` → verificar estado y `esperado` → revalidar → aplicar TODO → auditoría dentro de la transacción → commit; cualquier fallo = rollback total.

Concurrencia (A abre, B cambia, A guarda): compare-and-set del snapshot `esperado` (estado, fecha, hora, piloto, auxiliares, unidad, TC) bajo lock; discrepancia = 409 y falla todo el lote. Sin SQL. Una columna `version` queda como opción futura.

## 5. Endpoints propuestos (aún NO creados)

- `POST /api/empresas/[slug]/tms/planes/edicion-rapida/validar` (solo lectura, sin efectos secundarios).
- `POST /api/empresas/[slug]/tms/planes/edicion-rapida` (guardar todo-o-nada).
- Ambos `programacion:editar`, empresa siempre de la sesión.

```json
{ "motivoCambio": "Piloto no se presentó",
  "cambios": [{ "planId": 101,
    "esperado": { "estado": "Programado", "fechaPlan": "2026-09-25", "horaCarga": "05:00", "pilotoId": 10, "auxiliarPersonalIds": [7], "unidadId": 3, "tcVehiculoId": null },
    "nuevo": { "pilotoPersonalId": 20, "auxiliarPersonalIds": [7, 9], "flotaVehiculoId": 55, "tcVehiculoId": 88 } }] }
```
Respuesta de validar: `{ ok, filas: [{ planId, estado: "ok"|"error"|"sin_cambios", errores[], advertencias[] }] }`; guardar: 200, o 409 con `erroresPorFila` sin haber escrito nada.

## 6. UI propuesta (PR-3)

Botón "Edición rápida" → tabla compacta con encabezado fijo (Hora, Ruta, Cliente visibles) y celdas editables para piloto, auxiliares, unidad y TC con los buscadores existentes; marcas ✓ sin cambios / ● modificado / ⚠ conflicto; resumen `Cambios · OK · Conflictos`; botones Descartar / Validar / Guardar; sin autoguardado. Filas no editables (Cerrado, Cancelado, En ruta, Tercerizado, fecha pasada) con su motivo. "Intercambiar" entre dos filas es viable como azúcar de UI sobre el mismo borrador (PR-4).

## 7. Plan de PRs

| PR | Contenido |
|---|---|
| **PR-0** (este) | Motor A1 con `excluirPlanIds`; validaciones del PATCH extraídas a `src/lib/tms/programacion-validacion-recursos.ts` **sin cambio funcional**; tests de equivalencia; este documento |
| PR-1 | `…/edicion-rapida/validar` (solo lectura, estado final, intercambios/rotaciones, política diaria) |
| PR-2 | `…/edicion-rapida` guardar todo-o-nada (lock, `esperado`, transacción, viáticos, auditoría con motivo único) |
| PR-3 | UI "Edición rápida" |
| PR-4 | Acción "Intercambiar" (opcional) |

## 8. Dependencia A2

A2 (migrar POST, PATCH, importación y copia al motor de intervalos) **no está hecho**. Las validaciones de lote deben quedar detrás de una única función de conflictos de lote para que A2 cambie solo esa pieza. Este PR no migra el PATCH: sigue con la política diaria.

## 9. Riesgos y notas

- Viáticos ya autorizados/entregados impiden sacar a una persona de un viaje (regla vigente, se conserva); la UI futura debe explicarlo.
- El lock por empresa dura 8 s: limitar el lote (~50 filas) y validar en solo lectura antes de tomar el lock.
- `personalDesdeEmpleado` y el alta por nombre pueden crear filas en `tms_personal`: el PATCH conserva ese comportamiento ("escritura"); la validación futura usa el modo **"lectura"** (`resolverSeleccionPersonal(…, "lectura")`) que nunca inserta ni actualiza.
- Una misma persona puede tener varias filas en `tms_personal`; los motores ya la agrupan por `id_empleado`.
- Deuda ajena conocida: `programacion-tc.test.ts` usa fechas fijas ya pasadas (no se corrige en este PR).

## 10. Qué cambió en PR-0

- `disponibilidad-programacion-intervalos.ts`: `primerConflictoProgramacionIntervalo(empresaId, recursos, ventana, excluirPlanIds: readonly number[], conn?)` — `[]` no excluye, ids deduplicados, `p.id NOT IN (?,…)` parametrizado, mismo filtro de empresa/estado/ventana para personal, unidad y TC. Helper `normalizarPlanesExcluidos`.
- `programacion-validacion-recursos.ts` (nuevo): `camposTocados`, `validarMotivoCambioRecursos`, `validarEstadoEditable`, `validarFechaNoPasada`, `validarRegresoPosteriorASalida`, `resolverCambioTc`, `resolverSeleccionPersonal` (modo escritura/lectura), `personalExistenteDesdeEmpleado`, `calcularCambiosRecursos`, `personalQueSale`, `validarRemocionConViaticos`, `evaluarDisponibilidadPersonal`, `evaluarDisponibilidadUnidad`.
- `planes/route.ts` (PATCH): llama a esos helpers; contrato de request/response, mensajes, permisos, política diaria, lock, transacción, viáticos, auditoría y orden de operaciones **sin cambios**.
- Sin SQL, sin UI, sin endpoints nuevos.
