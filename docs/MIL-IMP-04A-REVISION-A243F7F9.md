# MIL-IMP-04A — revisión de observaciones de auditoría

Base revisada: `a243f7f9b250bbba81ebf4ca90f9276114c84222`, rama `feature/mil-imp04a-vencimiento-congelado`. Cambios locales para una nueva auditoría; sin commit, push, PR, merge ni despliegue en esta revisión. No se modifica MIL-IMP-04B, main, otros worktrees ni políticas de reverso contable.

## 1. Emisión y compatibilidad histórica

Defecto confirmado en el commit auditado: `congelarVencimientoTx` retornaba sin escribir cuando `propuesta` clasificaba el borrador como indeterminado. No distinguía una lectura de una transición nueva. Ahora rechaza esa emisión con 409 antes del UPDATE de factura. Toda transición Borrador→Emitida, incluso de un borrador antiguo, exige ámbito, condición explícita y snapshot confirmado; esquema FACT-4 parcial sigue devolviendo 503. La vista previa puede informar falta de datos, pero su token no concede una excepción. No hay fecha de corte inventada ni parámetro para eludir la validación.

Escritores revisados: `facturas.ts crearFactura/actualizarFacturaBorrador` todavía admiten payload anterior a FACT-4; `resolverContextoFact4` exige condición con líneas y puede resolver entidad mediante banco. La ruta POST de facturas admite campos opcionales de contexto y llama `resolverEntradaFact4`. La única llamada operativa encontrada a `emitirFactura` es la ruta `facturas/[id]/emitir`; el bloqueo vive en el servicio, por lo que también protege llamadores internos futuros. No se modifica la captura/edición antigua ni se infieren datos para completarla.

Impacto explícito: los borradores incompletos dejan de poder emitirse; deben completar contexto mediante edición ya existente y obtener perfil aprobado si son a crédito. Un esquema anterior a FACT-4 requiere preparación autorizada antes de emitir con esta versión. No se migran emitidas ni se calcula su vencimiento con el perfil actual. Lectura histórica y `leerVencimiento` siguen devolviendo indeterminado. Esta restricción debe revisarse funcionalmente antes de habilitar; no convierte un borrador antiguo en factura histórica emitida ni autoriza backfill.

Evidencia: `credito-compat.test.ts` cubre condición nula/vacía/no reconocida, ausencia total/parcial de FACT-4 y ámbito. `credito.db.test.ts` demuestra que el borrador sin entidad permanece Borrador sin snapshot tras rechazo, mientras la histórica emitida no recibe backfill.

## 2. UI y concurrencia

`credito-factura.tsx` invalida solicitudes al cambiar factura, cliente, entidad, fecha o fase, y descarta respuestas tardías de preview/guardado. Una respuesta de autorización solo habilita el formulario para la URL de perfil que la obtuvo. 403 de consulta oculta administración; otros errores de perfil se muestran. Se conserva la autoridad del servidor: el cambio concurrente de perfil invalida el token y la emisión devuelve conflicto.

`credito-factura.dom.test.ts`, happy-dom y React reales, fetch sintético: administración y aprobación con revisión observada; guardado 200/403/409/503; preview 403/409/503; cambio de fecha con respuesta tardía. Incluye `FacturasPanel` real para revisión→token→emisión 200/403/409/503, conservando formulario/error en rechazo. El laboratorio conserva prueba de cambio de perfil entre preview y emisión. No es un E2E de navegador conectado a un backend ni acredita QA visual.

## 3. Permisos y Admin

Búsqueda de referencias a `guardarPerfilCredito`: único adaptador operativo `credito-http.ts perfilCreditoHttp`, consumido por GET/PUT de clientes/[id]/credito. Ambos exigen tenant y lectura de facturación, más acción `administrar_credito`, fila `facturacion_credito.puedeVer`. Para Admin consulta `listarPermisosUsuario`, sin concesión implícita por rol. Otros usuarios usan `permisosEfectivos`; los defaults de todos los roles carecen de esta capacidad. El flag puedeVer es el contrato existente de esa acción granular, no el permiso general de consulta de facturas.

GET/POST de vencimiento no escriben perfiles: GET consulta snapshot y POST previsualiza con permiso emitir y contrato estricto. Emisión congela la regla aprobada; no administra el perfil. Las rutas reales GET/PUT sin grant devuelven 403 sin llamar al escritor; Admin con grant explícito es aceptado. No se conceden permisos ni se alteran usuarios. Es responsabilidad de autorización futura decidir a quién conceder la capacidad combinada de administrar/aprobar; este ticket no implementa doble aprobación segregada.

## 4. Reproducción limpia

Se extrajo `git archive a243f7f9` en una carpeta temporal sin .env ni credenciales y se copiaron solo archivos de revisión del ticket. `npm ci --no-audit --no-fund` terminó con salida 0, 533 paquetes. Lockfile idéntico byte a byte al del worktree; package.json/lockfile sin modificaciones. npm informó deprecaciones y un postinstall no aprobado de unrs-resolver; no se aprobó ni ejecutó manualmente. No se cambiaron versiones para obtener verde.

Los 15 TS2307 anteriores por fake-indexeddb desaparecen con las dependencias completas del lockfile: TypeScript global pasa. Diagnóstico confirmado de instalación compartida incompleta, sin atribuir esos errores a la lógica del ticket. npm.ps1 fue bloqueado por ExecutionPolicy al primer intento de build; se usó npm.cmd, sin cambiar la política del sistema. Build completo pasó; sin servidor web ni conexión productiva. No se reclama PASS integral de todas las suites del repositorio.

## 5. CxC: aislamiento, consistencia y coste

`listarDocumentosCxc` pasa empresa, entidad e IDs de la página a `leerVencimientos`; SQL ahora filtra explícitamente ambos ámbitos. No hay consulta extra si la página está vacía. Paginación existente: máximo 100 filas; una consulta por página, sin N+1. No agrega importes ni consulta perfil vivo.

La ampliación solo añade un atributo inmutable: el snapshot se confirma atómicamente con el paso a Emitida y no se crea posteriormente para emitidas históricas; UPDATE/DELETE se rechazan. Las filas que la consulta base ya observó como Emitida/Anulada no pueden adquirir un vencimiento posterior por un camino del ticket. Una emisión concurrente no incorpora filas nuevas al resultado base ya obtenido. Por eso la segunda consulta no mezcla fechas recalculadas ni un corte de saldo nuevo. No corrige ni promete atomicidad de las múltiples consultas de importes del reporte previo; eso permanece fuera de 04A y no se denomina saldo histórico.

Prueba sintética: 1003 snapshots del mismo libro; búsqueda de 3 IDs, EXPLAIN range por PRIMARY, estimación 3 filas, alrededor de 1 ms en esta ejecución local. Otras empresa/entidad devuelven mapa vacío. No demuestra latencia productiva, rendimiento de metadatos por emisión ni consistencia frente a escritores externos que violen el contrato. Evidencia `explain-cxc-volumen.json`; no se añaden índices nuevos.

## 6. SQL

Scripts de propuesta sin cambios: ninguna ejecución Hostinger. Laboratorio MariaDB 11.8.9 propio con datadir nuevo, pipe aleatorio, TCP deshabilitado e identidad verificada; apagado al terminar. Padres sintéticos con tipos/ámbitos/columnas de los contratos utilizados; no copia completa del esquema desplegado ni certificación de su estado real.

Pruebas reales: CLEAN→FINAL y reaplicación, falta de snapshot histórico, FKs cruzadas, inmutabilidad, rollback de datos/auditoría y emisión concurrente. Se añaden variantes de columna nullable, orden divergente de índice compuesto, FK ausente y cuerpo de trigger divergente: detectadas como DIVERGENTE. Una interrupción simulada con un DDL confirmado (retirar trigger) y posterior DDL inválido conserva estado parcial; migración rechaza continuar y los snapshots permanecen. Se restaura únicamente el fixture de laboratorio. No se afirma rollback transaccional del DDL ni reparación automática. La recuperación real requiere revisión DBA autorizada.

## 7. Resultados y límites

| Ejecución | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Revisión final pura/HTTP/compatibilidad/componentes | 44 | 0 | 0 |
| Regresión seleccionada de facturas/cobros/CxC/DOM de borradores y compras | 208 | 0 | 0 |
| Motor sintético, ejecución final | 11 | 0 | 0 |

TypeScript global, build completo y ESLint verificados en entorno desechable. No se ejecutó suite global completa ni navegador E2E, integración productiva ni migraciones reales. Resultados previos de este ticket no se suman de nuevo a estos conteos. Las comprobaciones instrumentales intermedias se conservan separadas: bloqueo de npm.ps1 y colisión de salida de log al solapar TypeScript no son fallos de aserciones; se usaron npm.cmd y logs separados.

Artefactos locales de revisión: `artifacts/mil-imp04a/revision-a243f7f9/`, con resultados JSON/logs finales, EXPLAIN, manifest de hashes y `MIL-IMP-04A-REVISION.diff` respecto a a243f7f9. No se publican ni se incluyen secretos, .env o datadirs. Los paths temporales internos de logs son evidencia de entorno, no datos reales.

Decisiones/riesgos restantes: aprobar el bloqueo de emisiones incompletas y preparar los escritores/despliegue antes de habilitar; concesiones humanas del permiso; validación autorizada del esquema efectivo; coste con volumen y concurrencia representativos; QA visual/E2E si se requiere. La auditoría debe evaluar estas condiciones. No se concede aprobación operativa ni se implementa cartera al corte 04B. Trabajo detenido para nueva auditoría, sin commit ni publicación de esta revisión.

## 8. Inventario exacto de los nueve archivos de revisión

Comparación contra `a243f7f9b250bbba81ebf4ca90f9276114c84222`, no contra una rama distinta. Los artefactos de evidencia no se cuentan como archivos de producto del ticket.

| Estado | Ruta exacta | Cambio |
| --- | --- | --- |
| Modificado | `docs/MIL-IMP-04A-IMPLEMENTACION.md` | Aclara la compatibilidad revisada y remite a este informe |
| Nuevo | `docs/MIL-IMP-04A-REVISION-A243F7F9.md` | Informe completo de revisión y entrega para segunda auditoría |
| Modificado | `src/components/facturacion/credito-factura.tsx` | Invalida respuestas tardías y limita autorización a la URL consultada; muestra errores de perfil |
| Nuevo | `src/components/facturacion/credito-factura.dom.test.ts` | 13 casos de componentes con React/happy-dom y HTTP simulado |
| Modificado | `src/lib/contabilidad/cxc/cxc.ts` | Pasa entidad explícita a la lectura por lote |
| Modificado | `src/lib/facturacion/credito.ts` | Bloquea emisión indeterminada, informa bloqueo en preview y filtra empresa/entidad en lote |
| Modificado | `src/lib/facturacion/credito-compat.test.ts` | 8 casos: compatibilidad de lectura, bloqueo de nueva escritura y lote vacío |
| Modificado | `src/lib/facturacion/credito-http.test.ts` | 7 casos, incluidas rutas reales y Admin con/sin concesión |
| Modificado | `src/lib/facturacion/credito.db.test.ts` | 11 casos de motor: bloqueo, aislamiento, esquema divergente, DDL parcial y coste |

El diff entregado contiene los siete archivos rastreados modificados y los dos nuevos completos. No incluye `package.json`, lockfile, SQL, catálogo de permisos, otros worktrees ni archivos de PriceSmart. `manifest.json` conserva SHA256 de cada uno de estos nueve archivos; su hash se actualiza al ampliar este documento.

## 9. Pruebas originales frente a las 263 PASS actuales

Las cifras son conjuntos distintos, no una pérdida de nueve pruebas ni un aumento neto sobre una suite idéntica. No se suman 279+263 ni se presenta una suite global ejecutada.

| Conjunto | Original a243f7f9 | Revisión local |
| --- | ---: | ---: |
| Regresión focal original, 16 archivos | 272 PASS | No se repitió íntegramente esa selección de 16 archivos |
| Revisión pura/HTTP/compatibilidad/componentes, 4 archivos | Sin conjunto idéntico original | 44 PASS |
| Regresión seleccionada, 7 archivos, incluidas tres suites DOM | Sin conjunto idéntico original | 208 PASS |
| Motor `credito.db.test.ts` | 7 PASS | 11 PASS |
| Total de las ejecuciones indicadas para cada etapa | 279 PASS | 263 PASS |

Desglose verificable de los 44: `credito-factura.dom.test.ts` 13, `credito-compat.test.ts` 8, `credito-http.test.ts` 7 y `vencimiento.test.ts` 16. Los últimos tres tenían originalmente 3, 4 y 16 casos respectivamente; los 13 casos DOM son nuevos. El motor conserva siete escenarios, modifica la expectativa insegura de emisión sin entidad y añade cuatro escenarios (lote aislado, divergencias estructurales, DDL parcial y volumen).

Desglose de los 208: `borradores/autoguardado.dom.test.ts` 26, `borradores/salida-borradores.dom.test.ts` 28, `compras/requerimiento-autoguardado.dom.test.ts` 31, `antiguedad-cxc-rutas.test.ts` 15, `cobros.test.ts` 29, `facturas.test.ts` 65 y `contabilidad/cxc/cxc-ui.test.ts` 14. Los tres archivos DOM (85 casos) no estaban en la selección original; cuatro archivos (123 casos) sí estaban. Otros archivos de la selección original no se repitieron en esta revisión; su PASS anterior no se traslada como resultado nuevo. Las tres ejecuciones finales son disjuntas por archivo: 44+208+11=263, FAIL 0 y SKIP 0.

Clasificación: resultados nuevos aprobados en las selecciones indicadas; 15 TS2307 anteriores resueltos por instalación completa; bloqueo inicial de npm.ps1 y colisión de log son incidencias instrumentales, no aserciones fallidas. Suites no seleccionadas y navegador E2E permanecen NO EJECUTADOS, no PASS ni SKIP ficticio.

## 10. Matriz de emisión y distinción temporal

| Documento/contexto | Resultado al intentar emitir |
| --- | --- |
| Borrador CONTADO con empresa/entidad/cliente válidos, esquema FINAL y token vigente | Snapshot con 0 días, vencimiento igual a fecha de emisión; no exige perfil de crédito |
| Borrador CREDITO con perfil explícito aprobado y token compatible | Snapshot del plazo/revisión del perfil; fecha base emisión, días calendario; transacción única con factura/auditoría |
| CREDITO sin perfil aprobado, token ausente/vencido o perfil cambiado | 409; permanece Borrador, sin snapshot confirmado |
| Borrador con entidad NULL o condición NULL/vacía/no reconocida | Vista previa informa bloqueo; al emitir 409, sin excepción silenciosa |
| Borrador de esquema totalmente anterior a FACT-4 | Vista previa indeterminada, emisión bloqueada con 409; no inventa contexto |
| Esquema FACT-4 parcial o contrato MIL04A CLEAN/DIVERGENTE con contexto explícito | 503; no se crea ni repara esquema desde el servicio |
| Histórica ya Emitida o Anulada sin snapshot | Consulta conserva vencimiento indeterminado; no backfill ni consulta de perfil para reconstruirla |
| Cualquier factura que ya no esté Borrador | El flujo existente no realiza otra emisión; no agrega un snapshot por reintento |

La **nueva emisión se identifica por la transición de estado**, no por edad o fecha de creación. Todo intento actual de pasar de Borrador a Emitida es una nueva escritura, aunque el borrador tenga años. No existe clasificación automática por timestamp ni exención de «borrador histórico». Una histórica ya emitida solo se consulta. El rechazo por falta de permiso proviene del guard HTTP (403); los conflictos de reglas son 409 y los contratos de esquema pendientes/divergentes 503. No se modifica el significado fiscal de emisión ni se implementa FEL.

## 11. Evidencia específica de interfaz

Los títulos y estados están en `revision-final.json`, archivo `src/components/facturacion/credito-factura.dom.test.ts`:

| Casos | Aserciones y límite de evidencia |
| --- | --- |
| Consulta de perfil 403 (1) | No aparece Guardar perfil; preview de emisión autorizado sigue disponible y devuelve token |
| Preview 403/409/503 (3) | Mensaje exacto en role=alert y último callback de token undefined |
| Guardar perfil 200/403/409/503 (4) | Payload conserva revisión observada, días y aprobación; éxito muestra Perfil guardado, rechazo muestra error; invalida token |
| Respuesta de preview tardía (1) | Cambiar fecha y resolver la solicitud anterior no devuelve token obsoleto ni muestra confirmación anterior |
| Panel real: emisión 200/403/409/503 (4) | Revisa preview, envía token en POST /emitir; éxito muestra Emitida; rechazo muestra error y mantiene confirmación |

Estos 13 casos simulan fetch; no prueban el transporte contra un servidor real. La invalidación real por cambio de revisión entre preview/emisión se prueba por separado con servicios y motor SQL en `credito.db.test.ts`. No se confunde un mock 409 de UI con evidencia de concurrencia SQL.

## 12. Comandos, evidencia y cambios de autoridad/esquema

Directorio de evidencia: `artifacts/mil-imp04a/revision-a243f7f9/`.

| Verificación realizada | Comando | Evidencia conservada / resultado |
| --- | --- | --- |
| Dependencias de la copia temporal | `npm ci --no-audit --no-fund` | `npm-ci.log`, 533 paquetes, salida observada 0; lockfile idéntico, sin instalaciones en el worktree |
| TypeScript completo | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | `tsc-cierre.log`, vacío; salida observada 0, sin exclusiones focales ni stubs |
| Build completo | `npm.cmd run build`, NEXT_TELEMETRY_DISABLED=1 | `build-final.log`, Next 16.4.1, compilación y generación de rutas completas, salida observada 0 |
| ESLint de los siete TS/TSX de revisión | `node node_modules/eslint/bin/eslint.js` con esas siete rutas | `eslint-final.log`, vacío; salida observada 0 |
| 44 casos | Vitest run de los cuatro archivos de revisión, `--maxWorkers=1 --reporter=json` | `revision-final.json` y `.log`: 44/0/0 |
| 208 casos | Vitest run de los siete archivos enumerados en §9, mismo worker/reporter | `regresion-dom.json` y `.log`: 208/0/0 |
| 11 casos SQL | `node scripts/mil-imp04a/lab.mjs --run-isolated` desde worktree | `lab-vitest.json` y `.log`: 11/0/0; servidor propio apagado; `lab-explain-cxc-volumen.json` |

Una salida vacía de log por sí sola no certifica éxito: los códigos 0 se observaron en las respuestas del ejecutor de la sesión. Los JSON contienen conteos y títulos verificables. Los hashes de fuentes están en manifest; no se presentan estos logs como una certificación externa firmada. TypeScript/build/ESLint y motor se ejecutaron antes de la última aclaración de dos textos de preview en `credito.ts` (sustituir mensajes de compatibilidad por mensajes de bloqueo); los 44 casos sí se repitieron después de ese ajuste. No se afirma que el build se repitiera sobre ese último cambio de literales. Esta entrega documental no ejecuta nuevamente pruebas ni SQL.

El build registra avisos: Node 24.18.0 fuerza fallback de workerThreads a childProcesses y advierte sobre Cache-Control personalizado. No son ausencia de errores global garantizada ni se ocultan como salida limpia. npm registra deprecaciones y el postinstall pendiente ya descrito. No se ejecutó npm audit ni se declara ausencia de vulnerabilidades de dependencias.

Cambios de esta revisión respecto a a243f7f9: **ningún permiso nuevo, grant, DDL, índice, trigger o migración**. El permiso granular y esquema propuestos ya pertenecían al commit base; se revisan mediante pruebas adicionales sin alterar sus contratos. El bloqueo nuevo está en `congelarVencimientoTx` y se ejecuta antes del UPDATE de emisión; no activa libros, no bloquea globalmente la base ni modifica históricos. La consulta por lote añade entidad al WHERE. La UI no concede autoridad y no sustituye la validación del servidor.

## 13. Riesgos del orden código/SQL (solo análisis, sin despliegue)

| Orden o estado | Riesgo y comportamiento esperado |
| --- | --- |
| Código revisado antes del SQL | Perfiles/escrituras certificadas con contrato CLEAN/DIVERGENTE rechazan con 503; borradores sin contexto rechazan 409. La lectura sin tabla puede seguir mostrando indeterminado. Es fail-closed, pero puede interrumpir emisión: no es despliegue compatible sin preparación |
| SQL antes del código revisado | DDL aditivo no modifica emitidas; código antiguo puede continuar emitiendo sin snapshot. Queda una ventana de cobertura incompleta, no corregible con backfill desde el perfil actual |
| SQL completo con instancias antiguas y nuevas simultáneas | Las antiguas omiten el helper; los triggers solo protegen snapshots existentes y no obligan a toda fila de factura a tener snapshot. Se requiere coordinación de todos los escritores; la garantía de aplicación no cubre binarios antiguos |
| DDL interrumpido | Confirmaciones implícitas dejan parcial DIVERGENTE; aplicación no repara ni continúa. Mantener escritura afectada detenida y revisión DBA autorizada; no rollback destructivo |
| Volver a código antiguo después de emisiones con snapshot | No retirar snapshots ni índices; las instancias antiguas permitirían nuevas emisiones sin congelación. Requiere plan de recuperación y control de escritura, no solo rollback de archivos |

Una futura ventana coordinada debe ser aprobada por responsables: validar esquema efectivo y respaldo, controlar escritores afectados, aplicar SQL autorizado, verificar FINAL, desplegar versión homogénea y comprobar perfiles/contexto antes de reabrir. Se describe el riesgo y la condición de habilitación, **no se autoriza ni se ejecuta ninguna de esas acciones**. Permanecen pendientes decisión funcional sobre borradores incompletos, concesiones y auditoría del diff. No se modificó código adicional en esta entrega. Detención para segunda auditoría independiente.
