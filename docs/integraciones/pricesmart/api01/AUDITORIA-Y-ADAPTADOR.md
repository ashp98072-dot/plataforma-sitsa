# Auditoría previa y mapa de reutilización API-01

Revisión de lectura realizada antes de programar contra `fcae97647e764dcf0219ee2870d77566ce0c8d66`; no se infiere estado físico de producción. Se revisaron documentos versionados S02, S03, s04, s05 y s06a en `docs/integraciones/pricesmart/`. También se leyeron los antecedentes locales `DISENO-FASE-1.md`, `CIERRE-F1.md` y `MODELO-Y-CONCURRENCIA.md` del workspace principal: **no están versionados en esta base**, no se copiaron ni modificaron archivos ajenos. D01–D16 se transcriben como pendientes en el nuevo documento de decisiones, sin convertir recomendaciones locales en acuerdos. La instrucción API-01 autoriza este prototipo aislado; no ratifica las condiciones de activación propuestas por F1.

## Código y tablas reales

| Fuente en la base | Hallazgo comprobado | Reutilización / decisión API-01 |
|---|---|---|
| `sql/schema.sql:1029`, `tms_solicitudes_cliente` | empresa+cliente, usuario de portal NOT NULL con FK compuesta, estados/versión, vínculo plan único por empresa | No insertar una orden máquina aquí ni usar usuario 0/ficticio. No cambiar columnas/FK |
| `sql/schema.sql:1061`, `tms_solicitud_paradas` | FK `(empresa_id,solicitud_id)`, orden, tipo y ubicación cliente | Futura adaptación validará pertenencia y secuencia; una orden externa no es una parada por definición |
| `src/lib/tms/solicitudes-cliente.ts:199` | `crearSolicitudCliente` posee transacción; validación requiere Carga, ≥1 Entrega y Descarga. Estados SOLICITADA, EN_REVISION, PROGRAMADA, RECHAZADA, CANCELADA | Reutilizar reglas de negocio mediante adaptación futura explícita, no invocar automáticamente ni anidar transacciones |
| `src/lib/tms/solicitudes-cliente-operaciones.ts:337` | `programarSolicitud` inicia transacción, FOR UPDATE, versión y plan | Programación queda en Operaciones. No ruta nueva ni HTTP interno desde API-01 |
| `src/lib/tms/cliente-rutas.ts`, `cliente-ubicaciones.ts` | Catálogos por empresa/cliente, rutas y paradas maestras | Mapeo de club mediante catálogo aprobado; no crear ruta maestra por recepción/reintento |
| `src/lib/flota/schema.ts:717`, `src/lib/tms/paradas.ts` | tms_plan_paradas existe en ensureSchema; plan y ámbito controlan sus lecturas | No asumir que el baseline SQL contiene todo; DDL runtime incompatible con SELECT mínimo queda pendiente |
| `src/lib/tms/vincular-viaje-plan.ts`, `flota_viajes` en flota/schema.ts | Vínculo plan/viaje y tiempos reales del viaje | Reutilización futura de consultas acotadas; no equiparar llegada de vehículo a entrega de cada orden |
| `src/lib/tms/cliente-portal-seguimiento.ts`, `flota/viaje-evidencias.ts`, `cierre-viaje.ts` | Evidencias de viaje, seguimiento e inferencias; cierre administrativo puede diferir de entrega física | No publicar fotos/paths ni mapear cierre/evidencia a DELIVERED contractual |
| `src/lib/tenant.ts`, `auth.ts`, `session.ts`, `empresas.ts` | Sesión humana, autorización multiempresa y roles; login puede actualizar hash | Conservar intacto; no usar cookies/roles humanos como M2M. No importar desde servicio puro |
| `src/lib/tms/cliente-portal-guard.ts` | Scope empresa/cliente/usuario desde sesión verificada y estado activo | Reutilizar el principio de scope confiable, no su mecanismo humano. Nuevo IdentityPort sin implementación |
| `src/middleware.ts` | Middleware UX no sustituye autorización por handler; APIs requieren su propio control | No confiar en middleware para futura API. API-01 no añade rutas |
| `src/lib/tms/idempotencia-envio.ts` | Huella canónica y UNIQUE para fondos/gastos, clave opcional específica | Reutilizar patrón, no importar módulo que trae DB ni heredar clave HTTP opcional/obligatoria. DTO ordenado y hash propios de versión mínima |
| `src/lib/auditoria.ts` | `registrarAuditoriaTx` propaga errores; no-Tx puede silenciarlos | Puerto obliga auditoría en la misma transacción. No usar variante que silencia fallos |
| `scripts/sandbox-config.mjs`, `src/lib/sandbox-db.ts` | Configuración privada e identidad SQL antes de operaciones | Se conservan, sin duplicar validadores. Un repositorio futuro deberá usar sus guardas; aquí no hay SQL |
| `infra/pricesmart-sandbox`, `scripts/sandbox-s04`, `scripts/sandbox-s05`, `scripts/sandbox-s06a` | Perfil cerrado, cuenta bloqueada, empaquetado/arranque y gates sin autorización operativa | Sin modificaciones. Sólo se ejecuta regresión offline y se mantienen pendientes de Linux/DB/UI |

## Especificación del adaptador futuro (no implementado)

| Origen | Destino candidato | Certeza / requisito |
|---|---|---|
| Tenant/client de principal verificado | empresa_id/cliente_id de solicitudes | Patrón de aislamiento cierto; mapeo de principal/cliente contractual aún debe aprobarse |
| externalOrderId | Referencia externa de staging y futuro vínculo | No es ID de solicitud, ruta o plan; conservar deduplicación estable. Referencia cliente TMS es sólo candidata, no vínculo durable único |
| Club externo autorizado | cliente_ubicacion/lugar de carga | Catálogo/versiones y pertenencia pendientes; nunca búsqueda por nombre libre ni ID del body |
| Dirección/destinatario/contacto/ítems/ventana | Paradas y datos operativos | D05–D07 desconocidos. No rellenar Carga/Descarga, fecha/hora o recursos con defaults inventados |
| Aceptación staging | Solicitud humana de revisión futura | No crear en API-01. Requiere actor máquina compatible y núcleo Tx que no abra/commitee por separado |
| Solicitud aprobada por Operaciones | Plan, paradas, asignaciones | Reglas actuales de estado, versión, disponibilidad/traslapes y auditoría siguen siendo autoridad |

Actor futuro: identidad de servicio estable, distinta de credencial rotativa y usuario portal. Cualquier evolución a unión PORTAL/INTEGRACION requiere FK compuestas/XOR, revisión de todos los escritores/lectores, migración expansiva propia y regresión humana; no usar una cuenta humana de laboratorio para suplir esa ausencia. Nada de eso cambia aquí.

Vínculos futuros: orden→unidades de cumplimiento→solicitud/paradas→plan/viaje, con historia de asignaciones y constraints de mismo tenant+cliente. Cardinalidades 1:N/N:1 y entregas parciales dependen de D05. UNIQUE por unidad/materialización y consumidor idempotente evitan duplicados después de caída; orden no equivale a viaje. No incorporar FK a TMS en el DDL API-01 ni permitir `tms_linked=1` en ese perfil.

Cancelación antes de planificación: API-01 sólo registra solicitud en staging no vinculado y pausa procesamiento; una cancelación final necesita otra transición/evento autorizado. Después de vínculo/planificación/ejecución: servicio devuelve conflicto, requiere protocolo de locks con materializador/programación/salida y revisión humana. No cancelar un plan compartido por cancelar una orden ni modificar tarifa/liquidación/cierre. Un replay de creación no cambia estados actuales.

Eventos disponibles no equivalentes: salida/llegada de viaje, vínculo plan, evidencia fotográfica, parada y cierre administrativo. Un evento contractual de entrega necesita unidad de cumplimiento, actor autorizado, ocurrencia/recepción, intento, prueba, correcciones y scope; D08/D13 siguen abiertos. `providerStatus` no existe en la proyección API-01: no se inventa.

KPI futuro: ventana original versionada, zona/offset, eventos por unidad/intento, hora real de ocurrencia/recepción, reprogramaciones, cancelaciones/exclusiones y procedencia de evidencia. No deducir puntualidad de `hora_llegada` ni de `Cerrado`; fórmula D16 NO DEFINIDA. La API no modifica el proyecto KPI ni calcula indicadores contractuales.

Todas las validaciones de tablas/índices/estado físico y el adaptador real quedan NO EJECUTADAS. La auditoría es del código versionado, no una inspección de Hostinger ni de otra base.
