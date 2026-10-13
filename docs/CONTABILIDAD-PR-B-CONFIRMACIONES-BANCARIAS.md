# PR B — confirmaciones bancarias

Base: main después de #447, f1d5aa31cdc29d7ee5d74eaf5f7e6bfc56854036.
Sin automatización contable, backfill ni ejecución productiva por esta rama.

## Discovery y reutilización

- Facturas/pagos: src/lib/facturacion/facturas.ts, migraciones FACT-1/FACT-4.
  registrarPago() bloquea factura pero calcula saldo administrativo con pagos informados.
  El preview FACT-4 muestra neto tras retención: NO es el límite aprobado para PR B.
- Cuenta: cont_cuentas_bancarias de FACT-4, empresa + entidad + cuenta contable,
  activas, JOIN con cont_entidades/cont_cuentas. Solo banco/alias: no número ni referencia de cuenta.
- Guard: requireTenantFacturacion en src/lib/tenant.ts. Catálogo central
  src/lib/permisos-catalogo.ts. Nuevas acciones sin legacy ni grants automáticos.
- UI: src/components/facturacion/facturas-panel.tsx (detalle expandido).
- Auditoría: registrarAuditoriaTx comparte conexión y rollback.
- Evidencia: guardarUpload/validarRutaArchivoEmpresa en src/lib/uploads.ts;
  el mecanismo común valida extensión, por eso PR B añade magic bytes/MIME/extensión/SHA-256.
- Idempotencia: sigue SHA-256 canónica de PR A sin llamar sus escritores.

## Regla aprobada

Solo Emitida con entidad definida, GTQ y retención aplicada/monto ambos cero.
Retenciones o monedas distintas se bloquean con mensaje explícito, saldo no habilitado.
Sin deducir retención esperada ni constancia real, sin conversión.
Límite = monto_total - suma de confirmaciones CONFIRMADA. Decimal.js y DECIMAL(14,2),
montos de entrada textuales con máximo 2 decimales, normalizados a 2; no floats.
fact_pagos no reduce el límite, no cambia estado ni se crea/modifica desde PR B.
pago_id nullable: se comprueba empresa/factura bajo lock; entidad se deriva de factura.
Confirmación no certifica FEL, ni reemplaza el hito de venta pendiente de aprobación.

## Modelo y protocolo

fact_pago_confirmaciones: empresa/entidad/factura/banco; pago opcional; monto,
fecha/referencia/observaciones; key/huella; actor/fecha y evidencia opcional;
estado CONFIRMADA/ANULADA, actor/fecha/motivo de anulación.
Sin edición financiera ni borrado: se anula y crea un registro nuevo.
La anulación conserva evidencia y metadata original, no cuenta en saldo activo.
Repetir anulación devuelve idempotente sin otra auditoría.

UNIQUE empresa/entidad/key (ascii_bin). Huella V1 JSON-array de orden fijo incluye
ámbito, IDs, monto normalizado, fecha, referencia trim, observaciones y SHA de evidencia.
Misma key/huella retorna el registro (incluso anulado); otro payload da conflicto.
Referencias repetidas permitidas por requerimiento: índice bancario/fecha para búsqueda,
sin UNIQUE de referencia ni reglas bancarias inventadas. Distintas keys pueden representar
un mismo depósito: unicidad bancaria de negocio queda pendiente.

Transacción READ COMMITTED: lock factura primero; lookup idempotente; revalidar
estado/moneda/retención/cuenta/entidad/cuenta contable/pago; SUM activa; INSERT y auditoría;
commit. Anulación usa el mismo root lock. Otros escritores que alteren total deben respetar
el lock de factura (crear/editar/anular existentes lo hacen). No GET_LOCK ni segundo motor.

FKs entidad/banco compuestas y seis FKs RESTRICT en total. Factura/pago usan PK simples
existentes para NO alterar tablas históricas: pertenencia multiempresa se verifica con
current read transaccional. SQL externo podría eludir esa comprobación de ámbito;
no prometer aislamiento físico compuesto de factura/pago. Antes de consumo contable
automático evaluar endurecimiento de esos padres en otra migración autorizada.
Actor/anulador usan PK usuarios. Cuatro CHECKs: monto, referencia, estado/auditoría de
anulación y coherencia completa de metadata de evidencia.

## API y permisos

Base /api/empresas/[slug]/facturacion/facturas/[id]/confirmaciones-bancarias:
- GET: facturacion:ver_confirmaciones_bancarias.
- POST: facturacion:confirmar_banco.
- POST /[confirmacionId]/anular: facturacion:anular_confirmacion.
- GET /[confirmacionId]/evidencia: ver_confirmaciones_bancarias.

Además Ver Facturación y acceso al tenant; Admin conserva bypass actual.
Son filas independientes facturacion_ver_confirmaciones_bancarias,
facturacion_confirmar_banco, facturacion_anular_confirmacion, sin SQL de asignación.
Para usar formulario/UI asignar Ver confirmaciones además de Confirmar/Anular que correspondan.
No confundir Registrar pago con Confirmar banco.

POST JSON sin evidencia o multipart con datos JSON y evidencia opcional. UI mantiene
key durante reintento idéntico en sesión montada; no localStorage/sessionStorage.
Cambiar datos genera key nueva. Archivo PDF/PNG/JPEG, máximo 10 MB, magic bytes +
extensión/MIME concordantes; hash del contenido, ruta opaca tenant-scoped.
GET evidencia revalida tenant/IDs/ruta y hash antes de servir attachment,
private/no-store, nosniff y CSP sandbox. Nunca retorna ruta física en JSON.
Archivo inmutable: si se cambia evidencia se anula y crea otra confirmación.

## Migración y rollout manual

sql/preflight-2026-10-confirmaciones-bancarias.sql: SELECT/SHOW independientes.
Operador revisa versión, FK/CHECK ON, padres InnoDB INT signed, índices compuestos
reales y colisiones. APLICAR/NOOP/DETENER se determinan con evidencia SHOW CREATE:
no fingir una compuerta automática cuando no hay comparación física completa.
NOOP exige igualdad íntegra de DDL nuevo; cualquier drift DETENER.

sql/migrate-2026-10-confirmaciones-bancarias.sql: solo CREATE TABLE IF NOT EXISTS.
No ALTER/DROP de padres, seeds ni backfill. Segunda pasada es NOOP sin modificar filas.
IF NOT EXISTS no detecta/repara drift: preflight obligatorio antes de cada ejecución.
Sin BEGIN/DELIMITER/SELECT interno; cada sentencia independiente evita #2014.
sql/verify-2026-10-confirmaciones-bancarias.sql: SHOW DDL/índices, FKs, conteos y
huérfanos de ámbito. Tabla vacía antes del primer uso. schema.sql incluye el mismo
contrato; instalación/restauración debe tener aplicadas migraciones FACT-1/FACT-4 y PR A.
La PR no ejecuta migraciones al build/deploy ni desde los nuevos endpoints.

Aplicar SQL manual aprobado antes de desplegar; verificar; asignar permisos manualmente;
probar factura sintética por procedimiento autorizado. No migración productiva realizada aquí.

## Límites/riesgos

- Retenciones, constancias reales vs esperadas, otras monedas: fuera y bloqueadas.
- No modifica emisión/anulación/pagos administrativos; anular factura no anula
  automáticamente un depósito real confirmado. Reconciliación/reversos futuros.
- Sin fact_pago_confirmaciones nueva, endpoints devuelven 503 sin ejecutar DDL.
- DB y filesystem no son una transacción distribuida: un crash/rollback o commit ambiguo
  puede dejar archivo huérfano. No se elimina automáticamente tras fallo de commit para
  evitar borrar evidencia vinculada. Reintento idempotente limpia solo su archivo duplicado.
  Limpieza de huérfanos requerirá revisión operativa separada, nunca borrar evidencia activa.
- Multipart materializa memoria igual que infraestructura existente; aplicar límite de
  cuerpo en proxy. Content-Length se revisa si está presente y tamaño real se valida.
- No pantalla global nueva ni cambio del saldo administrativo: historial/formulario viven
  en detalle de factura, el listado existente permite llegar al detalle.
- Revisar DDL padre real/preflight en Hostinger antes de aplicar.

## Validación local

Pruebas unitarias/API/contratos y DB opt-in exclusivamente 127.0.0.1:3407
MariaDB 11.8.9, base aleatoria conta_b_test_ y datos sintéticos; no .env de aplicación.
CONTA_B_TEST_PORT=3407 npx vitest run src/lib/facturacion src/lib/contabilidad/infraestructura-a.test.ts src/lib/contabilidad/infraestructura-a-sql.test.ts src/lib/permisos-catalogo.test.ts
Fixtures prueban parciales, sobreconfirmación, pagos independientes, tenants/cuentas,
idempotencia, anulación, cinco carreras, evidencia y migración repetida sin tocar pagos.
Otros DB tests opt-in no habilitados se reportan omitidos, no aprobados.
No llamar CI a estas verificaciones locales.

Resultado final: 52/52 nuevas (15 contratos, 25 DB incluyendo mysqli, 12 API).
Suite dirigida ampliada: 508 aprobadas / 102 omitidas / 0 fallos.
TypeScript, ESLint dirigido y git diff --check limpios. Build final exitoso.
Una pasada intermedia terminó sin diagnóstico en recolección de páginas; repetición
completa exitosa. Warnings existentes: middleware deprecado, Cache-Control y tracing
de filesystem en módulos previos; sin cambios fuera del alcance para silenciarlos.
Sin QA de navegador conectado a producción; UI cubierta por contratos/wiring y build.

## Archivos del ticket (20)

- docs/CONTABILIDAD-PR-B-CONFIRMACIONES-BANCARIAS.md
- sql/schema.sql
- sql/preflight-2026-10-confirmaciones-bancarias.sql
- sql/migrate-2026-10-confirmaciones-bancarias.sql
- sql/verify-2026-10-confirmaciones-bancarias.sql
- src/lib/permisos-catalogo.ts
- src/lib/tenant.ts
- src/lib/facturacion/confirmacion-bancaria-schema.ts
- src/lib/facturacion/confirmacion-bancaria-evidencia.ts
- src/lib/facturacion/confirmaciones-bancarias.ts
- src/lib/facturacion/confirmaciones-bancarias-api.ts
- src/lib/facturacion/confirmaciones-bancarias.test.ts
- src/lib/facturacion/confirmaciones-bancarias.db.test.ts
- src/lib/facturacion/confirmaciones-bancarias-api.test.ts
- src/lib/facturacion/permisos-config-requisitos.test.ts
- src/components/facturacion/confirmaciones-bancarias-panel.tsx
- src/components/facturacion/facturas-panel.tsx
- src/app/api/empresas/[slug]/facturacion/facturas/[id]/confirmaciones-bancarias/route.ts
- src/app/api/empresas/[slug]/facturacion/facturas/[id]/confirmaciones-bancarias/[confirmacionId]/anular/route.ts
- src/app/api/empresas/[slug]/facturacion/facturas/[id]/confirmaciones-bancarias/[confirmacionId]/evidencia/route.ts
