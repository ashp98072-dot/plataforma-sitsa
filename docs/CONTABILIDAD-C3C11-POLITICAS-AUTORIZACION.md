# C3C-11 — Políticas propuestas y solicitudes técnicas

## Alcance y límites

Calendario contable incorpora **Consultar políticas y solicitudes** por empresa/libro/ejercicio.
La pantalla muestra políticas y versiones, responsables, nominales, resultado, signos,
vigencia propuesta, justificación, huellas, solicitudes, decisiones y bloqueantes.
Todos los estados distinguen propuesta, revisión técnica y autorización formal pendiente.
No existe estado ni operación de aprobación contable efectiva, contabilización o cierre.
No se cambia ningún asiento, importe, cuenta, saldo, ejercicio o período.

`C3C11-POL-1` es una propuesta persistida, no una política contable definida por el sistema.
El preparador selecciona explícitamente nominales, documenta reglas/justificación y designa
otros dos responsables técnicos. Solo se admite el tratamiento técnico ya simulado por C3C-8:
invertir el neto del ejercicio sin arrastrar historia. No hay otro motor monetario.
Reglas de vigencia en texto son documentación a revisar, no código ni excepciones ejecutables.
Ejercicio/fechas, nominales y cuenta de resultado provienen del ámbito actual; esta última
debe estar configurada y validada técnicamente por C3C-7. Idoneidad formal permanece pendiente.
Una propuesta nominal parcial puede conservarse, pero bloquea revisión técnica satisfactoria.

## Persistencia e historial

- `cont_regularizacion_politicas`: código/versión por empresa/libro/ejercicio, contrato JSON,
  huella de política/condiciones, tres responsables, autor, fecha e idempotencia.
- `cont_regularizacion_solicitudes`: vínculo compuesto a política y borrador C3C-9, huella,
  justificación, diagnóstico/procedencia al preparar, actor y fecha.
- `cont_regularizacion_decisiones`: eventos consecutivos con estado anterior, acción,
  justificación, huella observada, actor, fecha e idempotencia.

Los tres historiales son append-only; seis triggers impiden UPDATE/DELETE y la API no ofrece
edición/borrado. El estado de la solicitud se deriva de su historial. Versiones, actor,
transición e integridad de política se verifican al leer; cadenas incoherentes fallan cerradas.
La protección no pretende impedir que un administrador SQL retire los controles.

Nueva política = nueva versión; solo el preparador propietario puede versionar su código
en el ejercicio. Una solicitud liga la última versión y el último borrador vigente,
creado por ese preparador. Un mismo borrador no puede originar dos solicitudes, ni bajo
otro código de política. Si fue devuelta/rechazada, se prepara una nueva revisión C3C-9.

## Responsabilidades y transiciones

Preparador, revisor y resolutor deben ser tres usuarios distintos, activos, asignados
explícitamente a la empresa y con Contabilidad:ver/editar global existente. No hay permisos
nuevos, concesiones automáticas ni excepción de escritura para Admin. Una matriz global
duplicada/ambigua se rechaza en C3C-11 hasta que el flujo existente de Usuarios la resuelva.
La designación no concede permisos ni autoridad contable formal; independencia organizativa
y responsables/aprobadores formales requieren decisión humana.

1. PREPARADA: puede conservar bloqueantes para evaluación/devolución, nunca para ejecutar.
2. REVISION_TECNICA_REGISTRADA: solo el revisor designado; sin bloqueantes técnicos, alcance
   nominal completo y procedencia explícita válida de todos los Registrados del ejercicio.
   NO_VERIFICADO/indicios/metadatos inválidos o regularizaciones previas no se ignoran.
3. PENDIENTE_AUTORIZACION_FORMAL: el resolutor deja constancia después de revisión técnica.
   Esto no aprueba contabilidad. También puede DEVOLVER o RECHAZAR con justificación.
4. DESACTUALIZADA: derivada sin escrituras por cambios de condiciones, rectificaciones
   C3C-10, nueva versión de política/borrador o revocación de cualquiera de los responsables.
   No permite revisión/resolución normal; un responsable aún autorizado puede INVALIDAR.
5. DEVUELTA, RECHAZADA e INVALIDADA son terminales. Invalidación persistida no se revierte
   aunque después se restituyan los datos originales. No se sobrescribe historia.

Las huellas representan condiciones observadas, no un historial universal de mutaciones:
cambios revertidos exactamente antes de observarlos pueden producir la misma huella C3C-9.
El historial C3C-10 y las versiones de política/borrador sí conservan sus transiciones.
La revisión documental C3C-10 y la revisión técnica C3C-11 no certifican documentos externos.

## Seguridad, API y transacciones

GET/POST `/api/empresas/[slug]/contabilidad/ejercicios/[id]/politicas-autorizacion?entidad=ID`.
POST usa unión JSON estricta `operacion=POLITICA|SOLICITUD|DECISION`, UUID de idempotencia,
confirmación técnica explícita, versiones/huellas y justificación. No admite campos para
aprobar o contabilizar. El tenant/actor se derivan de sesión; entidad/ejercicio se validan.
Cache privado/no-store. 400 entrada; 403 permisos/separación; 404 ámbito; 409 concurrencia,
duplicado u obsolescencia; 422 bloqueantes; 503 migración pendiente; 500 error interno seguro.

Consulta en READ ONLY / REPEATABLE READ reutiliza `prepararTx` C3C-9 en la misma instantánea.
C3C-5 a C3C-10 conservan contratos y huellas; solo se exporta ese helper transaccional.
Escrituras reutilizan bloqueos de ámbito/fuentes C3C-9/C3C-10, bloquean tablas C3C-11 y
filas de usuario/asignación/permisos de los responsables antes de la primera lectura consistente.
Se serializa deliberadamente el libro; historial grande puede aumentar contención.
Ninguna revocación concurrente puede pasar entre validación y commit de una acción nueva.

Idempotencia por tabla, empresa/libro/UUID y huella canónica de operación/actor/ámbito/cuerpo.
Reintento idéntico del actor todavía autorizado devuelve el registro previo sin segunda
auditoría, incluso si ahora sus condiciones están obsoletas; no constituye nueva acción.
Otra solicitud/actor con la misma clave devuelve 409. La consulta posterior muestra vigencia.
Auditoría `regularizacion_gestion_politica|solicitud|decision` comparte transacción;
fallo de auditoría revierte la operación completa. La interfaz conserva clave en reintentos.

## SQL manual, dependencias y rollback

Requiere C2B, C3C-1/C3C-2, C3C-7, C3C-9/C3C-10 y usuarios/permisos/auditoría existentes,
InnoDB y MariaDB 11.8.9. Después del merge y de autorización separada, aplicación MANUAL:

1. Postchecks C3C-9 y C3C-10; `sql/preflight-2026-10-politicas-autorizacion-c3c11.sql`.
2. `sql/migrate-2026-10-politicas-autorizacion-c3c11.sql` (privilegios CREATE/TRIGGER).
3. `sql/postcheck-2026-10-politicas-autorizacion-c3c11.sql` (todos los errores = 0).

Solo tres tablas y seis triggers nuevos; sin backfill, cambios de tablas anteriores,
permisos, sql/schema.sql o datos históricos. Ensayada únicamente en bases temporales nuevas.
Reejecutar conserva datos. IF NOT EXISTS no repara objetos incompatibles; DDL no es atómico:
ante fallo parcial o control distinto de cero, detenerse e investigar.

Rollback preferido: volver a C3C-10 conservando tablas, historial y auditoría C3C-11.
No se convierten solicitudes en autorizaciones ni se eliminan decisiones. Si tienen datos,
no hacer DROP sin política de retención/archivo y autorización separada. Para tablas nunca
utilizadas: comprobar vacío de las tres, consumidores/FK y respaldo autorizado de estructura
en mantenimiento antes de autorizar retirada. No hay rollback destructivo automático.

## Evidencia y pendientes

Runner privado: `node scripts/ci/c3c11/run-windows.mjs --run-isolated --engine=mariadb`.
Compatibilidad C3C-10: mismo runner con `--run-compat-isolated --engine=mariadb`.
TCP deshabilitado, pipe aleatorio, binario/distribución verificados y cierre del proceso propio.
Pruebas focalizadas de contratos/HTTP/render, roles, aislamiento, versiones, historial,
procedencia, cambios de fuentes, concurrencia, revocación concurrente, permisos ambiguos,
idempotencia, rollback y reejecución SQL, sin generación de asientos.

Pendientes: política correcta para la empresa, reglas y responsables formales de autorización,
independencia organizativa, idoneidad contable, suficiencia/autenticidad documental y efectos
fiscales. Nunca se activa aprobación efectiva en esta entrega. Equivalencia con Milenium 2000
no verificada. Validación visual C3C-11 no ejecutada. Laboratorio C3C-8 sin intervención.
