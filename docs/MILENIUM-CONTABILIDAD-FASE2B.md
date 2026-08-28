# Fase 2B — catálogo preparatorio de entidades y accesos

## Disponible después del despliegue y la migración manual

Contabilidad → Configurar entidades contables. Admin crea código/nombre de cada
razón social, activa/desactiva y asigna/revoca usuarios. No hay borrado físico.
No se crean KT/Mónaco ni se asignan usuarios automáticamente. Configurar las dos
razones sociales confirmadas por el responsable, sin crear otra para Mónaco 00:
esa base es histórica de Mónaco 08 y su solapamiento se conciliará al importar.

Un usuario no Admin ve solo entidades activas con acceso activo asignado. Además,
el guard existente exige permiso efectivo de Contabilidad y acceso al tenant.
Los candidatos son usuarios activos con acceso a la empresa o a todas; asignar
entidad no concede acceso global ni permiso de módulo. Si se revoca el permiso de
módulo/empresa, el guard lo bloqueará aunque conserve la asignación de entidad.
Admin administra todas las entidades del tenant. No se entregan listas de otros
usuarios ni sus asignaciones a usuarios no Admin.

Las mutaciones bloquean entidad/usuario, usan una sola transacción con auditoría
obligatoria y revierten ante fallos. La revocación es lógica y funciona incluso
si el usuario quedó inactivo o perdió acceso al tenant. Desactivar una entidad
la oculta a sus usuarios; reactivarla conserva los accesos que no se revocaron.
GET usa no-store y vuelve a consultar asignaciones, sin caché propio.

## Migración MANUAL, NO ejecutada por el agente

Archivo: sql/migrate-2026-08-contabilidad-entidades.sql.

- Crea cont_entidades y cont_entidad_usuarios, InnoDB.
- IF NOT EXISTS permite repetir sobre tablas ya creadas; no corrige definiciones
  divergentes: verificar esquema si existían tablas homónimas.
- FKs RESTRICT, incluida relación compuesta empresa/entidad. No CASCADE ni
  desactivación de FKs dentro de esta migración.
- No ALTER de cuentas/asientos; no semillas, backfill ni importación.
- Requiere empresas/usuarios existentes con IDs INT compatibles.
- Se mantiene la misma definición en schema.sql para instalaciones nuevas.
- Si faltan tablas/columnas, la nueva API devuelve 503 controlado y la pantalla
  muestra configuración pendiente. Las pantallas contables previas siguen igual.

Respaldar y revisar la migración antes de aplicarla. No ejecutar schema.sql como
actualización de producción. No hay DDL automático al abrir la pantalla.

## Límites IMPORTANTES

Esto es configuración preparatoria, NO separación efectiva del libro contable.
Las cuentas/asientos/CxC/CxP actuales todavía dependen de empresa_id y no usan
entidad_id. Los permisos de entidad solo filtran este catálogo; no ocultan saldos
anteriores. El acceso de edición queda preparado para la próxima fase; únicamente
Admin modifica este catálogo. No ofrecer todavía importación de ambas razones
sociales al mismo tenant ni interpretar esta configuración como aislamiento fiscal.

Limpiar Contabilidad conserva estas tablas de configuración (no cambia la limpieza
existente). Sus FKs RESTRICT impiden eliminar físicamente empresas/usuarios con
configuración vinculada: usar desactivación, no quitar las restricciones.

## Siguiente fase requerida

Agregar identidad contable a cuentas/partidas, guard conjunto tenant+entidad+
acción, selección explícita en todas las pantallas/reportes afectados y backfill
revisado de datos previos. Luego revisar CxC/CxP, numeración, períodos, limpieza y
Facturación antes de importar. No asignar filas previas a KT por defecto.
Homologar TIPO_CTA/CTACOM_CTA/MULTIP_CTA y la fuente histórica 00 antes de saldos.

Validación de esta entrega: pruebas simuladas de autorización, filtro tenant,
revocación, rollback y error de migración; revisión estática de equivalencia del
DDL. Pendiente ejecutar migración y probar navegación/concurrencia en un entorno
controlado. No se consultó ni modificó producción.
