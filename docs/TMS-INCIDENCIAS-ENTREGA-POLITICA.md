# TMS — Gestión administrativa de incidencias de entrega: auditoría y política de resolución

**Estado: PROPUESTA para aprobación. No hay código de aplicación, no se ejecutó SQL (ni en una base desechable) y no se modificó ningún dato.**
Entregables de este PR: este documento y `sql/migrate-2026-11-tms-incidencias-resoluciones.sql` (para revisión independiente). El módulo se implementa en PRs separados **después** de aprobar la política (§9).

Vocabulario: **incidencia** = una confirmación del piloto con resultado `PARCIAL`, `RECHAZADA` o `INCIDENCIA` (`tms_parada_confirmaciones`, `revision='PENDIENTE'`). **Resolver una incidencia NO equivale a una entrega aceptada por el cliente ni por PriceSmart**; ninguna decisión de este diseño produce «entregada» ni «recepción oficial».

## 1. Hallazgos de la auditoría (código real en `main`)

**Confirmaciones (`src/lib/tms/parada-confirmacion.ts`, `sql/migrate-2026-11-tms-parada-confirmaciones.sql`)**
1. **Callejón sin salida hoy.** `confirmarParadaPorPiloto` lee la última confirmación de la parada y, si no es un reintento idéntico del mismo piloto, responde `YA_CONFIRMADA` (si fue entregada) o `REVISION_PENDIENTE` (cualquier otra). **No existe ninguna salida**: una incidencia bloquea la parada para siempre.
2. **`revision` es una marca de creación, no un estado.** `ck_tmspc_vigente` obliga `revision='PENDIENTE'` ⇔ `resultado<>'ENTREGADA_POR_PILOTO'`, y la aplicación nunca hace `UPDATE` (la cuenta del laboratorio solo tiene `SELECT/INSERT`). Una resolución **no puede** vivir en esa columna: debe ser un registro aparte.
3. **`uq_tmspc_entrega (parada_id, entrega_vigente)`** admite **una sola** entrega por parada pero **cualquier número de incidencias** (`entrega_vigente` NULL). Por tanto un reintento autorizado puede terminar en `ENTREGADA` (primera y única) o en otra incidencia, sin chocar con el índice. No hay que cambiarlo.
4. **El «reintento idéntico» (replay) chocaría con los reintentos autorizados**: tras autorizar, un nuevo `PARCIAL` del mismo piloto se vería como replay del anterior. La regla de replay debe acotarse (ver §4).
5. **Condiciones de la confirmación**: viaje `abierto` y plan `En ruta` (líneas ~130–131), evidencia `producto` de esa parada (la última por `id`), solo piloto principal/extra, `READ COMMITTED` de sesión + bloqueo `FOR UPDATE` de la parada (serializa confirmaciones). **Una autorización dada después de que el viaje terminó no podría usarse nunca** (ver decisión D-2).
6. **Evidencia**: `evidenciaConfirmada` impide eliminar la evidencia de cualquier confirmación (también de incidencias), y la fila conserva una copia (ruta, captura, autor). La evidencia se identifica por `flota_viaje_evidencias.id` **autoincremental**: sirve como «corte» monótono sin depender de relojes.
7. **La pantalla del piloto** (`parada-confirmacion-ui.ts`: `puedeActuar/puedeEnviar` = «sin confirmación») ofrece acciones solo si la parada no tiene ninguna confirmación. Habrá que pasarlo a un **estado derivado** (§3).
8. **`listarEntregasDelViaje`** devuelve la última confirmación por parada; no conoce resoluciones.
9. **La limpieza administrativa de operaciones** (`validarReferencias`) ya se bloquea si hay filas que referencien `plan_id`/`parada_id`: las tablas nuevas heredarán ese bloqueo (deseado).

**Operaciones, permisos y auditoría (precedente a imitar)**
10. **Permisos explícitos por acción** en `src/lib/permisos-catalogo.ts` (`agregar("programacion", accion("viajes_confirmar_reporte", …, E))`: «ningún rol la trae por defecto») con guard dedicado (`requireTenantViajesConfirmarReporte(slug, "editar")` en `src/lib/tenant.ts`): empresa y usuario salen **de la sesión**, cuerpo `zod .strict()`, `Admin` pasa. La resolución debe seguir exactamente este patrón.
11. **Eventos append-only con versión**: `tms_viaje_liquidacion_eventos` (`UNIQUE (empresa_id, plan_id, version)`, `CHECK` de transiciones, FK `RESTRICT` a `usuarios`, «la aplicación no emite UPDATE/DELETE»). La tabla de resoluciones copia ese diseño; la `secuencia` hace de «versión» para detectar revisiones obsoletas.
12. **Pantallas internas**: `src/app/e/[slug]/tms/solicitudes-clientes` (página servidor + componente cliente de bandeja con filtros + API en `/api/empresas/[slug]/tms/...`). La bandeja nueva sigue ese molde: `/e/[slug]/tms/incidencias-entrega`.
13. **Relaciones**: confirmación → `plan_id` → `tms_planes_viaje.cliente_id` → `tms_clientes.nombre`; `viaje_id` → `flota_viajes`; piloto = `piloto_empleado_id`/`piloto_personal_id`/`piloto_usuario` (copia en la fila); parada = copia (`parada_tipo/orden/lugar_nombre`); evidencia = `evidencia_id` + ruta copiada. El visor de fotos existente exige permisos de Flota/TMS genéricos: la bandeja necesita **su propio endpoint de archivo** acotado por empresa y por «esta evidencia pertenece a una confirmación de esta empresa».

## 2. Decisiones que requieren al propietario (antes de implementar)

| ID | Decisión | Recomendación |
|---|---|---|
| **D-1** | ¿Se acepta una **tercera decisión** `CERRAR_SIN_ENTREGA` (cierra la incidencia sin reintento y sin entrega)? Sin ella, una `RECHAZADA` legítima (el cliente no recibió) **queda pendiente para siempre**. | **Sí.** Está incluida en el SQL propuesto; si se rechaza, se elimina de `ck_tmspr_*`. |
| **D-2** | ¿Se puede autorizar un nuevo intento cuando el viaje ya no está «En ruta»? Hoy el piloto solo confirma con viaje abierto y plan «En ruta». | **No**: `AUTORIZAR_NUEVO_INTENTO` solo si el viaje sigue abierto y en ruta; si no, usar `MANTENER_PENDIENTE` o `CERRAR_SIN_ENTREGA`. (Permitir reintentos con el viaje cerrado exigiría confirmaciones «por Operaciones», fuera de alcance.) |
| **D-3** | Permiso nuevo: `programacion` → acción `viajes_resolver_incidencias` («Resolver incidencias de entrega», nivel `editar`), sin rol por defecto (`Admin` pasa, como en las demás). La **lectura** de la bandeja con `programacion:ver`/TMS. | Aprobar nombre y quién lo recibe. |
| **D-4** | ¿Una incidencia **pendiente** debe impedir cerrar/liquidar el viaje? | **Solo advertencia** (mismo patrón `ADVERTENCIAS` de «reporte recibido»), no bloqueo; hoy los cierres no la conocen. |
| **D-5** | Corrección de una entrega confirmada por error (`ENTREGADA_POR_PILOTO`): **fuera de alcance**; ninguna decisión la revierte. | Mantener fuera; decidir aparte si se necesita. |
| **D-6** | La **justificación** se guarda completa en la tabla de resoluciones (visible a Operaciones); la auditoría general solo lleva ids y decisión (como las notas del piloto). | Aprobar. |

## 3. Máquina de estados (derivada, no almacenada)

El estado de una parada se **calcula** de dos listas append-only: sus confirmaciones `C` (por `id`) y las resoluciones `R` de la última incidencia (por `secuencia`). No hay columna de estado que actualizar.

| Estado derivado | Condición | Piloto puede confirmar | Admin puede resolver |
|---|---|---|---|
| `SIN_CONFIRMAR` | no hay confirmaciones | Sí (con evidencia) | — |
| `ENTREGADA_POR_PILOTO` | última `C` = entregada | No (terminal) | No (D-5) |
| `INCIDENCIA_PENDIENTE` | última `C` = incidencia, sin resoluciones | No | Sí |
| `INCIDENCIA_MANTENIDA` | última resolución = `MANTENER_PENDIENTE` | No | Sí |
| `REINTENTO_AUTORIZADO` | última resolución = `AUTORIZAR_NUEVO_INTENTO` | **Sí**, con evidencia **posterior al corte** | No (ya cerrada) |
| `INCIDENCIA_CERRADA` | última resolución = `CERRAR_SIN_ENTREGA` | No (terminal sin entrega) | No |

Transiciones: pendiente/mantenida → (mantener) mantenida · → (autorizar) reintento autorizado · → (cerrar) cerrada. Un reintento confirma una **fila nueva** `C'` unida a la autorización en `tms_parada_confirmacion_reintentos`; `C'` es entregada (terminal) o una **nueva incidencia** (nuevo ciclo, con su propia `secuencia` desde 1). Ninguna transición cambia una incidencia en entregada: la entrega nace solo de una nueva confirmación del piloto.

## 4. Reglas de la política

1. **Quién**: solo usuarios con `viajes_resolver_incidencias:editar` (o `Admin`), validado en servidor; empresa y usuario **siempre de la sesión**; el cuerpo no admite ni `empresa_id` ni usuario.
2. **Qué exige cada resolución**: `justificacion` (10–500 caracteres reales), `decision`, la incidencia (`confirmacion_id`) y `secuenciaEsperada` (lo que la pantalla vio). Se registran usuario, usuario (copia), fecha y secuencia.
3. **Revisión obsoleta**: si otra persona resolvió entre tanto, `secuenciaEsperada` ≠ siguiente real ⇒ `409 REVISION_OBSOLETA` sin escribir; `uq_tmspr_secuencia` lo garantiza en la base. Un reenvío idéntico (misma decisión, misma justificación, mismo usuario) devuelve lo ya guardado.
4. **`AUTORIZAR_NUEVO_INTENTO`** solo con el viaje abierto y el plan «En ruta» (D-2); guarda `evidencia_corte_id` = mayor id de evidencia de la parada. El piloto, para confirmar de nuevo, necesita una evidencia con **id > corte** (conserva la regla «evidencia actualizada»). La autorización se **consume una vez**: `tms_parada_confirmacion_reintentos` (`PRIMARY` + `UNIQUE(resolucion_id)`), insertada **en la misma transacción** que la nueva confirmación.
5. **Replay acotado**: un envío idéntico del piloto es replay **solo si** la última confirmación de la parada es la suya y **no** hay una autorización pendiente sobre ella; con autorización pendiente, el envío crea la confirmación nueva.
6. **Concurrencia**: resolver y confirmar toman el **mismo bloqueo** (`FOR UPDATE` de la fila de `tms_plan_paradas`) y las mismas lecturas vigentes (`READ COMMITTED` de sesión): se serializan. Los `UNIQUE` (`secuencia`, `terminal`, `resolucion_id`) son la segunda barrera si el bloqueo fallara.
7. **Separación de PriceSmart**: las tablas y respuestas no contienen campo alguno de recepción oficial/estado externo; las respuestas siguen declarando `recepcionOficial: NO_ACEPTADA_POR_PRICESMART`; ninguna decisión publica nada ni toca solicitudes/outbox. Los textos de la interfaz dirán «autoriza un nuevo intento», nunca «entregada» ni «aceptada».
8. **Auditoría**: cada decisión inserta en `auditoria` (acción `resolver_incidencia_entrega`; ids, decisión y secuencia; **sin** la justificación) **dentro de la misma transacción**; si la auditoría falla no queda resolución.

## 5. Propuesta de tablas y restricciones (`sql/migrate-2026-11-tms-incidencias-resoluciones.sql`)

| Objeto | Qué es | Restricciones clave |
|---|---|---|
| `tms_parada_confirmaciones` (existente) | **Solo** un índice único `uq_tmspc_ref (id, empresa_id, plan_id, parada_id)` (metadatos; ninguna fila cambia) | habilita FK compuestas «misma empresa, plan y parada» |
| `tms_parada_incidencia_resoluciones` (nueva) | una fila por decisión | `secuencia` única por incidencia (CAS); `terminal` único (a lo sumo una decisión que cierra); FK compuesta a la **confirmación original** y al plan; FK a `usuarios`; `CHECK` de decisión, de forma (`<=>`, sin NULL engañosos), de `secuencia ≥ 1` y de justificación ≥ 10; `ON DELETE RESTRICT` en todo |
| `tms_parada_confirmacion_reintentos` (nueva) | consumo de una autorización por la nueva confirmación | `PRIMARY(confirmacion_id)`, `UNIQUE(resolucion_id)`; la FK a la resolución **incluye la decisión** y `CHECK decision='AUTORIZAR_NUEVO_INTENTO'`: solo una autorización puede consumirse, y una sola vez |

Aislamiento multiempresa: toda fila lleva `empresa_id` y las FK compuestas impiden relacionar filas de empresas distintas. Permisos de base de datos previstos para la cuenta de aplicación: `SELECT, INSERT` (nunca `UPDATE/DELETE`).
**Lo que el SQL no puede garantizar** (queda en el dominio y en el laboratorio): que `secuencia` sea consecutiva, que el viaje siga abierto, que la nueva evidencia supere el corte y que la nueva confirmación sea del mismo piloto/viaje.

## 6. Pantalla «Incidencias de entrega» (módulo TMS de Operaciones)

`/e/[slug]/tms/incidencias-entrega` (página servidor + bandeja cliente, como `solicitudes-clientes`). **Columnas**: empresa, viaje (código del plan), cliente, parada, piloto, tipo (`PARCIAL`/`RECHAZADA`/`INCIDENCIA`), fecha y hora, nota del piloto, evidencia (miniatura/enlace por endpoint propio), **estado derivado**, y **administrador que resolvió** con su decisión y justificación. **Filtros**: fecha (rango), piloto, viaje, estado, cliente; paginación por `id`. Acción «Resolver» (solo con el permiso) abre un formulario con decisión + justificación obligatoria y muestra la advertencia de que **no marca la entrega como recibida**. Tras `AUTORIZAR_NUEVO_INTENTO`, el Portal del Piloto vuelve a ofrecer «Confirmar entrega» **solo** para esa parada, indicando que requiere una evidencia nueva.

## 7. Riesgos

1. **Resoluciones tardías** (viaje ya cerrado): la autorización sería inútil (D-2) → política `CERRAR_SIN_ENTREGA`/mantener.
2. **Incidencias eternamente pendientes** si D-1 se rechaza.
3. **Cambio de lógica sensible**: replay, estado derivado y pantalla del piloto se tocan a la vez; riesgo de regresión de B12 → se cubre con el laboratorio (B13 sobre B12) y pruebas de contrato.
4. **ALTER sobre la tabla ya creada en Hostinger** (solo un índice único; baja carga, pero es DDL en producción: revisión y ventana).
5. **Reloj de la aplicación** para `resuelto_en`/`confirmado_en` (mismo criterio que el resto del sistema); el corte de evidencia usa ids, no relojes.
6. **Privacidad**: la justificación es texto libre visible a Operaciones; no va a la auditoría general.
7. **Sin reversión de entregas confirmadas** (D-5): un error del piloto al confirmar «entregada» no tiene remedio dentro de este diseño.
8. **Permiso mal asignado**: se asigna explícitamente; ningún rol lo trae por defecto.

## 8. Pruebas previstas

- **Unitarias (puras)**: función de estado derivado (todas las transiciones y combinaciones, incl. ciclos con nuevas incidencias); reglas de replay; validación de justificación/decisión; separación de PriceSmart.
- **Ruta/API (doble de conexión)**: acceso autorizado/denegado (sin sesión, sin permiso, `Admin`, otro rol), cuerpo estricto (`empresaId`/`usuario` rechazados), empresa de la sesión, `REVISION_OBSOLETA`, reenvío idéntico, auditoría en la misma transacción, 503 reintentable.
- **DOM (happy-dom)**: bandeja (listado de pendientes, filtros, estados, evidencia, responsable), formulario de resolución (justificación obligatoria, advertencias), ausencia de acciones sin permiso; Portal del piloto tras autorización.
- **MariaDB aislada (laboratorio B13, sobre B12)**: listado de pendientes por empresa; resolución; **dos resoluciones simultáneas ⇒ una gana, la otra `REVISION_OBSOLETA`**; nueva confirmación tras autorización (consume la autorización una sola vez; con evidencia posterior; segundo uso rechazado); historial append-only (la cuenta de aplicación sin `UPDATE/DELETE`; FK `RESTRICT`); conservación de la evidencia original; ninguna columna de recepción oficial; aislamiento multiempresa (FK compuestas y consultas); `CHECK`/`UNIQUE` frente a datos incoherentes (incluido NULL).
- **E2E de navegador** (harness `scripts/ci/portal-e2e`): incidencia del piloto → bandeja → resolución → reintento del piloto.

## 9. Plan de implementación (PRs separados, cada uno con su revisión)

0. **Este PR**: política + SQL propuesto (revisión independiente y respuesta a D-1…D-6).
1. **Migración**: aplicar el SQL aprobado en Hostinger **solo con autorización expresa**, con postcheck estructural.
2. **Laboratorio B13** (preparado y ejecutado con autorización): valida las tablas y el dominio contra MariaDB real.
3. **Dominio + API** (`parada-confirmacion.ts` ampliado, `incidencias-entrega.ts`, permiso y guard, rutas de listado/resolución/archivo), con pruebas unitarias/ruta.
4. **Bandeja administrativa** (UI + pruebas DOM).
5. **Portal del piloto** (estado derivado y reintento autorizado) + E2E de navegador.

No se hace merge ni despliegue automático en ninguna fase.
