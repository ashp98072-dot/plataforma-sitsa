# TMS — Combustibles: auditoría y diseño, fase 1

Fecha: 2026-11-10. Estado: propuesta para auditoría independiente; no autoriza implementación, saneamiento ni despliegue.

Repositorio: `ashp98072-dot/plataforma-sitsa`. Rama aislada: `audit/tms-combustibles-fase1`. Base examinada: `373bb48704f14904326037573081280ab2222fcd` (main remoto consultado al iniciar). Worktree: `.worktrees/tms-combustibles-fase1`. Este documento es local, sin commit ni push.

## 1. Dictamen y límites de evidencia

Hay varios circuitos de combustible y no deben tratarse como una sola importación. C2B guarda evidencia de proveedor, C2C la concilia con vales internos y CB2 crea consumos operativos con su propio historial. La confirmación de un archivo de evidencia no equivale a crear un consumo ni a pagar una factura.

CB2 ya permite no vincular empleado y conserva el nombre informado. Eso no constituye soporte explícito para conductor externo. El vehículo de catálogo activo y autorizado sí es obligatorio. Asociar una unidad ajena para superar esta validación produciría una atribución incorrecta.

La placa no identifica un consumo. La identidad candidata actual de CB2 se calcula con el vale, dentro del ámbito empresa/proveedor. La serie y factura intervienen en la validación documental; no amplían automáticamente el espacio de vales. Es necesario acordar cómo numera cada emisor antes de cambiar esta regla.

La eliminación física de vehículos no es una consolidación: el endpoint intenta eliminar históricos relacionados. La FK de fondos protege referencias que no contempla su comprobación previa. No se propone borrar ninguno de los vehículos reportados.

Se inspeccionaron fuentes, definiciones SQL y tres Excel locales en lectura. No se consultó la base productiva, no se ejecutó SQL ni se verificaron las capturas mencionadas, que no están disponibles en esta sesión. El error #1451 y los IDs #1301/#684 son evidencia aportada por el usuario, coherente con las relaciones del repositorio, pero no se certificó su estado físico. No está demostrado que esos dos registros representen el mismo vehículo real. Tampoco se certificaron migraciones aplicadas, configuración desplegada, permisos efectivos ni procesos externos.

## 2. Archivos examinados

Lectura directa de OOXML con Python estándar (`zipfile`/XML), sin abrir macros, recalcular fórmulas ni guardar los libros. Se contaron filas con vale y placa, excluyendo cabeceras/totales. Para detectar repeticiones se compararon identificadores normalizados; la normalización exploratoria no se propone como regla productiva. No se publican nombres personales ni filas originales.

| Libro / hoja | Consumos candidatos | Vales / series / facturas únicos, cada columna | Placas normalizadas distintas | Claves de placa repetidas | Apariciones adicionales de esas placas |
|---|---:|---:|---:|---:|---:|
| CONSUMO COMBUSTIBLE OCTUBRE.xlsx / OCTUBRE | 325 | 325 / 325 / 325 | 56 | 41 | 269 |
| CONSUMO COMBUSTIBLE SEPTIEMBRE.xlsx / SEPTIEMBRE | 344 | 344 / 344 / 344 | 59 | 42 | 285 |

En ambos libros: cabecera fila 1; fecha A, vale B, serie C, factura D, piloto I y placa J. No hay repeticiones dentro de cada archivo en vale, serie, factura ni pareja serie/factura. Esto no demuestra ausencia de registros previos en la aplicación ni ausencia de coincidencias entre archivos. Las repeticiones de placa son compatibles con múltiples abastecimientos del mismo vehículo; no prueban duplicación del catálogo.

El fondo tiene hoja `Hoja1`, 92 filas XML y 91 celdas con fórmula; se identificaron fecha, placa y galones. No se certificó un conteo de consumos usando el contrato de proveedor: es un documento de fondo y requiere un mapeo propio aprobado. No debe importarse automáticamente como abastecimientos realizados.

Octubre tiene 328 celdas con fórmula y septiembre 347, incluidas fórmulas compartidas. La lectura de valores almacenados no prueba aceptación por el parser de la aplicación. Debe comprobarse su política de fórmulas, referencias y precisión con fixtures; no ejecutar Excel para convertir fórmulas arbitrarias en valores confiables.

| Archivo | SHA-256 antes y después (sin cambios) |
|---|---|
| Octubre | `e91df844421ed393e70887b36aca5f799636b586fda7a19b4b566b1595646b9b` |
| Septiembre | `f5c9db1370963e12ccdc195bfa2640a2b0cb3c1e9c88acf1572734dd596c9b10` |
| Fondo septiembre | `2eb9e82a51257a1d7003a3ce7a9fa3682192b9b409e5b42139e1f577df077e2f` |

Fuentes locales, conservadas sin modificaciones:

:codex-file-citation{path="C:/Users/Admin/Downloads/CONSUMO COMBUSTIBLE OCTUBRE.xlsx" artifact_kind="workbook" purpose="source"}

:codex-file-citation{path="C:/Users/Admin/Downloads/CONSUMO COMBUSTIBLE SEPTIEMBRE.xlsx" artifact_kind="workbook" purpose="source"}

:codex-file-citation{path="C:/Users/Admin/Downloads/FONDO COMBUSTIBLE DEL 01 AL 10 DE SEPTIEMBRE.xlsx" artifact_kind="workbook" purpose="source"}

## 3. Inventario del código y contratos actuales

Rutas relativas a la raíz del worktree; los directorios agrupan endpoints de la misma familia.

| Circuito | Código principal | Responsabilidad / hallazgo |
|---|---|---|
| Pantallas | `src/app/e/[slug]/combustibles/`, `src/components/flota/cb2/`, `src/components/flota/combustible-importaciones-client.tsx` | Captura, importaciones, asignaciones, pendientes y conciliación. CB2 muestra ambigüedades y permite empleado sin vincular. |
| HTTP CB2 | `src/app/api/empresas/[slug]/flota/combustible/cb2/`, `src/lib/flota/cb2/http.ts`, `origin.ts` | Preview/confirmar/reanudar/corregir, lecturas y documentos. Tenant, permisos, origen HTTP y reautorización. Reanudar/corregir requieren Admin adicionalmente. |
| Parser | `src/lib/flota/combustible-importacion-parser.ts`, `combustible-importacion-v2.ts`, `combustible-ooxml-v2.ts` | Contenedor XLSX, perfiles, celdas, originales, diagnósticos y agrupación de vales. En v2, `identidadCandidata = hash(JSON.stringify([vale]))`; servidor agrega ámbito. |
| Confirmación CB2 | `src/lib/flota/cb2/model.ts`, `service.ts`, `repository.ts` | Token de preview, digest de selección, transacción, bloqueos, comparación con previos, consumo, factura operativa y eventos originales/resoluciones. |
| Matching | `src/lib/flota/combustible-coincidencias.ts`, `vehiculos-catalogo.ts`, `cb2/empleados-coincidencias.ts`, `cb2/empleados-validacion.ts` | Placas completas/abreviadas; unicidad; empleado activo de empresa; propuestas aproximadas no prueban identidad. |
| Edición CB2 | `src/lib/flota/cb2/asignaciones.ts`, `asignaciones-http.ts`, `src/components/flota/cb2/asignacion.tsx` | Cambiar vehículo/empleado/producto con revisión, clave idempotente y evento; no sobrescribir evidencia original. |
| Documentos CB2 | `src/lib/flota/cb2/documentos*.ts`, `conciliacion-documental*.ts` | Asociar/completar/corregir documentación, revisiones y permisos. Fase documental condicionada por `CB2_DOCUMENTOS_FASE2`; no certifica pago/CxP ni emisión de ventas. |
| Consultas CB2 | `src/lib/flota/cb2/consumos-lectura.ts`, `resumen-mensual.ts` | Placa actual por JOIN y originales conservados. Nuevos externos deben aparecer en consultas/totales, sin perder filas por JOIN interno. |
| C2B evidencia | `src/lib/flota/combustible-importaciones.ts`, `combustible-importaciones-http.ts` | Archivo por empresa/proveedor/hash, preview firmado, confirmación y conservación de filas. Confirmar evidencia no crea consumo CB2. |
| C2C conciliación | `src/lib/flota/combustible-c2c.ts`, `combustible-conciliacion*.ts`, `src/app/api/empresas/[slug]/flota/combustible/conciliacion-proveedor/` | Vínculo de fila de proveedor con vale interno, fondos informativos e historial. No reescribe los importes originales del vale. |
| Vales staff | `src/lib/flota/combustible-staff.ts`, `combustible-staff-schema.ts`, `combustible-staff-http.ts` | Vehículo obligatorio, proveedor derivado de estación; edición restringida de pendientes. No asumir que aceptar externos en CB2 habilita este circuito. |
| Portal piloto | `src/lib/flota/combustible.ts`, `src/app/api/portal/viajes/[id]/combustible/`, `src/app/portal/viajes/combustible-form.tsx` | Captura desde viaje/identidad de piloto; requiere revisión específica para externos. |
| Fondos | `src/lib/flota/combustible-fondos.ts`, `combustible-fondos-captura.test.ts` | Ámbito y vínculo con línea de solicitud y pruebas de captura; no es una fuente automática de consumos realizados. |
| Permisos/compartidos | `src/lib/flota/combustible-permisos.ts`, `tenant.ts`, `acceso.ts` | Acciones ver/registrar/editar_pendientes/revisar/conciliar/estaciones/documentos; Admin tiene acceso por el contrato actual. Vehículo propio o compartido explícitamente. |
| Catálogo / borrado | `src/app/api/empresas/[slug]/flota/vehiculos/route.ts`, `src/lib/flota/schema.ts` | Alta, baja y eliminación física. Alta comprueba placa textual por empresa; no garantiza unicidad canónica. Runtime schema no sustituye verificación del esquema efectivo. |

### 3.1 Matching y confirmación

`vehiculos-catalogo.ts` elimina repeticiones del mismo ID producidas por joins, pero conserva IDs diferentes con la misma placa y reporta posibles duplicados. La normalización moderna conserva el prefijo de placa; existen rutas históricas de conciliación con otra normalización. Unificar ambas sin versionado puede cambiar la identidad de registros existentes.

CB2 exige vehículo activo y acceso propio/compartido. Una placa abreviada no autoriza inferir un prefijo arbitrario. La selección excepcional requiere motivo de unidad y validación de acceso; esa posibilidad no debe usarse para atribuir un externo a un vehículo distinto. Empleados automáticos deben coincidir de forma única; sugerencias por similitud requieren intervención. Si se elige empleado, debe estar activo y pertenecer a la empresa. `SIN_ASIGNACION` admite empleado nulo.

El token CB2 dura 15 minutos y liga contexto/actor/archivo/selección; confirmar vuelve a validar bajo bloqueo de proveedor. Existen límites de concurrencia, claves idempotentes y manejo de commit incierto. Deben conservarse: ante resultado incierto, consultar/reintentar con la misma clave; no generar otra operación para “destrabar”.

El payload operativo incluye vale, fecha, placa, piloto informado, producto, cantidades/precios/importes/kilometraje y moneda. Serie/factura se controlan por separado. Un grupo del mismo vale con payloads distintos o documentos completos contradictorios bloquea. La ausencia de serie/factura puede dejar un consumo operativo pendiente de documento. Los previos C2B se tratan como históricos, sin promoción automática a CB2.

### 3.2 Por qué no basta con «crear un empleado externo»

La migración `sql/migrate-2026-10-combustibles-c1.sql` ya permite `empleado_id` y viaje nulos en vales staff; el esquema inicial de runtime tiene un contrato diferente. CB2 incorpora empleado opcional mediante la migración de asignaciones. Sin verificar las migraciones físicas no puede atribuirse un rechazo productivo únicamente a la nómina. Hay que identificar endpoint, perfil, respuesta y esquema efectivos.

Un empleado ficticio introduce identidad laboral falsa, permisos/relaciones indebidos y malas estadísticas. Tampoco debe crearse una unidad ficticia de flota para cumplir `vehiculoId`. El TMS ya contiene campos externos en planes (nombre/transportista/placa), pero eso no integra automáticamente esos sujetos en combustible.

## 4. Relaciones de vehículos y diagnóstico de #1451

| Relación visible en fuentes | Comportamiento / consecuencia |
|---|---|
| `tms_solicitud_fondo_lineas.vehiculo_id` → `flota_vehiculos.id` | FK restrictiva; línea conserva además placa y otros snapshots. Explica el tipo de bloqueo reportado. |
| `tms_gastos_operativos.vehiculo_id` | FK restrictiva; gasto histórico no debe eliminarse para borrar unidad. |
| `tms_unidades.flota_vehiculo_id`, `tms_planes_viaje.tc_vehiculo_id` | Referencias adicionales del TMS; considerar también vínculos vía unidad. |
| `tms_cliente_rutas.unidad_recurrente_id` y referencias de unidad recurrente del esquema | La migración de rutas declara FK a vehículo con SET NULL; una eliminación también puede alterar configuración sin borrarla. |
| `cb_requerimiento_lineas.vehiculo_id` | Compras; FK restrictiva en esquema/migración de compartidos. |
| `ops_multas_revisiones` | Referencia compuesta empresa/vehículo, restrictiva; no sustituir por ID de otro propietario. |
| `flota_cb2_consumos.vehiculo_id` y vales `flota_combustible_cargas` | Consumos y vales originales; mantener trazabilidad, fondos y conciliaciones. CB2 referencia obligatoria y restrictiva. |
| `flota_viajes`, `flota_lecturas`, `flota_servicios` | Hay cascadas en el esquema y borrado explícito en endpoint, junto con evidencias/adjuntos/filtros/accesos. Suprimir el padre puede perder historia. |
| `flota_vehiculo_acceso`, documentos y otras relaciones lógicas | No limitar inventario a FKs declaradas: hay acceso compartido y columnas de referencia sin FK. |

Fuentes: `sql/schema.sql`; `sql/migrate-2026-10-fondos-vehiculos-compartidos.sql`; `sql/migrate-2026-10-vehiculos-compartidos-global.sql`; `sql/migrate-2026-09-rutas-tarifario-multiple-unidad.sql`; `sql/migrate-2026-08-operaciones-multas.sql`; `sql/migrate-2026-10-combustibles-pr2-consumos-facturas.sql`; `sql/migrate-2026-10-combustibles-pr514-asignaciones.sql`; endpoint de vehículos y `schema.ts`.

La migración de fondos compartidos pasa referencias a ID global de vehículo y mantiene la empresa de la solicitud. No debe restaurarse una FK por empresa propietaria que impida compartir unidades válidamente. Estas definiciones son inventario de fuentes, no certificado exhaustivo de la base desplegada. Antes de implementar habrá que contrastar `information_schema` (FKs, índices, motores y columnas) y referencias lógicas del código con una copia autorizada.

El DELETE revisa multas y viajes abiertos, pero no todas las referencias de fondos/gastos/consumos. Intenta borrar históricos antes del padre y devuelve un error genérico si falla. Una transacción debería revertirlo con motores transaccionales; no se comprobó ese supuesto en producción. Diseño: prohibir eliminación física cuando haya historia y ofrecer informe de dependencias/baja/consolidación. No quitar FKs ni agregar cascadas para permitir el borrado.

## 5. Diseño propuesto: personas y vehículos externos

### 5.1 Identidad explícita

Separar el sujeto económico del catálogo laboral y de flota. Cada consumo tendrá dos uniones discriminadas independientes:

| Dimensión | Tipo | Datos propuestos |
|---|---|---|
| Conductor | `EMPLEADO` | ID real de empleado de la empresa; nombre original y snapshot al confirmar. |
| Conductor | `EXTERNO` | Referencia a identidad externa empresarial o registro de identificación revisado; nombre informado, transportista/contratista cuando exista, origen y responsable de validación. Sin alta en nómina. |
| Conductor | `NO_IDENTIFICADO` | Solo como pendiente de revisión conforme a política aprobada; nunca convertir automáticamente un nulo histórico en externo. |
| Vehículo | `CATALOGO` | ID autorizado propio/compartido, snapshot y eventual ID canónico; preservar ID original. |
| Vehículo | `EXTERNO` | Registro externo separado de flota: placa original/canónica, jurisdicción si consta, transportista/propietario declarado y evidencia de revisión. Sin crear mantenimiento, odómetro o acceso de flota implícitos. |

Recomendación: catálogo externo acotado por empresa con identidad estable y snapshots por consumo. No deduplicar personas por nombre ni vehículos externos por placa aislada cuando pueda haber jurisdicciones/reasignaciones. Documento personal únicamente si es necesario y autorizado; minimizar exposición y retención. La obligatoriedad de identificar contratista y el tratamiento de `NO_IDENTIFICADO` requieren decisión del responsable operativo antes de implementar.

Restricciones coherentes: solo un tipo de conductor y un tipo de vehículo; el ID de catálogo se exige exclusivamente en su variante; externo requiere su identidad/evidencia mínima aprobada. Nunca persistir ambos tipos para el mismo rol ni usar IDs cero. Mantener actor, empresa, proveedor, origen/hoja/fila, motivo y revisión. Una persona externa puede conducir un vehículo de catálogo y un empleado puede conducir un externo si la política lo autoriza; no acoplar ambas elecciones.

### 5.2 UI y flujo

1. Preview conserva todas las filas y sus originales. Selector explícito de tipo de conductor y vehículo; no adivinar “externo” por falta de match.
2. Matching muestra ID, placa, estado, propietario/acceso permitido y número de candidatos. Desambiguar no equivale a consolidar el catálogo.
3. Proponer coincidencias; usuario autorizado confirma identidad externa y motivo. Cambiar empresa/proveedor/archivo/tipo invalida selección y token.
4. Servidor vuelve a comprobar permisos, acceso, identidad, revisión y duplicados dentro de la transacción. El preview no es una autorización permanente.
5. Persistir consumo/evidencia/evento atómicamente. Conciliación posterior se mantiene con documento, vale y fondo correspondientes, sin fabricar relaciones laborales ni financieras.
6. Consultas y exportaciones separan flota/externo/no identificado y conservan totales. Ediciones posteriores agregan eventos y snapshots; originales permanecen inmutables.

### 5.3 Ámbito y permisos

El contexto CB2 actual es empresa/proveedor/actor; no contiene `entidad_id`. No se debe afirmar aislamiento por entidad que hoy no está implementado en este circuito. Si una entidad/libro determina permisos o imputación, resolverlo en servidor y persistirlo como parte del contrato aprobado, validando su pertenencia a empresa. No derivarla de empresa propietaria del vehículo, texto de Excel o ID enviado por el navegador.

Definir separadamente el ámbito de identidad del vale y el de imputación contable: permitir cambiar entidad no debe permitir importar el mismo vale otra vez. Ante intento de usar un consumo ya existente en otro libro, rechazar o tramitar reasignación aprobada del mismo consumo, sin duplicarlo ni exponer datos del otro ámbito.

Conservar acciones vigentes. Proponer aprobación separada para registrar/verificar externos y consolidar vehículos; revisión de matriz por dueño de seguridad antes de agregar permisos. Mantener auditoría de actor real, motivo, antes/después, revisiones y correlación de importación. Acceso compartido a vehículo no habilita leer consumos de otra empresa. Errores no revelarán nombres/IDs de otros tenants.

## 6. Identidad e idempotencia

No reemplazar la identidad actual por placa/nombre, ni por hash del archivo. Un archivo editado o reordenado puede contener exactamente el mismo vale. Tampoco usar factura como identidad de consumo: una factura puede documentar varios consumos.

Antes de diseñar la clave definitiva, cada proveedor debe declarar su regla de numeración: unicidad global del vale o por emisor/estación/serie/periodo, si admite reinicios y si un vale puede tener varias líneas de producto. La serie del documento fiscal no se asume serie del vale. Fecha y monto no deben permitir convertir una corrección del mismo vale en otro consumo.

Contrato propuesto, sujeto a aprobación de esa regla:

- Identidad operativa: empresa + proveedor + espacio de numeración certificado + vale normalizado; sublínea solo si el emisor acredita vales multilínea con identificador estable. No inventarla a partir de posición Excel.
- Identidad documental: empresa + proveedor + serie fiscal + número de factura, como contrato actual; validar moneda, datos y vínculos sin asumir un consumo por factura. Datos incompatibles se revisan.
- Ámbito de entidad: imputación validada y protección contra doble registro entre entidades según la titularidad real del vale. No añadir entidad a una clave única automáticamente.
- Comparar por separado payload original y asignación revisable. Mismo vale y contenido equivalente: reutilizar consumo y registrar nueva aparición, sin duplicar galones/importes. Diferencia de fecha, importe, producto, placa o documento contradictorio: conflicto revisable, no “nuevo vale”.
- Vale/espacio insuficiente o ambiguo: conservar evidencia y bloquear creación hasta revisión. No completar con ceros, factura arbitraria ni un proveedor distinto para superar el conflicto.
- Confirmación: reserva de identidad con restricción única física y revalidación transaccional; clave de operación y revisión para reintentos. Dos procesos concurrentes deben terminar con un consumo. Commit incierto exige reconciliar la misma operación.
- Versionar nueva identidad y normalización. Consultar correspondencias con CB2 v1, vales internos y evidencia C2B antes de crear; no hacer que un vale previo desaparezca por cambiar algoritmo. C2B no se promueve automáticamente. La resolución de un conflicto histórico requiere autorización y evento.

El UNIQUE actual de huella operativa no sustituye una restricción de identidad del vale: dos payloads distintos producen huellas distintas. El bloqueo y búsqueda del servicio son defensas importantes que deben conservarse, pero hay que inventariar todos los escritores antes de endurecer el contrato físico.

## 7. Validaciones y mensajes propuestos

Respuesta estructurada por fila: `codigo`, `severidad`, `campo`, `mensaje`, `accionPermitida`, `bloqueaConsumo`, referencia hoja/fila/candidato y revisión. Identificadores originales en texto seguro; jamás HTML sin escapar. Servidor define la clasificación; UI no debe deducir el estado buscando palabras en el mensaje.

| Código / severidad | Mensaje propuesto | Resolución |
|---|---|---|
| `EMPLEADO_NO_DISPONIBLE` / bloqueante para tipo empleado | «No hay un empleado activo autorizado que corresponda a esta selección.» | Corregir selección; si es tercero, elegir explícitamente externo y acreditar identidad. No revelar catálogo ajeno. |
| `CONDUCTOR_AMBIGUO` / revisión bloqueante | «Hay varias coincidencias de conductor. Seleccione la persona correcta.» | Selección manual autorizada, sin auto-match por parecido. |
| `CONDUCTOR_SIN_VINCULO` / advertencia condicionada | «El nombre informado se conservará sin vínculo laboral. Revise su clasificación.» | No bloquear solo por falta de nómina si el contrato externo aprobado está completo. |
| `VEHICULO_NO_DISPONIBLE` / bloqueante para catálogo | «La placa no tiene una unidad activa y autorizada en este catálogo.» | Revisar placa/acceso o elegir vehículo externo; no asignar otra unidad. |
| `PLACA_AMBIGUA` / revisión bloqueante | «La placa corresponde a más de una unidad disponible. Revise los candidatos.» | Selección acreditada para esta fila; abrir revisión de catálogo por separado. |
| `PLACA_ABREVIADA` / revisión | «La placa está abreviada y no identifica una unidad de forma única.» | Evidencia y motivo si se autoriza selección; sin inventar prefijo. |
| `EXTERNO_INCOMPLETO` / bloqueante | «Complete y valide la identificación externa requerida antes de confirmar.» | Mostrar exactamente campos faltantes y responsable. |
| `VALE_YA_REGISTRADO` / informativo idempotente | «Este vale ya está registrado con los mismos datos. No se creará otro consumo.» | Vincular aparición, mostrar resultado autorizado. |
| `VALE_EN_CONFLICTO` / bloqueante | «Este vale ya existe con datos diferentes: [campos permitidos]. Requiere revisión.» | No sobrescribir ni generar otro consumo. Datos de otro ámbito no se exponen. |
| `ESPACIO_VALE_AMBIGUO` / bloqueante | «No puede determinarse el ámbito de numeración del vale.» | Validar regla del emisor; no elegir otra factura como parche. |
| `DOCUMENTO_PENDIENTE` / advertencia | «El consumo puede registrarse, pero faltan serie o factura para completar la documentación.» | Mantener pendiente según contrato vigente; no simular factura. |
| `DOCUMENTO_CONTRADICTORIO` / bloqueante para asociación | «La serie y factura ya están vinculadas con datos incompatibles.» | Revisión documental con permiso y evento. |
| `DATO_INVALIDO` / bloqueante | «[Campo] no es válido en hoja [X], fila [Y]: [regla].» | Precisión, fecha, monto, formato o fórmula no admitida; preservar original. |
| `REVISION_CAMBIO` / bloqueante temporal | «La selección o el registro cambió. Actualice la revisión antes de confirmar.» | Nuevo preview/revisión; nunca reutilizar token anterior. |

Producto no determinado, kilometraje textual, diferencia de cálculo y mes distinto deben conservar su diagnóstico específico y severidad aprobada; no convertir advertencias en descartes silenciosos. La pantalla debe indicar cuántas filas crearán, reutilizarán, quedarán pendientes o estarán bloqueadas y por qué. Confirmación parcial, si se incorpora, requiere contrato explícito y evidencia de todas las filas; no se presupone habilitada.

## 8. Consolidación segura de vehículos duplicados

### 8.1 Preparación y aprobación

Generar candidatos por placa comparable, pero comparar además VIN/chasis, propietario, empresa, documentos, estado, periodos y autorizaciones. Placa igual puede ser error, abreviación, reasignación o unidades distintas; un VIN contradictorio detiene la consolidación. No elegir automáticamente el ID menor, más nuevo ni el que tenga más referencias.

Para C-558BSJ #1301/#684: expediente de ambos, referencias por tabla/empresa, documentos, duplicidades de viajes/odómetros y evidencia del vehículo real. Flota confirma identidad; responsables de TMS/fondos/compras validan efectos; propietarios y seguridad aprueban si involucra compartidos. Ningún ID canónico se propone sin esos datos.

### 8.2 Modelo recomendado

Consolidación lógica mediante relación auditable de alias → canónico, sin borrar originales. Mapeo sin ciclos, sin cadenas ambiguas, con actor/motivo/evidencia/revisión/fecha y ámbito explícito. Los IDs históricos y snapshots permanecen; consultas pueden agrupar por canónico conservando acceso al ID y placa originales. Un consumo se cuenta una sola vez aunque aparezca mediante varios alias.

Para nuevas operaciones, selector presenta canónico autorizado y etiqueta alias retirado de nuevas selecciones. Acceso al alias no se transforma en acceso general al canónico ni une permisos de dos empresas. Resolver permisos del propietario y de cada empresa usuaria; no trasladar FKs compuestas de multas/otros registros a un propietario incompatible. Si identidad/propiedad no permite esa semántica, mantener registros separados con una incidencia, sin consolidar.

No actualizar masivamente todas las FKs. Referencias históricas cerradas, snapshots de fondos, consumos, documentos y eventos quedan intactos. Referencias abiertas que requieran reasignación se evalúan una a una, con aprobación, revisión optimista y registro antes/después. No duplicar ni migrar automáticamente lecturas: odómetros y mantenimiento necesitan orden y coherencia propia.

### 8.3 Qué se puede automatizar

| Automatizable en una fase futura autorizada | Requiere aprobación humana |
|---|---|
| Inventario, conteos, agrupación de candidatos, diferencias de campos y dependencias; comprobación de ciclos/acceso/huérfanos; reporte de impacto. | Determinar identidad física, ID canónico, propietario, conflicto VIN/placa y permisos compartidos. |
| Reutilización de consumo idéntico acreditado bajo identidad certificada; sugerencias únicas. | Conflicto de vale, reinicios de numeración, cambio de importe/fecha y promociones históricas. |
| Aplicar un expediente aprobado con precondiciones/revisión y evento, sin borrar historia. | Reasignar documentos o referencias abiertas; corregir externos y decidir su contratista. |

No automatizar desde estos Excel altas de empleados, consolidación de flota ni reconstrucción de datos ausentes.

## 9. Migraciones y secuencia futura (no implementadas)

Necesidades previsibles: tipos de identidad y referencias externas; snapshots/revisión; catálogo externo si se aprueba; correspondencias canónicas de vehículos; identidad de vale versionada y reserva única; índices de ámbito/consulta y eventos de regularización. Elegir nombres/DDL solo tras inventario físico y aprobación del diseño. Revisar FKs/CHECK para impedir combinaciones incoherentes y referencias entre empresas, respetando vehículos compartidos. No se modifica ningún SQL existente en esta fase.

Migración aditiva por etapas: inventario y simulación → esquema compatible → código que lea ambos formatos → habilitación controlada de nuevos tipos → regularización revisada. Nulos históricos permanecen «clasificación pendiente»; no backfill automático como externo. Los escritores antiguos que exigen vehículo de flota o desconocen externos deben quedar deshabilitados/controlados durante la transición; no desplegar versiones mixtas capaces de confirmar el mismo vale con reglas distintas.

Escritores conocidos: CB2 confirmar/reanudar/corregir/asignaciones/documentos; vales staff y edición/revisión; portal de piloto; C2B/C2C y vínculo documental; herramientas administrativas de limpieza. Inventariar también imports manuales, scripts, cron, integraciones, accesos SQL y otras versiones desplegadas fuera del repositorio. No están verificados. Ninguna restricción de aplicación garantiza idempotencia si un escritor externo evita el servicio y no existe defensa física adecuada.

## 10. Riesgos, preflight y recuperación

| Riesgo | Prevención / condición para avanzar | Recuperación propuesta |
|---|---|---|
| Borrado de historia al eliminar vehículo | No usar DELETE; alias y snapshots, ensayo de todas las dependencias. | Revertir relación activa con evento; si hubo daño, restauración ensayada y reconciliación, nunca reconstrucción inventada. |
| Doble consumo por nueva clave/archivo/concurrencia | Compatibilidad de identidades antiguas, restricción física y prueba de dos escritores. | Bloquear confirmaciones y resolver incidencia auditada; no borrar consumo financiero sin procedimiento aprobado. |
| Acceso entre empresas/libros | Ámbito en cada lectura/escritura, IDs validados, acceso compartido explícito. | Suspender la capacidad afectada, preservar evidencia y revisar exposición. |
| Externos omitidos en totales o reportes | Revisar JOINs y clasificación; conciliar conteos, galones e importes antes/después. | Desactivar nuevas altas externas; lectura compatible de lo ya registrado. |
| Alias incorrecto o odómetros mezclados | Identidad física aprobada y ninguna fusión automática de lecturas. | Desactivar alias mediante evento y corregir solo operaciones posteriores revisadas. |
| Versiones/esquema incompatibles | Inventario de escritores, ventana sin confirmaciones, ensayo previo y bloqueo de clientes antiguos. | Rollback de aplicación solo si puede leer los nuevos tipos; mantener esquema aditivo y datos. |
| Fórmula/precisión/archivo malinterpretado | Fixtures de fórmulas compartidas, valores y límites; no recalcular contenido arbitrario. | Conservar archivo y diagnósticos, cancelar importación pendiente, reintentar con mismo contrato aprobado. |

Checklist para futura intervención, pendiente de autorización:

- [ ] Responsable de flota, TMS/fondos, finanzas, seguridad y operador de DB nombrados; aprobación del contrato externo y numeración por proveedor.
- [ ] Copia autorizada: esquema efectivo, motores, FKs, índices, flags y versión de aplicación; inventario de todos los escritores y referencias lógicas.
- [ ] Reporte de dependencias y conteos por vehículo/empresa/tabla; lista de posibles duplicados, huérfanos y colisiones sin corregirlos.
- [ ] Backup consistente de DB, archivos de importación/evidencias y configuración necesaria; cifrado, retención, responsable, checksum y manifiesto. Sin secretos en el reporte.
- [ ] Restauración en entorno aislado comprobada: mismos conteos/sumas/FKs/snapshots, archivos legibles y tiempos de restauración medidos. Backup no probado no habilita saneamiento.
- [ ] Ensayo completo de migración aditiva y reversión lógica; pruebas de compatibilidad, permisos e idempotencia; plan de bloqueo de escrituras y versiones antiguas.
- [ ] Expediente y aprobación individual de cada consolidación. Sin elección automática del canónico.
- [ ] Postcheck: mismo número de consumos/vales/fondos/históricos, mismas sumas decimales por empresa/proveedor/moneda, ningún huérfano, permisos intactos, originales recuperables y ausencia de doble conteo por alias.
- [ ] Registro de cada operación y punto de corte; desbloqueo de escritores solo tras aceptación operativa.

NO-GO: esquema desconocido/divergente, backup sin restaurar, identidad no probada, permisos compartidos sin resolver, contrato de numeración ambiguo, escritor no controlado, resultados monetarios distintos o requerimiento de inventar datos. Recuperación debe preservar nuevas identidades: no eliminar columnas/tablas con datos externos para volver al código viejo. Si es necesaria restauración puntual, detener escrituras y reconciliar todas las operaciones posteriores al backup antes de reabrir; no reemplazar toda la DB perdiendo movimientos ajenos.

## 11. Matriz de pruebas propuesta

Todas las pruebas siguientes están **pendientes**, no ejecutadas en fase 1. Fixtures sintéticos; casos reales anonimizados solo con aprobación, sin nombres, documentos ni archivos completos en Git. Preservar distribución, formatos y anomalías relevantes, no datos personales.

| Caso | Nivel | Resultado esperado |
|---|---|---|
| Libros equivalentes a 325/344 filas sin claves repetidas | Parser / servicio | Todos los candidatos explicados; suma decimal y conteos certificados. |
| Placa repetida con vales distintos | Servicio | Varios consumos legítimos; ninguna deduplicación por placa. |
| Mismo vale idéntico dos veces en archivo | Servicio | Un consumo, apariciones trazables. |
| Mismo vale en archivos distintos/reordenados | Integración | Reutilización sin doble consumo; hash de archivo no basta. |
| Mismo vale con monto/fecha/placa/producto diferentes | Servicio / DB | Conflicto explícito, sin sobrescritura ni segundo consumo. |
| Mismo vale con serie fiscal distinta | Servicio | Conflicto/revisión conforme a regla del emisor; no asumir nuevo consumo. |
| Vales válidos de espacios diferentes acreditados | Integración | Distintos solo si regla certificada; no dividir el ámbito por elección libre. |
| Serie/factura igual con varios vales | Documentos | Varios consumos en documento compatible, sin falso duplicado. |
| Falta serie/factura | Servicio / DOM | Pendiente documental visible según contrato; no fabricar documento. |
| Colisión C2B/CB2 v1/nueva versión | Integración | No promoción ni duplicación silenciosa. |
| Dos confirmaciones simultáneas, commit incierto y reintento | MariaDB aislada | Un consumo; misma clave recupera resultado; originales completos. |
| Conductor externo + vehículo externo | Servicio / DOM | Sin empleado/unidad ficticios; identidad, actor y evidencia completos. |
| Empleado + vehículo externo / externo + vehículo de catálogo | Servicio | Combinaciones independientes según política aprobada. |
| Externo incompleto / identidad no revisada | DOM / HTTP | Campos y acción claros; confirmación bloqueada. |
| Empleado inexistente/inactivo/otra empresa | HTTP / DB | No vincular; no filtrar datos de otro tenant. |
| Nulo histórico de empleado | Migración simulada | No reclasificar automáticamente como externo. |
| Placa completa ambigua; abreviada; prefijo distinto | Matching / DOM | Sin asignación arbitraria; motivo/evidencia donde corresponda. |
| IDs sintéticos 101/202, misma placa y mismo VIN certificado | Consolidación simulada | Alias aprobado; conservar todas las referencias originales. |
| Misma placa y VIN/propietario contradictorios | Consolidación | NO-GO, expediente sin fusión. |
| Vehículo compartido / multa con FK compuesta | Integración | Sin ampliar permisos ni violar propietario/empresa. |
| Fondos/gastos/viajes/documentos/lecturas antes y después | DB aislada | Conteos/snapshots intactos; no DELETE, cascada ni duplicación. |
| Reportes con aliases y externos | Consultas / DB | Cada consumo una vez, mismos totales por ámbito y moneda. |
| Confirmar externo desde cliente/código antiguo | Compatibilidad | Rechazo controlado o capacidad deshabilitada; sin fallo parcial. |
| Cambio de contexto/selección mientras preview está pendiente | DOM | Token viejo inválido, sin respuesta ni confirmación de otro contexto. |
| Usuario sin conciliar/corregir/consolidar | HTTP | Denegado en servidor aun manipulando UI. |
| Fórmulas compartidas, fórmulas no admitidas, caché ausente | Parser | Resultados deterministas o diagnóstico específico; no aceptar valor arbitrario. |
| Vale con ceros iniciales, caracteres Unicode, formatos numéricos | Parser | Original conservado y normalización versionada sin colisiones ocultas. |
| Montos, galones, precio y redondeos en límites | Unidad / DB | Aritmética decimal, precisión comercial preservada. |
| Fondo sin vale de proveedor | Parser / UX | No convertirlo automáticamente en consumo ni deduplicarlo por placa. |
| Recuperación/reversión lógica y restore | Laboratorio | Históricos recuperables y movimientos posteriores reconciliados. |

Suites existentes para ampliar/reutilizar, sin atribuirles PASS: `combustible-importacion-parser.test.ts`, `combustible-importacion-v2.test.ts`, `combustible-ooxml-v2.test.ts`, `combustible-coincidencias.test.ts`, `combustible-importaciones.test.ts`, `combustible-c2c*.test.ts`, `combustible-staff*.test.ts`; en `cb2/`: `model.test.ts`, `empleados-*.test.ts`, `coincidencias-service.test.ts`, `repository.test.ts`, `service.db.test.ts`, `asignaciones.test.ts`, `documentos*.test.ts`, `consumos-lectura.test.ts`, `resumen-mensual.test.ts` y pruebas HTTP. Añadir DOM del flujo externo y consolidación según diseño aprobado.

Las suites DB tienen opt-in distintos: C2C usa `LIQ_TEST_DB_PORT` local; CB2 servicio usa `CB2_TEST_PIPE` propio. No activarlos con credenciales productivas ni asumir que un SKIP equivale a PASS. Laboratorio desechable, versión MariaDB compatible, uploads sintéticos, sin red ni variables de producción; conservar errores originales.

## 12. Evidencia ejecutada y decisiones pendientes

Ejecutado: comprobación de Git/remote main, creación de worktree limpio aislado, búsquedas/lectura de código y SQL, lectura OOXML de tres libros, conteos y SHA-256 antes/después. No hubo consulta SQL, instalación, ejecución de suites, build ni modificación funcional. Los conteos Excel son evidencia de archivos, no una regresión de la aplicación. Este informe es el único archivo agregado en el worktree del ticket.

Comprobación final: `git diff --name-only` vacío; `git status --porcelain=v1` muestra únicamente este documento no rastreado; HEAD permanece en la base indicada. Se intentó leer el estado de #581 con `gh pr view ... --json number,isDraft,headRefOid,baseRefName,headRefName`, pero GitHub CLI no pudo acceder a su archivo de configuración por permisos del entorno. Por tanto, no se certifica aquí el estado remoto del PR. No se ejecutó ninguna operación de escritura sobre GitHub ni se alteró su worktree.

Pendiente: diagnóstico reproducible del rechazo de cada fila con endpoint/respuesta real anonimizados; inspección autorizada del esquema y de #1301/#684; contrato de vales por proveedor; definición de entidad e identidad externa; matriz final de permisos; inventario externo de escritores; decisiones de aprobación y laboratorio de pruebas. No se atribuye una causa única a la importación sin esas verificaciones.

Propuesta de siguiente autorización: aprobar o ajustar primero identidad externa, ámbito de vale/entidad y consolidación lógica; después dividir implementación, migraciones aditivas y regularización de datos en tickets separados. Ninguna ejecución productiva, commit, push o cambio de PR queda autorizado por este documento. Fase 1 se detiene aquí para auditoría independiente de ChatGPT.
