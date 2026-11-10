# TMS-COMB-02 — Contratos y tickets previos a implementación

Estado: propuesta documental para auditoría; no aprobada para implementación. Fecha: 2026-11-10.

Base: `docs/TMS-COMBUSTIBLES-FASE1-AUDITORIA-DISENO.md`, commit `8714d01407a637ddefb35b7dbfab1e2c68e40bce`. Rama: `audit/tms-combustibles-fase1`. El informe aprobado permanece intacto. No se consultó producción ni se modificaron código, SQL, pruebas o datos. Este documento no autoriza commit/push.

## 1. Convenciones y decisiones

«Debe» define una condición del contrato propuesto, no una capacidad ya implementada. «Pendiente» identifica una decisión que impide habilitar el comportamiento afectado. Los nombres de campos y capacidades nuevos son lógicos; el diseño físico/API final requerirá revisión. No se reutilizan enums de empleado ni columnas históricas para simular los nuevos tipos.

**NO APROBADAS:** todas las decisiones D1–D5 y las exigencias comerciales nuevas pendientes de validación en este documento. La autorización de publicación permite únicamente publicar esta propuesta documental; no aprueba sus reglas ni habilita implementación o ejecución operativa.

| Decisión | Propuesta concreta | Aprobación/evidencia pendiente |
|---|---|---|
| D1: conductor desconocido | Conservar evidencia como pendiente; no crear un consumo nuevo NO_IDENTIFICADO. | Operaciones/finanzas deben aprobar esta restricción nueva, diferenciada del SIN_ASIGNACION actual. Hasta entonces no cambiar comportamiento vigente. |
| D2: terceros | Identidad externa separada por empresa, verificada por revisor distinto del capturista. | Seguridad/operaciones aprueban capacidades y separación de funciones; no asumir que los permisos existentes las conceden. |
| D3: numeración | Mantener protección conservadora empresa/proveedor/vale para lo existente; ampliar únicamente con regla certificada y compatibilidad histórica. | Responsable de proveedor y finanzas acreditan cada espacio de numeración. |
| D4: entidad | No inventar entidad ni usarla para multiplicar identidades del vale. | Finanzas identifica si combustible necesita entidad/libro, su fuente y reglas de imputación/lectura. |
| D5: consolidación | Alias sin cambiar IDs, FKs ni snapshots históricos. | Flota acredita identidad física y propietarios/seguridad aprueban alcance compartido. |

Los casos no resueltos se conservan para revisión con motivo concreto; no se silencian, inventan ni descartan. No es necesario resolver todos los proveedores para documentar contratos, pero sí certificar el proveedor/flujo antes de habilitar una regla nueva.

## 2. Contrato de conductor

Unión discriminada `conductor.tipo`; exactamente una variante. Campos no aplicables se rechazan, no se ignoran.

| Tipo | Obligatorios | Prohibidos / reglas |
|---|---|---|
| EMPLEADO | `empleadoId` positivo; método de selección; snapshot de nombre tomado por servidor; texto original conservado por separado. | Sin `externoId`. Empleado activo de la empresa, revalidado al confirmar. Automático solo si coincidencia única certificada por servidor; selección manual registra actor/motivo. |
| EXTERNO | `externoId` positivo de identidad externa verificada de la empresa; snapshot de nombre; referencia de validación vigente. | Sin `empleadoId`; sin alta laboral. Nombre libre sin identidad verificada no permite confirmar. |
| NO_IDENTIFICADO | Motivo codificado (`SIN_DATO`, `AMBIGUO`, `PENDIENTE_EVIDENCIA`), observación y responsable de revisión. | Ambos IDs nulos. Texto original puede faltar; no inventar nombre. En propuesta D1: solo evidencia pendiente, sin nuevo consumo ni vínculo definitivo. |

Identidad externa mínima: ID interno estable; empresa resuelta en servidor; nombre visible de 1–160 caracteres tras trim; estado `PENDIENTE`, `VERIFICADO` o `INACTIVO`; revisión. No es única por nombre. Tipo de relación `CONTRATISTA`, `INDEPENDIENTE` u `OTRO_ACREDITADO`; en contratista se exige referencia empresarial del contratista, en los otros motivo/evidencia de la relación. Si se enlaza proveedor/tercero existente, validar su empresa y acceso; el proveedor de combustible no se presume empleador del conductor.

Validación mínima: referencia a evidencia privada (ID/ubicación controlada o expediente) y tipo de evidencia; capturadoPor/fecha; verificadoPor/fecha; motivo y revisión de identidad. El revisor acredita que la persona corresponde a la evidencia y al contexto operativo. Referencia no vacía y existencia/acceso de evidencia se verifican; texto inventado no satisface validación. Documento oficial personal no es obligatorio por defecto, y no se guarda copia/numero sin necesidad y política aprobada. No exponer evidencia personal en listas o logs generales.

Homónimos: mostrar candidatos autorizados y atributos de distinción no sensibles; nunca fusionar por nombre. Inactivar identidad impide nuevos usos; no cambia snapshots de consumos cerrados. Corregir una atribución posterior requiere evento, revisión y permiso, sin cambiar el original importado. Un empleado nulo histórico conserva la semántica histórica: no se convierte ni en EXTERNO ni en NO_IDENTIFICADO mediante backfill.

## 3. Contrato de vehículo

Unión `vehiculo.tipo`, independiente del tipo de conductor. No se exige que externo conduzca externo ni que empleado conduzca flota.

| Tipo | Obligatorios | Prohibidos / reglas |
|---|---|---|
| CATALOGO | `vehiculoId` positivo; snapshot de placa y referencia original; revisión del mapeo canónico si existe. | Sin `externoId`. Unidad activa y autorizada para empresa; preservar acceso propio/compartido. Revalidar tras espera de bloqueos. |
| EXTERNO | `externoId` positivo de registro externo verificado; snapshot de placa original/canónica y evidencia de validación. | Sin `vehiculoId`. Nunca crear unidad de flota ficticia; no generar mantenimiento, odómetro, viajes o acceso compartido implícitos. |

Registro externo mínimo: empresa, placa original de 1–128 caracteres sin controles, placa comparable con versión, país/jurisdicción declarados, transportista/tenedor identificado por referencia empresarial o expediente revisado, estado/revisión y evidencia/actor de verificación como en conductor. No inventar jurisdicción: si falta, pendiente hasta acreditarla. Esta exigencia nueva requiere aprobación de operaciones antes de habilitación. No exigir VIN inexistente en el origen; si se conoce, conservarlo protegido y usar contradicciones para bloquear matching.

Una placa no es identidad física eterna. No crear UNIQUE global por placa ni deduplicar automáticamente entre empresas/jurisdicciones. Mismo texto puede corresponder a reasignaciones: revisor decide registro y periodo, con evidencia. Si corresponde a flota autorizada, proponer CATALOGO; permitir externo frente a ese candidato requiere resolver explícitamente la ambigüedad. No usar EXTERNO para eludir una denegación de acceso a catálogo; emitir error sin revelar unidad ajena. Coincidencias privadas de otro tenant no se muestran.

Inactivación/corrección no altera snapshots. Si cambia placa o tenedor, crear revisión; para identidad física diferente, nuevo registro y expediente, sin reasignar consumos antiguos. En vales/fondos que hoy exigen vehículo de flota, el externo queda no soportado hasta adaptar ese escritor expresamente; no enviar IDs externos en `vehiculoId`.

## 4. Contexto, permisos y auditoría

Contexto obligatorio: empresa derivada de sesión/slug, proveedor activo de empresa, actor real y acción autorizada. Si entidad aplica, derivarla/validarla en servidor conforme a D4; no inferirla del vehículo, del Excel o del proveedor. Acceso al vehículo compartido no concede acceso a sus consumos en otras empresas.

| Operación | Requisito existente que se conserva | Capacidad nueva propuesta |
|---|---|---|
| Ver preview/evidencia | Lectura autorizada del circuito; CB2 HTTP actualmente diferencia lectura de conciliación. | Lectura de datos personales/evidencia externa separada y mínima. |
| Confirmar importación CB2 | `conciliar`, contexto y token vigentes; no sustituir por `registrar`. | Usar externo verificado, sujeto a D2. |
| Capturar vale staff | `registrar` y reglas de estación/fondo vigentes. | Externo solo tras ampliar y probar explícitamente ese contrato. |
| Proponer identidad externa | Sin concederlo por tener acceso de lectura. | `terceros.proponer`. |
| Verificar/inactivar identidad | No usar permiso documental como equivalente. | `terceros.validar`, revisor distinto de capturista. |
| Cambiar asignación de consumo | Permiso de corrección del circuito, revisión e historial; no ampliar silenciosamente. | Mismos controles externos aplicados al nuevo destino. |
| Proponer/aprobar alias | Sin reinterpretar `eliminar` como consolidar. | `vehiculos.consolidar.proponer` y `vehiculos.consolidar.aprobar`; aprobación distinta del proponente. |

Nombres de capacidades pendientes de integración con catálogo central y aprobación de seguridad. El bypass Admin actual no demuestra separación de funciones: las nuevas invariantes de revisión deben cumplirse también para Admin salvo excepción futura expresamente aprobada y auditada. Sin asignación aprobada de nuevas capacidades, funciones nuevas deshabilitadas.

Evento mínimo append-only: ID/correlación, empresa/proveedor y entidad cuando corresponda, actor, acción, fecha del servidor, recurso/revisión anterior y nueva, IDs de identidad/asignación, motivo, referencia de evidencia y operación idempotente. Preservar archivo hash, parser/versión, hoja/fila, textos originales, decisiones y snapshots. No guardar secretos, documentos personales completos ni tokens de preview en auditoría. Registro y evento atómicos; un fallo de auditoría impide confirmar. Correcciones agregan eventos, no reescriben ORIGEN.

## 5. Ámbito de numeración: acreditado y desconocido

| Origen | Acreditado en código/archivos | No acreditado / decisión comercial pendiente |
|---|---|---|
| Perfil HALEL | CB2 agrupa por hash de vale dentro de empresa/proveedor. C2B persiste evidencia histórica HALEL y busca claves previas por ese ámbito. | Qué proveedores/emisores reales usan este formato; reinicios por estación/año/serie; multilínea; titular legal del vale. |
| Perfil SHELL | CB2 reconoce perfil y reglas particulares de fórmulas; misma identidad candidata basada en vale. | No acredita unicidad mundial de Shell ni por estación/franquicia. Debe certificarse regla por proveedor legal concreto. |
| Otros proveedores/perfiles | No se certificó catálogo productivo ni una correspondencia completa de proveedor→perfil. | Inventario por empresa/proveedor y emisor; formatos no soportados requieren contrato nuevo, sin mapear por marca. |
| Libros septiembre/octubre | Vales/series/facturas sin repetición dentro de cada libro según fase 1. | No prueba numeración entre periodos, estaciones o archivos; no se certificó regla de emisor. |
| Fondo septiembre | Documento de fondo, sin contrato de vale de proveedor certificado. | No tratar entrega de fondo como consumo; pedir comprobante operativo y conciliación aprobada. |

Por cada proveedor real, expediente requerido: empresa y proveedor legal; emisor/estaciones; titular de la factura; definición de vale y sublíneas; regla de unicidad/reinicio; significado de serie (fiscal o del vale); normalización autorizada y ceros iniciales; ejemplos anonimizados de límites/reinicio; responsable y vigencia de la regla. Finanzas/operaciones aprueban; el proveedor acredita. Sin esto, estado `NO_CERTIFICADO`: mantener contrato conservador actual y enviar colisiones a revisión; no habilitar un espacio nuevo seleccionado por usuario.

No es posible identificar el ámbito comercial real de *cada proveedor productivo* solo con este repositorio y sin consultarlo. Esta limitación es un bloqueo explícito de D3, no un dato a completar mediante inferencia.

## 6. Idempotencia compatible

### 6.1 Tres identidades separadas

1. Operación de usuario: clave idempotente + empresa/proveedor + tipo de operación, ligada a digest y revisión. Misma clave/mismo comando devuelve resultado previo; misma clave/comando distinto devuelve conflicto. Commit incierto consulta/reintenta la misma clave.
2. Consumo: identidad del vale en espacio certificado. Mientras no exista certificación, protección empresa/proveedor/vale como contrato legado. Nunca placa, nombre, posición de fila, fecha/monto ni hash del archivo como única identidad.
3. Documento: empresa/proveedor/serie fiscal/número. Una factura puede contener varios consumos. Ausencia de documento no inventa identidad; datos contradictorios bloquean la asociación correspondiente.

Normalización v1 observada: NFC, trim, espacios internos colapsados y mayúsculas en `combustible-identificadores.ts`; preservar ceros iniciales y puntuación salvo contrato versionado aprobado. No convertir identificadores a números. Nuevo algoritmo debe guardar versión y correspondencia con claves antiguas; no regenerar payloads ni hashes originales.

### 6.2 Resolución antes de crear

Dentro de transacción y bloqueo de proveedor existente: reautorizar actor; validar contexto/identidades/revisiones; consultar CB2 por clave candidata y vale normalizado, verificar versiones, payload y selección original; consultar evidencia C2B en su ámbito; considerar vínculos C2C con vales internos antes de inferir elegibilidad. Para rutas nuevas sin proveedor bloqueable, se requiere mecanismo equivalente certificado; no reducir protección.

| Estado encontrado | Resultado contractual |
|---|---|
| Sin previos y datos completos/autorizados | Crear una vez, reservar identidad y guardar evento/evidencia. |
| CB2 previo único compatible según contrato v1 (payload, versiones, vehículo/documento) | Reutilizar ID y registrar aparición; ningún nuevo volumen/importe. No cambiar asignación como efecto lateral de reimportar. |
| CB2 previo con corrección de asignación o cambio de identidad | Revisión explícita contra originales y eventos; no “reparar” ni declarar equivalente automáticamente. Compatibilidad desconocida bloquea creación. |
| CB2 múltiple, payload o versión no certificable | Bloquear por conflicto; no escoger primer ID. |
| C2B previo con misma identidad candidata | Conservar bloqueo histórico actual. Mostrar evidencia autorizada y abrir expediente; no crear CB2 ni promover evidencia por sí sola. |
| C2B conciliado a vale interno | No crear segundo consumo económico; resolver expediente de correspondencia. No sumar C2B y vale como dos abastecimientos. |
| Vale interno previo sin correspondencia demostrable | Revisión de posible previo, sin crear por descarte automático. Implementar su búsqueda exige inventario y criterio certificado; no afirmar que CB2 ya cubre todos los escritores. |
| Nuevo espacio certificado que colisiona con vale legado | Bloquear hasta acreditar correspondencia/no correspondencia con el legado. Crear espacio nuevo no evade la barrera histórica. |

Una reserva única física de identidad deberá complementar el servicio, no reemplazar comparaciones ni FKs. Su diseño y migración son otro entregable, no SQL en este ticket documental. Antes de imponerla, detectar colisiones sin corregirlas. Empresa/proveedor siguen siendo barreras; cambio de entidad, perfil o alias de vehículo no crea otra identidad. Si hay varios IDs de proveedor para el mismo emisor, se requiere expediente de correspondencia aprobado antes de admitir una regla nueva; no fusionarlos por nombre.

La clasificación externa/empleado no altera identidad de consumo. Los payloads v1 se comparan con su contrato v1; no agregar nuevos campos y recalcular el hash histórico. Nuevos payloads son versionados. Consumir alias no permite reimportar el mismo vale con otro ID: si la selección difiere del original v1, usar revisión explícita, sin reinterpretar silenciosamente la igualdad vigente.

## 7. Estados visibles y confirmación

Separar `estadoEvidencia`, `elegibilidadConsumo` y `estadoDocumento`. Guardar evidencia no equivale a consumo; registrar consumo no equivale a pago. Propuesta sin confirmación parcial implícita: usuario selecciona candidatos elegibles; servidor rechaza atómicamente la selección si uno dejó de ser elegible. Filas no seleccionadas permanecen visibles con su razón. Habilitar confirmación parcial diferente exige contrato adicional.

| Estado de candidato | Permite confirmar consumo | Presentación |
|---|---|---|
| BLOQUEADO | No | Razón y acción requerida; no ocultarlo por filtros por defecto. |
| REVISION_REQUERIDA | No hasta resolver | Candidatos/evidencia y responsable; la resolución genera nueva revisión/preview. |
| ELEGIBLE_CON_ADVERTENCIA | Sí, si no hay bloqueos y usuario reconoce aviso | Aviso persistido, sin alterar importes u originales. |
| ELEGIBLE | Sí | Resumen de identidades, vale, importes y documento. |
| REUTILIZABLE | Solo vincular aparición al consumo existente | «No se creará otro consumo»; no sumar de nuevo. |
| IGNORADO_POR_FORMATO | No | Cabecera/total/nota con motivo estructural; jamás usarlo para esconder una fila inválida de operación. |

Contrato diagnóstico por campo/fila: código estable, severidad, bloqueaConsumo, bloqueaDocumento, mensaje, acción, hoja/fila/candidato y revisión. No transmitir IDs ajenos, rutas privadas ni texto HTML. Validación autoritativa del servidor; UI no interpreta severidad buscando palabras.

| Situación / código | Mensaje visible | Acción y efecto |
|---|---|---|
| Empleado sin coincidencia `EMPLEADO_NO_DISPONIBLE` | «No se encontró un empleado activo autorizado. Revise el nombre o clasifique al conductor como externo.» | Seleccionar empleado válido o externo verificado. Bloquea tipo EMPLEADO; no exige empleado ficticio. |
| Homónimos `CONDUCTOR_AMBIGUO` | «Hay varias personas que podrían corresponder. Seleccione y justifique la identidad correcta.» | Revisión; sin selección automática. |
| Sin dato `CONDUCTOR_NO_IDENTIFICADO` | «No hay información suficiente para identificar al conductor. La fila queda pendiente.» | Evidencia conservada; nuevo consumo bloqueado según D1. |
| Unidad no disponible `VEHICULO_NO_DISPONIBLE` | «No se encontró una unidad activa autorizada. Revise la placa o seleccione un vehículo externo validado.» | No revela si existe fuera del ámbito; bloquea tipo CATALOGO. |
| Placa ambigua `PLACA_AMBIGUA` | «La placa tiene varios candidatos autorizados. Revise los datos de la unidad antes de continuar.» | Elegir con evidencia/motivo; no fusionar unidades desde importación. |
| Abreviada `PLACA_INSUFICIENTE` | «La placa abreviada no identifica una unidad de forma única.» | Completar evidencia o resolver selección autorizada; no inventar prefijo. |
| Externo pendiente `EXTERNO_NO_VALIDADO` | «La identidad externa requiere validación de un revisor autorizado.» | Bloquea, muestra responsable y campos faltantes autorizados. |
| Duplicado compatible `VALE_REUTILIZABLE` | «El vale ya está registrado con los mismos datos. Se vinculará esta aparición sin crear otro consumo.» | Reutilizar con nuevo evento. |
| Conflicto `VALE_EN_CONFLICTO` | «El vale ya existe con datos incompatibles. Requiere revisión.» | Bloquear; diferencias solo dentro del ámbito autorizado. |
| Evidencia C2B `VALE_CON_HISTORICO` | «Existe evidencia histórica de este vale. Debe resolverse su correspondencia antes de crear un consumo.» | Expediente, sin promoción automática. |
| Documento incompleto `DOCUMENTO_PENDIENTE` | «Falta serie o factura. El consumo quedará pendiente de documentación.» | Advertencia; no bloquea consumo que cumpla las demás reglas actuales. |
| Documento incompatible `DOCUMENTO_EN_CONFLICTO` | «La documentación contradice una asociación existente.» | Bloquea asociación; si afecta candidato seleccionado, confirmar no salta el conflicto. |
| Importe/fecha/fórmula inválidos `DATO_INVALIDO` | «[Campo] no cumple [regla] en [hoja/fila]. Corrija el origen o solicite revisión.» | Bloquea; no autocorrección de importes ni confianza ciega en caché Excel. |
| Contexto cambiado `REVISION_CAMBIO` | «La selección cambió. Actualice la revisión antes de confirmar.» | Nuevo preview/token; respuesta anterior no cambia selección ni carga vigente. |

Kilometraje textual, mes distinto y diferencias de cálculo mantienen severidad aprobada del circuito actual; no establecer tolerancias nuevas en este documento. Resumen muestra cantidades por estado y total seleccionado, sin sumar reutilizaciones como consumos nuevos. No afirmar «importación correcta» si quedan filas bloqueadas.

## 8. Alias de vehículos sin tocar historia

Expediente propuesto: aliasId y canónicoId distintos, evidencia de misma identidad física, alcance por empresa usuaria/propietarios, estado/revisión y aprobación independiente. Ambos IDs deben existir; no aceptar ciclos, cadenas o varios canónicos vigentes por alias/ámbito. Propuesta simple: todo alias apunta a raíz que no es alias; bloquear operaciones concurrentes que violen esa regla.

El alcance no cambia propietario ni concede permisos. Revisor acredita VIN/chasis/documentos/periodos y resuelve contradicciones. Misma placa no basta. Si se trata de unidades físicas diferentes o una placa reasignada, no procede alias. #1301/#684 siguen sin canónico elegido: no existe inspección de datos físicos autorizada.

Al activar alias: conservar todos los registros y FKs, documentos, fondos, viajes, vales, consumos, lecturas y snapshots. Nuevas selecciones ofrecen raíz solo si está activa y autorizada; un usuario sin acceso a raíz no obtiene ese acceso mediante alias. Operaciones abiertas con alias quedan pendientes de revisión o mantienen contrato vigente según escritor; no reasignarlas silenciosamente. Si raíz no disponible, bloquear nuevas selecciones, sin hacer fallback a unidad equivocada.

Consultas históricas muestran ID/placa originales y agrupación canónica opcional. Resolver agrupación con acceso por registro original: jamás unir permisos o mostrar movimientos ajenos. Agregar cada consumo una vez por su ID; galones/importes por moneda/empresa no cambian. No intercalar odómetros ni concatenar mantenimiento como una sola serie sin evaluación específica. Eliminar físicamente un alias o raíz con historia no forma parte del contrato.

Reversión: desactivar mapeo con evento y revisión; no borrar expediente. Conservar relación vigente usada por cada nueva operación. Desactivar alias no revierte automáticamente operaciones posteriores; listar impacto para corrección autorizada. Cambio de canónico requiere nuevo expediente; nada de UPDATE masivo de FKs históricas.

## 9. Tickets independientes y criterios de aceptación

Los IDs siguientes son propuestas de trabajo, no issues creados ni autorización de ejecución. Cada ticket tendrá rama aislada, diff de alcance revisado y migraciones por separado si resultan necesarias.

### TMS-COMB-03 — Conductores y vehículos externos

Alcance: uniones de identidad, catálogo externo, verificación y selección explícita en CB2; lectura/exportación/totales compatibles; revisión de escritores staff/portal y habilitación solo de los expresamente cubiertos. Sin altas ficticias ni reclasificación automática de históricos. Depende de D1/D2/D4 aprobadas y de contrato de idempotencia común antes de permitir nuevas confirmaciones.

Aceptación: variantes mutuamente excluyentes; empleado/vehículo autorizados revalidados; externos no confirmables sin revisión independiente; nulos históricos legibles sin alteración; evidencia y evento atómicos; sin exposición entre empresas; totales incluyen externos; errores concretos; token inválido ante cambio de contexto. Ningún escritor antiguo puede registrar parcialmente un externo.

Fixtures sintéticos: empleado 11 empresa A y 22 empresa B; dos personas externas homónimas con IDs distintos; identidad pendiente e inactiva; unidad compartida y otra no autorizada; externo con placa/jurisdicción verificadas y otro sin evidencia. Probar las cuatro combinaciones de conductor identificado/vehículo, discriminantes inválidos, NO_IDENTIFICADO, conflicto de candidatos, permiso denegado incluso con UI manipulada, Admin sin autoaprobación, revisión concurrente, rollback por auditoría fallida y DOM fuera de orden. Todas las pruebas pendientes.

### TMS-COMB-04 — Idempotencia y validaciones de importación

Alcance: diagnósticos estructurados/estados, numeración certificada, correspondencias de identidades y reserva única; compatibilidad CB2 v1/C2B/vales internos; no reconstruir historia ni promocionar C2B. Depende de D3/D4 y expediente por proveedor. Sin cambiar tolerancias monetarias ni normalización antigua silenciosamente.

Aceptación: reimportación idéntica no duplica consumo; archivo distinto no evita controles; modificaciones de importe/fecha/placa generan conflicto; nueva serie fiscal no crea por sí sola otro vale; C2B previo bloquea hasta resolver; versión desconocida bloquea; alias y entidad no permiten duplicación; dos transacciones terminan con un consumo; reintento de commit incierto recupera misma operación; datos originales/hashes se conservan; cada fila explica su estado. No migrar UNIQUE hasta demostrar compatibilidad con datos existentes en copia autorizada.

Fixtures: vale textual `000123`, otro `123` no equivalente por conversión numérica; varias cargas de una placa; mismo vale en dos archivos; factura con tres vales; serie ausente; reinicio de vale en espacio certificado y colisión con legado no clasificado; mismo emisor con dos IDs de proveedor; C2B con/sin vínculo C2C; consumo corregido por asignación; payload versión desconocida; dos confirmaciones concurrentes y misma clave con digest distinto; archivos de 325/344 filas sintéticas con fórmulas compartidas válidas/no admitidas. MariaDB desechable, sin credenciales ni red productiva. Todas las pruebas pendientes.

### TMS-COMB-05 — Consolidación lógica de vehículos

Alcance: expediente/aprobación y alias; selector canónico autorizado; consulta agrupada sin cambiar IDs/FKs ni historia. Sin DELETE de unidades, fondos, consumos, documentos o lecturas. Depende de D5 y auditoría de escritores/permisos compartidos. Aplicación a casos reales exige autorización distinta del desarrollo.

Aceptación: dos IDs de misma placa no se fusionan automáticamente; VIN contradictorio detiene; raíces/alias sin ciclos ni cadenas; permisos no se unen; operaciones nuevas guardan resolución y originales; históricos y snapshots byte a byte intactos; mismos conteos/sumas por ámbito; agrupación cuenta una vez cada consumo; revisión concurrente falla sin efecto parcial; reversión lógica auditable conserva operaciones posteriores.

Fixtures: IDs 101/202 misma placa con VIN coincidente y expediente válido; IDs 303/404 placa igual y VIN distinto; alias entre propietarios con acceso compartido limitado; raíz inactiva; fondos con FK restrictiva y multas con FK compuesta; lecturas de odómetro incompatibles; ciclo directo/indirecto y dos aprobaciones concurrentes; desactivación posterior con movimientos nuevos. Comparar referencias, snapshots, conteos y sumas antes/después en laboratorio aislado. Todas las pruebas pendientes.

## 10. Puerta de aprobación y evidencia de este trabajo

Orden propuesto: aprobar contratos y decisiones → inventario autorizado en copia/laboratorio y expedientes de proveedor → diseñar migraciones aditivas y reserva de identidad → implementar tickets con flags/escritores coordinados → ensayar restauración/compatibilidad → solicitar autorización operativa separada. No habilitar externos antes de que la idempotencia común los cubra; no desplegar mezcla de escritores que conozcan reglas incompatibles.

Revisión realizada: HEAD y limpieza de rama; lectura estática de `cb2/model.ts`, `cb2/service.ts`, `cb2/empleados-validacion.ts`, `combustible-importacion-v2.ts`, `combustible-importaciones.ts`, `combustible-identificadores.ts` y `combustible-permisos.ts`, además del informe base. No se volvieron a inspeccionar Excel ni se consultó catálogo productivo. Las cifras de libros se citan del informe aprobado, sin nuevas afirmaciones de numeración real.

No se ejecutaron pruebas funcionales, TypeScript, ESLint, build o SQL: cambio exclusivamente documental. Matrices y criterios son propuestas pendientes de implementación/ejecución, no resultados PASS. El único cambio previsto es agregar este documento; informe base y todos los archivos existentes deben permanecer idénticos al commit auditado.

Entrega de revisión: diff del nuevo documento respecto a `8714d01407a637ddefb35b7dbfab1e2c68e40bce`, sin commit/push. La implementación, regularización de datos y cualquier cambio productivo siguen sin autorización. Detenerse para auditoría independiente de ChatGPT.
