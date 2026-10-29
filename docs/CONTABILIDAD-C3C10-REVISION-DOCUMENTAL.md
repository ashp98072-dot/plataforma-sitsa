# C3C-10 — Revisión y rectificación documental

## Alcance

Calendario contable → ejercicio → Consultar preparación de regularización incorpora
historial documental y el formulario de revisión/rectificación. Reutiliza la consulta
C3C-9, los permisos existentes y su transacción de lectura consistente. No altera
asientos, líneas, importes, cuentas, ejercicios o períodos, abiertos o cerrados.
No aprueba políticas, no contabiliza y no ejecuta regularizaciones, cierres ni aperturas.

Se distinguen cuatro acciones:

- Identificación documental: declaración inicial de C3C-9, conservada como versión 0.
- Revisión documental: conserva clasificación, agrega justificación y referencia; puede
  renovar la huella tras una modificación del asiento realizada por otro flujo.
- Rectificación documental: cambia NORMAL ↔ REGULARIZACION mediante otra declaración.
- Revisión técnica: borradores de preparación C3C-9; ninguna de las anteriores constituye
  aprobación contable formal. Ese flujo no existe en esta entrega.

Una declaración es evidencia atribuible al revisor, no certificación de autenticidad del
documento externo o validez del asiento. No se adjuntan documentos ni se infiere procedencia
por nombres/códigos. La identificación original de emisión controlada también se conserva;
sus revisiones posteriores se atribuyen expresamente a REVISION_DOCUMENTADA.

## Contrato y persistencia

`cont_asientos_origen_revisiones` contiene ámbito, asiento, ejercicio, versión, tipo,
clase anterior/nueva, justificación obligatoria, referencia, huella del asiento,
huella de la declaración anterior, clave de idempotencia, huella de solicitud, actor y fecha.
FK compuesta a la raíz C3C-9, FK al ejercicio/actor y unicidad de versión/clave.

No existe tabla de estado mutable: la declaración vigente se deriva de la raíz y las
transiciones ordenadas. Cada enlace verifica versión consecutiva, ejercicio/asiento,
clase anterior, contrato, actor y huella de la declaración previa. Una cadena incompatible
queda inválida y bloqueada; no se omiten sus errores ni se permite repararla desde esta API.
Los triggers rechazan UPDATE/DELETE de las revisiones, además de no existir endpoints de
edición/borrado. No son protección frente a un administrador SQL capaz de retirar controles.

La raíz C3C-9 nunca se actualiza. Cambiar una clasificación no cambia el asiento ni su
estado Registrado. La huella del asiento debe coincidir con el estado actual. El historial
completo entra en la huella de preparación, incluso si se retorna a la clasificación inicial.
Esto desactualiza los borradores anteriores sin borrarlos o modificar su evidencia.
Al desplegar C3C-10 también se incorpora fecha de raíz e historial vacío al contrato de
huella: los borradores C3C-9 previos deben volver a consultarse y prepararse si procede.
C3C-5–C3C-8 conservan sus contratos; C3C-6 continúa INCOMPLETA y propuestaCompleta=null.

## API y autorización

- Consulta: GET de preparación C3C-9 añade `historialOrigen` y, por asiento,
  `revisionDocumental` (raíz, vigente, versión, huella de vigente y estado de cadena).
- POST `/api/empresas/[slug]/contabilidad/ejercicios/[id]/revision-origen?entidad=ID`:
  `{asientoId,versionEsperada,huellaVigente,huellaAsiento,tipo,clase,justificacion,
  referencia,claveIdempotencia,confirmacion:"DOCUMENTACION_REVISADA_SIN_APROBACION_CONTABLE"}`.

JSON estricto: no acepta aprobación, empresa arbitraria u órdenes contables.
Permisos: consulta tenant existente; escritura requiere usuario activo, asignación explícita
de empresa y Contabilidad:ver/editar global existente, sin excepción implícita de Admin.
La rectificación exige un actor distinto del autor de la declaración vigente. Una revisión
que conserva clasificación puede hacerla el mismo autor. Esta separación técnica no es
un circuito formal de doble aprobación ni certifica independencia organizativa del revisor.
No se crean permisos ni se conceden automáticamente.

Se reutiliza el bloqueo C3C-9 del libro, fuentes, raíz, historial y autorización antes de la
primera lectura consistente. Versiones/huellas antiguas reciben 409; operación/clase
incompatible o asiento no Registrado, 422; falta de autorización/separación, 403.
Sin raíz en el ejercicio: 409; asiento/ámbito no accesible: 404; JSON inválido: 400;
esquema pendiente: 503. Respuestas privadas no-store y errores internos sin datos sensibles.

Idempotencia ligada al actor, ámbito y cuerpo canónico. Reintento idéntico autorizado
devuelve la versión original sin duplicar auditoría, incluso si después hay nuevas versiones.
Reutilizar la clave para otra petición devuelve 409. Las referencias de otros asientos
del libro no pueden reutilizarse; revisiones del mismo asiento pueden compartir referencia.
Auditoría `origen_revision_documental` registra anterior/nueva clasificación, actor,
versión, justificación, referencia y huellas en la misma transacción. Si falla, todo revierte.

## SQL manual y rollback

Dependencias: ámbito compuesto C2B, calendario/control C3C-1/C3C-2, configuración C3C-7,
tablas y controles C3C-9, usuarios/permisos/asignaciones y auditoría InnoDB existentes.
MariaDB 11.8.9; se requieren privilegios CREATE y TRIGGER en la aplicación manual.

Después del merge y de autorización productiva separada, ejecutar manualmente:

1. `sql/preflight-2026-10-origen-revisiones-c3c10.sql` (junto al postcheck C3C-9).
2. `sql/migrate-2026-10-origen-revisiones-c3c10.sql`.
3. `sql/postcheck-2026-10-origen-revisiones-c3c10.sql`.

Todos los controles deben dar cero errores. Crea una tabla y dos triggers; sin backfill,
concesiones, cambios de movimientos o cambios de auditoría. CREATE IF NOT EXISTS conserva
datos al repetir, pero no repara una tabla/trigger preexistente incompatible. DDL no es
atómico: ante fallo parcial detenerse e investigar, sin saltarse controles. Postcheck
comprueba columnas, índices, restricciones y existencia/evento/cuerpo de los triggers.
No se ejecutó SQL en producción ni en bases preexistentes; solo instancias temporales nuevas.

Rollback preferido: deshabilitar nuevos endpoints/formulario y conservar tabla y auditoría.
Si ya se rectificó una clasificación, volver al lector C3C-9 sin adaptación mostraría la raíz
antigua: **no usar esa versión como procedencia vigente**. Retirar el módulo de preparación
o mantener el lector C3C-10 hasta resolver la recuperación con revisión humana.
Nunca borrar historial con datos. Retirar tabla/triggers solo si está vacía, sin consumidores
y con revisión de FK, respaldo autorizado de estructura y autorización separada en mantenimiento.
No se incluye rollback destructivo automático.

## Validación y límites

Pruebas específicas de cadena, permisos, ámbito, separación, historial, huellas, referencias,
concurrencia, idempotencia, revocación, rollback e incompatibilidades, además de compatibilidad
C3C-5–C3C-9. Runner MariaDB privado, TCP deshabilitado y cierre automático:

`node scripts/ci/c3c10/run-windows.mjs --run-isolated --engine=mariadb`

Compatibilidad C3C-9 con esquema nuevo en otra instancia nueva:

`node scripts/ci/c3c10/run-windows.mjs --run-compat-isolated --engine=mariadb`

Pendientes humanos: política de aprobación contable, suficiencia/autenticidad documental,
idoneidad formal de cuentas, evidencia externa y roles de independencia organizativa.
No se certifica equivalencia con Milenium 2000. No se ejecutó validación visual manual
C3C-10 ni se intervino el laboratorio conservado C3C-8. El PR es para auditoría independiente,
no autorización de contabilización ni cierre formal.
