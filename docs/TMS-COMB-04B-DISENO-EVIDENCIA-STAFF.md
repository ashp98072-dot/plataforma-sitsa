# TMS-COMB-04B — Diseño acotado de conservación de evidencia staff

Fecha: 2026-11-11. Estado: **PROPUESTA PARA AUDITORÍA; NO IMPLEMENTADA**.

## Trazabilidad y alcance

Rama de preparación: `feature/tms-comb04-idempotencia-vales`. HEAD verificado y worktree inicialmente limpio: `2eaa77e094170468fe63a53e68b176060454cc62`.

TMS-COMB-04A queda cerrado como **caracterización experimental de pruebas/documentación**. Sus 66 PASS se aceptan como resultados con mocks, no como certificación de MariaDB real. Este diseño deriva de R3 y del rollback fallido documentados en `TMS-COMB-04-AUDITORIA-Y-ALCANCE.md`; ambos son defectos, no políticas aceptadas.

La eventual corrección se limitaría al control de errores, estado transaccional, disposición de conexión y compensación de evidencia NUEVA en `guardarCombustibleStaff`, más pruebas y documentación. No cambia SQL, validación, normalización, deduplicación, permisos, datos de entrada/salida ni entidades. Requiere nueva autorización antes de modificar `combustible-staff.ts` o sus pruebas.

En esta entrega se añade solo este documento. No se modifica staff, CB2, C2B, C2C, endpoints, UI, contratos, SQL ni dependencias; no se ejecutan pruebas DB ni consultas. La autorización posterior permite exclusivamente un commit documental y push normal para auditoría. Sin PR, merge o despliegue. No se incorpora PR #582; main y PR #581 quedan intactos. D1–D5 continúan **NO APROBADAS**.

## Problema observado

`src/lib/flota/combustible-staff.ts` marca `committed=true` solo después de que `await conn.commit()` resuelve. Su finally elimina la evidencia nueva siempre que ese booleano siga falso. Una respuesta perdida puede dejar el COMMIT aplicado y aun así solicitar el borrado de un archivo referenciado por el vale. El catch actual hace `await conn.rollback()` sin protegerlo: si también falla, sustituye el error original.

El adaptador HTTP vigente propaga errores de dominio con su status y convierte errores genéricos en 500. Esta propuesta conserva esa clasificación; no introduce códigos HTTP, flags públicos de certeza ni mensajes de recuperación nuevos. Por tanto el cliente seguirá sin poder distinguir con precisión un resultado incierto: es una limitación explícita, no una garantía de reintento seguro.

`borrarUpload` en `src/lib/uploads.ts` absorbe internamente sus excepciones. Que retorne no demuestra eliminación física. No se propone cambiar ese helper compartido. Las pruebas de compensación deben distinguir “se solicitó borrar” de “archivo eliminado”.

## Estados propuestos: dos ejes independientes

Evitar un único booleano “no committed = seguro para borrar”. Usar estado local explícito, sin persistirlo ni exponerlo como contrato:

| Eje | Estados | Significado |
|---|---|---|
| Transacción / COMMIT | NO_INICIADA, INICIO_EN_CURSO, ABIERTA, COMMIT_INTENTADO, COMMIT_CONFIRMADO | Marcar INICIO_EN_CURSO antes de esperar beginTransaction; ABIERTA solo tras su respuesta. Marcar COMMIT_INTENTADO inmediatamente ANTES de invocar commit; CONFIRMADO solo tras su resolución. |
| Rollback | NO_INTENTADO, INTENTADO, CONFIRMADO, FALLIDO | No inferir resultado a partir de “se llamó rollback”. Marcar confirmado solo si resuelve. Un rollback fallido nunca autoriza borrar. |
| Resultado derivado | ERROR_PRECOMMIT, COMMIT_CONFIRMADO, COMMIT_DESCONOCIDO, INICIO_DESCONOCIDO | El error de commit deja COMMIT_DESCONOCIDO aunque un rollback posterior resuelva. Un fallo de inicio no prueba que la conexión quedó limpia. |

ROLLBACK_FALLIDO se conserva como condición independiente: puede acompañar ERROR_PRECOMMIT o COMMIT_DESCONOCIDO. No colapsar esos casos en un error de negocio ni afirmar que “rollback fallido” significa “COMMIT aplicado”.

## Invariantes de la corrección propuesta

1. **Después de cualquier intento de COMMIT sin confirmación, conservar evidencia nueva y anterior.** Un timeout, desconexión, rechazo síncrono de commit o error del driver se tratará conservadoramente como desconocido, sin clasificar códigos particulares como “no aplicado”.
2. **Rollback fallido implica conservar evidencia y descartar la conexión.** No reutilizarla ni concluir ausencia de referencias.
3. **Compensar automáticamente solo con prueba positiva de aborto previo al COMMIT:** transacción abierta, COMMIT nunca intentado, rollback confirmado, upload nuevo de esta invocación y ruta validada. No basta con `!committed`.
4. **La evidencia anterior jamás es candidata a compensación**, aun al reemplazarla o cuando se confirme COMMIT. No borrar snapshots ni registros históricos.
5. **Conservar exactamente el error original**, incluido el mismo objeto/valor rechazado. Rollback, disposición de conexión, validación de ruta, compensación o diagnóstico no deben sustituirlo. No mutar un error ajeno para añadir campos; no hacer una auditoría SQL secundaria.
6. **Sin reintento automático de escrituras, commit ni operación completa.** No existe clave durable de solicitud staff que haga seguro ese reintento.
7. **Solo una disposición terminal de la conexión:** release para estado limpio demostrado; destroy para estado incierto. No llamar ambos de manera normal ni devolver al pool una conexión después de destruirla.

La compensación presupone que el upload devuelve una ruta nueva exclusiva de esta llamada, dentro de la empresa y no igual a la anterior. Verificar esa precondición en revisión/pruebas antes de autorizar borrado. Si no puede establecerse, conservar. Una ruta válida de la empresa por sí sola no demuestra que sea exclusiva ni no referenciada. No añadir búsquedas SQL para intentar demostrar ausencia de referencias.

## Flujo de manejo de errores propuesto

1. Mantener validaciones y adquisición de conexión vigentes. Si getConnection falla, propagar su error sin rollback, release, destroy ni compensación de una conexión inexistente.
2. Registrar los estados locales antes/después de beginTransaction y commit. Mantener el cuerpo de consultas, uploads y auditoría de negocio sin cambios.
3. Ante error previo a COMMIT con transacción abierta: guardar la referencia al error original; intentar rollback en un bloque protegido. Si resuelve, habilitar compensación solo bajo las precondiciones anteriores y release; si falla, conservar archivo y destroy.
4. Ante error en beginTransaction: no hay upload completado por el flujo vigente; tratar la conexión como incierta y destruirla. No afirmar que hubo rollback ni intentar borrar rutas desconocidas.
5. Ante error de COMMIT: guardar el error original y mantener resultado desconocido para siempre en esta invocación. Se puede intentar rollback una sola vez como mejor esfuerzo; su éxito NO cambia la clasificación ni habilita compensación. Destruir la conexión y conservar archivo.
6. Ante COMMIT confirmado: conservar evidencia, devolver el mismo cargaId. No iniciar rollback por fallos posteriores de release/diagnóstico. Proteger la disposición para que una excepción de mantenimiento no transforme una confirmación en un falso error de operación; si release falla, intentar destroy como contingencia protegida y registrar incertidumbre de disposición, no de COMMIT.
7. Ejecutar compensación y disposición en bloques separados y protegidos: el fallo de uno no impide intentar el otro ni sustituye el resultado principal. Si destroy también falla, no hacer release como fallback: registrar que no se pudo demostrar la disposición. No prometer que el socket quedó cerrado.

El punto 6 trata destroy tras release fallido como contingencia excepcional, no como doble disposición rutinaria. No volver a disponer una conexión cuyo release ya terminó correctamente. Los diagnósticos serán de mejor esfuerzo, sin lanzar, con etapa y clasificación saneadas; nunca SQL, secretos, archivos completos o payloads del vale. Podrán incluir identificador interno/ruta relativa de evidencia solo en registro interno restringido y bajo la política vigente. No crear en 04B un nuevo almacén persistente, endpoint o formato público de recuperación.

## Matriz de escenarios y resultado esperado

| Escenario | COMMIT / rollback observados | Archivo nuevo | Conexión | Resultado hacia caller |
|---|---|---|---|---|
| Validación falla antes de adquirir conexión | Ninguno | No existe | Ninguna | Error original |
| Adquisición falla | Ninguno | No existe | Ninguna adquirida | Error original |
| beginTransaction falla | Inicio incierto, sin COMMIT | No existe en flujo vigente | Destroy protegido | Error original |
| Upload falla sin devolver ruta | Sin COMMIT; rollback confirmado | No hay ruta certificada; no adivinar ni borrar parciales | Release | Error original del upload |
| INSERT/UPDATE/auditoría falla; rollback confirmado | Error previo, sin intento COMMIT | Compensación solo si nuevo/exclusivo/ruta válida | Release | Mismo error original |
| Mismo fallo; rollback falla | Error previo + rollback fallido | Conservar | Destroy | Error original de INSERT/UPDATE/auditoría; rollback secundario |
| COMMIT resuelve | Confirmado, sin rollback | Conservar | Release protegido | cargaId original |
| COMMIT falla; rollback resuelve | COMMIT desconocido | Conservar, incluso si el mock dice “no aplicado” | Destroy | Mismo error de COMMIT; no retorno de éxito |
| COMMIT falla; rollback falla | COMMIT desconocido + rollback fallido | Conservar | Destroy | Mismo error de COMMIT; rollback secundario |
| Rollback confirmado previo; ruta inválida, no exclusiva o igual a anterior | Sin COMMIT | Conservar | Release | Error original |
| Compensación arroja excepción en un doble | Sin COMMIT; rollback confirmado | No asegurar eliminación | Release igualmente intentado | Error original; fallo secundario |
| Release falla tras COMMIT confirmado | Confirmado | Conservar | Intentar destroy protegido | cargaId, sin rollback ni segunda escritura |
| Release/destroy/diagnóstico falla durante manejo de error | Clasificación principal inmutable | Conservar salvo compensación ya autorizada/intencionada | No afirmar disposición exitosa | Error original inmutable |
| Edición sin archivo nuevo | Cualquier resultado | Sin compensación posible; anterior intacta | Según estados anteriores | Resultado/error principal |
| Proceso/SO cae antes de finalizar | Sin respuesta suficiente | No se puede garantizar ejecución de finally ni limpieza | Fuera del control de la llamada | Sin certeza inventada; revisión posterior |

## Pruebas de regresión propuestas, aún no implementadas

Todas las pruebas de la primera implementación serían unitarias con mocks completos de DB, uploads, auditoría y diagnóstico. Ningún test abre conexiones, toca archivos subidos reales, carga .env efectivo o ejecuta SQL en un motor.

- COMMIT confirmado en alta/edición: devuelve mismo ID; evidencia conservada; cero rollback; release una vez.
- Fallo previo en INSERT, UPDATE y auditoría: sin intento de commit; rollback confirmado; compensación solo de ruta nueva propia; error rechazado por identidad (`toBe(errorOriginal)`), no solo por mensaje.
- COMMIT con respuesta perdida, mock aplicado/no aplicado × rollback resuelto/fallido: conservar siempre ambas evidencias; no reutilizar conexión; error de commit original, sin reintento. Son cuatro escenarios distintos, no pruebas de durabilidad real.
- Error previo × rollback fallido: conservar evidencia, destroy y preservar error original; verificar que un rollback secundario no se vuelve el error principal.
- Ruta ajena, igual a anterior o exclusividad no demostrada; edición sin upload; upload que rechaza sin ruta: no borrar por conjetura. No recorrer ni limpiar directorios.
- Fallos inyectados de release, destroy, validación de ruta, compensación y diagnóstico: resultado principal estable; cada acción posterior permitida se intenta; nunca release después de destroy ni rollback tras COMMIT confirmado.
- Rechazo de beginTransaction/getConnection; no acceder a variables/recursos no inicializados. Clasificación conservadora, sin archivo ficticio.
- Regresiones vigentes de captura, catálogos, campos omitidos, tenant y duplicado preventivo: mismas validaciones, consultas, parámetros y resultados de negocio. No cambiar normalización, deduplicación o política de históricos para resolver una prueba.

Las pruebas 04A que describen explícitamente los defectos deberán revisarse de forma deliberada en el futuro commit correctivo: conservar el SHA publicado y la documentación como evidencia de comportamiento anterior, y sustituir las expectativas afectadas por la regresión deseada. No conservar en la suite activa una obligación de borrar tras COMMIT incierto ni de ocultar el error original. No suprimirlas ni volverlas SKIP en silencio. El conteo 66 corresponde al SHA auditado; la implementación futura deberá informar el nuevo conteo y cada expectativa cambiada. Hoy no se cambia ninguna prueba.

Aceptación futura: Vitest focal de captura/evidencia y regresiones afectadas, TypeScript, ESLint focal y diff --check; revisión del diff que demuestre ausencia de cambios de SQL/negocio/contratos. No se declara PASS de estas pruebas propuestas ni se ejecuta suite alguna en esta entrega documental.

## Recuperación y riesgos residuales

- Conservar una evidencia puede dejar un archivo huérfano, pero evita borrarlo cuando podría estar referenciado. No crear GC, TTL, limpieza por edad ni tarea de borrado automático en este incremento.
- No consultar posteriormente una fila ausente y concluir que nunca existió COMMIT: visibilidad, réplica, rollback y pérdida de respuesta impiden esa inferencia sin un protocolo adicional. El número de vale y la deduplicación preventiva no son un recibo idempotente durable.
- Un resultado desconocido no autoriza repetir alta ni editar automáticamente el mismo vale. Una revisión posterior requerirá autorización separada, observaciones consistentes de registros/evidencia y una decisión humana; este diseño no ejecuta esa recuperación.
- El mismo error original conserva compatibilidad del caller pero limita la señal pública de incertidumbre. Si se requiere distinguirla en UI/HTTP, será otra fase con contrato explícito; no ampliar 04B para ello.
- Fallo de rollback no demuestra persistencia ni ausencia de referencias; fallo de destroy no demuestra cierre. La propuesta solo controla intentos y decisiones del servicio.
- Mocks no prueban aislamiento, atomicidad, escritura durable, cierre real del socket, semántica del pool o comportamiento de COMMIT/rollback de MariaDB. Validación futura con motor desechable y fallos de transporte requiere autorización explícita; no usar producción ni afirmar que los escenarios artificiales certifican el motor.
- Caídas de proceso durante upload/COMMIT y archivos parciales sin ruta retornada requieren un diseño de recuperación separado. No introducir aquí inventarios históricos ni cambios de uploads compartidos.

## Condición de cierre de esta entrega

Se entrega solo el diseño para auditoría independiente de ChatGPT. R3 y rollback fallido siguen sin corregir y no aceptados. Antes de implementar deben aprobarse la regla de compensación estricta, la preservación del error original, la disposición conservadora de conexión y los límites de compatibilidad/recuperación descritos. **No se implementa 04B. Se autoriza únicamente la publicación documental y se detiene el trabajo después del push.**
