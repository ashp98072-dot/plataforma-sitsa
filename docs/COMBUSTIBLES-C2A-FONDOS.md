# C-2A — vínculo opcional de vale a línea de Fondos

Base: main `3a9b2d601674159d07f9a74fc2e628a972404e6d`, posterior a #474.

## Contrato comprobado en código

`tms_solicitudes_fondo` -> `tms_solicitud_fondo_lineas.id`. Categoría literal `Combustible`; monto solicitado = cantidad × monto. `actualizarSolicitudFondo` (`src/lib/tms/fondos.ts`) bloquea cabecera y solo admite Pendiente; reemplaza físicamente líneas mediante DELETE/INSERT. Autorizada/Liquidada no admiten edición de contenido. Rechazada también es inmutable, pero no es elegible en C2A.

`flota_combustible_cargas.solicitud_fondo_linea_id INT NULL`: una línea admite muchos vales; un vale cero o una línea. FK compuesta empresa/línea RESTRICT y UNIQUE padre empresa/id. Sin cambios de vehículo, viajes, piloto, empleado ni viáticos. Vehículos compartidos conservan su FK simple existente.

El servidor relee cabecera y línea con FOR UPDATE, exige mismo tenant, categoría y estado, y compara unidad si existe. Sin unidad en línea se admite y se indica que no fue validada por Fondos. La captura/edición del vínculo y auditoría se confirman en la misma transacción del vale. Omitir campo conserva, NULL elimina. Solo PENDIENTE editable; permisos Registrar/Editar pendientes existentes.

Una solicitud autorizada puede rechazarse después: su vínculo se conserva visible con el estado actual; editar el vale exige quitar/cambiar ese vínculo no elegible. No se borran históricos ni se captura snapshot redundante. `empleado_id` se presenta como Empleado relacionado, nunca se infiere Piloto.

## UI y permisos

Nuevo/editar vale usa CatalogoSearchSelect, búsqueda remota acotada a 50 coincidencias, código/placa/empleado/monto. API nueva `GET /api/empresas/[slug]/flota/combustible/fondos?q=...` admite Registrar OR Editar pendientes, con guards tenant existentes. No concede acceso al expediente de Fondos ni a banco/cuenta. `?lineaId=` permite resumen con Ver Combustibles. La bandeja muestra contexto y carga el resumen solo al abrirlo.

Resumen por línea: cantidad × monto una vez, número de vales y sumas separadas PENDIENTE/APROBADO/RECHAZADO, agregadas antes del JOIN. No Entregado/Desembolsado/Facturado. No importación HALEL, matching ni cambios de conciliación.

## Rollout pendiente de autorización

No se ha consultado ni migrado producción. DDL del repositorio no certifica el esquema físico.

1. Seleccionar BD y ejecutar manualmente `sql/preflight-2026-10-combustibles-c2a-fondos.sql` (SELECT/SHOW).
2. Revisar tipos INT signed, PK, InnoDB, índices, nombres FK, ausencia de huérfanos y contrato inicial/final. Comparar SHOW CREATE con DDL propuesto. Cualquier divergencia/estado parcial => DETENER.
3. Solo tras aprobación, ejecutar `sql/migrate-2026-10-combustibles-c2a-fondos.sql`. Es DDL con compuerta metadata, no DML; requiere permisos de procedimiento y lectura information_schema del schema seleccionado. Si Hostinger los deniega, detener y diseñar protocolo compatible, no aplicar ALTER sueltos.
4. Ejecutar postcheck, comparar conteos. Reejecución sobre contrato final => NOOP. Una interrupción entre ALTERs requiere revisión manual, no reparación automática.
5. Desplegar código solo después de BD verificada; probar tenant/permisos y alta/edición sin vínculo y con vínculo.

No DDL en requests ni ejecución automática deploy/build. No seeds/backfill, no cambio de collation/índices previos. SQL/schema.sql no contiene actualmente la tabla de cargas (bootstrap Flota); el contrato incremental está en esta migración, sin introducir ejecución de C2A en bootstrap.

Riesgos: esquema físico aún sin validar; metadata/procedimientos restringidos en Hostinger; DDL no transaccional; crecimiento de catálogo limitado mediante búsqueda; rechazo posterior del origen requiere corrección explícita para editar. No hay comprobación de dinero entregado.

## Validación local

Mismo comando, máquina y dependencias para BASE y rama: `npx vitest run src/lib/flota/combustible src/app/api/empresas/[slug]/flota/combustible src/lib/tms/fondos src/app/api/empresas/[slug]/tms/fondos`.

- BASE exacta: 568 aprobadas, 21 omitidas, 0 fallos.
- C2A: 599 aprobadas, 21 omitidas, 0 fallos (31 pruebas adicionales). Cero regresiones en esta suite dirigida ampliada; no se ejecutó la suite completa global.
- TypeScript, ESLint dirigido y diff-check limpios. Build de producción local exitoso; avisos en archivos existentes no modificados (middleware, Cache-Control y trazado de archivos).
- Pruebas con mocks: elegibilidad, tenant, locks, unidad ausente/incompatible, asignar/cambiar/quitar/preservar, múltiples vales por línea, estados inmutables, permisos reales del endpoint con servicios simulados, SQL de agregación y contratos estáticos de migración. Render HTML del contexto y selección histórica comprobado.
- No prueba real de migración/FK ni navegación con BD: pendientes de preflight y entorno autorizado. No afirmar validación física por pasar mocks/compilación. SQL de los scripts no se ejecutó.
