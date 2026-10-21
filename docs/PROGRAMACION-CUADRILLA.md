# Programación: Cuadrilla independiente

Base de trabajo: `cdb25f42c8f7d337123ca0d37ee3d82cab642783`.
Rama local: `codex/programacion-cuadrilla`.

## Modelo y despliegue

Tabla nueva `tms_plan_cuadrilla`, independiente de `tms_plan_auxiliares`:

| Columna | Tipo | Contrato |
|---|---|---|
| id | INT, PK autoincremental | Identidad de asignación |
| empresa_id | INT NOT NULL | Tenant del plan y empleado |
| plan_id | INT NOT NULL | Requerido; FK a tms_planes_viaje |
| orden | SMALLINT NOT NULL | Orden visible dentro del plan |
| tipo | VARCHAR(10) NOT NULL | INTERNO / EXTERNO |
| id_empleado | INT NULL | Requerido solo para INTERNO |
| nombre | VARCHAR(200) NOT NULL | Snapshot interno del servidor / nombre externo |
| identificacion | VARCHAR(100) NULL | Solo externo; opcional |
| telefono | VARCHAR(50) NULL | Solo externo; opcional |
| creado_en | DATETIME DEFAULT CURRENT_TIMESTAMP | Creación de asignación |

Únicos `(plan_id, id_empleado)` y `(plan_id, orden)`; índices por empresa/plan y empresa/empleado.
CHECK de tipo/identidad; FKs a empresas, plan y empleado. Los NULL permiten varios externos.
Las FKs compuestas `(empresa_id, plan_id) -> tms_planes_viaje(empresa_id, id)` y
`(empresa_id, id_empleado) -> empleados(empresa_id, id)` impiden referencias cruzadas de tenant
en BD, además de la validación existente del servidor. Externos con id_empleado NULL no
requieren empleado padre, pero sí empresa y plan válidos del tenant.
Se mantienen los índices hijos idx_tpc_empresa_plan y idx_tpc_empresa_empleado como soporte
BTREE de estas FKs, sin añadir índices redundantes. Los únicos por plan siguen vigentes:
plan.id es PK global; las FKs compuestas obligan a que pertenezca a empresa_id.

Se conserva la FK directa empresa_id -> empresas(id): garantiza la existencia del tenant
independientemente de las restricciones de los padres. No añade otro índice: reutiliza el
prefijo empresa_id de los índices compuestos. Empresa y plan conservan ON DELETE CASCADE;
empleado ON DELETE RESTRICT protege la referencia histórica; todas usan ON UPDATE RESTRICT.
No se usan SET NULL ni UPDATE CASCADE sobre columnas del CHECK.

Preflight manual comunicado por el usuario: MariaDB 11.8.9, BD u611730801_Plataforma,
checks y FKs ON, tabla nueva ausente, padres InnoDB con INT signed y claves compatibles.
Producción: empleados tiene uq_multas_empleado_empresa_id UNIQUE (empresa_id, id);
schema.sql tiene la clave equivalente uq_ruta_personal_empresa_id. El padre planes tiene
uq_tmsplanes_empresa_id UNIQUE (empresa_id, id) en ambos casos. No se alteran los padres.
La tabla nueva usa ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci,
alineada con TMS real. Esto fija objetivo MariaDB; no es DDL portable sin cambios a MySQL.

Compatibilidad documental: MariaDB admite FKs compuestas con índices BTREE compatibles,
nullable id_empleado y CHECK determinista. Fuentes oficiales:
https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/foreign-keys
https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint
https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/supported-character-sets-and-collations
El usuario confirmó la creación manual y verificación en producción: InnoDB,
utf8mb4_uca1400_ai_ci, PRIMARY, ambos UNIQUE, ambos índices compuestos, chk_tpc_tipo
y fk_tpc_empresa / fk_tpc_plan / fk_tpc_empleado correctos. El agente no ejecutó SQL.

`sql/preflight-2026-10-tms-plan-cuadrilla.sql` contiene solamente SELECT/SHOW, sin information_schema.
Antes del despliegue, verificar manualmente los tipos signed INT, motores, índices compuestos,
checks activos, collation y esquema físico. El preflight actualizado agrega SHOW de estas condiciones.
SHOW COLLATION puede listar uca1400_ai_ci con Charset NULL, al servir varios charsets;
el preflight admite ese nombre además del prefijo utf8mb4, sin falso DETENER por el alias.
APLICAR si no existe y los padres son compatibles; NOOP si coincide completamente; DETENER si difiere.
Los SHOW de la tabla nueva se ejecutan únicamente si la comprobación de existencia la encuentra.

`sql/migrate-2026-10-tms-plan-cuadrilla.sql` contiene CREATE TABLE IF NOT EXISTS,
sin ALTER, backfill ni modificación de históricos. El mismo DDL está en schema.sql.
No se ha ejecutado SQL de producción durante este trabajo. La aplicación requiere la tabla
antes de desplegar esta versión: no oculta la ausencia del esquema ni lo crea al atender requests.
CREATE IF NOT EXISTS no corrige una tabla existente incompatible; debe detenerse en preflight.

## Contrato y disponibilidad

POST/PATCH `/api/empresas/[slug]/tms/planes` aceptan opcionalmente `cuadrilla`:

```json
[
  { "tipo": "INTERNO", "empleadoId": 123 },
  { "tipo": "EXTERNO", "nombre": "Nombre externo", "identificacion": "opcional", "telefono": "opcional" }
]
```

Validación estricta: no acepta nombre interno enviado por cliente, empleadoId externo ni
internos duplicados. Máximo técnico de 200 integrantes por payload; no es una regla laboral.
El catálogo reutiliza RRHH personal-ops con tipo=all. Nuevos internos deben estar activos y
pertenecer al tenant. Una identidad ya guardada conserva su snapshot aunque esté inactiva.
Los externos nunca crean empleados ni tms_personal.

El recurso interno de cuadrilla usa empleados.id. El motor compartido compara esa identidad
contra piloto, piloto extra, auxiliar y cuadrilla de otros planes mediante tms_personal.id_empleado.
También rechaza la misma persona en dos roles dentro del mismo viaje. Los externos no reservan recursos.
Mantiene intervalos [inicio, fin), ventanas secuenciales válidas, cruce de medianoche, estados
existentes y reserva conservadora de fecha_plan cuando falta hora/regreso. Cancelado no reserva.
Un viaje Tercerizado puede reservar exclusivamente sus integrantes internos de cuadrilla;
no convierte sus nombres externos de piloto/auxiliares en personal interno.

POST revalida los internos con current-read FOR UPDATE dentro de la transacción y bajo el candado
de empresa existente. PATCH utiliza GET_LOCK solo si hay recursos efectivos que validar: una
prelectura decide su adquisición temprana; la lectura autoritativa es current-read transaccional.
El gate definitivo vuelve a exigir el candado si esa lectura encuentra internos nuevos.
Sin recursos internos (también Tercerizado sin cuadrilla o con solo externos) no toma el candado
ni introduce un 409 de contención. Cancelado conserva la liberación sin validar disponibilidad.
Omitir cuadrilla conserva las asignaciones; enviar [] las quita.
La edición exige motivo y respeta los bloqueos actuales de estado; cambiar tipo de viaje se
guarda separadamente de cambiar cuadrilla, usando el flujo de tipo existente.
Edición rápida conserva cuadrilla y la incorpora al estado final del lote; sigue siendo
solo lectura en validar. Así no desaparecen reservas al excluir todos los planes del lote.

Las modificaciones de cuadrilla se auditan en la misma transacción, sin copiar identificación
ni teléfono a auditoría. No se añaden permisos, endpoints ni sincronizaciones de viáticos.
La sincronización sigue recibiendo exclusivamente los pilotos y auxiliares existentes.
No se modifica src/lib/tms/viaticos.ts ni se escribe Cuadrilla en tms_plan_auxiliares.

## UI y reportes

Sección Cuadrilla separada de Auxiliares: buscador del catálogo real para internos y campos
para externos, con agregar/quitar y precarga de edición. No utiliza almacenamiento del navegador.
GET devuelve la cuadrilla por plan, tenant y orden. Las tarjetas muestran nombre/tipo.
No se incorpora copia/importación automática de cuadrilla: este alcance es alta/edición.

Excel/PDF del reporte de Programación e imagen incluyen una columna Cuadrilla cuando hay
integrantes, sin cambiar los encabezados históricos cuando no hay. Nombre y tipo por integrante;
identificación y teléfono no se exportan. PDF/imagen usan continuaciones para evitar truncar
listas largas, conservando los datos del viaje en la primera fila. Auxiliar 1/2 siguen separados.
Excel conserva el generador compartido sin modificarlo: únicamente la celda Cuadrilla usa
wrapText y altura según sus líneas. Al superar 24 líneas se usan continuaciones para respetar
el límite Excel de 409.5 puntos; nunca se recorta el listado. Imagen prepara el wrapping con
las mismas métricas Canvas 13px Arial antes de paginar, incluyendo los márgenes en los 6000px.
Palabras largas se segmentan completas. PDF usa métricas Helvetica 7.5 para segmentar solo las
palabras de Cuadrilla que el helper compartido abreviaría; no cambia otras columnas ni snapshots.
No se modifica el reporte general de historial de viajes ni otros módulos.

## Archivos exactos

Implementación y esquema:

- sql/schema.sql
- sql/migrate-2026-10-tms-plan-cuadrilla.sql
- sql/preflight-2026-10-tms-plan-cuadrilla.sql
- src/lib/tms/cuadrilla-contrato.ts
- src/lib/tms/cuadrilla.ts
- src/lib/tms/disponibilidad-programacion-intervalos.ts
- src/lib/tms/edicion-rapida-validar.ts
- src/lib/tms/programacion-imagen.ts
- src/lib/tms/programacion-pdf-anchos.ts
- src/lib/tms/programacion-excel-cuadrilla.ts
- src/lib/tms/programacion-cuadrilla-pdf.ts
- src/components/tms/cuadrilla-select.tsx
- src/app/api/empresas/[slug]/tms/planes/route.ts
- src/app/api/empresas/[slug]/tms/programacion/reporte/route.ts
- src/app/e/[slug]/programacion/plan-form.tsx
- src/app/e/[slug]/programacion/programacion-client.tsx
- src/app/e/[slug]/programacion/programacion-exportar-imagen.ts

Pruebas:

- src/lib/tms/cuadrilla.test.ts
- src/lib/tms/cuadrilla-disponibilidad.test.ts
- src/lib/tms/cuadrilla-integracion.test.ts
- src/lib/tms/cuadrilla-reportes.test.ts
- src/lib/tms/edicion-rapida-validar.test.ts
- src/lib/tms/piloto-extra.test.ts
- src/app/api/empresas/[slug]/tms/planes/disponibilidad-intervalos-a2-1.test.ts
- src/app/api/empresas/[slug]/tms/planes/edicion-rapida-get.test.ts
- src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts
- src/app/api/empresas/[slug]/tms/planes/route-patch-equivalencia.test.ts
- src/app/api/empresas/[slug]/tms/planes/route-piloto-extra.test.ts
- src/app/api/empresas/[slug]/tms/planes/route.test.ts
- src/app/api/empresas/[slug]/tms/programacion/reporte/route.test.ts

Documentación: docs/PROGRAMACION-CUADRILLA.md. Total: 31 archivos.

## Validación local

- Dirigida de Cuadrilla, motor, edición rápida, reportes y handlers: 314/314.
- TypeScript, ESLint dirigido y git diff --check: OK. Build exitoso.
- Suite amplia TMS/Programación en base exacto: 3359 aprobadas / 11 fallidas.
- Mismo comando en implementación: 3408 aprobadas / 11 fallidas.
- Mismos archivos, nombres y mensajes de fallo: 7 casos PATCH de TC,
  2 PATCH de regreso opcional, 1 PATCH de tercerizados y 1 importación Excel
  por unzip ausente en Windows. Ningún fallo nuevo en esta comparación.
- Los tests usan mocks de BD. El agente no ejecutó preflight ni migración.
  La migración fue aplicada y verificada manualmente en producción por el usuario.

## Corrección de auditoría: validación adicional

- Revalidación final para publicación: 380/380 en 13 archivos; TypeScript y ESLint
  dirigido OK; diff-check OK; build exitoso. Incluye los contratos del DDL compuesto.
- GET_LOCK condicional, tercerizado con internos/externos, current-read y self-exclusion.
- XLSX generado/reabierto en memoria con ExcelJS: wrap, alturas, continuaciones y conservación
  de encabezados/anchos/datos. Sin modificar fuentes compartidas RRHH.
- QA lógico de imagen: 0, 1, 5, 10 integrantes, nombres largos y mezcla interno/externo;
  estrés de 200 integrantes y una celda extrema. Anchos de texto y alto total <=6000px.
- PDF: filas por integrante y nombres completos con métricas reales PDFKit. No usa firma/viáticos.
- Suite amplia TMS/Programación repetida: 3445 aprobadas / los mismos 11 fallos del baseline
  cdb25f42c8f7d337123ca0d37ee3d82cab642783. No se repite la suite global de todo el repositorio.
- QA geométrico y round-trip XLSX; no representa ejecución visual en Excel/ navegador ni contra BD real.
- Riesgos conocidos: falta QA interactivo posterior al despliegue; la suite amplia conserva
  los 11 fallos reproducidos en la base. No se repitió esa suite amplia en la revalidación final.
