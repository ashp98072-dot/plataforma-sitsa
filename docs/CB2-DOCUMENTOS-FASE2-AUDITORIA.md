# CB2 fase 2: edición documental controlada

Estado: implementación en rama, SQL propuesto **no ejecutado**, sin autorización
de migración productiva. Base `main` en `425e91bb`, posterior a #520.

## Auditoría y alcance

`flota_cb2_facturas` ya dispone de fecha/total opcionales, moneda y UNIQUE de
empresa/proveedor/id, pero no de revisión ni recibos de edición. `repository.ts`
ofrece transacción con bloqueo de proveedor, revalidación, READ COMMITTED y
tratamiento de commit incierto; se reutiliza sin modificarlo. La idempotencia
de importaciones no se reutiliza, porque sus eventos requieren una importación.
`registrarAuditoriaTx` propaga errores y permite escribir el historial en la
misma transacción; la variante que silencia errores no se utiliza.

Solo se pueden modificar fecha y total de una factura existente. No hay SQL de
actualización de consumos, asociaciones, importaciones, evidencias o recibos de
importación. Serie, número, proveedor, moneda e identidad permanecen inmutables.
El balance de #520 se recalcula desde datos vigentes y la UI vuelve a consultarlo
tras guardar. No se persiste un segundo saldo ni se altera el resumen mensual.

## Reglas y permisos

- Fecha ISO calendario válida; total textual no negativo, máximo 12 enteros y
  6 decimales, validado/normalizado con Decimal. No acepta números JSON, notación
  científica ni exceso de precisión. Cero es válido. Moneda tomada de la fila:
  GTQ/USD sin conversiones; otras monedas se rechazan sin modificación.
- Omitir campo lo conserva; null/borrado no se admite. No exige completar ambos
  campos simultáneamente. Equivalencia Decimal no produce un cambio artificial.
- La fila bloqueada determina COMPLETAR (solo nulos), CORREGIR (cualquier valor
  declarado distinto, incluso en una solicitud mixta) o SIN_CAMBIO.
- Toda solicitud exige motivo de 10 a 1,000 caracteres y confirmación de valores
  en la UI. El servidor nunca acepta una clasificación del cliente.
- Nuevas acciones `completar_documentos` y `corregir_documentos`, sin fallback
  legacy ni concesión por roles operativos. Completar exige Ver + completar;
  corregir exige además corregir. Se conserva la política administrativa
  existente: **Admin tiene bypass**, igual que otras capacidades de combustible.
  Esto debe quedar reconocido al aprobar la activación; no se cambió el modelo
  global de permisos ni se otorgaron permisos a usuarios existentes.
- GET/PATCH usan el tenant del servidor, proveedor y factura compuestos. PATCH
  valida origen confiable y JSON acotado (16 KiB). Tras esperar bloqueo se
  revalidan identidad/empresa/permisos; corregir se revalida también al conocer
  los valores y al recuperar un recibo de corrección.

### Alcance explícito del bypass Admin (política existente, sin cambios)

Se refiere al **rol global de la aplicación cuyo valor es exactamente `Admin`**
en una sesión válida. No significa administrador de Hostinger/MariaDB, un usuario
llamado admin, un responsable operativo ni una etiqueta administrativa de empresa.
Todos los usuarios con ese rol global que superen `requireTenant` pueden completar
y corregir documentos cuando la fase esté habilitada. No hay una lista especial
de administradores CB2. `requireTenant` sigue exigiendo empresa activa y acceso
según `empresasParaUsuario`; el bypass de combustible ocurre después de ese guard.

En `requireTenantFlotaCombustible`, Admin retorna antes de comprobar módulo TMS
y matriz granular. También `capacidadesCombustible(..., true)` concede las dos
capacidades. Por tanto **no marcar los nuevos permisos o guardar una denegación
granular no restringe a un Admin global**. Para no Admin sí hacen falta Ver y
concesiones explícitas (corregir requiere además completar); no existe herencia
desde Editar/Conciliar. No se cambió ningún guard, rol o concesión global en esta
revisión. Restringir un subconjunto de administradores requeriría otra política
expresamente autorizada; la matriz actual no ofrece esa separación para Admin.

El bypass no omite el flag apagado, esquema requerido, origen confiable,
proveedor activo, ámbito empresa/proveedor/factura, clasificación en fila
bloqueada, revisión, clave/huella/actor, motivo, auditoría o transacción. Un replay
continúa ligado al actor original: ser Admin no permite recuperar la operación
de otra identidad. El guard revalida la sesión y capacidades tras esperar el
bloqueo. Este alcance debe aceptarse conscientemente antes de activar la fase.

Referencias de código: `src/lib/tenant.ts::requireTenant` y
`requireTenantFlotaCombustible`, `src/lib/flota/combustible-permisos.ts`,
`src/lib/flota/cb2/documentos-http.ts` y `documentos.ts`.

## Revisión, idempotencia y atomicidad

`revision_documental` comienza en 0, aumenta en uno solo con un cambio real y
no retrocede. Revisión esperada obsoleta: 409 incluso ante A→B→A. Se combina
bloqueo de factura y condición de revisión en UPDATE (exactamente una fila).

Clave aleatoria de 16–64 caracteres ASCII; UNIQUE por empresa/proveedor/clave.
La huella SHA-256 versionada incluye empresa, proveedor, factura, actor ID,
revisión, campos presentes normalizados y motivo recortado, en orden fijo. No
incluye una clasificación controlada por cliente ni el username mutable.
Misma clave y diferente actor, factura o contenido: 409. Misma solicitud y actor:
recupera la respuesta original, aunque después haya otra revisión. Antes se
revalidan los permisos actuales; un permiso revocado no autoriza el replay.

Orden: proveedor → recibo por clave → factura → clasificación/autorización →
actualización condicional → nuevo recibo → `registrarAuditoriaTx` → commit.
Un recibo válido se recupera antes de comprobar la revisión actual; así un
reintento no se confunde con una pantalla obsoleta. SIN_CAMBIO también tiene
recibo y auditoría, pero no UPDATE ni aumento de revisión.

Auditoría JSON: operación, empresa/proveedor/factura, ID y nombre de usuario,
fecha del servidor, moneda, tipo, revisión anterior/nueva, valores antes/después,
motivo, clave y huella. Un fallo al guardar el recibo o auditar revierte también
el documento. No se duplica el historial completo en la tabla operativa: esta
conserva el resultado original necesario para reintentos.

Ante resultado transaccional incierto se conserva clave/cuerpo. El editor los
mantiene en memoria y sessionStorage por actor/API/proveedor, sin tokens. Los
errores de validación/autorización/conflicto definitivos permiten volver a editar;
errores de red, 5xx o respuesta no certificable solo permiten el mismo reintento.
Cerrar la sesión/pestaña puede eliminar sessionStorage: el servidor conserva el
recibo, pero no se promete recuperar automáticamente una clave perdida.

## SQL pendiente de auditoría: ejecución por pasos

El archivo `sql/migrate-2026-10-cb2-documentos-fase2.sql` es ahora un
**manifiesto de comentarios**, no un lote ejecutable. No importar ese archivo ni
concatenar los siguientes. Para cada envío, confirmar nuevamente la misma base
objetivo y sesión/modos. El orden manual obligatorio es:

1. `sql/preflight-2026-10-cb2-documentos-fase2.sql` (solo lectura).
   **PARAR** y revisar todos los resultados, backup, triggers, motor, modos,
   tipos, índices y ausencia de objetos/colisiones antes de aprobar paso 1.
2. `sql/migrate-2026-10-cb2-documentos-fase2-paso1-revision.sql`:
   una única sentencia ALTER TABLE con revisión y CHECK.
3. **PARAR**, incluso ante error, timeout o desconexión. Abrir por separado
   `sql/verificar-2026-10-cb2-documentos-fase2-paso1.sql` (solo lectura).
   Confirmar columna INT signed NOT NULL DEFAULT 0, CHECK correcto, revisiones
   iniciales, tabla operativa ausente, contexto/motor/modos y claves base.
   Exige revisión humana y aprobación independiente antes del segundo DDL.
4. `sql/migrate-2026-10-cb2-documentos-fase2-paso2-operaciones.sql`:
   una única sentencia CREATE TABLE, con los mismos índices, UNIQUE binario,
   FK compuesta y restricciones de integridad del diseño aprobado.
5. **PARAR**. `sql/postcheck-2026-10-cb2-documentos-fase2.sql` (solo lectura)
   para auditar la estructura final completa antes de cualquier activación.

Las consultas de comprobación muestran evidencia; **no bloquean automáticamente
un DDL posterior**. El control es operativo: enviar un archivo DDL por vez solo
tras aprobación del resultado anterior. La presencia de un objeto no certifica
su definición. No se usa IF NOT EXISTS, OR REPLACE ni una importación masiva para
ocultar un estado divergente. No reutilizar la migración CB2 original.

### Compatibilidad revisada: MariaDB 11.8 y Hostinger

- **DELIMITER** es una instrucción de cliente, no una garantía del servidor.
  El lote anterior dependía de que la herramienta reconociera el delimitador y
  enviara el bloque compuesto completo. Los pasos nuevos usan solo el terminador
  SQL estándar; no contienen DELIMITER ni bloques BEGIN NOT ATOMIC.
- **BEGIN NOT ATOMIC** es sintaxis de MariaDB para bloques fuera de rutinas;
  no convierte ALTER + CREATE en una transacción reversible. Suprimir el bloque
  evita depender de su procesamiento por el frontend de la herramienta SQL.
- **ALTER TABLE y CREATE TABLE** causan commits implícitos. No existe rollback
  conjunto entre los dos pasos. No se promete ausencia de bloqueo/reconstrucción
  de tabla; capacidad y ventana deben revisarse antes del paso 1.
- **CHECK** se mantiene en el DDL para MariaDB 11.8; requiere
  check_constraint_checks=1, FK activas y modo estricto. Los tipos de FK y motor
  InnoDB se revisan antes de CREATE. Los nombres FK deben ser únicos en el
  esquema en 11.8 (la relajación documentada es de 12.1): verificar colisiones.
- **JSON_VALUE** usa rutas constantes y extrae escalares. Retorna NULL si no hay
  coincidencia o el JSON es inválido; por ello se conservan JSON_VALID y los
  COALESCE(...,0) que rechazan respuestas incompletas/incoherentes. No se usa el
  tipo JSON nativo de MySQL ni se depende de él: resultado sigue siendo LONGTEXT.
- Hostinger documenta phpMyAdmin como herramienta de importación SQL. No se
  inspeccionó una instalación de Hostinger ni se probó su parser. Estos archivos
  reducen esa dependencia a sentencias SQL ordinarias, una por envío DDL; **la
  revisión documental no certifica ejecución exitosa en el hosting concreto**.
  Seleccionar explícitamente la base en la herramienta y no subir todos los
  pasos en un mismo lote. Cambiar de pestaña/conexión puede cambiar el contexto.

Fuentes primarias consultadas en esta revisión:

- [MariaDB: bloques fuera de rutinas](https://mariadb.com/kb/en/using-compound-statements-outside-of-stored-programs/).
- [MariaDB: commits implícitos](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit).
- [MariaDB: constraints](https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint).
- [MariaDB: JSON_VALUE](https://mariadb.com/docs/server/reference/sql-functions/special-functions/json-functions/json_value).
- [Hostinger: importación SQL con phpMyAdmin](https://www.hostinger.com/support/1884149-how-to-import-a-database-with-phpmyadmin-in-hostinger/).

## Activación compatible, sin ejecutarla en esta tarea

1. Mantener `CB2_DOCUMENTOS_FASE2=0` (o ausente) en todos los nodos. En ese estado
   el editor GET devuelve habilitado=false sin leer columnas nuevas; PATCH falla
   cerrado. Las consultas y asociaciones anteriores conservan sus contratos.
2. Auditar/aprobar por separado SQL y ventana operativa. Revisar preflight sobre
   la base explícitamente seleccionada, verificar backup recuperable y tipos
   compatibles. No interpretar la aprobación de este PR como autorización de DDL.
3. Solo con autorización productiva independiente: seguir los pasos DDL separados y
   sus puntos de parada; revisar postcheck. Estado previo limpio o final completo; detenerse si parcial.
4. Desplegar el código nuevo con flag apagado y comprobar que TODOS los nodos y
   rutas están actualizados. El código antiguo puede leer/crear facturas con el
   esquema aditivo (DEFAULT 0) y no actualiza metadatos existentes. No activar en
   una mezcla de nodos antiguos/nuevos: uno antiguo no conoce el endpoint PATCH.
5. Asignar explícitamente capacidades a usuarios no Admin y activar el flag solo
   tras aprobación. El editor comprueba revisión de nuevo y refresca el balance.
   Esquema ausente/incompleto devuelve 503; no hay DDL ni fallback sin garantías.

## Recuperación (procedimiento; NO ejecutado)

- Ante fallo funcional: apagar el flag en todos los nodos, dejar terminar las
  solicitudes en curso y revisar auditoría/recibos antes de volver a intentar.
  No cambiar claves de operaciones con respuesta incierta.
- Se puede volver al código anterior **conservando columnas, tabla y datos**.
  No borrar recibos/auditoría ni resetear revisiones. Los cambios documentales
  confirmados permanecen; esto no es una reversión de negocio.
- Ante DDL parcial (por ejemplo ALTER exitoso y CREATE fallido): mantener flag
  apagado, preservar diagnóstico/backup y detener activación. No reejecutar el
  archivo original ni utilizar DROP para hacer coincidir un estado inicial.
  Preparar una reparación específica del objeto faltante/divergente, auditarla
  y obtener autorización separada; contrastar después el postcheck completo.
- Después de ALTER, el estado intermedio esperado es revisión y CHECK presentes,
  tabla operativa ausente. Es válido únicamente mientras el flag siga apagado.
  Si falla CREATE, no deshacer ALTER ni repetir el paso 1: comprobar el estado
  intermedio y causa. Si la tabla resulta presente tras un timeout, no repetir
  CREATE: auditar el postcheck completo. Si no se puede determinar el estado,
  detenerse y escalar; no asumir rollback a partir de un error de phpMyAdmin.
- Ante necesidad de restaurar fecha/total: usar una nueva corrección autorizada
  con motivo y revisión vigente, nunca modificar recibos ni deshacer asociaciones.
- Si se pierde la respuesta de commit, reintentar idéntica solicitud con el mismo
  actor y permisos. Si la clave se perdió, investigar auditoría/recibo antes de
  cualquier nueva orden; no certificar éxito o rollback por un timeout.

## Pruebas y límites

Conexiones simuladas, sin motores ni bases de prueba. Pruebas del servicio usan
el wrapper transaccional real con driver falso y bloqueo por proveedor simulado:
fallos de lectura, bloqueo, UPDATE/CAS, recibo, auditoría y commit; reversión;
commit aplicado con respuesta perdida; carreras de dos editores/reintentos;
A→B→A; claves/actores incompatibles; revocación; aislamiento; Decimal y USD.
HTTP prueba guards, origen, permisos dobles, activación apagada/esquema pendiente
y rechazo de campos controlados por cliente. DOM verifica confirmación, campos
protegidos, reintento estable al remontar y actualización de balance. SQL se
inspecciona como texto, nunca se ejecuta.

Resultados de la revisión: **183 pruebas aprobadas en 17 archivos**, con Vitest 4.1.12 y las
dependencias ya disponibles de otro worktree. Incluye regresiones de #519/#520,
repositorio transaccional, catálogo y persistencia de permisos. TypeScript
(`tsc --noEmit --incremental false`), ESLint de todos los TS/TSX afectados y
`git diff --check` completados sin errores. No se instalaron dependencias.
Se añadió verificación estática de una sola sentencia por paso DDL y ausencia
de SQL ejecutable en el manifiesto, además de comprobar que el editor no muestra
JSON ni claves pendientes y sigue reintentando el cuerpo idéntico tras remontar.

Riesgos que requieren decisión antes de activar: autorización independiente del
DDL y backup; revisión real de sintaxis/planes y tipos MariaDB por auditoría
(esta tarea no ejecuta SQL); despliegue homogéneo; reconocimiento del bypass
Admin existente; política de permisos y retención de recibos/auditoría. El wrapper
actual impide escribir con proveedor inactivo: no se amplió esa política.
Escritores SQL externos que no incrementen revisión quedan fuera del contrato.
Las lecturas de balance y detalle siguen siendo independientes, no un cierre.

Sin merge, despliegue, SQL ejecutado, bases de prueba, cambios productivos,
cierres contables o reversión de asociaciones.
