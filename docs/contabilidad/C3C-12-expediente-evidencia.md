# C3C-12 - Expediente de evidencia y validacion previa

Base: e2a3fb9fa30bf59b9e7afc5a8fff11d6b45ecb0c (PR #535).
Rama: feature/c3c12-expediente-evidencia.
Desarrollo aislado en .worktrees/c3c12; cambios preexistentes de C3C-2 conservados. Main local actualizado.

## Funcionalidad

GET/POST /api/empresas/[slug]/contabilidad/ejercicios/[id]/expedientes?entidad=ID.
Expediente derivado por solicitud C3C-11: politica y version, borrador C3C-9, historial documental C3C-10, responsables, decisiones, justificaciones, huellas, bloqueantes y obsolescencia. Sin duplicar movimientos contables.

Evidencias inmutables por codigo y version. La ultima sustituye a las anteriores sin borrarlas. Estados: PENDIENTE, NO_VERIFICADA, VERIFICADA_TECNICAMENTE, REVOCADA. Referencia y SHA-256 son declaraciones, no prueba de autenticidad. La verificacion requiere al revisor designado, una declaracion previa de otro responsable y conservar referencia y hash. Todas las versiones se comprueban, incluida continuidad 1..N. Una nueva referencia debe registrarse NO_VERIFICADA antes de revisarla.

Codigos documentales obligatorios del contrato inicial: POLITICA, BORRADOR, REVISION_DOCUMENTAL. Otros codigos son admitidos y sus pendientes tambien bloquean. Completo tecnicamente no significa aprobado formalmente. No hay accion de aprobacion formal.

La huella base abarca la solicitud y decisiones, politica, condiciones actuales, borrador e historial C3C-10. Una modificacion posterior desactualiza las evidencias; se requiere nueva declaracion y revision. Control optimista usa huella completa del expediente y version del codigo. Idempotencia incluye actor y ambito. Bloqueos C3C-11 serializan escritores y permisos; auditoria participa en la misma transaccion.

Panel en Calendario contable: resumen, motivos, responsables, decisiones, revision documental, versiones y formulario. Exportacion JSON local del expediente consultado con ambito y aviso. Referencias mostradas como texto; no se descargan documentos ni se realizan peticiones a URLs proporcionadas. No se introdujo almacenamiento de archivos.

## SQL manual preparado

- sql/preflight-2026-10-expediente-evidencia-c3c12.sql
- sql/migrate-2026-10-expediente-evidencia-c3c12.sql
- sql/postcheck-2026-10-expediente-evidencia-c3c12.sql

Tabla cont_regularizacion_evidencias con FK compuesta al ambito y solicitud, unicidad de versiones e idempotencia, checks y triggers anti UPDATE/DELETE. Schema de instalacion nueva actualizado. Aplicar solo despues de C3C-11, mediante proceso manual autorizado. No se ejecuto SQL en Hostinger. Ausencia de migracion devuelve 503.
Postcheck comprueba estructura, triggers, huerfanos, formato de huellas y continuidad. La recomputacion SHA-256 canonica se realiza en servicio, no mediante SHA2 del texto JSON SQL.

## Validacion 2026-10-30

- 79 pruebas unitarias/contratos/API/render estatico de interfaz: aprobadas.
- MariaDB 11.8.9 temporal, named pipe unico y sin red: C3C-12 9/9; C3C-9 30/30; C3C-10 20/20; C3C-11 31/31.
- Migracion C3C-12 repetida dos veces en entorno temporal; preflight y postcheck aprobados.
- C3C-12 prueba permisos, aislamiento de ejercicio/empresa, concurrencia, idempotencia, separacion de revision, integridad, invalidacion, inmutabilidad y rollback por fallo de auditoria.
- TypeScript noEmit: aprobado. ESLint de archivos modificados: aprobado. git diff --check: aprobado.
- Revision independiente: corregida omision de integridad historica y continuidad; normalizadas fechas mediante DATE_FORMAT; corregidos textos afectados por codificacion.
- El ejecutor antiguo C3C-9 falla por no preparar cont_asientos_origen_revisiones de C3C-10. La misma suite pasa con el ejecutor C3C-12 y todas las dependencias instaladas.

Comandos reproducibles:

    node scripts/ci/c3c12/run-windows.mjs --run-isolated --engine=mariadb
    node scripts/ci/c3c12/run-windows.mjs --run-c9-isolated --engine=mariadb
    node scripts/ci/c3c12/run-windows.mjs --run-compat-isolated --engine=mariadb
    node scripts/ci/c3c11/run-windows.mjs --run-isolated --engine=mariadb

## Limites y pendientes

Validacion de interfaz mediante render estatico y contratos HTTP; no recorrido en navegador autenticado. No se verifican bytes de archivos externos ni autenticidad documental. La configuracion de codigos obligatorios es fija en este contrato, sin reglas configurables. El resumen exportado es una instantanea y debe reconsultarse antes de revision posterior. No constituye firma digital ni aprobacion contable. Acceso de lectura hereda guard y ambito de Calendario; gestion exige permisos explicitos y responsabilidad designada.

Sin asientos reales, aprobaciones automaticas, regularizaciones definitivas, cambios historicos, apertura/cierre de ejercicios, merge ni despliegue. Laboratorio temporal C3C-8 conservado sin intervencion.
