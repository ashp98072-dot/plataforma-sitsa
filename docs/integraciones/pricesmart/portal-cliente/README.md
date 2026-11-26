# PriceSmart en el Portal del Cliente existente (consulta de solo lectura)

Estado: **VERIFICADO TÉCNICAMENTE** en el laboratorio (MariaDB 11.8.9 real, sesiones HTTP reales del portal). **No** se crearon cuentas reales ni se habilitó acceso externo; no se asume que PriceSmart acepte usar un portal web (es una opción, no un compromiso). No se creó un portal nuevo.

## 1. ¿Hoy funciona? Sí, para la consulta
Las solicitudes que crea la integración (`tms-link.ts` → `crearSolicitudCliente`, con `empresa_id`, `cliente_id` y `creado_por_usuario_cliente_id` del mapeo administrativo `ps_api12_tms_mapping`) son filas normales de `tms_solicitudes_cliente` del cliente TMS mapeado. El Portal del Cliente filtra siempre por **empresa + cliente de la sesión** (`listarSolicitudesCliente`, `obtenerSolicitudCliente`, `obtenerSeguimientoSolicitudCliente`), así que **ya muestra** esas órdenes sin duplicar datos: referencia (= `externalOrderId`), fecha planificada, estado, viaje (código, piloto, unidad), paradas y evidencias del piloto.
| Capacidad | Estado | Dónde / prueba (`portal-cliente.e2e.ts`) |
|---|---|---|
| Autenticación por cliente y empresa (email único, scrypt, JWT 12 h, cookie propia, revalidación contra BD en cada petición) | EXISTENTE | `cliente-usuarios.ts::verificarCredencialesCliente`, `cliente-portal-guard.ts::requireClienteSession`, `cliente-portal-session.ts`; CP.1 (login HTTP) |
| Pedidos recibidos por la API, una sola vez | EXISTENTE | `listarSolicitudesCliente`; CP.1 |
| Fecha planificada, estado de la solicitud, estado del viaje, viaje asignado | EXISTENTE | `cliente-portal-seguimiento.ts::obtenerSeguimientoSolicitudCliente`, `estadoViajePortal`; CP.2 |
| Seguimiento de paradas y evidencias autorizadas (cadena cliente → solicitud → plan → parada → evidencia) | EXISTENTE | `obtenerEvidenciasParadaCliente`, `obtenerEvidenciaClienteParaArchivo`; CP.3 |
| Aislamiento entre clientes y empresas (404 sin distinguir) | EXISTENTE | CP.1–CP.3 |
| Cancelaciones y excepciones ejecutadas (CANCELADA, RECHAZADA con motivo) | EXISTENTE | `solicitudes-cliente.ts`, página de detalle |
| Acceso de solo consulta (sin crear solicitudes) | **REQUIERE AJUSTE → hecho** | §2; CP.4 |
| Aviso de que «Finalizado» / ✓ no son entrega confirmada (D13) | **REQUIERE AJUSTE → hecho** | nota en `solicitudes/[id]/page.tsx`; CP.2 |
| Mostrar en el portal la *solicitud* de cancelación pedida por API y su resolución | NO DISPONIBLE (decisión) | Vive en `ps_api12_tms_links`; el portal es genérico y el guardián `contract.test.ts` prohíbe que código fuera del módulo importe `integrations/pricesmart`. PriceSmart la consulta por el GET (`cancellation.resolution`). Añadirlo exige decidir ese acoplamiento |
| Solicitud de cancelación / creación desde el portal por PriceSmart | NO DISPONIBLE (intencional) | el acceso de consulta no escribe |
| Gestión de cuentas de consulta (alta) | EXISTENTE + parámetro | `POST …/clientes/[id]/portal-usuarios` y `…/tms/clientes/[clienteId]/usuarios`: `soloLectura: true` |

## 2. Ajuste mínimo: acceso de SOLO CONSULTA
- `tms_cliente_usuarios.solo_lectura TINYINT(1) NOT NULL DEFAULT 0` — **migración preparada, NO ejecutada**: `sql/migrate-2026-11-tms-cliente-usuarios-solo-lectura.sql` (+ `preflight-…` y `postcheck-…`). Idempotente (`ADD COLUMN IF NOT EXISTS`), no toca datos; las cuentas existentes siguen igual (0).
- `esUsuarioClienteSoloLectura` (lee la fila real por usuario + empresa + cliente de la sesión; sin columna → `false`, que es el comportamiento actual) y `requireClienteEscritura` (403 «Tu acceso es de solo consulta.»), usado por `POST /api/cliente-portal/solicitudes`. Es la **única** operación de escritura del portal (la contraseña propia se conserva). Páginas: ocultan «Nueva solicitud» y redirigen.
- `crearUsuarioCliente({ soloLectura: true })` se niega a crear la cuenta si la columna no existe (nunca se crea una cuenta con más permisos de los pedidos). Por eso: **aplicar la migración antes de dar de alta cuentas de consulta.**
- La marca se evalúa en cada petición (no va en el JWT): activarla o quitarla surte efecto de inmediato (CP.4). Una cuenta de consulta sigue sin permisos administrativos: el portal no tiene operaciones de administración.

## 3. Cuenta de integración vs. cuenta humana
`tms_usuario_cliente_id` del mapeo es el **usuario de servicio** que figura como creador de las solicitudes de la API (en el laboratorio está **inactivo y sin contraseña conocida**: nadie inicia sesión con él). Una cuenta humana de consulta de PriceSmart sería **otra** fila de `tms_cliente_usuarios` del **mismo `tms_clientes`**; ve todas las solicitudes de ese cliente (también las creadas por otros canales), porque el aislamiento del portal es por cliente, no por origen.

## 4. Diferencias portal humano ↔ API M2M
| | Portal del Cliente | API PriceSmart |
|---|---|---|
| Identidad | usuario humano (email + contraseña), uno por persona | integración (credencial M2M por club/alcance; D02 pendiente) |
| Sesión | JWT HS256 12 h en cookie `sitsa_cliente_session` (secreto de la app) | evidencia por solicitud, ligada a método/ruta/cuerpo, con caducidad y anti-repetición |
| Alcance | empresa + cliente de la sesión | entorno + empresa + cliente + integración + clubes + operaciones |
| Escritura | crear solicitud (salvo cuentas de consulta) | recibir órdenes y cancelaciones |
| Estados | `PROGRAMADO/EN_RUTA/FINALIZADO/CANCELADO/DESCONOCIDO` (simplificados) | `proposedStatus` (10 estados provisionales, D08) + `confirmsDelivery:false` |
| Limitación de intentos | **no se encontró** límite ni bloqueo en el login del portal (`auth/login/route.ts`) | límite de tasa `LIMITED` (429) |

## 5. Requisitos para un ambiente de homologación separado
Base propia (el aprovisionador instala el esquema del TMS, incluida esta migración, dentro de alcance), `AUTH_SECRET` distinto de producción, `UPLOAD_DIR` propio con archivos sintéticos, usuarios de **staff** del sandbox para dar de alta las cuentas de consulta, y aislar `/cliente-portal` y `/api/cliente-portal` en el proxy (allowlist de IPs/ruta). **Riesgo a decidir antes de exponerlo:** añadir límite de intentos de login al portal (hoy inexistente) y MFA si se desea; no se hizo aquí por ser un cambio de seguridad transversal a todos los clientes.

## 6. Pendiente / límites
Que PriceSmart acepte un acceso web (no está acordado); decisión sobre mostrar cancelaciones pedidas por API en el portal; D13 (entrega confirmada). Los datos de piloto y unidad que el portal ya muestra a cualquier cliente deben revisarse con el propietario antes de exponerlos a un tercero.
