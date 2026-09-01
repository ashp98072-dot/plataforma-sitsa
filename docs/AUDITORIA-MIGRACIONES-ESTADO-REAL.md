# Auditoría del estado real de los archivos SQL del repositorio

Fecha: 2026-09-01. Estado: **auditoría documental únicamente** — cero SQL
ejecutado, cero migraciones nuevas, cero cambios de schema, cero cambios de
código funcional. Base: `origin/main` en
`a0d88371011e79b03c40b5314017766e56d6df0d`.

## Metodología y límites de la evidencia

Para cada archivo se buscó, en este orden, evidencia verificable:

1. **Auto-declaración del propio archivo** (encabezado) — este repo tiene una
   disciplina muy consistente de declarar "APLICADA MANUALMENTE" / "MIGRACIÓN
   MANUAL, NO EJECUTADA" / "PROPUESTA, NO APLICAR" en sus primeras líneas.
2. **Cruce contra `sql/schema.sql`**: si la tabla/columna que crea el archivo
   YA aparece en `schema.sql`, es evidencia de que el cambio se reconcilió
   como definitivo — pero **no es prueba de ejecución en producción** (varias
   migraciones confirmadas como aplicadas NUNCA se reflejaron en
   `schema.sql`, ver sección 8) ni tampoco lo contrario (columnas ausentes de
   `schema.sql` que sí están confirmadas aplicadas).
3. **Cruce contra código** (`src/lib/**`, `src/app/api/**`): si múltiples
   archivos de código leen/escriben la tabla/columna, es evidencia indirecta
   de que la funcionalidad está viva (el código fallaría constantemente si la
   tabla no existiera y no hay manejo de error específico) — pero tampoco es
   prueba directa de producción.
4. **Cruce contra documentación** (`docs/*.md`) y contra el propio hilo de
   esta sesión, cuando hay confirmación textual explícita del usuario (p. ej.
   resultados reales de `SHOW COLUMNS`, o resultados de consultas de
   verificación pegados por el usuario en un ticket de cierre de PR).

**No se marcó `APLICADO_CONFIRMADO` solo porque el archivo existiera.** Donde
la evidencia de los 4 puntos anteriores fue insuficiente o contradictoria, se
usó `ESTADO_DESCONOCIDO_REQUIERE_VERIFICACION` explícitamente.

**No se consultó la base de datos de producción** — esta sesión no tiene
acceso a ella (confirmado en tickets anteriores). Toda la evidencia es del
propio repositorio (código, schema, documentación, historial de esta sesión).

## 1. Resumen ejecutivo

**Total de archivos SQL revisados: 69** (incluye `schema.sql` y
`seed-usuarios.sql`, que se documentan aparte por ser de naturaleza distinta
a una migración).

| Categoría | Cantidad |
| --- | --- |
| APLICADO_CONFIRMADO | 51 |
| PENDIENTE_EJECUCION | 5 |
| TRAZABILIDAD_YA_APLICADO | 5 |
| PROPUESTA_NO_APROBADA | 1 |
| UTILIDAD_MANUAL | 0 (ver nota) |
| LIMPIEZA_DESTRUCTIVA_NO_EJECUTAR_SIN_AUTORIZACION | 3 |
| ESTADO_DESCONOCIDO_REQUIERE_VERIFICACION | 2 |
| OBSOLETO_NO_REEJECUTAR | 0 (ver nota) |
| No aplica (base/seed, no es "una migración") | 2 (`schema.sql`, `seed-usuarios.sql`) |
| **Total** | **69** (67 migraciones/utilidades + 2 base/seed) |

**Nota sobre `UTILIDAD_MANUAL`**: los 3 candidatos naturales
(`limpiar-*-empresa.sql`) se clasificaron como
`LIMPIEZA_DESTRUCTIVA_NO_EJECUTAR_SIN_AUTORIZACION` en vez de
`UTILIDAD_MANUAL` porque son operaciones `DELETE` irreversibles — la
categoría de seguridad tiene prioridad sobre la de utilidad cuando ambas
aplican (ver sección 6).

**Nota sobre `OBSOLETO_NO_REEJECUTAR`**: ningún archivo calificó para esta
categoría de forma estricta (un archivo cuyo re-uso sería activamente
incorrecto/dañino porque otra pieza ya lo reemplazó). Los 3
`limpiar-*-empresa.sql` son funcionalmente redundantes con
`src/lib/admin/limpiar-modulo.ts` (sección 6), pero re-ejecutarlos no
rompería nada por sí solo — por eso se quedaron en la categoría de
seguridad, más específica y accionable, no en "obsoleto".

## 2. Tabla maestra

Columnas: Archivo · Módulo · Tipo · Categoría · Producción · Reejecutable ·
Riesgo · Evidencia · Acción recomendada.

**Producción**: `SÍ` (evidencia directa o auto-declarada sin contradicción) ·
`NO` (confirmado no ejecutada) · `NO SE SABE` (sin evidencia suficiente).
**Reejecutable**: `SÍ` (idempotente/`IF NOT EXISTS`/guardas) · `NO`
(re-ejecutar duplicaría o rompería datos) · `PARCIAL` (algunas partes sí,
otras no).

| Archivo | Módulo | Tipo | Categoría | Producción | Reejecutable | Riesgo | Evidencia | Acción recomendada |
|---|---|---|---|---|---|---|---|---|
| `schema.sql` | Todos | Esquema completo | (base, no es migración) | — | — | Alto si se ejecuta contra una BD con datos (usa `SET FOREIGN_KEY_CHECKS=0` y recrea) | Es la fuente de instalaciones nuevas | Nunca ejecutar contra producción con datos; **desactualizado** respecto a producción (ver sección 8) |
| `seed-usuarios.sql` | Todos | Datos semilla | (base, no es migración) | NO SE SABE | Probablemente NO (INSERTs simples) | Medio (credenciales/usuarios) | Comentario: "Importar DESPUÉS de schema.sql" | Solo para instalación nueva, revisar antes de usar |
| `correccion-de-vacaciones.sql` | RRHH | Consulta + UPDATE de corrección | ESTADO_DESCONOCIDO_REQUIERE_VERIFICACION | NO SE SABE | SÍ (auto-declarado idempotente, verificado por lectura: el WHERE no vuelve a matchear filas ya corregidas) | Medio (UPDATE sin transacción explícita, pero acotado por JOIN a subconsulta) | Sin ninguna referencia en docs/código que confirme si se ejecutó | Verificar manualmente si ya se corrió (correr el Paso 1 de solo lectura primero) |
| `fix-sesiones-uq.sql` | RRHH (marcajes) | ALTER + UPDATE normalización | APLICADO_CONFIRMADO | SÍ | NO (el segundo `ALTER ... DROP INDEX uq_sesion` fallaría si ya no existe) | Bajo (ya reconciliado) | `sql/schema.sql:268` tiene `idx_sesion_emp_fecha` como KEY normal y NO tiene `uq_sesion` — coincide exactamente con el estado post-fix | No reejecutar |
| `limpiar-flota-empresa.sql` | Flota | DELETE por empresa, multi-tabla | LIMPIEZA_DESTRUCTIVA_NO_EJECUTAR_SIN_AUTORIZACION | — (utilidad bajo demanda) | SÍ (mismo efecto si se repite, ya no hay filas que borrar) | Alto (DELETE irreversible, sin transacción explícita) | Existe además un equivalente EN LA APP (`src/lib/admin/limpiar-modulo.ts`, caso `"flota"`), transaccional y auditado | Preferir la función en la app (Administración → Limpiar módulo); ver sección 6 |
| `limpiar-operaciones-empresa.sql` | TMS/Operaciones | DELETE por empresa, multi-tabla | LIMPIEZA_DESTRUCTIVA_NO_EJECUTAR_SIN_AUTORIZACION | — | SÍ | Alto | Mismo commit (`507fb14`) que introdujo `src/lib/admin/limpiar-operaciones.ts` (case `"operaciones"`) | Preferir la función en la app; ver sección 6 |
| `limpiar-rrhh-empresa.sql` | RRHH | DELETE por empresa, multi-tabla | LIMPIEZA_DESTRUCTIVA_NO_EJECUTAR_SIN_AUTORIZACION | — | SÍ | Alto | Mismo patrón; `limpiar-modulo.ts` tiene casos `"rrhh"`, `"rrhh_planillas"`, `"rrhh_vacaciones"`, etc. | Preferir la función en la app; ver sección 6 |
| `migrate-2026-08-clientes-facturacion.sql` | Clientes/Facturación | CREATE TABLE `clientes` + columnas | APLICADO_CONFIRMADO | SÍ | SÍ (`IF NOT EXISTS`/JSON defensivo, auto-declarado) | Bajo | `sql/schema.sql:1057` tiene `clientes` con `tms_cliente_id` (`uq_clientes_tms`) idéntico | No reejecutar |
| `migrate-2026-08-clientes-rtu.sql` | Clientes | ALTER `clientes` +`rtu` | APLICADO_CONFIRMADO | SÍ (indirecta) | SÍ (`IF NOT EXISTS`) | Bajo | Código usa `rtu` en 6 archivos (`src/lib/clientes/*`, ruta API); **ausente de `schema.sql`** (inconsistencia, sección 8) | No reejecutar; actualizar `schema.sql` en un ticket aparte |
| `migrate-2026-08-contabilidad-entidad-integridad.sql` | Contabilidad | ALTER (UNIQUE/FK compuestas) | APLICADO_CONFIRMADO | SÍ | NO (`ADD CONSTRAINT ... FOREIGN KEY IF NOT EXISTS` es re-ejecutable, pero el archivo lo advierte "sin escrituras concurrentes") | Medio si se reejecuta sin backup | `docs/CONTABILIDAD-C3A-CAPTURA.md`: "C2B ... cuyas migraciones el usuario confirmó aplicadas manualmente"; `exigirEsquemaC2b()` en `ambito.ts` exige exactamente estos índices/FK o falla con 503 | No reejecutar |
| `migrate-2026-08-contabilidad-entidad-preparacion.sql` | Contabilidad | ALTER (columnas `entidad_id` nullable) | APLICADO_CONFIRMADO | SÍ | SÍ (`IF NOT EXISTS`) | Bajo | `docs/CONTABILIDAD-C2-TRANSICION.md`: "C2A aplicada manualmente por el usuario" (explícito) | No reejecutar |
| `migrate-2026-08-contabilidad-entidades.sql` | Contabilidad | CREATE TABLE `cont_entidades`/`cont_entidad_usuarios` | APLICADO_CONFIRMADO | SÍ | SÍ (`IF NOT EXISTS`) | Bajo | `sql/schema.sql:950` idéntico; C3A/C3B (pantalla completa de entidades) no podrían funcionar sin esto | No reejecutar |
| `migrate-2026-08-corregir-hora-guatemala.sql` | RRHH (marcajes) + Flota | UPDATE de timestamps -6h, una sola vez | TRAZABILIDAD_YA_APLICADO (parcial, ver hallazgo) | SÍ (parcial) | **NO** (auto-declarado: "No volver a ejecutar, doblaría el ajuste") | **ALTO** — ver hallazgo detallado sección 4 | La parte de `sesiones_trabajo` la aplica también la APP automáticamente (`src/lib/tz-guatemala-migrate.ts`, guardado en `sitsa_migrations`); la parte de `flota_*` (4 UPDATE) **NO tiene ningún equivalente en código** | Verificar manualmente si los 4 UPDATE de Flota de este archivo ya corrieron — ver hallazgo prioritario sección 4 |
| `migrate-2026-08-fact-1-facturas-pagos.sql` | Facturación | CREATE TABLE `fact_facturas`/`fact_factura_viajes`/`fact_pagos` | APLICADO_CONFIRMADO (evidencia fuerte, header contradictorio) | SÍ | SÍ (`IF NOT EXISTS`) | Bajo (ya en uso estable) | Uso extensivo confirmado EN ESTA MISMA SESIÓN: consultas reales contra `fact_facturas`/`fact_pagos`/`fact_factura_viajes` en el ticket TMS-CLIENTES-DUPLICADOS-CANONICALIZACION-1 y en todo el trabajo de FACT-1-TMS-REPORTES (PR #119 fusionado) | **El encabezado del propio archivo ("PROPUESTA... NO EJECUTAR AQUÍ... NO se ha ejecutado") está obsoleto** — ver hallazgo sección 4 |
| `migrate-2026-08-fase-a1-tms-unidades-flota-vinculo.sql` | TMS/Flota | ALTER (`flota_vehiculo_id`) | APLICADO_CONFIRMADO | SÍ | NO (auto-declarado: falla si se reejecuta tras aplicada) | Bajo | `flota_vehiculo_id` en `sql/schema.sql` (4 apariciones) y en código | No reejecutar |
| `migrate-2026-08-fase-a3-backfill-tms-unidades-flota.sql` | TMS/Flota | UPDATE backfill, 3 filas hardcoded | ESTADO_DESCONOCIDO_REQUIERE_VERIFICACION | NO SE SABE | SÍ (auto-declarado, triple guarda id+empresa_id+placa+`IS NULL`) | Bajo (bien guardado) pero **IDs hardcoded** (`id IN (7,8,9)`, `empresa_id=1`) | Sin confirmación de ejecución en ningún doc | Verificar con el SELECT de verificación que el propio archivo incluye |
| `migrate-2026-08-fase0-tms-personal-empleado.sql` | TMS/RRHH | ALTER (`tms_personal.id_empleado`) | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado idempotente) | Bajo | `id_empleado` en `schema.sql` (24 apariciones) y usado extensamente (viáticos, programación) | No reejecutar |
| `migrate-2026-08-fase1-1-trazabilidad-marcaje.sql` | RRHH (marcajes) | ALTER (`ubicacion_entrada_id` y relacionados) | APLICADO_CONFIRMADO | SÍ (indirecta) | SÍ (`IF NOT EXISTS`, patrón del archivo) | Bajo | Código usa `ubicacion_entrada_id` en `src/lib/rrhh/marcajes.ts`; ausente de `schema.sql` (inconsistencia) | No reejecutar; actualizar `schema.sql` |
| `migrate-2026-08-fase1-backfill-ubicaciones.sql` | RRHH (marcajes) | INSERT backfill desde `configuracion` | APLICADO_CONFIRMADO (indirecta) | SÍ (indirecta) | SÍ (auto-declarado: `NOT EXISTS` por empresa) | Bajo | Complementa `ubicaciones_marcaje`, confirmada viva (siguiente fila) | No reejecutar |
| `migrate-2026-08-fase1-ubicaciones-marcaje.sql` | RRHH (marcajes) | CREATE TABLE `ubicaciones_marcaje` | APLICADO_CONFIRMADO (header obsoleto) | SÍ | SÍ (`IF NOT EXISTS`) | Bajo | Usada en vivo por `src/lib/rrhh/geocerca.ts:97` (validación real de geocerca) — el propio encabezado del archivo dice "todavía NO se usa en la validación real", **obsoleto** (ver sección 8) | No reejecutar |
| `migrate-2026-08-flota-completa.sql` | Flota | ALTER multi-columna `flota_vehiculos` | APLICADO_CONFIRMADO | SÍ | SÍ (`IF NOT EXISTS`) | Bajo | Columnas (`descripcion`, `chasis`, etc.) en `sql/schema.sql:816+` | No reejecutar |
| `migrate-2026-08-flota-inventario-equipo.sql` | Flota | CREATE TABLE `flota_inv_categorias`+relacionadas | APLICADO_CONFIRMADO | SÍ | SÍ (`IF NOT EXISTS`) | Bajo | `flota_inv_categorias` en `schema.sql:899` | No reejecutar |
| `migrate-2026-08-flota-km-intervalo-5000.sql` | Flota | `MODIFY COLUMN` (default) | APLICADO_CONFIRMADO | SÍ | SÍ (MODIFY es naturalmente idempotente) | Bajo | `km_intervalo_servicio INT NOT NULL DEFAULT 5000` en `schema.sql:827` | No reejecutar |
| `migrate-2026-08-flota-odometro-mantenimiento-tiempo.sql` | Flota | ALTER (`odometro_funcional`+relacionados) | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado idempotente) | Bajo | `odometro_funcional` en `schema.sql` | No reejecutar |
| `migrate-2026-08-marcajes-foto-dpi.sql` | RRHH (marcajes) | CREATE TABLE `marcaje_evidencias` | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado idempotente) | Bajo | `marcaje_evidencias` en `schema.sql:273` (visto en la revisión de `fix-sesiones-uq.sql`) | No reejecutar |
| `migrate-2026-08-numero-empleado-global.sql` | RRHH | ALTER (`numero_empleado`) + backfill `LPAD` | APLICADO_CONFIRMADO (indirecta) | SÍ (indirecta) | SÍ (checks contra `INFORMATION_SCHEMA` antes de cada `ALTER`) | Bajo | Código usa `numero_empleado` en 5 archivos (import Excel de marcajes, ficha empleados); **ausente de `schema.sql`** (inconsistencia) | No reejecutar; actualizar `schema.sql` |
| `migrate-2026-08-operaciones-multas-pago-documentos.sql` | Operaciones/Multas | ALTER + CREATE (pagos + documentos) | PENDIENTE_EJECUCION | NO | SÍ (auto-declarado "reejecutable", cada bloque verifica antes de aplicar) | Medio (requiere `SELECT COUNT(*) FROM ops_multa_documentos = 0` antes de un `MODIFY` no aditivo) | Encabezado explícito: "MIGRACIÓN MANUAL, NO EJECUTADA"; depende de `migrate-2026-08-operaciones-multas.sql` y `-rrhh.sql`, ambas también pendientes | No ejecutar sin aprobación del negocio para el módulo de Multas completo |
| `migrate-2026-08-operaciones-multas-rrhh.sql` | Operaciones/Multas + RRHH | CREATE (vínculo descuento) | PENDIENTE_EJECUCION | NO | SÍ (auto-declarado) | Medio | Encabezado explícito: "MIGRACIÓN MANUAL, NO EJECUTADA"; depende de `-multas.sql` (aplicada, según su propio encabezado) y `rrhh-descuentos-d1.sql` (aplicada, confirmado) | No ejecutar sin aprobar Multas completo |
| `migrate-2026-08-operaciones-multas.sql` | Operaciones | CREATE (catálogo de multas) | PENDIENTE_EJECUCION | NO | SÍ (auto-declarado "reejecutable para el esquema aquí definido") | Medio | Encabezado explícito: "MIGRACIÓN MANUAL, NO EJECUTADA" | No ejecutar sin aprobación del negocio |
| `migrate-2026-08-ops-1-roles-cierre.sql` | Operaciones/TMS | ALTER (`cerrado_por`, roles) | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado idempotente) | Bajo | `cerrado_por` en `schema.sql`; OPS-1 referenciado como funcional en múltiples docs posteriores (FACT-1, C2, etc.) | No reejecutar |
| `migrate-2026-08-portales-proveedores.sql` | Portales/Proveedores | CREATE TABLE `proveedor_portales` | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado idempotente) | Bajo (credenciales cifradas) | `proveedor_portales` en `schema.sql` | No reejecutar |
| `migrate-2026-08-programacion-tms-p0.sql` | TMS/Programación | ALTER (`tarifa_comercial`, `referencia_cliente`, `regreso_estimado`) | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado aditivo) | Bajo | `tarifa_comercial` en `schema.sql:586` (visto en revisión de FACT-1); usado extensivamente en Programación/Reportes/Facturación | No reejecutar |
| `migrate-2026-08-rrhh-archivos.sql` | RRHH | CREATE TABLE `evidencias_incidencias` | APLICADO_CONFIRMADO | SÍ | SÍ | Bajo | `evidencias_incidencias` en `schema.sql:437` | No reejecutar |
| `migrate-2026-08-rrhh-casos-legales.sql` | RRHH | CREATE TABLE `rrhh_casos_legales` | **PENDIENTE_EJECUCION** | **NO (confirmado)** | SÍ (auto-declarado aditivo) | Medio — el código (`src/lib/rrhh/casos-legales.ts`, ruta API completa) YA ASUME que la tabla existe, sin manejo `ER_NO_SUCH_TABLE`/503 visible | `docs/PLAN-RRHH-CIERRE-REQUISITOS.md:59`: "Migración manual: `sql/migrate-2026-08-rrhh-casos-legales.sql`, NO ejecutada" (explícito, caso solicitado por el ticket) | **Ejecutar antes de usar la pantalla de Casos Legales** — riesgo real #4 del ticket confirmado |
| `migrate-2026-08-rrhh-centros-costo.sql` | RRHH | CREATE TABLE `centros_costo` | APLICADO_CONFIRMADO (indirecta) | SÍ (indirecta) | SÍ (auto-declarado) | Bajo | Código usa `centros_costo` en 2 archivos; ausente de `schema.sql` | No reejecutar; actualizar `schema.sql` |
| `migrate-2026-08-rrhh-colaborador-auth.sql` | RRHH/Portal | CREATE TABLE `colaborador_credenciales` | APLICADO_CONFIRMADO (indirecta) | SÍ (indirecta) | SÍ (`IF NOT EXISTS`) | Bajo | Código usa `colaborador_credenciales`; **archivo duplicado casi exacto de `-auth2.sql`** (ver sección 8) | Consolidar con `-auth2.sql` en un ticket aparte, no reejecutar |
| `migrate-2026-08-rrhh-colaborador-auth2.sql` | RRHH/Portal | CREATE TABLE `colaborador_credenciales` (idéntico) | APLICADO_CONFIRMADO (indirecta) | SÍ (indirecta) | SÍ (`IF NOT EXISTS`) | Bajo | Diff contra `-auth.sql`: solo difieren 3 bloques de comentarios, mismo DDL | Mismo que arriba — duplicado |
| `migrate-2026-08-rrhh-core.sql` | RRHH | ALTER `configuracion`+base | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado) | Bajo | `configuracion` en `schema.sql` | No reejecutar |
| `migrate-2026-08-rrhh-descuentos-d1.sql` | RRHH | CREATE TABLE `rrhh_descuentos`+relacionadas | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado aditivo) | Bajo | `rrhh_descuentos` en `schema.sql` (7 apariciones); depende de esta migración `migrate-2026-08-operaciones-multas-rrhh.sql` (pendiente) | No reejecutar |
| `migrate-2026-08-rrhh-empleado-supervisores.sql` | RRHH | CREATE TABLE `empleado_supervisores` | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado idempotente) | Bajo | `empleado_supervisores` en `schema.sql` | No reejecutar |
| `migrate-2026-08-rrhh-entrevista-documentos.sql` | RRHH/Reclutamiento | CREATE TABLE `entrevista_documentos` | APLICADO_CONFIRMADO (indirecta) | SÍ (indirecta) | SÍ (auto-declarado) | Bajo | Código usa `entrevista_documentos`; ausente de `schema.sql` | No reejecutar; actualizar `schema.sql` |
| `migrate-2026-08-rrhh-entrevistas.sql` | RRHH/Reclutamiento | CREATE TABLE `entrevistas` | APLICADO_CONFIRMADO (indirecta) | SÍ (indirecta) | SÍ (auto-declarado) | Bajo | Código usa `entrevistas` en 4 archivos; ausente de `schema.sql` | No reejecutar; actualizar `schema.sql` |
| `migrate-2026-08-rrhh-ficha-monaco.sql` | RRHH | ALTER ficha ampliada + historial | APLICADO_CONFIRMADO | SÍ | SÍ ("Idempotente vía app") | Bajo | `dpi` y columnas relacionadas en `schema.sql`; la propia app la reaplica vía `asegurarSchemaEmpleados()` (patrón similar al de timezone, ver sección 4) | No reejecutar el SQL manual — la app ya la gestiona |
| `migrate-2026-08-rrhh-horas-extra-h1.sql` | RRHH | ALTER (elegibilidad/aprobación) | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado) | Bajo | `horas_extra_habilitado` en `schema.sql` | No reejecutar |
| `migrate-2026-08-rrhh-horas-extra-h2.sql` | RRHH | ALTER (`aplicado_en`, aplicación a planilla) | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado, chequeo `INFORMATION_SCHEMA` previo) | Bajo | `aplicado_en` (comentado "Fase H2") en `schema.sql:212` | No reejecutar |
| `migrate-2026-08-rrhh-horas-extra.sql` | RRHH (autogestión) | CREATE TABLE registro horas extra colaborador | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado) | Bajo | `horas_extra_registros` en `schema.sql` | No reejecutar |
| `migrate-2026-08-rrhh-inventario-entregas-inv1.sql` | RRHH | CREATE TABLE `inventario_rrhh_entregas` | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado no destructivo) | Bajo | `inventario_rrhh_entregas` en `schema.sql` | No reejecutar |
| `migrate-2026-08-rrhh-inventario-inv0.sql` | RRHH | ALTER + CREATE `inventario_rrhh_movimientos` | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado no destructivo) | Bajo | `inventario_rrhh_movimientos` en `schema.sql` (2 apariciones) | No reejecutar |
| `migrate-2026-08-rrhh-ops.sql` | RRHH | ALTER base operativa | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado) | Bajo | `rrhh_descuentos` y relacionados en `schema.sql` | No reejecutar |
| `migrate-2026-08-rrhh-planilla-periodos-p0.sql` | RRHH/Planilla | ALTER (`tipo_periodo`, `numero_quincena`) | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado no destructivo) | Bajo | `tipo_periodo`/`numero_quincena` en `schema.sql:140-141` | No reejecutar |
| `migrate-2026-08-rrhh-planillas-lineas.sql` | RRHH/Planilla | CREATE TABLE `rrhh_planilla_lineas` | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado) | Bajo | `rrhh_planilla_lineas` en `schema.sql` (3 apariciones) | No reejecutar |
| `migrate-2026-08-rrhh-reclutamiento-colaborativo.sql` | RRHH/Reclutamiento | CREATE TABLE `entrevista_responsables` | APLICADO_CONFIRMADO (indirecta) | SÍ (indirecta) | SÍ (auto-declarado) | Bajo | Código usa `entrevista_responsables`; ausente de `schema.sql` | No reejecutar; actualizar `schema.sql` |
| `migrate-2026-08-rrhh-recordatorios-bitacora.sql` | RRHH | CREATE TABLE `rrhh_recordatorios` | APLICADO_CONFIRMADO (indirecta) | SÍ (indirecta) | SÍ (auto-declarado) | Bajo | Código usa `rrhh_recordatorios` en 2 archivos; ausente de `schema.sql` | No reejecutar; actualizar `schema.sql` |
| `migrate-2026-08-rrhh-solicitudes-vacaciones.sql` | RRHH (autogestión) | CREATE TABLE `solicitudes_vacaciones` | APLICADO_CONFIRMADO (indirecta) | SÍ (indirecta) | SÍ (auto-declarado) | Bajo | Código usa `solicitudes_vacaciones`; ausente de `schema.sql` | No reejecutar; actualizar `schema.sql` |
| `migrate-2026-08-rrhh-supervisor.sql` | RRHH | ALTER (`supervisor_id`) | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado) | Bajo | `supervisor_id` en `schema.sql` (5 apariciones) | No reejecutar |
| `migrate-2026-08-usuario-permisos.sql` | Usuarios/Permisos | ALTER (`puede_crear`, `puede_eliminar`) | APLICADO_CONFIRMADO | SÍ | PARCIAL (comentario propio: "Ignorar error si la columna ya existe" — no usa `IF NOT EXISTS`, depende de tolerar el error 1060 manualmente) | Bajo (ya reconciliado) | `puede_crear`/`puede_eliminar` en `schema.sql:49-51`; permisos granulares usados en absolutamente todos los módulos de esta sesión | No reejecutar |
| `migrate-2026-08-viat-0-viaticos.sql` | TMS/Viáticos | CREATE TABLE `tms_viaticos_config`/`tms_viaticos` | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado idempotente) | Bajo | Encabezado explícito: "MIGRACIÓN REAL: YA SE EJECUTÓ MANUALMENTE EN PRODUCCIÓN" | No reejecutar |
| `migrate-2026-08-viat-1-ciclo-viaticos.sql` | TMS/Viáticos | ALTER (ciclo PROGRAMADO→LIQUIDADO) | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado) | Bajo | Todo el ciclo de viáticos (autorizar/entregar/liquidar/rechazar/snapshot) confirmado funcionando en producción en múltiples PR de esta sesión | No reejecutar |
| `migrate-2026-08-viat-1-cliente-ubicaciones.sql` | TMS/Programación | CREATE TABLE `tms_cliente_ubicaciones` | APLICADO_CONFIRMADO (header obsoleto) | SÍ | SÍ (auto-declarado) | Bajo | **Confirmado con datos reales en esta misma sesión**: el ticket TMS-CLIENTES-DUPLICADOS-CANONICALIZACION-1 (PR #157) reportó conteos reales de `tms_cliente_ubicaciones` (6, 6, 1 ubicaciones por cliente canónico) — el propio encabezado del archivo dice "NO se ejecutó en este entorno", **obsoleto** (ver sección 8) | No reejecutar |
| `migrate-2026-08-viat-4-contactos-rutas.sql` | TMS/Programación | CREATE TABLE `tms_cliente_contactos`/`tms_cliente_rutas` | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado) | Bajo | Confirmado con datos reales en esta sesión (mismo PR #157: conteos de "rutas"/"contactos"); referenciado como aplicado por el propio `viat-4b` | No reejecutar |
| `migrate-2026-08-viat-4b-rutas-correcciones.sql` | TMS/Programación | ALTER (índice único global) + columna `destino_descripcion` | **PENDIENTE_EJECUCION** | **NO (confirmado)** | PARCIAL (B y C aditivas; A requiere verificación previa de duplicados antes del ALTER no aditivo) | Medio — cambia una restricción UNIQUE existente, requiere `SELECT ... HAVING COUNT(*) > 1` previo | Encabezado explícito: "NO se ejecuta en runtime ni se ejecutó en este entorno"; **PERO `schema.sql` YA refleja el estado post-migración** (`uq_tmsclirutas_codigo (empresa_id, codigo)`) — posible divergencia schema.sql vs. producción real | Verificar el índice único real de `tms_cliente_rutas` en producción antes de asumir cualquier estado |
| `propuesta-2026-08-firma-electronica-viaticos-imagen.sql` | TMS/Viáticos (firma visual) | ALTER (`imagen_ruta`+3 columnas) | **TRAZABILIDAD_YA_APLICADO** | **SÍ — verificado directamente el 2026-09-01** | SÍ (`IF NOT EXISTS`) | Bajo (existencia de columnas ya confirmada; ver nota de cierre sección 5) | Resultado real de `DESCRIBE firmas_electronicas;` ejecutado por el usuario en producción el 2026-09-01: las 4 columnas (`imagen_ruta` varchar(255), `imagen_nombre_original` varchar(255), `imagen_mime` varchar(50), `imagen_tamano` int(11), todas NULL permitido) existen actualmente. El error `Unknown column 'imagen_ruta'` del 2026-08-29 queda como antecedente histórico — no se determinó si se aplicó después de ese error, en otra base, o si hubo un despliegue intermedio | No reejecutar; no se afirma que `autorizarViatico()`/`liquidarViatico()` funcionan correctamente por esta prueba, solo que las columnas existen |
| `propuesta-2026-08-firma-electronica-viaticos.sql` | Portal/TMS (firmas) | CREATE TABLE `firmas_electronicas` | APLICADO_CONFIRMADO | SÍ | SÍ (auto-declarado, ver también `propuesta-2026-08-firma-electronica.sql`) | Bajo | Encabezado explícito: "APLICADA MANUALMENTE POR EL USUARIO" | No reejecutar |
| `propuesta-2026-08-firma-electronica.sql` | Portal (diseño general) | Propuesta de diseño completo | PROPUESTA_NO_APROBADA | NO (parcial — ver el archivo `-viaticos.sql` arriba que sí se aplicó, solo una parte) | N/A (diseño) | Bajo (no ejecutado) | Encabezado explícito: "PROPUESTA DE DISEÑO, NO APLICAR" | Mantener como referencia de diseño; NO ejecutar tal cual (el subconjunto real ya se aplicó vía el archivo específico de Viáticos) |
| `propuesta-2026-08-tms-clientes-duplicados-canonicalizacion.sql` | TMS/Clientes | Transacción de datos (bridges + datos maestros) | **TRAZABILIDAD_YA_APLICADO (header obsoleto)** | SÍ (confirmado explícitamente por el usuario) | NO (procedimiento temporal de un solo uso, con guardas anti-doble-ejecución) | Bajo (ya aplicado y verificado con post-checks reales) | **Confirmación explícita del usuario** en el cierre de PR #157 (mismo hilo de esta sesión): bridges movidos, datos maestros de CALSA actualizados, FACT-1 confirmado funcionando — el propio encabezado del archivo sigue diciendo "PROPUESTA, NO EJECUTADA" (**obsoleto**, ver sección 8) | No reejecutar; el encabezado debería actualizarse en un ticket documental aparte |
| `propuesta-2026-08-usuario-firmas.sql` | Portal (firma personal, MI-FIRMA-1) | CREATE TABLE `usuario_firmas` | APLICADO_CONFIRMADO (indirecta, header obsoleto) | SÍ (indirecta) | SÍ (auto-declarado) | Bajo | Código usa `usuario_firmas` en `src/lib/firmas/usuario-firmas.ts` y en la ruta API dedicada `src/app/api/empresas/[slug]/mi-firma/route.ts` (feature MI-FIRMA-1 completa y en uso); el encabezado dice "PROPUESTA (NO ejecutada por Claude" — mismo patrón de encabezado obsoleto que otros casos (sección 8); ausente de `schema.sql` | No reejecutar; actualizar `schema.sql` |
| `propuesta-2026-08-viaticos-liquidacion-estructurada.sql` | TMS/Viáticos | ALTER (`gastos_comprobados`, `reintegro`) | APLICADO_CONFIRMADO | SÍ | SÍ (`IF NOT EXISTS`) | Bajo | Encabezado explícito: "APLICADA MANUALMENTE POR EL USUARIO (fuera de esta sesión de Claude, tras aprobación explícita)"; código usa `gastos_comprobados` en `viaticos.ts`; **ausente de `schema.sql`** | No reejecutar; actualizar `schema.sql` |
| `propuesta-2026-08-viaticos-pago-snapshot.sql` | TMS/Viáticos | ALTER (`pago_banco`+2 columnas) | TRAZABILIDAD_YA_APLICADO | SÍ (confirmado con `SHOW COLUMNS` real, pegado por el usuario) | SÍ (`IF NOT EXISTS`) | Bajo | Encabezado explícito con resultado real de `SHOW COLUMNS FROM tms_viaticos` — el más completo y trazable de todo el repo | No reejecutar |
| `propuesta-2026-08-viaticos-rechazado.sql` | TMS/Viáticos | ALTER (`rechazado_por`+3 columnas) | TRAZABILIDAD_YA_APLICADO | SÍ (mismo patrón que el anterior) | SÍ (`IF NOT EXISTS`) | Bajo | Encabezado explícito, aplicada el 31/08/2026 vía phpMyAdmin | No reejecutar |

## 3. Pendientes reales (requieren acción)

Únicamente 4 archivos tienen evidencia clara y sin contradicción de que
**siguen sin ejecutarse**, y son los únicos que representan trabajo
pendiente real de "aplicar SQL":

1. **`migrate-2026-08-rrhh-casos-legales.sql`** — bloquea la pantalla de
   Casos Legales (código ya desplegado que la usa). Confirmado explícitamente
   en `docs/PLAN-RRHH-CIERRE-REQUISITOS.md`.
2. **`migrate-2026-08-operaciones-multas.sql`** — base del módulo de Multas,
   sin ninguna otra pieza del módulo pudiendo avanzar sin esta primero.
3. **`migrate-2026-08-operaciones-multas-rrhh.sql`** — depende de la
   anterior + de `rrhh-descuentos-d1.sql` (esta última sí aplicada).
4. **`migrate-2026-08-operaciones-multas-pago-documentos.sql`** — depende de
   las dos anteriores; además requiere una verificación manual
   (`SELECT COUNT(*) FROM ops_multa_documentos = 0`) antes de un `MODIFY` no
   aditivo.

Adicionalmente, **`migrate-2026-08-viat-4b-rutas-correcciones.sql`** está
auto-declarada como no ejecutada, pero con la particularidad de que
`schema.sql` YA refleja su resultado final — ver hallazgo de la sección 4
(posible divergencia entre lo que asume `schema.sql` y lo que realmente
tiene producción).

## 4. Aplicados / no volver a ejecutar

Los 51 archivos `APLICADO_CONFIRMADO` de la tabla maestra (sección 2) — **no
reejecutar ninguno**. Los más críticos por su naturaleza no-idempotente o su
efecto ya verificado en datos reales:

- `migrate-2026-08-corregir-hora-guatemala.sql` (parcial — la parte de
  `sesiones_trabajo`; **NO** volver a correr manualmente porque la app ya la
  aplica sola una vez, y el archivo completo desplaza -6h de nuevo si se
  reejecuta a ciegas).
- Los 3 archivos de Viáticos con confirmación explícita de producción
  (`rechazado`, `pago-snapshot`, `liquidacion-estructurada`), más
  `propuesta-2026-08-firma-electronica-viaticos-imagen.sql` (confirmado el
  2026-09-01 vía `DESCRIBE firmas_electronicas;`, ver sección 5).
- `propuesta-2026-08-tms-clientes-duplicados-canonicalizacion.sql`
  (procedimiento temporal ya ejecutado y verificado con post-checks reales
  — reejecutarlo fallaría de todas formas por la precondición global, pero
  no debe intentarse).
- Las 3 migraciones de Contabilidad (`entidades`, `entidad-preparacion`,
  `entidad-integridad`) — el código (`exigirEsquemaC2b`) literalmente deja
  de funcionar (503) si su forma exacta no coincide, así que reejecutarlas
  con un esquema divergente sería peligroso.

**Duplicado a resolver (no en este ticket)**: `migrate-2026-08-rrhh-
colaborador-auth.sql` y `-auth2.sql` crean la MISMA tabla
(`colaborador_credenciales`) con un DDL prácticamente idéntico (solo
difieren 3 bloques de comentarios) — ambos están aplicados/reconciliados,
pero mantener dos archivos para la misma migración es ruido documental.

## 5. Estado desconocido — qué verificar manualmente

Estos son exactamente los 2 archivos clasificados
`ESTADO_DESCONOCIDO_REQUIERE_VERIFICACION` en la tabla maestra — evidencia
insuficiente para afirmar con certeza si se aplicaron:

1. **`correccion-de-vacaciones.sql`** — sin ninguna referencia en
   documentación ni código que confirme si ya se aplicó. Verificar corriendo
   primero el Paso 1 (solo lectura) del propio archivo.
2. **`migrate-2026-08-fase-a3-backfill-tms-unidades-flota.sql`** — sin
   confirmación; usa el propio SELECT de verificación que el archivo incluye
   (`WHERE tu.id IN (7, 8, 9)`).

### Cierre de hallazgo — `propuesta-2026-08-firma-electronica-viaticos-imagen.sql` (2026-09-01)

**Ya NO está en la lista de arriba** — reclasificado de
`ESTADO_DESCONOCIDO_REQUIERE_VERIFICACION` a `TRAZABILIDAD_YA_APLICADO`
(sección 2). Registro de la verificación:

- **Verificación realizada**: 2026-09-01, por el usuario, manualmente en
  phpMyAdmin de producción.
- **Consulta ejecutada**: `DESCRIBE firmas_electronicas;` (solo lectura —
  ningún `ALTER` se ejecutó, ninguna otra escritura).
- **Resultado**: las 4 columnas existen ACTUALMENTE en producción —
  `imagen_ruta` (`varchar(255)`, NULL permitido), `imagen_nombre_original`
  (`varchar(255)`, NULL permitido), `imagen_mime` (`varchar(50)`, NULL
  permitido), `imagen_tamano` (`int(11)`, NULL permitido). También se
  confirmaron visualmente el resto de columnas esperadas de
  `firmas_electronicas` (`id`, `empresa_id`, `usuario_id`, `empleado_id`,
  `accion`, `modulo`, `entidad_tipo`, `entidad_id`, `fecha_hora_servidor`,
  `hash_payload`, `payload_canonico`, `metodo`, `resultado`, `codigo_firma`,
  `version`, `creado_en`).
- **El error `Unknown column 'imagen_ruta'` del 2026-08-29 queda como
  antecedente histórico** — documenta que en ese momento/entorno la
  columna no estaba disponible; no se determinó (ni se necesita determinar
  para este cierre) si se aplicó después de ese error, en otra base, o si
  hubo un despliegue intermedio.
- **No se ejecutó ningún `ALTER`** en este ticket ni en el de verificación
  — la tabla ya tenía las columnas antes de correr el `DESCRIBE`.
  **No se modificó producción.**
- **Conclusión permitida, y nada más que eso**: en el estado ACTUAL de la
  base de datos, las 4 columnas que `crearFirmaInterna()` inserta siempre
  existen — queda descartado el riesgo ACTUAL de que `autorizarViatico()` o
  `liquidarViatico()` fallen específicamente por `Unknown column
  'imagen_ruta'` o por ausencia de las otras 3 columnas. **Esto NO afirma
  que esos flujos funcionan correctamente de punta a punta** — la prueba
  solo confirma existencia de columnas, no comportamiento de la
  aplicación ni contenido de filas existentes.

Dos casos más quedaron con OTRA categoría principal (no
`ESTADO_DESCONOCIDO`) pero merecen la misma cautela al leerlos, documentado
donde corresponde:

- `migrate-2026-08-viat-4b-rutas-correcciones.sql` — categorizado
  `PENDIENTE_EJECUCION` (su propio encabezado es explícito y es la mejor
  evidencia disponible), pero `schema.sql` ya refleja su resultado final —
  ver sección 3.
- `propuesta-2026-08-usuario-firmas.sql` — inicialmente parecía
  `PROPUESTA_NO_APROBADA` por su encabezado ("NO ejecutada por Claude"),
  pero el código en uso (`usuario-firmas.ts`, ruta `mi-firma`) es evidencia
  más fuerte de que SÍ se aplicó (en otra sesión) — reclasificado a
  `APLICADO_CONFIRMADO (indirecta)` en la tabla maestra. Se documenta aquí
  como recordatorio de que la frase "NO ejecutada por Claude" nunca implica
  por sí sola "pendiente": otras sesiones de este mismo repositorio sí
  aplican migraciones sin dejarlo registrado (sección 8, punto 4).

## 6. Scripts destructivos / limpieza

**`limpiar-flota-empresa.sql`, `limpiar-operaciones-empresa.sql`,
`limpiar-rrhh-empresa.sql`** — los 3 son `DELETE FROM ... WHERE empresa_id =
@empresa_id` encadenados, **sin transacción explícita** (si el script se
corta a la mitad en phpMyAdmin, queda una empresa parcialmente borrada) y
**sin ningún respaldo automático**.

**Hallazgo importante**: el mismo commit que introdujo estos 3 archivos
(`507fb14`) introdujo TAMBIÉN el equivalente **dentro de la aplicación**
(`src/lib/admin/limpiar-modulo.ts` + `limpiar-operaciones.ts`), con casos
`"flota"`, `"operaciones"`, `"rrhh"`, `"rrhh_planillas"`,
`"rrhh_vacaciones"`, `"rrhh_marcajes"`, `"rrhh_incidencias"`,
`"rrhh_descuentos"`, `"rrhh_horas_extra"`, `"rrhh_inventario"`,
`"flota_kilometraje"`, `"pruebas_operaciones"`, `"operaciones_viaticos"`,
`"operaciones_multas"`, `"operaciones_accesos"`, `"facturacion_clientes"`,
`"clientes"`, entre otros — **transaccional, con auditoría, y accesible vía
Administración → Limpiar módulo**. Los 3 archivos SQL crudos son
funcionalmente redundantes con esa pantalla, pero no pasan por permisos,
auditoría ni transacción.

**Recomendación**: usar siempre la función de la app para limpiar datos de
una empresa; reservar los 3 archivos SQL únicamente como referencia
histórica de qué tablas toca cada módulo, no como procedimiento operativo
recomendado. No se han tocado ni corregido en este ticket (fuera de
alcance).

## 7. Dependencias y orden (solo donde hay evidencia explícita)

- `migrate-2026-08-operaciones-multas-rrhh.sql` requiere
  `migrate-2026-08-operaciones-multas.sql` (auto-declarado) Y
  `migrate-2026-08-rrhh-descuentos-d1.sql` (auto-declarado, esta última YA
  aplicada).
- `migrate-2026-08-operaciones-multas-pago-documentos.sql` requiere las dos
  anteriores de Multas (auto-declarado).
- `migrate-2026-08-contabilidad-entidad-integridad.sql` (C2B) requiere
  `migrate-2026-08-contabilidad-entidad-preparacion.sql` (C2A) Y
  `migrate-2026-08-contabilidad-entidades.sql` (auto-declarado) — las 3 ya
  aplicadas, en ese orden.
- `migrate-2026-08-fase-a3-backfill-tms-unidades-flota.sql` requiere
  `migrate-2026-08-fase-a1-tms-unidades-flota-vinculo.sql` (auto-declarado;
  A1 confirmada aplicada, A3 en estado desconocido).
- `migrate-2026-08-viat-4b-rutas-correcciones.sql` es incremental sobre
  `migrate-2026-08-viat-4-contactos-rutas.sql` (auto-declarado; VIAT-4
  confirmada aplicada, 4b pendiente).
- `propuesta-2026-08-firma-electronica-viaticos.sql` reutiliza la tabla
  `firmas_electronicas` de `propuesta-2026-08-firma-electronica.sql`
  (diseño), pero NO ejecuta ese archivo completo — solo la tabla específica.
- `propuesta-2026-08-firma-electronica-viaticos-imagen.sql` depende de que
  `firmas_electronicas` ya exista (de la anterior, confirmada aplicada).

## 8. Inconsistencias documentación vs. SQL vs. código

Estos son los hallazgos de mayor valor de la auditoría — patrones repetidos
de divergencia, no solo casos aislados:

1. **Encabezados obsoletos que nunca se actualizaron tras la ejecución real**
   (patrón repetido, 4 casos confirmados):
   - `migrate-2026-08-viat-1-cliente-ubicaciones.sql`: dice "NO se ejecutó en
     este entorno", pero hay datos reales confirmados en esta sesión.
   - `migrate-2026-08-fase1-ubicaciones-marcaje.sql`: dice "todavía NO se usa
     en la validación real", pero el código YA la usa en vivo
     (`geocerca.ts`).
   - `migrate-2026-08-fact-1-facturas-pagos.sql`: dice "PROPUESTA... NO
     EJECUTAR AQUÍ", pero es la base de todo el módulo de Facturación,
     confirmado funcionando extensamente.
   - `propuesta-2026-08-tms-clientes-duplicados-canonicalizacion.sql`: dice
     "PROPUESTA, NO EJECUTADA", pero el propio usuario confirmó su ejecución
     y resultado en el cierre de PR #157, en este mismo hilo.
2. **`schema.sql` está sistemáticamente desactualizado** respecto a
   migraciones confirmadas como aplicadas — no es un caso aislado, son al
   menos 12 columnas/tablas confirmadas en producción/código que NO aparecen
   en `schema.sql`: `rtu`, `numero_empleado`, `gastos_comprobados`/
   `reintegro`, `imagen_ruta`+3 (confirmada aplicada el 2026-09-01, sección 5),
   `centros_costo`, `entrevista_documentos`, `entrevistas`,
   `entrevista_responsables`, `rrhh_recordatorios`, `solicitudes_vacaciones`,
   `ubicacion_entrada_id`, y **las 3 tablas completas de Facturación**
   (`fact_facturas`/`fact_factura_viajes`/`fact_pagos`, el caso más grave —
   una instalación nueva desde `schema.sql` hoy NO tendría Facturación
   funcional en absoluto).
3. **Archivos duplicados**: `migrate-2026-08-rrhh-colaborador-auth.sql` y
   `-auth2.sql` crean la misma tabla con DDL casi idéntico.
4. **Migraciones aplicadas fuera de esta sesión, sin registro centralizado**:
   al menos `propuesta-2026-08-viaticos-liquidacion-estructurada.sql` se
   aplicó "fuera de esta sesión de Claude" según su propio encabezado —
   confirma que hay más de un agente/sesión trabajando sobre el mismo
   repositorio (visible también en los ~40 worktrees `.worktrees/*`
   encontrados), y ninguno mantiene una bitácora central de qué se aplicó
   realmente en producción. El único mecanismo de auto-registro real
   encontrado es la tabla `sitsa_migrations` (creada por
   `migrate-2026-08-corregir-hora-guatemala.sql` y usada por
   `src/lib/tz-guatemala-migrate.ts`), y solo cubre ESA migración puntual.
5. **`migrate-2026-08-corregir-hora-guatemala.sql` — divergencia
   código-vs-SQL dentro del MISMO archivo**: la app (`tz-guatemala-
   migrate.ts`) auto-aplica en runtime SOLO los 2 `UPDATE` de
   `sesiones_trabajo` (con guarda en `sitsa_migrations`) — los otros 4
   `UPDATE` del mismo archivo (`flota_viajes`, `flota_viaje_evidencias`,
   `flota_lecturas`, `flota_lectura_evidencias`) **no tienen ningún
   equivalente en código**, así que su ejecución depende ENTERAMENTE de que
   alguien haya corrido el archivo `.sql` completo manualmente — no hay
   forma de confirmar eso desde el repositorio. Es además el único archivo
   de todo `sql/` que audita su propia aplicación en una tabla dedicada
   (`sitsa_migrations`), y ni así cubre completamente lo que el archivo
   hace.
6. **`propuesta-2026-08-firma-electronica-viaticos-imagen.sql`**: fue el caso
   más grave de la auditoría — evidencia CONTRADICTORIA explícita y
   documentada dentro del propio archivo (usuario dice que sí, log de error
   de producción dice que no). **Cerrado el 2026-09-01**: verificación real
   (`DESCRIBE firmas_electronicas;`) confirmó que las 4 columnas existen
   actualmente — ver nota de cierre en sección 5. Se mantiene aquí como
   registro de que la contradicción documental ocurrió y de cómo se
   resolvió, no como riesgo abierto.

## 9. Recomendación final priorizada

~~Verificar `DESCRIBE firmas_electronicas;` en producción~~ — **RESUELTA el
2026-09-01** (ver nota de cierre, sección 5): las 4 columnas de imagen
existen actualmente. Retirada de esta lista.

1. **Confirmar el estado real de los 4 `UPDATE` de Flota** en
   `migrate-2026-08-corregir-hora-guatemala.sql` (¿se corrieron alguna vez?
   — sin equivalente en código, a diferencia de la parte de marcajes). Pasa
   a ser la nueva prioridad #1 de la auditoría.
2. Ejecutar (si el negocio lo aprueba) las 3 migraciones de Multas en orden,
   si el módulo de Multas va a activarse — o descartarlas explícitamente si
   ya no es prioridad.
3. Ejecutar `migrate-2026-08-rrhh-casos-legales.sql` antes de que alguien
   use la pantalla de Casos Legales (ya desplegada sin su tabla).
4. Actualizar `schema.sql` para reflejar las ~15 columnas/tablas confirmadas
   pero ausentes (sección 8, punto 2) — especialmente las 3 tablas de
   Facturación, el hueco más grave. Ticket documental/SQL aparte, sin tocar
   producción.
5. Consolidar (o al menos anotar cuál es la versión "canónica" de)
   `migrate-2026-08-rrhh-colaborador-auth.sql` vs. `-auth2.sql`.
6. Verificar el estado real del índice único de `tms_cliente_rutas`
   (`migrate-2026-08-viat-4b-rutas-correcciones.sql`) antes de decidir si
   falta ejecutarlo.
7. Considerar retirar o marcar explícitamente como históricos los 3
   `limpiar-*-empresa.sql`, dado que la app ya tiene un equivalente más
   seguro (Administración → Limpiar módulo).
8. Verificar `correccion-de-vacaciones.sql` y
   `migrate-2026-08-fase-a3-backfill-tms-unidades-flota.sql` (impacto bajo,
   pero sin ninguna evidencia de haberse corrido).
9. Adoptar, hacia adelante, el patrón ya existente pero subutilizado de
   `sitsa_migrations` (o un mecanismo equivalente) para registrar
   CENTRALIZADAMENTE cada migración manual realmente aplicada — resolvería
   de raíz la mayoría de los hallazgos de esta auditoría.

Ninguna de estas acciones se ejecutó en este ticket — quedan como
recomendación para tickets separados, cada uno con su propia autorización
explícita. No se ejecutaron los 4 `UPDATE` de Flota (punto 1) ni ningún
otro SQL en este ticket — solo se registró la verificación ya realizada del
hallazgo de firmas.
