# PR 2 — diseño definitivo propuesto: consumos importados y facturas

Estado: PROPUESTA PARA AUDITORÍA DE CHATGPT. Sin autorización de ejecución ni implementación.
Base inspeccionada: main 03f9de40 (PR #506 fusionado, incluida corrección de elegibilidad por identidad).
Fecha del diseño: 2026-10-21. No se ejecutó SQL, ni siquiera contra una BD de pruebas.
Este documento expresa decisiones y contratos futuros; no afirma que estén implementados o verificados en MariaDB.

## 1. Alcance y decisiones aprobadas

- Consumos independientes de flota_combustible_cargas, HALEL v1 y conciliación C2C.
- Un consumo operativo válido se guarda sin factura completa: factura_id NULL.
- estado_factura es una columna generada STORED: NULL -> PENDIENTE_FACTURA; ID -> FACTURADO.
  FACTURADO significa únicamente asociación documental; no emisión FEL, asiento, deuda, pago ni aprobación.
- Una factura admite múltiples consumos, incluso de varios archivos/importaciones.
- Confirmación parcial explícita: se guardan candidatos seguros y TODAS las apariciones originales,
  incluidas inválidas, ignoradas, duplicadas y bloqueadas. No se exige factura para considerar completo el registro de consumos.
- Conflictos operativos, contradicciones de documentos fiables y posibles duplicados históricos siguen bloqueados.
- No se modifican datos originales, tablas históricas, permisos actuales, contabilidad, CxP ni movimientos financieros.
- En esta tarea solo se preparan documento y SQL. No hay APIs, interfaz, servicios ni pruebas ejecutables nuevos.

## 2. Referencias existentes a reutilizar en una implementación posterior

- src/lib/flota/combustible-importacion-v2-types.ts: contrato v2 de preview.
- src/lib/flota/combustible-importacion-v2.ts: parsing y elegibilidad por identidad completa.
- src/lib/flota/combustible-ooxml-v2.ts: literal XML, ZIP acotado y defensa ante archivos hostiles.
- src/lib/flota/combustible-preview-v2-http.ts: límites multipart, guard de solo lectura y cobertura del historial.
- src/lib/flota/combustible-importaciones.ts: referencia v1 de recibo firmado, evidencia privada y compensación; NO cambiar su contrato.
- src/lib/flota/combustible-c2c.ts: referencia de READ COMMITTED, conexión dedicada y bloqueo de proveedor; NO reutilizar su modelo de vales.
- src/lib/tenant.ts, combustible-permisos.ts: identidad de empresa y permisos servidor.
- src/lib/auditoria.ts: registrarAuditoriaTx, misma conexión; no usar el helper que silencia fallos.
- src/lib/uploads.ts: guardarUploadExcel, validarRutaArchivoEmpresa, verificarDirectorioPadreReal y raíz persistente privada.
- sql/schema.sql, migraciones C1/C2B/C2C y src/lib/flota/schema.ts: fuentes de contratos físicos existentes.
- compras_proveedores identifica proveedores por empresa/ID, no por texto HALEL/SHELL.
  flota_vehiculo_acceso permite compartición. fact_facturas es venta; cxp_facturas contiene lógica fiscal/financiera:
  ninguna es el destino de las facturas operativas de este PR.

## 3. Cuatro tablas y relaciones

### flota_cb2_importaciones
Una cabecera por (empresa_id, proveedor_id, archivo_sha256), no una cabecera por intento.
Archivo/nombre/hash/ruta/MIME/tamaño, perfil/versiones iniciales, proveedor_nombre y creador son inmutables.
estado, revision, resumen_actual y actualizado_por/en son proyecciones revisables bajo bloqueo.
Estado COMPLETA: todos los candidatos operativos quedaron creados/reutilizados; pueden tener PENDIENTE_FACTURA.
PARCIAL: hay consumos y candidatos pendientes/bloqueados. SOLO_EVIDENCIA: todavía no hay consumos.
Una omisión no elimina el candidato pendiente ni se presenta como importación completa.
resumen_actual contiene la proyección de resolución operativa y sus cantidades, no contadores documentales:
el estado de factura se consulta desde los consumos vigentes para no dejar resúmenes obsoletos en otros archivos
que reutilicen el mismo consumo.
Cada mutación incrementa revision por importación; la primera confirmación usa revision 1.
Las claves de idempotencia se conservan en flota_cb2_filas como diario de operaciones.

### flota_cb2_facturas
Documento operativo por empresa/proveedor/serie_norm/numero_norm, con UNIQUE de identidad documental.
Serie/número originales y normalizados siempre VARCHAR, sin Number ni truncamiento.
Moneda explícita y fecha/total documental opcionales. No inferir fecha_factura de fecha_consumo.
No inferir total_documental de las líneas disponibles: la factura puede tener otros consumos fuera del archivo.
Solo crear/reutilizar cuando serie y número completos son verificables. No crear documentos con textos
inseguros, identificadores numéricos fuera del rango fiable, campos ausentes o números inventados.
El SQL garantiza strings normalizados no vacíos; la seguridad/verificabilidad y normalización pertenecen al servidor.
No se crean adjuntos ni tablas de adjuntos en esta fase.

### flota_cb2_consumos
Empresa/proveedor/vehículo y primera importación de origen obligatorios. factura_id nullable.
Estado generado evita combinaciones inconsistentes y no se recibe del cliente.
Al asociar factura también son obligatorios factura_asociada_por/en; con NULL los dos permanecen NULL.
FK factura compuesta por (empresa_id, proveedor_id, factura_id): impide cruces de proveedor o tenant.
FK vehículo SIMPLE por ID: una unidad compartida puede pertenecer a otra empresa.
Campos de operación, payload_operacion, huellas, creador e importación inicial son inmutables.
Solo factura_id y metadatos de su asociación son mutables en este alcance, dentro del servicio documental.
La placa original/normalizada queda como snapshot; no se actualiza el maestro de vehículos ni su kilometraje.

### flota_cb2_filas
Diario append-only de evidencia y eventos. Tipos:
- ORIGEN: una fila por posición real del libro, revision 1, datos_origen completos y no editables.
- RESOLUCION: evento posterior enlazado a la fila ORIGEN de la MISMA empresa/proveedor/importación.
  decision contiene clasificación nueva, elecciones, justificación y referencia documental si existe.
- ASOCIACION_FACTURA: evento posterior enlazado al ORIGEN que explica la asociación o su NOOP.
  Incluye factura_anterior_id/nueva_id, consumo, usuario y fecha.
Los eventos no vuelven a copiar/modificar datos_origen: ese campo es NULL.
marca_origen vale 1 exclusivamente en ORIGEN y NULL en eventos, exigido por CHECK.
UNIQUE (empresa_id, proveedor_id, importacion_id, marca_origen, hoja_indice, fila_excel)
impide dos originales de la misma posición; los NULL de eventos no restringen sus repeticiones legítimas.
El índice de revisión/hoja/fila es NO ÚNICO e incluye id para orden estable. Puede haber varios eventos
de una misma posición en una revisión: por ejemplo RESOLUCION y ASOCIACION_FACTURA dentro de REANUDAR.
Cada evento conserva un operacion_ordinal distinto. No se usa INSERT IGNORE, REPLACE ni UPSERT del diario:
no se descartan ni sobrescriben eventos para superar una colisión de índices.
No hay FK desde consumo a fila canónica: evita dependencia circular. El consumo apunta a su importación inicial;
las filas aportan procedencias adicionales, incluso de otras importaciones.
Múltiples apariciones del mismo candidato pueden apuntar al mismo consumo.
FK autorreferenciada de origen conserva el ámbito; aplicación y postcheck exigen además tipo ORIGEN y posición coincidente.
Todas las FKs nuevas son RESTRICT. No hay borrado en cascada, triggers nuevos ni modificaciones de tablas históricas.
LONGTEXT utf8mb4_bin + CHECK JSON_VALID se usa explícitamente para JSON lógico y metadata reproducible en MariaDB.

## 4. Identidad, equivalencia y huellas

Identidad candidata provisional: (empresa_id, proveedor_id, vale_norm).
version_clave=1; clave_candidata usa el mismo SHA-256 de JSON([vale_norm]) que la evidencia C2B.
Se guarda la versión y el texto normalizado. NO hay UNIQUE al vale ni a clave_candidata.
No se elimina el prefijo de placa ni ceros/guiones de identificadores. El perfil no crea otro namespace de proveedor.

Huella persistente de operación v1, diferente de la huella de preview:
SHA-256 de tupla canónica versionada de vale_norm, fecha_consumo, placa_normalizada, piloto informado normalizado,
producto normalizado, galones, precio, monto, kilometraje numérico/textual y moneda.
Decimales canónicos en strings sin float; NULL distinto de cero/vacío; strings NFC con reglas explícitas.
Excluir archivo, hoja/fila, lote, perfil, vehículo elegido y documento de factura. Esos son procedencia,
resolución o relación documental y no deben crear otro consumo cuando cambien.
payload_operacion conserva exactamente la estructura firmada/canónica usada para comparar.
El UNIQUE (empresa_id, proveedor_id, huella_operacion) impide reinsertar una operación exacta.
En colisión se compara también payload, no se asume equivalencia únicamente por hash.

El preview v2 conserva su huella y semántica actuales. PR 2 deriva la huella persistente sin reutilizarla ciegamente.
La validación debe separar operación de documento:
- Falta de serie/número no invalida un consumo operativo seguro.
- Documento inseguro: no crear factura; evidencia intacta y PENDIENTE_FACTURA si la validación operativa es segura.
- No convertir automáticamente una fila INVALIDA de PR 1 en válida por omitir factura: la derivación debe
  tener códigos estructurados versionados y verificar que la única incidencia sea documental.
  Campos operativos inválidos y datos documentales fiables contradictorios continúan bloqueados.
- Todas las apariciones del candidato se evalúan en conjunto, independientemente del orden.
  Una incidencia operativa invalidante/conflicto/posible previo bloquea TODO el candidato.
- No hay un flag cliente para forzar el desbloqueo ni para elegir una aparición ignorando otra contradictoria.

Buscar siempre por clave candidata y comparar todos los consumos previos, incluso con versiones anteriores.
Misma operación y mismas resoluciones -> reutilizar; diferente vehículo elegido -> conflicto de resolución.
Factura ausente frente a una completa compatible permite asociación documental aparte; dos identidades
documentales fiables diferentes para un mismo consumo son conflicto, no un consumo adicional.
Un vale previo con otro payload se bloquea: no se presume reutilización legítima.
Habilitar reutilización real de vale requiere decisión posterior y evidencia; no hay override en este diseño.
Cambiar versión de normalización/huella no puede eludir las comparaciones: versiones desconocidas bloquean confirmación.

## 5. Idempotencia y concurrencia

operacion_clave aleatoria por acción de usuario, 16..64 caracteres permitidos; se reutiliza en los reintentos.
solicitud_sha256 incluye empresa/proveedor/usuario, tipo de operación, importaciones/revisiones esperadas,
hash del archivo, versiones, selección canónica y decisiones. Ordenar listas por IDs estables antes de firmar.
Todas las filas de una operación comparten clave, digest, actor y tipo; operacion_ordinal va de 1 a N sin huecos.
operacion_total conserva N en todas sus filas; el CHECK exige 1 <= ordinal <= total <= 10000.
Namespace idempotente: (empresa_id, proveedor_id, operacion_tipo, operacion_clave).
UNIQUE (empresa_id, proveedor_id, operacion_tipo, operacion_clave, operacion_ordinal) respalda el diario.
La misma clave aleatoria en CONFIRMAR/REANUDAR/ASOCIAR_FACTURA identifica operaciones diferentes:
la búsqueda de recuperación SIEMPRE incluye tipo. El digest también lo incluye. No se confunde una con otra.
Dentro del mismo namespace, cambiar actor/digest/total es conflicto 409, nunca nueva ejecución.
Antes de recuperar se comprueba COUNT=N, MIN/MAX(total)=N, ordinales completos y digest/actor únicos.
Si falta un evento, se bloquea y reporta inconsistencia; no se devuelve éxito ni se completa por adivinación.
operacion_total se calcula desde el plan entero antes del primer INSERT, no desde las filas recuperadas.
Repetir un ordinal con otro evento es error, no una actualización; todos los eventos del plan son parte del digest.
Cada importación/revisión pertenece a un único namespace de operación, que puede tener varios eventos por fila
y abarcar varias importaciones. El postcheck verifica esta correspondencia y la integridad de los N eventos.
Si el plan supera 10000 eventos, dividir en operaciones explícitas; no truncar ni fingir atomicidad global.
No se permite una operación sin eventos; un primer NOOP documental registra SIN_CAMBIO.
La atomicidad de la transacción garantiza que un reintento no encuentre un prefijo confirmado de sus eventos.

Orden estable: proveedor -> importaciones por ID -> facturas por ID -> vehículos/accesos por ID -> consumos por ID.
READ COMMITTED en una única conexión. Proveedor FOR UPDATE serializa TODAS las escrituras CB2 del mismo ámbito.
Revalidar permisos/empresa/proveedor en servidor; reconsultar después de adquirir bloqueos.
Revisar clave idempotente antes de revision esperada: mismo digest devuelve el resultado anterior sin nuevos eventos
ni auditoría duplicada; distinto digest devuelve 409. Para una acción nueva, revision obsoleta devuelve 409.
La búsqueda de la clave anterior significa el namespace completo, incluyendo operacion_tipo.
La respuesta de un reintento se reconstruye del diario de esa operación, no del resumen actual de la cabecera.
Unicidades de archivo/documento/huella y diario respaldan carreras. Deadlock/timeout -> rollback y reintento acotado
con la MISMA clave, nunca éxito supuesto. Un error de otro índice no se presenta como repetición idempotente.

Garantía: todos los escritores deben usar este protocolo. El esquema de cuatro tablas no impone por sí solo
un digest/actor único a todas las filas con igual operacion_clave, ni la inmutabilidad append-only.
Eso se valida bajo bloqueo y en postcheck; no se ofrecen endpoints genéricos de UPDATE.
La cuenta de aplicación no debe dar acceso SQL arbitrario a usuarios.

## 6. Primera confirmación y reanudación de un archivo parcial

Primera confirmación:
1. Preview solo lectura; límites y reglas PR 1. Consultar tanto consumos CB2 como evidencia histórica C2B.
2. Recibo específico de confirmación liga identidad de sesión, tenant/proveedor, archivo, versiones y decisiones.
   No aceptar JSON de filas del cliente como fuente autoritativa.
3. Preparar archivo privado verificado fuera de la transacción larga, únicamente si no existe cabecera del hash.
4. En transacción, proveedor bloqueado; comprobar idempotencia y archivo. Un archivo existente devuelve su ID:
   no se crea otra cabecera ni se trata como confirmación nueva; requerir reanudación explícita para nuevos efectos.
5. Insertar cabecera revision 1, crear/reutilizar consumos seguros, guardar todas las filas ORIGEN,
   guardar resumen/estado y registrarAuditoriaTx. Si factura está incompleta/insegura, guardar consumo pendiente.
6. Confirmar de forma atómica cabecera, consumos, facturas completas si corresponde, filas y auditoría.

Reanudación:
- Misma cabecera y MISMO archivo/hash; el Excel privado es la fuente, nunca una copia editada por el cliente.
- Petición nueva con clave idempotente nueva, revision esperada y filas/candidatos pendientes seleccionados.
- Revalidar evidencia con versiones soportadas, historial vigente, acceso a vehículos y permisos. Reconstruir
  todo el grupo candidato del libro, no solo la fila seleccionada.
- Crear consumo solo si el candidato es ahora seguro. Si ya existe equivalente, reutilizarlo.
- Añadir RESOLUCION para TODAS las apariciones afectadas, apuntando a sus ORIGEN respectivos, con decisión,
  motivo, actor y nueva revision. No actualizar resultado/valores/celdas de ORIGEN.
- Si sigue bloqueado, conservarlo y registrar el resultado de la resolución solicitada sin creación.
- Recalcular la proyección de cabecera a partir del estado vigente de los eventos, no sumar los eventos como consumos.
- Una fila ya resuelta no puede crear un segundo consumo por repetición, otro ordinal o nueva clave de petición.
- Un binario corregido es otra importación, relacionado por procedencias si el consumo es equivalente; el hash nuevo
  no autoriza ignorar conflictos con el anterior.
- Evidencia histórica C2B sin consumo CB2 sigue como posible previo. Un permiso de resolución no autoriza
  promoverla automáticamente ni cambiar C2C. Debe existir una clasificación documentada y autorizada que pruebe
  equivalencia/no duplicación; si no se puede demostrar, permanece bloqueada.
- Autorización: conciliar para confirmar candidatos seguros; para RESOLUCION material debe existir capacidad
  explícita de resolver_importaciones (nombre propuesto, sin grants implícitos) o autorización Admin.
  Se definirá mediante catálogo central en implementación posterior; no se modifica permisos en esta tarea.
  Ni Admin puede saltar empresa/proveedor, inventar dígitos o forzar otra versión contradictoria de un consumo.
- Resolver campos operativos contradictorios requiere evidencia corregida/decisión funcional posterior, no un
  botón de forzar. Resolver vehículo, aceptar documento ausente y reconocer equivalencia son acciones distintas.

## 7. Asociación posterior de factura

Servicio futuro dedicado, separado de captura/aprobación de vales y sin llamadas a CxP.
Requiere conciliar y acceso vigente al tenant. No confiar en IDs de factura/consumos sin validar empresa/proveedor.
Para un lote, todos los consumos son del MISMO proveedor/empresa; pueden proceder de distintas importaciones.
Solicitar una factura existente o una identidad completa verificable. Serie/número incompletos o inseguros:
rechazar creación/asociación de factura y conservar consumo PENDIENTE_FACTURA.

Transacción con el orden de bloqueos anterior:
- Verificar idempotencia, revisiones esperadas y datos documentales; crear/reutilizar factura sin sobrescribir
  fecha/moneda/total previos incompatibles. Moneda debe coincidir con los consumos.
- Bloquear cada consumo; si factura_id NULL, asignar ID y usuario/fecha de asociación.
- Si ya tiene la misma factura: SIN_CAMBIO auditable; si tiene otra: 409, rollback del lote completo.
- Añadir ASOCIACION_FACTURA por consumo con referencia a un ORIGEN de su importación inicial, factura
  anterior/nueva y motivo. Incrementar revision de cada cabecera afectada; una operación puede abarcar varias.
- registrarAuditoriaTx en la misma conexión. Un fallo de auditoría impide commit.
- No editar payload_operacion, huella, importes, fecha, placa, piloto ni datos_origen.
- No existe desasociación, reasignación o anulación de factura en PR 2; requeriría otro diseño.
La columna generada cambia a FACTURADO automáticamente. Sus IDs no se comparten con cxp_facturas/fact_facturas.

## 8. Vehículos y almacenamiento privado

Resolver placa únicamente contra vehículos accesibles al tenant: propietario o flota_vehiculo_acceso.
No elegir silenciosamente entre placas ambiguas. ObtenerVehiculoAccesibleTx es referencia a reutilizar,
pero bloquear explícitamente también la fila de acceso compartido cuando corresponda; no suponer que un
EXISTS de una consulta externa protege por sí solo una revocación concurrente.
La FK por vehiculo_id conserva el vínculo físico. Para consulta histórica no exigir compartición ACTUAL:
filtrar primero el consumo por empresa/proveedor y luego mostrar el snapshot/vehículo referenciado.
No ampliar compartición, cambiar propiedad ni sincronizar kilometraje por importar.

Una sola evidencia Excel privada por cabecera/hash; guardar ruta relativa bajo empresas/<id>/flota/ y
validar ruta/directorio real. Descargar siempre por endpoint autorizado, private/no-store, nosniff y attachment.
No exponer rutas absolutas ni URL pública. Mantener límites de archivo/ZIP/multipart de PR 1.

Filesystem y BD no tienen commit conjunto. Compensar solo archivo nuevo ante rollback conocido.
Si COMMIT es incierto, conservar archivo y recuperar por operacion_clave/hash mediante conexión nueva.
En caída antes del registro pueden quedar huérfanos: se reconcilian con procedimiento posterior autorizado,
edad de seguridad y comprobación de referencias; nunca borrado automático en requests.
Si el archivo de una cabecera falta/no coincide en hash, bloquear reanudación; no aceptar silenciosamente otro Excel.
Restauración de evidencia solo por procedimiento autorizado que compruebe el mismo hash.

Adjuntos futuros: tabla hija de flota_cb2_facturas con FK empresa/proveedor/factura, ruta privada,
MIME verificado por contenido, tamaño/hash/usuario/fecha. PR 2 no crea esa tabla ni campos PDF provisionales.
La factura estable admite múltiples adjuntos en un PR posterior, sin alterar consumo/procedencia.

## 9. Contrato SQL definitivo y estados

Los tres scripts se reconstruyen íntegramente desde una sola definición del modelo y de las consultas,
sin parches acumulados sobre texto SQL. Los cuatro CREATE TABLE son la fuente del manifiesto NUEVO.
Cada entrada se presenta en su propia línea para facilitar revisión.

Archivos:
- sql/preflight-2026-10-combustibles-pr2-consumos-facturas.sql
- sql/migrate-2026-10-combustibles-pr2-consumos-facturas.sql
- sql/postcheck-2026-10-combustibles-pr2-consumos-facturas.sql

Los bloques delimitados por BEGIN/END CB2_METADATA_CANONICO son idénticos en los tres scripts.
Preflight y postcheck contienen uno; la migración contiene dos intencionalmente: antes y después del DDL.
No son versiones diferentes de la consulta. Cada bloque contiene ocho CTEs y nueve ramas de verificación.
Los manifiestos nuevos contienen exactamente 86 columnas, 34 índices (incluidas PK), 18 FKs y 26 CHECK.

Preflight consulta metadata y entorno: tipos, signedness, nulabilidad, precisión/longitud, charset/collation,
generación, defaults nuevos, índices/orden/prefijos/BTREE/índices ignorados, FKs/CHECK e InnoDB.
Incluye cobertura histórica C2B, rechaza colisiones de nombres FK, particiones relevantes, vistas en lugar
de tablas y triggers inesperados. No consulta datos personales ni certifica integridad histórica.

- CLEAN: base compatible y ninguna de las cuatro tablas CB2.
- FINAL de metadata: base compatible y las cuatro tablas con contrato físico completo/exacto.
- DIVERGENTE: base incompatible, esquema parcial, diferencias u objetos no previstos dentro de esas tablas.
- Un error de consulta o visibilidad insuficiente deja SIN CERTIFICAR; nunca equivale a CLEAN o FINAL.
  La cuenta futura debe tener visibilidad completa del esquema. No usar IF NOT EXISTS para certificarlo.

Migración: cuatro CREATE aditivos dentro del mismo bloque anónimo, precedidos por guard CLEAN.
Sin backfill, seeds, triggers, rutinas persistentes ni cambios de tablas históricas.
SELECT INTO asigna variables de sesión, no filas. Las variables se invalidan antes de cada lectura de metadata.
El marcador de finalización solo se establece tras el cuarto CREATE. El resultado
APLICADA_PENDIENTE_POSTCHECK exige ese marcador y metadata FINAL; no certifica los datos.
El cliente debe detenerse ante cualquier error. BEGIN NOT ATOMIC no evita los commits implícitos del DDL.

Postcheck: lee metadata y, únicamente con FINAL, prepara/ejecuta un SELECT constante de datos.
No se incorpora SQL del usuario. El literal completo se valida estáticamente después de decodificar sus escapes.
Sus 15 comprobaciones abarcan relaciones del ámbito, factura/metadata/moneda, huellas, evidencia original,
revisiones y grupos idempotentes completos. RESULTADO FINAL exige cero incidencias en todas.
Si metadata no es FINAL, RESULTADO es DIVERGENTE, acompañado de SIN CERTIFICAR; no se consultan datos
ni se fabrican conteos cero. Errores de preparación/ejecución dejan SIN CERTIFICAR.
La salida DIAGNOSTICO cuenta grupos candidatos con varios consumos: no identifica vales ni personas,
no se suma a las incidencias y no crea un UNIQUE al vale. Retirar compartición actual no invalida historia.
Los conteos no sustituyen el contraste del inventario histórico preservado por el operador.

Compatibilidad objetivo: MariaDB 11.8.x con FK/CHECK habilitados y modo estricto.
No se ha validado contra motor por prohibición de ejecutar SQL. El comparador PCRE preserva cadenas SQL
entre comillas y elimina espacios/backticks solo fuera de ellas; el patrón se representa en hexadecimal.
Una representación no contemplada puede producir DIVERGENTE. No relajar comparaciones para forzar FINAL
sin revisión y autorización de ChatGPT.

## 10. Pruebas que deberá incluir la implementación, sin ejecutarlas ahora

| Área | Casos mínimos |
|---|---|
| Tenant | IDs válidos de otra empresa/proveedor rechazados en lectura, confirmación, reanudación y asociación; mismo vale en otro tenant independiente. |
| Factura nullable | Sin documento -> PENDIENTE_FACTURA; documento completo -> FACTURADO; no insertar estado manual; asociación sin actor/fecha rechazada. |
| Documento | Serie/número como texto con ceros; literal inseguro preservado; ausencia no crea factura; conflicto documental no actualiza factura existente. |
| Grupos | Primera inválida/segunda válida y viceversa, previo en cualquier aparición, permutaciones, duplicados exactos una sola contribución. |
| Concurrencia real | Dos conexiones mismo archivo/clave/vale, archivos solapados, creación simultánea misma factura, asociación concurrente a documentos distintos. |
| Idempotencia | Mismo namespace/digest recupera N eventos completos sin nueva auditoría; otro digest/actor -> 409; tipo distinto usa otro namespace; otro intento no duplica consumo. |
| Parciales | Todos los ORIGEN intactos; reanudaciones sucesivas por fila/grupo; revision obsoleta; archivo corregido no evade conflicto; operación sin eventos rechazada. |
| Asociación múltiple | Una factura agrupa consumos de varias importaciones; FK bloquea otro proveedor/empresa; una discrepancia revierte todo el lote. |
| Rollback | Fallo en consumo/factura/filas/auditoría; nada queda parcialmente confirmado; resultado incierto se recupera sin borrar evidencia. |
| Flota | Propio/compartido/ambiguo, revocación concurrente del acceso, histórico visible después de retirar compartición, nunca modifica maestro. |
| Privados | Sin rutas públicas, traversal/symlinks, archivo faltante/hash cambiado; límite real ZIP/multipart y fórmulas no permitidas. |
| Rollout SQL | CLEAN, FINAL, parcial, unsigned incompatible, UNIQUE incorrecto, CHECK generado discrepante, triggers inesperados; cero cambios históricos. |
| Regresión | HALEL v1, C2B/C2C, vales/aprobaciones y módulos financieros sin cambios. |

## 11. Riesgos y decisiones aún pendientes

- Reutilización real de vales: continúa sin autorizarse. Contradicciones permanecen bloqueadas, sin UNIQUE al vale.
- Procedimiento/capacidad exacta para resolver evidencia histórica C2B sin promoverla automáticamente.
- Nombre final y asignación de resolver_importaciones; sin herencia implícita ni ampliación del permiso revisar.
- Proveedores/vehículos inactivos en importaciones históricas: propuesta conservadora exige acceso vigente;
  cualquier excepción histórica debe definirse antes de implementarla.
- Moneda debe confirmarse por configuración/decisión explícita; no inferir de un número sin unidad.
- Límites 128 de identificadores y 255 de piloto: rechazar excesos sin truncar; validar contra formatos admitidos.
- Los cuatro esquemas admiten el diario en filas para no introducir quinta tabla. La idempotencia por grupo,
  append-only y correspondencia del snapshot/huella requieren servicio único y pruebas reales; no son garantías
  obtenidas únicamente con una FK o UNIQUE.
- Se necesita validar consumo operativo frente a errores exclusivamente documentales sin debilitar los bloqueos
  del PR 1. No clasificar a partir de strings libres de motivos ni datos del cliente.
- Normalización y cambio futuro de versiones necesitan compatibilidad contra claves/huellas anteriores.
- Persistencia privada exige retención/recuperación/limpieza autorizada; no hay atomicidad distribuida.
- Esquema productivo y metadata exacta desconocidos. Estos archivos son propuestas, no ejecución ni aprobación.

No se han creado servicios, APIs, interfaz, permisos, datos de ejemplo reales, credenciales ni adjuntos.
No se han ejecutado migraciones ni consultas SQL. La publicación de estos archivos se limita a un PR Draft de auditoría.
La auditoría independiente y autorización del diseño corresponden a ChatGPT.

## 12. Revisión de consistencia y validación estática

### Modelo conservado

marca_origen es 1 solo en ORIGEN, con IS NOT NULL explícito en CHECK, y NULL en eventos.
El UNIQUE por posición impide originales repetidos; el índice por revisión/hoja/fila es NO ÚNICO.
RESOLUCION y ASOCIACION_FACTURA pueden coexistir sobre una fila/revisión de REANUDAR,
con ordinales distintos. Nunca se usa IGNORE, REPLACE o UPSERT para descartar eventos del diario.

El namespace idempotente incluye empresa, proveedor, operacion_tipo y operacion_clave.
operacion_total declara N antes de insertar: recuperar exige exactamente ordinales 1..N,
mismo total/digest/actor. Mezclas o prefijos incompletos bloquean la recuperación.
La clave admite solo caracteres ASCII alfanuméricos, guion y guion bajo; el digest exige 64 hex minúsculas.
Una revisión de importación pertenece a una operación; una operación puede abarcar varias importaciones.

factura_id sigue nullable y estado_factura sigue generado STORED. Actor/fecha de asociación
son ambos NULL sin factura y ambos obligatorios con factura.
Una asociación nueva exige factura anterior NULL; SIN_CAMBIO exige anterior igual a nueva.
No se permite reasignar/desasociar. FKs documentales y de origen incluyen empresa/proveedor,
y la de origen también importación. Vehículo mantiene FK simple para compartidos.
Acceso vigente, permisos, comparación de payload, inmutabilidad y protocolo transaccional siguen
siendo obligaciones del futuro servicio; el DDL por sí solo no los demuestra.

### Verificaciones ejecutadas sin motor

Se inspeccionaron los archivos completos y se reconstruyeron los tres scripts desde templates únicos.
Los manifiestos previos de la copia local ya coincidían con el DDL. El validador léxico/estructural no
reprodujo en esa copia una duplicación sintáctica de SELECT/COALESCE; esto no certifica sintaxis MariaDB.
Se eliminaron dependencias de sustituciones incrementales y se hicieron explícitas las repeticiones
intencionales de metadata. Se corrigieron dos discrepancias documentales: se describía un diagnóstico
que no se emitía y conteos NULL que no existían como salida. Ahora script y documento describen la misma salida.

Validación automatizada de texto, repetida después de guardar y releer los cuatro archivos:
- Manifiestos JSON decodificados de cada bloque: idénticos, sin nombres duplicados.
- Correspondencia exacta del manifiesto NUEVO con los cuatro CREATE: 86 columnas/34 índices/18 FKs/26 CHECK,
  incluyendo atributos, orden de columnas de índices/FKs, unicidad y expresiones generadas/CHECK.
- Un contrato en preflight/postcheck y dos idénticos en migración; ocho CTEs únicas por contrato.
- Literales, escapes, comentarios, paréntesis, bloques CASE/IF/BEGIN y delimitadores balanceados.
- Sin SELECT o cláusulas repetidos al mismo nivel sin UNION/delimitador; aridad de funciones sensibles.
- SELECT dinámico del postcheck decodificado y validado separadamente; 15 comprobaciones únicas.
- Ocho controles negativos sintéticos en memoria detectados: SELECT duplicado, COALESCE pegado,
  argumento vacío, paréntesis abierto, CTE repetida, manifiesto divergente, índice alterado y END ausente.
- Documento sin encabezados de sección repetidos ni referencias obsoletas al UNIQUE por revisión.

Son comprobaciones estáticas específicas, no un parser completo de MariaDB ni pruebas SQL, de concurrencia
o de comportamiento. No se crearon scripts auxiliares ni datos de prueba en el repositorio.

### Compatibilidad documental y límites

Fuentes oficiales revisadas durante el diseño:
- https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/generated-columns
- https://mariadb.com/docs/server/reference/sql-functions/special-functions/json-functions/json_table
- https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/foreign-keys
- https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint
- https://mariadb.com/docs/server/reference/sql-functions/string-functions/regular-expressions-functions/regexp_replace
- https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit

STORED/PERSISTENT y JSON_TABLE son compatibles documentalmente con el objetivo.
Ninguna FK usa columnas generadas; los INT referenciados deben tener signedness compatible.
Preflight exige strict mode, FK/CHECK habilitados, innodb_strict_mode, página >=8 KiB,
group_concat_max_len >=8192 y ausencia de NO_BACKSLASH_ESCAPES; no cambia variables para conseguirlo.
Comprueba número de columnas de índices/FKs para no aceptar prefijos truncados de GROUP_CONCAT.
Con MariaDB 11.8 los nombres FK deben estar libres en todo el esquema.

Falta probar, con autorización posterior, CREATE/STORED/índices, FK autorreferenciada, JSON_TABLE,
CHECK/GENERATION_EXPRESSION devueltos por el motor, PCRE y escapes, bloques anónimos/cliente DELIMITER,
CLEAN/FINAL/DIVERGENTE reales, errores parciales y concurrencia/rollback/idempotencia.
No se certifica compatibilidad ejecutable a partir del análisis estático.

### Procedimiento seguro ante DDL parcial, solo propuesto

1. Esperar autorización de ChatGPT y pruebas posteriores en instancia desechable expresamente autorizada.
2. Preparar respaldo/recuperación comprobables, inventario histórico y ventana sin escritores/DDL concurrentes;
   seleccionar esquema y comprobar visibilidad completa de metadata.
3. Exigir CLEAN y base compatible. FINAL no autoriza reejecución. DIVERGENTE obliga a detenerse.
4. Guard y cuatro CREATE pertenecen a un bloque sin handler de continuación; un error lo aborta,
   pero cada DDL puede haber quedado confirmado. El conjunto no tiene rollback automático.
5. Ante error/corte, bloquear despliegue y escrituras CB2; conservar mensajes e inventario del parcial.
   No repetir, completar a mano, eliminar objetos ni restaurar sobre posibles datos para obtener CLEAN.
6. Diagnóstico posterior autorizado; cualquier continuación requiere script específico con precondiciones
   exactas y revisión de ChatGPT. Nunca recuperación automática mediante IF NOT EXISTS.
7. Tras pérdida de conexión, no asumir resultado. Metadata FINAL aún exige postcheck de datos y contraste histórico.
8. No desplegar sin metadata FINAL, postcheck FINAL, preservación histórica comprobada y autorización final.

Solo se modifican estos cuatro archivos de propuesta. No se ejecuta SQL, ni siquiera contra una BD de pruebas,
ni se implementan APIs/interfaz o servicios. Su commit y publicación en PR Draft no autorizan merge, migración ni cambios de producción.
La migración sigue pendiente de auditoría independiente y autorización de ChatGPT.
