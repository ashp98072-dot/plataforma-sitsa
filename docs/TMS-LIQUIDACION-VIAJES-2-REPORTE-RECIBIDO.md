# TMS — Liquidación de viajes · FASE 2: confirmar «reporte recibido» + color/badge en Planes/Viajes

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local** (compilación, ESLint, pruebas unitarias/arquitectura/contraste, pruebas de BD y
concurrencia contra MariaDB 11.8.9 desechable). **NO probado manualmente en producción ni aprobado para producción.** Sin SQL nuevo (usa las
tablas de Fase 1, ya instaladas). Continúa [Fase 1](TMS-LIQUIDACION-VIAJES-1-MODELO.md) y [0B](TMS-LIQUIDACION-VIAJES-0B-DECISIONES.md).

## Alcance

| Incluye | NO incluye |
|---|---|
| `POST /api/empresas/[slug]/tms/planes/[id]/reporte-recibido` (confirmación humana, idempotente, con advertencias reconocibles) | Liquidar / reabrir desde la UI (Fase 3), cargos (Fase 4) |
| Permiso `viajes_confirmar_reporte` (fila propia, sin concesión por rol) + guard `requireTenantViajesConfirmarReporte` | **Cambio del cierre (Fase 5)**: el cierre normal, manual, masivo y por período NO consultan la liquidación |
| Columna «Liquidación» + fila amarilla (REPORTE_RECIBIDO / EN_AJUSTE) + badge + leyenda en Planes/Viajes y reporte de viajes | Configurar la fecha de activación, facturación, fondos/gastos, cuadrilla real, FEL, contabilidad |

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

## Permiso (patrón real del repositorio)

Mismo patrón que `viajes_cerrar`/`PERMISOS_ENTREGA`: id de fila ≤ 40 en `usuario_modulo.modulo`; `PERMISOS_LIQUIDACION_VIAJE` en `permisos-shared.ts`
(lista de permisibles, módulo de empresa `tms`, etiqueta, grupo de la matriz, exclusión de navegación); acción de catálogo en el módulo
`programacion` (`confirmar_reporte`, flag `puedeEditar` = puede actuar); guard en `tenant.ts`. **Ningún rol lo trae por defecto** (ni Jefe/Gerente) y
`viajes_cerrar` no lo concede: se asigna manualmente desde Usuarios. Admin lo recibe como todo el catálogo (igual que `viajes_cerrar`).
`viajes_liquidar`, reapertura, cargos y configuración **no** se declaran todavía.

## Reglas de UI (Planes/Viajes)

- **Fila amarilla = fondo COMPLETO del `<tr>`** para `REPORTE_RECIBIDO` y `EN_AJUSTE`; el color del **texto no cambia**. `LIQUIDADO` y «sin liquidación»
  = superficie normal del tema + badge/«—». Sin registro **nunca** se muestra «Liquidado» (históricos intactos).
- **Sin blanco literal en oscuro**: «blanco» es `--card` (blanco en claro; tarjeta oscura en oscuro). Tokens nuevos `--fila-pendiente-liquidar`
  (`#fffadc` claro / `#2b2714` oscuro), `--fila-hover`, `--accion-reporte`. Contraste verificado por prueba: texto ≥ 7:1, secundario ≥ 4.5:1, enlace ≥ 4.5:1.
- **Hover y selección** son capas independientes del fondo (`background-image` y `box-shadow` inset en la primera celda): siguen visibles sobre el amarillo.
- **El color no es el único portador**: badge de texto («Reporte recibido», «En ajuste», «Liquidado») con contraste ≥ 4.5:1, columna «Liquidación» y leyenda.
- **Acción «Confirmar reporte»**: solo en la vista operativa, con permiso, sin liquidación y viaje no cerrado/cancelado; diálogo con observación opcional y
  advertencias (se vuelve a enviar reconociéndolas). La vista de reportes es de consulta: muestra color/badge, sin acciones.
- El badge existente «Pendiente de cierre» (llegada registrada) **no se reutiliza ni se modifica** en esta fase.

## Qué NO cambia

`cierre-viaje*.ts`, `cierre-masivo.ts`, las rutas de cierre y `accionesViaje` no mencionan la liquidación (prueba de arquitectura). Sin fecha de activación el
sistema se comporta exactamente como antes; esta fase no la configura.

## Riesgos / pendientes

- La nueva consulta de la lista (`liquidacionesDePlanes`) es una lectura por empresa en lote y tolerante (sin tablas ⇒ «—»); no altera filtros, KPIs ni
  exportaciones.
- **Verificación visual:** el contraste y las reglas CSS están verificados por prueba; no se hizo una revisión visual en navegador con datos reales.
- En modo oscuro el enlace de acento (`--accent`) sobre la fila amarilla baja de ≈3.0:1 a ≈2.6:1 (ya era bajo sobre la tarjeta); es un hallazgo del tema
  existente, no se corrigió aquí.
- El texto exacto de las advertencias y de la leyenda es propuesta; pendiente de confirmación con Operaciones (D01/D04).
