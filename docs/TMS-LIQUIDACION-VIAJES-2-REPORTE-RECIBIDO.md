# TMS — Liquidación de viajes · FASE 2: confirmar «reporte recibido» + color/badge en Planes/Viajes

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local** (compilación, ESLint, pruebas unitarias/arquitectura/contraste, pruebas de BD y
concurrencia contra MariaDB 11.8.9 desechable). **NO probado manualmente en producción ni aprobado para producción.** Sin SQL nuevo (usa las
tablas de Fase 1, ya instaladas). Continúa [Fase 1](TMS-LIQUIDACION-VIAJES-1-MODELO.md) y [0B](TMS-LIQUIDACION-VIAJES-0B-DECISIONES.md).

## Alcance

| Incluye | NO incluye |
|---|---|
| `POST /api/empresas/[slug]/tms/planes/[id]/reporte-recibido` (confirmación humana, idempotente, con advertencias reconocibles) | Liquidar / reabrir desde la UI (Fase 3), cargos (Fase 4) |
| Permiso `viajes_confirmar_reporte` (fila propia, sin concesión por rol) + guard `requireTenantViajesConfirmarReporte` | **Cambio del cierre (Fase 5)**: el cierre normal, manual, masivo y por período NO consultan la liquidación |
| Columna «Liquidación» + fila amarilla sin reporte confirmado o en ajuste + badge + leyenda en Planes/Viajes y reporte de viajes | Configurar la fecha de activación, facturación, fondos/gastos, cuadrilla real, FEL, contabilidad |

## Endpoint

`POST /tms/planes/[id]/reporte-recibido` · permiso `viajes_confirmar_reporte:editar` · body estricto `{ observacion?: string(≤500), reconocerAdvertencias?: boolean }`
(la empresa y el usuario salen **siempre** de la sesión; cualquier otro campo ⇒ 400).

| Caso | Respuesta |
|---|---|
| Sin permiso | 403 (guard) |
| Viaje de otra empresa / inexistente | 404 |
| Viaje `Cerrado`/`Cancelado` | 409 (`PLAN_NO_ADMITE`) |
| Sin salida o sin llegada del piloto y sin reconocer | **409** `{ codigo: "ADVERTENCIAS", advertencias[] }`, **sin escribir nada** |
| Reconocidas, o sin advertencias | 200 `{ idempotente, liquidacion: { estado: "REPORTE_RECIBIDO", version: 1 } }` y evento `REPORTE_RECIBIDO` (advertencias reconocidas en el detalle) |
| Ya en `REPORTE_RECIBIDO` | 200 `idempotente: true`, sin evento nuevo (no vuelve a advertir) |
| Ya `LIQUIDADO`/`EN_AJUSTE` | 409 (`ESTADO_NO_PERMITE`) |

Las advertencias (decisión D02: **advertir, no bloquear**) las calcula el servidor leyendo `flota_viajes` (solo lectura): `SIN_SALIDA_REGISTRADA`,
`SIN_LLEGADA_REGISTRADA`. Confirmar el reporte **no** equivale a llegada, no cierra, no liquida y no modifica `tms_planes_viaje`.

Textos para Operaciones (los pilotos aún no registran salida/llegada en el sistema): «Este viaje no tiene salida registrada por el piloto. Puede
confirmar el reporte de todas formas.» / «Este viaje no tiene llegada registrada por el piloto. Puede confirmar el reporte de todas formas.»; el botón
del modal con advertencias dice «Confirmar reporte de todas formas». La falta de salida/llegada **nunca** bloquea; la advertencia reconocida queda en el evento.

## Permiso (patrón real del repositorio)

Mismo patrón que `viajes_cerrar`/`PERMISOS_ENTREGA`: id de fila ≤ 40 en `usuario_modulo.modulo`; `PERMISOS_LIQUIDACION_VIAJE` en `permisos-shared.ts`
(lista de permisibles, módulo de empresa `tms`, etiqueta, grupo de la matriz, exclusión de navegación); acción de catálogo en el módulo
`programacion` (`confirmar_reporte`, flag `puedeEditar` = puede actuar); guard en `tenant.ts`. **Ningún rol lo trae por defecto** (ni Jefe/Gerente) y
`viajes_cerrar` no lo concede: se asigna manualmente desde Usuarios. Admin lo recibe como todo el catálogo (igual que `viajes_cerrar`).
`viajes_liquidar`, reapertura, cargos y configuración **no** se declaran todavía.

## Reglas de UI (Planes/Viajes)

**Regla visual: amarillo significa «requiere una acción pendiente»: viaje activo sin reporte confirmado o liquidación en ajuste.**
Confirmar el reporte cambia amarillo a superficie normal; reabrir cambia normal a amarillo; reliquidar vuelve a normal.
Esto no altera estados, transiciones ni la regla funcional de estar pendiente de liquidar: un reporte recibido aún puede estar pendiente de liquidar,
pero no se pinta amarillo. No se implementa ninguna funcionalidad de Fase 3 en este ajuste.

| Situación del viaje | Fila | Badge de texto |
|---|---|---|
| Activo (Programado/Cargado/En ruta/Descargado) **sin liquidación registrada** | amarillo | **Pendiente** |
| `REPORTE_RECIBIDO` | superficie normal del tema | Reporte recibido |
| `EN_AJUSTE` | amarillo | En ajuste |
| `LIQUIDADO` | superficie normal del tema | Liquidado |
| `Cerrado`/`Cancelado` **sin** liquidación registrada (histórico / no aplica) | superficie normal | «—» |

El último caso se mantiene a propósito: un viaje ya cerrado o cancelado sin liquidación es histórico (decisión 0B: no se marca «liquidado» ni
«pendiente» el pasado, sin backfill). Si el negocio quiere ver también los cerrados históricos en amarillo, es un cambio de una función
(`estaPendienteDeLiquidacion`).

- **Fondo COMPLETO del `<tr>`**; el color del **texto principal no cambia**.
- **«Blanco» = `--card`** (blanco en claro; tarjeta oscura en oscuro). Nunca blanco literal en oscuro.
- **Tokens** (por tema): `--fila-pendiente-liquidar` = `#fff3bf` (claro) / `#3a3218` (oscuro); `--fila-hover`; `--accion-reporte`; y
  `--fila-pendiente-muted` / `--fila-pendiente-accent`, que **solo dentro de la fila amarilla** ajustan el texto secundario y el enlace de acento para
  conservar ≥ 4.5:1 (`#526079` / `#1d5f96` en claro; `#93a4b8` / `#5ea8e0` en oscuro).
- **Contraste** verificado por prueba sobre la fila: texto ≥ 7:1 (≈ 16:1 claro, ≈ 10.9:1 oscuro); secundario, acento y «Confirmar reporte» ≥ 4.5:1.
- **Hover y selección** son capas independientes del fondo (`background-image` y `box-shadow` inset en la primera celda).
- **El color no es el único portador**: badge de texto con contraste ≥ 4.5:1, columna «Liquidación» y leyenda «Fila amarilla = requiere una acción
  pendiente (sin reporte confirmado o en ajuste). Fondo normal = reporte recibido, liquidado o histórico cerrado/cancelado sin liquidación».
- **Acción «Confirmar reporte»**: solo en la vista operativa, con permiso, sin liquidación y viaje no cerrado/cancelado; la vista de reportes es de
  consulta (color/badge sin acciones).
- El badge existente «Pendiente de cierre» (llegada registrada) **no se reutiliza ni se modifica**.

## Qué NO cambia

`cierre-viaje*.ts`, `cierre-masivo.ts`, las rutas de cierre y `accionesViaje` no mencionan la liquidación (prueba de arquitectura). Sin fecha de activación el
sistema se comporta exactamente como antes; esta fase no la configura.

## Riesgos / pendientes

- La nueva consulta de la lista (`liquidacionesDePlanes`) es una lectura por empresa en lote y tolerante (sin tablas ⇒ «—»); no altera filtros, KPIs ni
  exportaciones.
- **Verificación visual:** el contraste y las reglas CSS están verificados por prueba; no se hizo una revisión visual en navegador con datos reales.
- El enlace de acento y el texto secundario se ajustan **solo dentro de la fila amarilla** (tokens por tema) para conservar el contraste; fuera de ella
  el tema no cambia (el acento oscuro normal sobre la tarjeta ya era ≈3.0:1: hallazgo del tema existente, no corregido aquí).
- La leyenda sigue la semántica visual confirmada: amarillo solo sin reporte confirmado o en ajuste. Este ajuste no modifica los textos ni el flujo de advertencias.
