# TMS-COMB-04 — Auditoría técnica y alcance propuesto

Fecha: 2026-11-11. Informe inicial publicado en `dd97ee2f29ea5d453ee54b448357de0e618e6654` y auditado por ChatGPT. Estado actual: 04A exclusivamente como pruebas/documentación, con publicación controlada autorizada para auditoría independiente. No habilita implementación funcional ni TMS-COMB-04B.

## Base y aislamiento

- Main obtenido de origin mediante fetch: `373bb48704f14904326037573081280ab2222fcd`.
- Rama nueva: `feature/tms-comb04-idempotencia-vales`.
- Worktree: `.worktrees/tms-comb04`.
- Al preparar el informe inicial, HEAD coincidía con main verificado; el SHA aprobado de 03A no era ancestro de ese HEAD. No se incorporaron archivos de PR #582. El trabajo local 04A parte del commit documental `dd97ee2f29ea5d453ee54b448357de0e618e6654`.
- TMS-COMB-03A terminado exclusivamente a nivel experimental, SHA aprobado `c61f2582b87ac74ee919e42ed2976c9aa843e462`. PR #582 comprobado abierto, Draft y no fusionado; su rama queda sin cambios.
- D1–D5 siguen **NO APROBADAS**. Sin confirmaciones externas, catálogos persistentes, migraciones ni cambios históricos.

## Método y límites

La auditoría inicial fue una revisión estática de servicios, adaptadores HTTP, parsers, pruebas y DDL versionado en este main. Se leyeron archivos SQL como texto: **no se ejecutó SQL ni se abrió conexión a BD**. No se iniciaron servidores, build ni suites DB. No se modificó código, dependencias, main o PR #581. En esa fase, este documento fue el único archivo nuevo. Los resultados de las nuevas pruebas locales 04A se detallan al final.

Los índices descritos son los declarados en el repositorio: no certifican que producción tenga ese esquema. No se infieren datos reales, duplicados existentes, flags activos ni garantías de concurrencia medidas. Las pruebas citadas se inspeccionaron; no se vuelven a declarar PASS en esta fase.

## Inventario de escritores y lectores relevantes

| Flujo / entrada | Escritor existente | Destino y garantías observadas |
|---|---|---|
| CB2 confirmar y reanudar (`cb2/http.ts`) | `cb2/service.ts`: `confirmarArchivo`, `reanudarArchivo`, `resolver`, `proyectar` | Cabeceras `flota_cb2_importaciones`, consumos `flota_cb2_consumos` y eventos originales/resoluciones `flota_cb2_filas`. No inserta vales internos en cargas. |
| CB2 asociar factura | `cb2/service.ts`: `asociarFactura`; `cb2/repository.ts`: `factura`, `diario` | Facturas, vínculo documental del consumo, revisión de importaciones y diario. No cambia monto/fecha/vale del consumo. |
| CB2 corregir asignación | `cb2/asignaciones.ts`: `corregirAsignacion` | Cambia vehículo/empleado/producto clasificado con revisión esperada y registro `flota_cb2_asignaciones`. No ejecutar: escritor de históricos fuera del incremento. |
| CB2 completar/corregir documento | `cb2/documentos.ts`: `editarDocumento` | Fecha/total/revisión documental y `flota_cb2_documento_operaciones`, condicionado por flag y autorización. No cambia identidad serie/número/moneda. No se asume flag activo. |
| Importación C2B HALEL (`combustible-importaciones-http.ts`) | `combustible-importaciones.ts`: `confirmarImportacion` | Guarda evidencia, cabecera y TODAS las apariciones en `flota_combustible_conciliaciones` / `flota_combustible_conciliacion_filas`; audita en transacción. No crea consumos CB2 ni cargas internas. |
| Conciliación C2C de C2B con vale interno | `combustible-c2c.ts`: `recalcularImportacion`, `accionManual` | Cambia estado/vínculos/sugerencias de filas C2B; nunca los importes, vehículo ni estado del vale. Máximo un vínculo por vale según DDL. |
| Captura/edición staff de vales | `combustible-staff.ts`: `guardarCombustibleStaff` | Inserta/edita `flota_combustible_cargas` pendientes, deriva proveedor y snapshot de estación en servidor, conserva relaciones históricas al omitir campos, valida fondo y audita. |
| Revisión del vale | `combustible.ts`: `revisarCargaCombustible` | UPDATE condicionado a `PENDIENTE`; doble revisión devuelve 409. Es transición atómica, no recibo de reintento. |
| Captura antigua portal | `combustible.ts`: `registrarCargaCombustible` | Helper de INSERT de carga y archivo, sin deduplicación propia. No se encontró caller operativo actual; POST portal devuelve 410. No reactivarlo ni confundirlo con escritor alcanzable actual. |
| Conciliación histórica Excel | `combustible-conciliacion-persistencia.ts`: `guardarConciliacionCombustible`, llamado desde `conciliaciones/route.ts` | Snapshot de cabecera/filas en tablas compartidas con C2B; no modifica cargas. No es confirmación CB2. |
| Catálogo de estaciones | `combustible-estaciones.ts` | Cambia estaciones que determinan proveedor de nuevos vales; debe considerarse al probar carreras de validación. No se modifica. |
| Limpieza administrativa | `admin/limpiar-operaciones.ts`: lectura de cargas/filas y borrado genérico por grupos | Camino destructivo administrativo adicional, fuera de la importación. No ejecutado ni propuesto. El endpoint `combustible-bloqueante` es solo lectura, no el escritor. |
| Preview proveedor v2 | `combustible-preview-v2-http.ts` | Lectura/parser HALEL/SHELL, sin token de confirmación ni persistencia. El preview CB2 sí produce recibo firmado; no son intercambiables. |

## Identidades y deduplicación: cuatro niveles distintos

1. **Solicitud CB2**: namespace empresa + proveedor + tipo + clave. Digest SHA-256 de versión, tenant, proveedor, actor, tipo y datos. `anterior`/`recuperar` comprueban actor, digest, ordinales y total del diario. Repetir clave con contenido/actor diferente no certifica reintento. La misma clave textual en otro tipo tiene otro namespace.
2. **Archivo**: hash de bytes; UNIQUE `(empresa_id,proveedor_id,archivo_sha256)` en cada cabecera CB2 y C2B, por separado. CB2 recupera diario antes de verificar expiración del recibo; mismo archivo con otra clave devuelve existente/requiere reanudación. C2B valida primero el JWT de 15 minutos y rechaza archivo repetido con 409; no recupera un recibo equivalente al de CB2.
3. **Candidato/vale**: C2B `combustible-importacion-parser.ts:130` y v2 `combustible-importacion-v2.ts:171` calculan SHA-256 de `JSON.stringify([valeNormalizado])`. Tenant/proveedor son ámbito aplicado por servidor, no parte del hash. `normalizarIdentificador` usa NFC, trim, colapso de espacios y mayúsculas. Conserva ceros, prefijos y puntuación; no convertir a número ni quitar guiones del vale.
4. **Contenido**: fingerprint C2B incluye fecha de REPORTE, placa, importes, documento, km y piloto. Huella parser v2 y huella operativa CB2 son conceptos diferentes. `cb2/model.ts:payload` incluye versión 1, vale, fecha de CONSUMO, placa, piloto/producto normalizados, decimales canónicos, km numérico/textual y moneda; excluye documento, vehículo asignado y empleado elegido. La reutilización compara aparte vehículo y compatibilidad documental; no reasigna empleado de un consumo previo. No sustituir estos hashes entre sí.

DDL relevante: `sql/migrate-2026-10-combustibles-pr2-consumos-facturas.sql:479` declara UNIQUE de huella por empresa/proveedor, pero candidato es índice NO único (línea 480). Diario único por operación/ordinal (533), no un único registro de solicitud. `sql/migrate-2026-10-combustibles-c2b-importaciones.sql:150` declara UNIQUE de archivo C2B; clave de fila solo se indexa. C1 declara explícitamente que no añade UNIQUE de proveedor/vale. C2C añade `uq_fccif_vinculo (empresa_id,carga_vinculada_id)`.

## Validaciones y compatibilidad de vales

- CB2: esquemas estrictos de selección/operación; detección de perfil en servidor; archivo/recibo ligados a contenido y decisiones; revalida autorización después de esperar proveedor. Vehículos activos y compartidos con acceso bloqueado; empleados activos del tenant; sin identidades externas activadas. Reanudación lee evidencia privada, verifica SHA y originales completos, moneda única y revisión.
- C2B: JWT ligado a actor/tenant/proveedor/hash/version/digest del análisis. Recalcula clasificación bajo bloqueo y obliga a repetir preview si cambió. Guarda duplicados/invalidaciones como evidencia, no los fusiona con consumos.
- Staff: número de vale 1–40 caracteres; fecha calendario, galones con 3 decimales y monto con 2, positivos y acotados; precio calculado con Decimal. Proveedor derivado de estación. CB2 admite hasta 128 caracteres en vale y otra precisión de parser/persistencia: un vale CB2 no es automáticamente un vale capturable por staff.
- Staff busca duplicados por `UPPER(TRIM(numero_vale))`; no aplica el colapso interno de espacios ni NFC explícito de JS. C2C usa prefiltro SQL con REGEXP de espacios y luego comparación NFC en JS. La colación y composición Unicode pueden impedir que un registro llegue al segundo filtro: requiere caracterización, no afirmar equivalencia SQL/JS.
- C2C vincula por empresa/proveedor/vale; placa, fecha, galones, precio y monto son diferencias secundarias. Fecha reporte C2B no certifica consumo. `hayDiferencias` cuenta valores distintos, no faltantes: “exacta” no significa evidencia completa ni autorización.
- Vale interno y consumo CB2 pueden representar evidencias del mismo hecho sin ser la misma entidad. No unir IDs, eliminar una evidencia ni sumar ambos indiscriminadamente como consumos nuevos.

## Hallazgos y riesgos priorizados

| ID | Hallazgo / consecuencia | Tratamiento propuesto |
|---|---|---|
| 04-R1 Alta | Asimetría C2B→CB2: `resolver` bloquea ante clave histórica C2B HALEL; C2B solo busca antecedentes C2B. Si CB2 entra primero, C2B puede guardar luego el reporte. No necesariamente duplica consumo (C2B no crea consumo), pero el resultado depende del orden. | Caracterizar ambos órdenes y no convertir reporte en consumo ni promover evidencia automáticamente. Política bidireccional pendiente. |
| 04-R2 Alta | Staff y CB2 bloquean proveedor, pero buscan duplicados en tablas distintas. Compartir lock no implica detectar vale cruzado. No existe UNIQUE global de vale ni reserva común. | Matriz de coexistencia por entidad; sin nueva tabla/reserva en el primer incremento. |
| 04-R3 Alta | Staff, tras COMMIT con respuesta perdida, conserva `committed=false` y puede borrar archivo nuevo en finally. CB2 y C2B tienen manejo explícito de incertidumbre más conservador. | Test de caracterización con mocks; no ejecutar ni alterar un vale real. Corrección operativa requeriría autorización separada. |
| 04-R4 Media | Normalizaciones y longitudes no equivalentes; `00123` / `123`, espacios, guiones y Unicode pueden colisionar o divergir según capa. | Conservar literal e identidad vigente; probar sin backfill ni recalcular hashes históricos. |
| 04-R5 Media | UNIQUE de huella CB2 no impide por sí solo dos payloads distintos del mismo vale; la garantía depende del proveedor bloqueado y de que todos los escritores sigan el protocolo. SQL externo queda fuera. | Caracterizar unicidad física frente a lógica; no prometer deduplicación global. |
| 04-R6 Media | CB2 usa READ COMMITTED y reintentos acotados de deadlock/timeout; C2C usa READ COMMITTED sin recuperación equivalente; C2B/staff no fijan aislamiento en sus funciones. | No asumir snapshot fresco en todos los caminos; futura prueba con dos conexiones y barreras, bajo autorización SQL aparte. |
| 04-R7 Media | Cambios concurrentes de estación/proveedor, acceso compartido, empleado o permisos pueden invalidar el preview. CB2 revalida autorización tras esperar; C2B valida guard HTTP antes de esperar, sin callback equivalente en servicio. | Pruebas de revocación y cambio de catálogo con mocks; no ampliar permisos. |

Orden observado de bloqueos: CB2 proveedor primero, luego cabeceras/documentos/vehículos/consumos según operación; staff proveedor → vale → fondo/estación/vehículo según entrada; C2C proveedor → fila → vale para acción manual. El orden no es idéntico entre todos los recursos. El proveedor común serializa mismo tenant/proveedor, pero vehículos compartidos y otros proveedores pueden introducir ciclos; el semáforo CB2 (4 activas, cola 32) es local al proceso, no cerrojo distribuido. No se demostró un deadlock real durante esta revisión.

## Primer incremento propuesto: TMS-COMB-04A (autorizado solo como pruebas/documentación)

**Objetivo:** fijar contratos observables de idempotencia y compatibilidad mediante pruebas de caracterización, antes de decidir cambios en escritores.

Alcance permitido propuesto: pruebas nuevas bajo `src/lib/flota/` y/o `src/lib/flota/cb2/` con fixtures sintéticos en memoria, y actualización de este informe. Importar funciones vigentes sin cambiar normalización, payload, parser, UI, endpoint, escritor ni DDL. Servicios se prueban con DB/uploads/auth completamente simulados; ningún test obtiene conexión real o carga env. No instalar dependencias ni copiar el prototipo 03A.

Entregables de 04A:

1. Tabla ejecutable de casos de vale: ceros iniciales, prefijos, guiones ASCII/Unicode, mayúsculas, espacios repetidos/NBSP, NFC/NFD, vacío, 40/41/128/129 caracteres y entradas Excel numéricas no seguras. Comparar semánticas por capa; no imponer que todas coincidan.
2. Caracterizar identidades vigentes con fixtures/golden hashes: misma operación en archivos/hojas distintos, documento añadido, moneda/importe/fecha/placa/km/piloto distintos. Separar candidato, fingerprint, payload y hash de archivo.
3. Caracterizar recibos: misma clave/mismo contenido y actor; distinta solicitud/actor; diario incompleto/ordinales; token vencido con y sin resultado previo; revisión obsoleta; COMMIT/rollback inciertos. Sin producir recibos nuevos para externos.
4. Matriz cruzada de secuencias CB2/C2B/staff/C2C con mocks que describa el comportamiento ACTUAL. Casos problemáticos se documentan como deuda; no introducir una prueba fallida permanente ni cambiar la política para hacerla pasar.
5. Verificación de que ningún archivo operativo incorpora un módulo nuevo, no hay rutas nuevas, ni cambios de históricos, catálogos o contratos existentes.

Aceptación propuesta: pruebas unitarias focales sin SQL, TypeScript, ESLint focal y diff --check; diff exclusivamente de tests/documentación aprobados. Toda divergencia respecto del inventario debe quedar explicada. No afirmar concurrencia real a partir de mocks.

Fuera de 04A: reserva/idempotencia común persistente, UNIQUE nuevo, normalización masiva, nueva confirmación, cambios de permisos, activación de externos, reasignación de vehículos históricos, modificación de escritores/endpoints y pruebas DB. No PR, commit/push ni publicación adicional solicitados para este análisis.

## Pruebas necesarias en fases posteriores (requieren autorización específica)

| Grupo | Casos y criterio |
|---|---|
| Dos conexiones reales, BD desechable | Misma clave y archivo en paralelo: un resultado durable y una auditoría; claves diferentes mismo archivo: respuesta definida sin cabecera adicional. No habilitar ahora. |
| Operaciones cruzadas | CB2→C2B y C2B→CB2, staff simultáneo, C2C recalcular/confirmar, corrección/asociación simultánea. Preservar evidencia y cardinalidad, comprobar política aprobada y límites del lock. |
| Aislamiento y bloqueos | READ COMMITTED y configuración soportada; snapshot previo al lock; deadlock/timeout/cola saturada; varios procesos; revocación de acceso y catálogos. Sin escrituras fuera de tenant. |
| Incertidumbre y archivos | Pérdida de respuesta COMMIT, rollback fallido, caída tras subir archivo: conservar evidencia potencialmente referenciada, reintento determinista, no auditoría duplicada. |
| Integridad física | DDL real, tipos/escala/colación/FKs/CHECK/UNIQUE y versiones parser; nunca suponer migración aplicada por existir script. |
| Regresión histórica | NULL proveedor/vale/estación/fecha, inactivos conservados, unidades compartidas y placas repetidas con IDs distintos; sin reescritura de registros. |

Pruebas existentes a reutilizar como referencia: `cb2/service.db.test.ts` (concurrencia mismo archivo, solapados, conflicto payload, histórico C2B, reintentos, revisiones y tenant); `cb2/repository.test.ts` (commit incierto, deadlock, cola, entorno); `combustible-importaciones.test.ts` (archivo repetido, clasificación cambiante y commit incierto); `combustible-c1.db.test.ts` / `combustible-vale-estacion.db.test.ts` (captura y estaciones); `combustible-c2c.db.test.ts` y `combustible-c2c-rollout.db.test.ts` (vínculos). Ninguna suite DB fue ejecutada.

## Decisiones pendientes para ChatGPT

- Aprobar o ajustar 04A limitado a tests/documentación.
- Definir si un vale ya representado en CB2 permite reporte C2B coexistente (evidencia), y cómo presentarlo sin doble conteo. No asumir simetría de bloqueo como regla aprobada.
- Separar una futura corrección de conservación de evidencia staff de cualquier integración CB2/C2B.
- Definir reglas de repetición de vale por proveedor/periodo y contrato de normalización/versionado antes de proponer reserva o índice nuevo.

El análisis inicial se detuvo sin implementación funcional. Posteriormente se autorizó y publicó exclusivamente este informe en `dd97ee2f29ea5d453ee54b448357de0e618e6654`, sin PR. La autorización posterior 04A permite preparar pruebas/documentación localmente, sin commit ni push.

## 04A — Resultados locales de caracterización

Base de trabajo: `dd97ee2f29ea5d453ee54b448357de0e618e6654`. La entrega local inicial no creó commit ni push; la autorización posterior permite un único commit incremental y push normal de los tres archivos nuevos de pruebas y este informe. D1–D5 permanecen **NO APROBADAS**. El diff no contiene cambios de implementaciones.

### Cobertura exacta de los casos nuevos

| Archivo bajo `src/lib/flota/` | PASS | Casos ejecutados |
|---|---:|---|
| `combustible-04a-evidencia.test.ts` | 12 | Staff: COMMIT confirmado (1); fallos previos en INSERT/auditoría (2); respuesta COMMIT perdida con escenario aplicado/no aplicado (2); rollback fallido (1); upload fallido (1); edición con referencia anterior y COMMIT incierto (1); estación inactiva/proveedor cambiado/acceso de vehículo revocado (3); conservación de espacios internos y argumentos de deduplicación SQL (1). |
| `combustible-04a-identidades.test.ts` | 29 | Normalización comparada staff/C2B/C2C/CB2 con 7 literales; límites 40/41/128/129 (4); vacío (1); identificador numérico Excel inseguro en CB2 (1); vector SHA/payload/candidato/fingerprint conocidos (1); archivo/hoja/documento (1); sensibilidad a monto/fecha/placa/piloto/producto/km (6); moneda y equivalencia decimal (1); C2C exacta con 5 datos faltantes (1); recuperación válida/vacía (1); digest/actor/diario incompleto/orden/total incompatibles (5). |
| `combustible-04a-secuencias.test.ts` | 25 | CB2→C2B y C2B→CB2 (2); reutilización y conflicto de payload (2); recuperación con token vencido y rechazo sin operación previa (2); clave con actor/contenido distinto (2); mismo archivo/clave nueva (1); diario incompleto (1); ausencia del callback CB2 en servicio C2B (1); C2B repetido/reclasificación/token vencido (3); rollback CB2 fallido (1); orden lock→revalidación y revocación (1); vehículo/empleado/proveedor revocados (3); conservación comparada CB2/C2B con COMMIT confirmado, rollback previo y COMMIT incierto (6). |
| **Total** | **66** | **3 archivos; 0 FAIL; 0 SKIP.** |

“Cobertura” aquí significa el inventario de escenarios anterior, no un porcentaje de líneas/ramas ni certificación de toda la aplicación. No se instrumentó cobertura porcentual.

### Ejecución y aislamiento

- Vitest focal: `npx.cmd vitest run src/lib/flota/combustible-04a-evidencia.test.ts src/lib/flota/combustible-04a-identidades.test.ts src/lib/flota/combustible-04a-secuencias.test.ts` → **66 PASS**.
- TypeScript completo: `npx.cmd tsc --noEmit` → exit 0.
- ESLint sobre los tres archivos nuevos con `--max-warnings 0` → exit 0.
- `git diff --check` y comprobación equivalente de cada archivo nuevo no rastreado → sin errores de whitespace.
- Se reutilizó la instalación local existente mediante junction `node_modules` ignorada por Git; no se instaló ni cambió ninguna dependencia o lockfile. No se hizo build ni se iniciaron servidores.
- Los tres archivos sustituyen `@/lib/db` antes de importar servicios. La carga de entorno real está bloqueada. Uploads, compensación/borrado, auditoría y autorización se simulan cuando corresponden. Los Excel sintéticos se generan con ExcelJS únicamente en buffers; no se leen archivos históricos ni se escribe evidencia en disco.
- En secuencias se ejecutan las implementaciones vigentes de CB2, C2B y del repositorio/transacción CB2. El adaptador SQL propio acepta solo las formas de consulta previstas y falla ante otras; sus INSERT solo alimentan colecciones en memoria. Prohíbe insertar cargas internas. No es un motor SQL, no aplica restricciones físicas, colaciones, locks ni concurrencia de MariaDB.
- Staff y secuencias verifican llamadas a persistencia/compensación simuladas. Los “COMMIT aplicado/no aplicado” son escenarios definidos por el doble; no se deduce el estado durable de una base real.

### Comportamientos problemáticos observados y divergencias

**R3 y el rollback fallido de staff son defectos actuales caracterizados, no comportamientos aceptados.** Que estas pruebas pasen significa que reproducen el defecto vigente; no aprueba la pérdida potencial de evidencia, el enmascaramiento del error original ni su conservación como política. Su corrección requiere autorización posterior y no forma parte de esta publicación.

1. **R3 reproducido:** staff llama a `borrarUpload` para la evidencia NUEVA si COMMIT arroja error, tanto cuando el mock representa COMMIT aplicado como no aplicado. El caso de edición conserva la referencia anterior, pero pide eliminar la nueva. Es una solicitud de borrado observada, no un borrado físico realizado. No se corrigió la implementación.
2. **Deuda adicional de rollback staff:** si el rollback arroja error después de un fallo de INSERT, ese error sustituye al original; finally sigue solicitando compensación y libera la conexión. CB2, en contraste, devuelve `incierto=true`, destruye la conexión simulada y conserva evidencia cuando falla rollback. El caso de COMMIT incierto también conserva evidencia en CB2 y C2B.
3. **Asimetría R1 caracterizada:** con el mismo archivo/vale, CB2→C2B crea un consumo CB2 y un reporte C2B; C2B no consulta CB2. C2B→CB2 conserva la cabecera y el diario original CB2 con resultado BLOQUEADA y no crea consumo. El bloqueo se observa en los servicios reales sobre estado simulado; no constituye una nueva política aprobada.
4. **Coexistencia R2:** un vale interno sintético ya existente permanece idéntico al importar consumo/reporte; se verifican colecciones separadas, no un total sumado ni fusión de entidades. No se comprueba una estrategia global de deduplicación entre tablas.
5. **Normalización R4:** staff conserva `A  001` tras trim y lo envía a `UPPER(TRIM(...))`; C2B/C2C/CB2 normalizan a `A 001`. NFC/NFD y NBSP convergen en funciones JS, ceros/prefijos/guiones del vale se conservan. Staff rechaza longitud >40; CB2 bloquea >128. No se emula la semántica de comparación SQL ni se certifican colaciones Unicode.
6. **Identidades distintas:** añadir serie/factura y renombrar hoja cambia hash de archivo y huella parser v2, pero no payload operativo CB2. Monto/fecha/placa/piloto/producto/km/moneda cambian el payload; representaciones decimales equivalentes no lo cambian. Los hashes operativos no se sustituyeron ni recalcularon en históricos. Los vectores constantes de SHA-256 se fijaron sobre JSON conocido y se calcularon con `node:crypto` independientemente de las funciones bajo prueba.
7. **Recuperación:** CB2 recupera una solicitud previa incluso con recibo vencido, pero rechaza actor/digest/diario incompatible; un archivo existente con clave nueva requiere reanudar. C2B rechaza repetición y valida expiración antes de cualquier recuperación. C2C puede devolver COINCIDENCIA_EXACTA aun con campos faltantes, que siguen como diferencias FALTANTE; no implica evidencia completa.
8. **Revocaciones:** se observa revalidación CB2 después del bloqueo simulado del proveedor y rechazo ante catálogos revocados. Staff rechaza estación inactiva/proveedor cambiado/vehículo sin acceso antes de subir. La prueba de C2B invoca directamente su servicio y confirma que no llama al callback de autorización CB2: **no prueba una vulnerabilidad del endpoint ni evita su guard HTTP**.
9. **Ajuste de expectativa del harness:** CB2 hace una transacción inicial de recuperación sin escrituras antes de preparar evidencia. Por eso un fallo posterior de auditoría puede tener un COMMIT anterior de solo consulta; la prueba exige rollback de la transacción de escritura, no ausencia absoluta de cualquier COMMIT. No se modificó código para satisfacer esa expectativa.

### Límites y deuda pendiente

Las 66 pruebas no demuestran unicidad física, exclusión mutua, atomicidad del motor ni comportamiento multiproceso. No se ejecutaron suites DB, migraciones, consultas reales, pruebas HTTP/DOM ni procesos productivos. El adaptador no comprueba DDL aplicado, FKs, CHECK, escala, normalización SQL ni snapshots de aislamiento. No se ejercitó reanudación completa con lectura privada ni su control de revisión obsoleta en esta nueva suite; las pruebas existentes citadas siguen siendo referencias, sin ejecución nueva.

R1–R7 siguen como riesgos que requieren decisiones o pruebas adicionales. Este incremento caracteriza algunos caminos, no cierra la política de coexistencia ni el defecto R3. No implementa reserva común, índices, nuevos recibos, cambios de validación o confirmaciones externas. Las futuras pruebas de dos conexiones en BD desechable requieren autorización SQL específica.

**Publicación controlada para auditoría:** exclusivamente un commit incremental y push normal de las pruebas nuevas y este informe. Sin PR nuevo, merge, rebase, squash, force push o despliegue. Main, PR #581 y PR #582 no se modifican. Se detiene el trabajo después del push para auditoría independiente; no se inicia TMS-COMB-04B.
