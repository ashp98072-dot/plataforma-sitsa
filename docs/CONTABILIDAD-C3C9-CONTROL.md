# C3C-9 — Preparación y procedencia de regularizaciones

## Alcance funcional

Calendario incorpora **Consultar preparación de regularización** junto a C3C-5/C3C-6/C3C-8.
La consulta muestra contrato, versión, huella, nominales, resultado, cuenta configurada,
idoneidad técnica/formal, bloqueantes, procedencia y últimas veinte revisiones técnicas.
Un usuario autorizado puede guardar un borrador o registrar evidencia documental de origen.
Ninguna operación registra asientos, cambia líneas históricas, períodos, catálogo o roles.
No hay aprobación, contabilización, cierre o apertura formal.

C3C-6 conserva su contrato y transacción READ ONLY. Se extrajo `consultarRegularizacionTx`
para compartir su cálculo/diagnóstico y una sola instantánea con C3C-9. C3C-8 conserva su
simulación y sus avisos; C3C-9 es el control adicional que consulta los nuevos metadatos.
No existe un segundo motor monetario: se reutilizan sus inversas y BigInt.

## Política técnica y huellas

`C3C9-PREP-1`, versión 1, se basa en C3C8-SIM-1. Identifica empresa, libro, ejercicio,
nominales incluidas y cuenta de resultado, tratamiento de signos, exclusión de historia,
requisitos de idoneidad y decisiones pendientes. Estado BORRADOR_NO_APROBADO y aprobada=false.
Una revisión persistida tiene estado BORRADOR; nunca existe un estado APROBADO/CONTABILIZADO.

La huella SHA-256 usa JSON canónico, con claves ordenadas y arrays en orden SQL estable.
Incluye estado y fechas del ejercicio, períodos y sus versiones/revisiones de cierre,
control de períodos, catálogo del libro (incluido nivel/actividad), rol de resultado y fecha
de actualización, cabeceras/líneas de **todos los estados dentro del ejercicio** y metadatos
de procedencia, contrato de política C3C-8, resumen monetario y bloqueantes calculados.
Fechas de generación y revisiones de borradores no entran en la huella.
Los importes monetarios son cadenas DECIMAL/centavos BigInt; no se agregan con Number.

Una diferencia de condiciones invalida el borrador anterior. Guardar exige la huella recién
consultada y la versión previa esperada; devuelve 409 si hubo cambios o una revisión ganadora.
Las modificaciones que restituyen exactamente los mismos datos no son un historial universal
de mutaciones: la huella describe condiciones observadas, no sustituye auditoría de todo el ERP.
Los saldos de ejercicios anteriores siguen separados y no forman parte de la regularización.

Un borrador puede conservar bloqueantes para dejar evidencia de una revisión incompleta.
Guardar no elimina bloqueantes técnicos o formales ni autoriza ejecutar la propuesta.
Si cambian las condiciones se puede preparar una nueva revisión, manteniendo las anteriores.

## Identificación explícita, indicios e historia

`cont_asientos_origen` es metadato separado del asiento y vinculado por FK compuesta a
empresa/libro/asiento y ejercicio. No hay backfill por nombres, códigos o saldos.

- REGULARIZACION_IDENTIFICADA: clase explícita REGULARIZACION, fuente admitida,
  referencia, actor, ejercicio y huella del asiento coincidentes.
- NORMAL_IDENTIFICADO: iguales requisitos con clase NORMAL. No es el valor por defecto.
- INDICIO: asiento Registrado sin procedencia válida con movimientos en la cuenta de resultado,
  incluso si el neto es cero. No se afirma que sea una regularización.
- NO_VERIFICADO: información insuficiente, origen no marcado o metadato incompatible, salvo
  que además exista el indicio anterior. Nunca se convierte automáticamente la historia en NORMAL.

La huella de origen liga fecha, número, estado, glosa, creador y líneas ordenadas (ID, cuenta,
Debe/Haber). Cambiar el asiento invalida la declaración: se muestra METADATOS_ORIGEN_INVALIDOS.
No se descartan silenciosamente etiquetas incoherentes. Los asientos de otros ejercicios
no se mezclan, incluso si su metadato tiene un ejercicio erróneo: el lector verifica ambas cosas.

La API actual solo emite **REVISION_DOCUMENTADA**: un editor asignado confirma que revisó
documentación y aporta una referencia única. Se conserva clase, referencia, huella, autor y
fecha; la acción es inmutable e idempotente y genera auditoría transaccional. Declarar una
regularización existente no la genera ni modifica su asiento. La declaración identifica
explícitamente su origen atribuido; **no certifica autenticidad externa del documento ni
validez contable**. Es responsabilidad del revisor aportar evidencia suficiente.

EMISION_CONTROLADA queda como contrato técnico de integración para un futuro emisor
autorizado que etiquete en la misma transacción de emisión. **No existe emisor formal ni
endpoint que permita simular esa fuente en esta entrega**. Sus pruebas usan fixtures.

Una regularización identificada, varios registros identificados, indicios sin resolver o
metadatos inválidos bloquean la preparación técnica disponible para simulación C3C-9.
La imposibilidad de certificar toda la procedencia histórica permanece como decisión pendiente.
Una identificación errónea no se sobrescribe: su rectificación requiere un procedimiento
auditado específico todavía no definido; el backend devuelve 409 ante una declaración distinta.

## Permisos, transacciones e idempotencia

GET reutiliza `requireTenantCalendario(slug,'ver')`, acceso tenant y selección estricta
de entidad/ejercicio. Conserva el contrato existente de lectura de Admin.
POST exige además usuario activo, asignación explícita a empresa y permiso global existente
Contabilidad con puede_ver=1 y puede_editar=1. **Admin no recibe excepción de escritura**.
No se crean ni conceden permisos. El cliente recibe puedeGuardar y los servicios vuelven
a comprobar autorización, independientemente de la interfaz.

La consulta utiliza READ ONLY / REPEATABLE READ. Las escrituras bloquean el ámbito existente
empresa/libro, fuentes del libro y filas de autorización antes de su primera lectura consistente.
Después recalculan condiciones y verifican huella/versión. Este orden evita la instantánea vieja
del perdedor y mantiene fuentes y autorización estables hasta commit. El bloqueo es deliberadamente
amplio; se prioriza integridad sobre concurrencia de escrituras del mismo ámbito.

Los borradores son revisiones append-only con unicidad empresa/libro/ejercicio/versión y
empresa/libro/UUID de idempotencia. La solicitud se liga también al actor, huella, revisión y nota.
Un reintento idéntico devuelve la revisión original sin nueva auditoría; reutilizar la clave con
otro contenido o actor devuelve 409. La revisión documental tiene unicidad de asiento y de
fuente/referencia por libro; duplicado idéntico por el mismo actor se reutiliza sin nueva auditoría.

`registrarAuditoriaTx` comparte la transacción. Un fallo de auditoría revierte íntegramente
borrador o metadato; no se silencia el error. Detalles incluyen actor, empresa/libro/ejercicio,
versión anterior/nueva o declaración anterior nula, huella y aprobación/contabilización false.

## API

- GET `/api/empresas/[slug]/contabilidad/ejercicios/[id]/preparacion-regularizacion?entidad=ID`
- POST misma ruta: `{huellaCondiciones,versionEsperada,claveIdempotencia,nota}`.
- POST `/api/empresas/[slug]/contabilidad/ejercicios/[id]/identificacion-origen?entidad=ID`:
  `{asientoId,huellaAsiento,clase,referencia,confirmacion:"DOCUMENTACION_DE_ORIGEN_REVISADA"}`.

Entradas estrictas: no aceptan aprobado, contabilizar, empresa arbitraria u operaciones extras.
400 validación; 403 autorización; 404 ámbito; 409 conflicto; 422 estado del asiento no Registrado;
503 esquema pendiente. Cache privado/no-store. No hay operaciones de contabilización ni métodos
para editar/borrar revisiones o declaraciones. La UI mantiene la clave en reintentos de red
y descarta respuestas de un ámbito desmontado mediante AbortController y claves de componente.

## Migración SQL y rollback

Requiere C2B (ámbito compuesto), C3C-1/C3C-2, C3C-7, usuarios, asignaciones, permiso
Contabilidad:editar existente y auditoría transaccional. MariaDB 11.8.9, tablas InnoDB.
No modifica sql/schema.sql, tablas previas, roles, permisos o asientos.

Orden de aplicación **manual después del merge y autorización específica**:

1. `sql/preflight-2026-10-regularizacion-control-c3c9.sql`: todos los errores deben ser cero.
2. `sql/migrate-2026-10-regularizacion-control-c3c9.sql`: dos tablas nuevas, sin backfill.
3. `sql/postcheck-2026-10-regularizacion-control-c3c9.sql`: verificar esquema/constraints/índices.

CREATE TABLE IF NOT EXISTS conserva datos al reejecutar; no repara un esquema preexistente
incompatible. Revisar los resultados y detenerse si no coinciden. DDL no es atómico: un fallo
parcial exige revisión, nunca completar automáticamente a la fuerza. Charset utf8mb4 binario
para referencias/JSON; claves de huella e idempotencia ASCII sensibles a mayúsculas.

Rollback seguro preferido: retirar la interfaz/API nueva volviendo a la versión anterior y
**conservar las dos tablas y la auditoría**. Si ya tienen datos, no hacer DROP ni borrar evidencia;
se necesita una política de archivo/retención aprobada. Si nunca se utilizaron, un responsable
puede comprobar en mantenimiento COUNT(*)=0 en ambas, ausencia de consumidores/FK entrantes y
exportación autorizada de estructura, y solo entonces autorizar manualmente DROP de
cont_asientos_origen y cont_regularizacion_borradores. No hay un rollback destructivo automático.
No se ejecutó SQL en producción ni bases existentes; todo el ensayo usa una base temporal nueva.

## Pruebas y decisiones pendientes

Las pruebas focalizadas cubren procedencia explícita y ambigua, signos/precisión heredados,
versiones, lectores y escritores (incluido Admin sin permisos), ámbitos, claves duplicadas,
concurrencia, huellas ante cambios de catálogo/movimientos/configuración/períodos, instantánea
concurrente, rollback de ambas escrituras ante fallo de auditoría, ausencia de cambios en asientos,
compatibilidad C3C-5–C3C-8 y reejecución de migración sin pérdida de datos ni concesión de permisos.
Runner: `node scripts/ci/c3c9/run-windows.mjs --run-isolated --engine=mariadb`.
Solo acepta MariaDB verificada, pipe privado, TCP deshabilitado y cierre del proceso propio.

Pendientes: política contable formal y aprobadores, imputabilidad/idoneidad formal de cuentas,
autenticidad y suficiencia de documentación histórica, rectificaciones de procedencia, emisor
formal futuro, cierre/apertura y efectos fiscales. No se certifica equivalencia con Milenium 2000.
Las pruebas automatizadas no sustituyen validación visual/manual de las nuevas pantallas C3C-9.
