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

## SQL pendiente de auditoría

1. `sql/preflight-2026-10-cb2-documentos-fase2.sql`: exclusivamente SELECT;
   esquema/motor, modos, tipos, índices, CHECK, triggers y estado previo.
2. `sql/migrate-2026-10-cb2-documentos-fase2.sql`: nueva migración independiente;
   revisión y CHECK en facturas, tabla de operaciones InnoDB, UNIQUE binario,
   índices, FK compuesta empresa/proveedor/factura y FK de actor, integridad de
   clave/huella/tipo/revisiones/JSON y coherencia de la respuesta almacenada.
3. `sql/postcheck-2026-10-cb2-documentos-fase2.sql`: exclusivamente SELECT/SHOW;
   comprobar DDL completo, tipos, índices, FKs, CHECK y ausencia de huérfanos.

No reutilizar ni ejecutar la migración CB2 original. La inicialización de revisión
a cero no altera fecha, total o moneda históricos. El DDL rechaza objetos existentes
para impedir un reintento ciego ante instalación parcial; no es una certificación
automática del esquema. MariaDB hace commits implícitos en DDL: ALTER + CREATE no
forman una unidad atómica. Ver recuperación antes de cualquier ejecución autorizada.

## Activación compatible, sin ejecutarla en esta tarea

1. Mantener `CB2_DOCUMENTOS_FASE2=0` (o ausente) en todos los nodos. En ese estado
   el editor GET devuelve habilitado=false sin leer columnas nuevas; PATCH falla
   cerrado. Las consultas y asociaciones anteriores conservan sus contratos.
2. Auditar/aprobar por separado SQL y ventana operativa. Revisar preflight sobre
   la base explícitamente seleccionada, verificar backup recuperable y tipos
   compatibles. No interpretar la aprobación de este PR como autorización de DDL.
3. Solo con autorización productiva independiente: aplicar la nueva migración y
   revisar postcheck. Estado previo limpio o final completo; detenerse si parcial.
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

Resultados: **181 pruebas aprobadas en 17 archivos**, con Vitest 4.1.12 y las
dependencias ya disponibles de otro worktree. Incluye regresiones de #519/#520,
repositorio transaccional, catálogo y persistencia de permisos. TypeScript
(`tsc --noEmit --incremental false`), ESLint de todos los TS/TSX afectados y
`git diff --check` completados sin errores. No se instalaron dependencias.

Riesgos que requieren decisión antes de activar: autorización independiente del
DDL y backup; revisión real de sintaxis/planes y tipos MariaDB por auditoría
(esta tarea no ejecuta SQL); despliegue homogéneo; reconocimiento del bypass
Admin existente; política de permisos y retención de recibos/auditoría. El wrapper
actual impide escribir con proveedor inactivo: no se amplió esa política.
Escritores SQL externos que no incrementen revisión quedan fuera del contrato.
Las lecturas de balance y detalle siguen siendo independientes, no un cierre.

Sin merge, despliegue, SQL ejecutado, bases de prueba, cambios productivos,
cierres contables o reversión de asociaciones.
