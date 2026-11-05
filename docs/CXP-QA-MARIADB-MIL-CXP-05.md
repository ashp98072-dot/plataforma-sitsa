# MIL-CXP-05 — QA del panel de integridad y Excel

Fecha: 2026-11-05. Base: `origin/main` = `f035bec9fc5c8ed9d9aceb4efd3ef5bb765f54f1` (merge #566).
Rama independiente: `feature/mil-cxp05-qa-mariadb`; worktree: `.worktrees/mil-cxp05`.

**Estado técnico: SUITE PREPARADA; INTEGRACIÓN REAL PENDIENTE.** No se certifica el SQL, la concurrencia ni el rendimiento contra MariaDB con esta entrega. Las pruebas omitidas no cuentan como aprobadas. No se modifica la política #555 ni código productivo.

## Entorno identificado y bloqueo

No hay `LIQ_TEST_DB_PORT` configurado. La inspección de listeners no identificó una instancia en 3399/3407. Hay dos procesos `mysqld.exe`, pero no fue posible obtener su línea de comandos/ruta ni vincularlos a esos puertos. Su existencia no acredita aislamiento ni autorización. Existe un directorio local de binarios MariaDB 11.8.9 y documentación histórica de laboratorios; ninguno demuestra un servidor desechable activo autorizado para este ticket.

- Alias de laboratorio confirmado: **ninguno**.
- Versión exacta consultada al motor: **no obtenida**; versión requerida: **MariaDB 11.8.9**.
- Conexiones SQL, bases creadas, migraciones aplicadas y datos insertados en esta revisión: **ninguno**.
- EXPLAIN, tiempos SQL/exportación desde el motor y bytes XLSX del laboratorio: **pendientes**, sin mediciones inventadas.
- No se inició ningún servicio ni VM. No se utilizó Hostinger, producción, una base existente ni configuración privada.

El bloqueo se resuelve identificando una instancia ya disponible y expresamente autorizada, su alias desechable, puerto loopback permitido y huella del datadir. Si es necesario iniciar un servicio/VM, requiere autorización separada; este procedimiento no lo inicia.

## Archivos y alcance

- `src/lib/contabilidad/cxp/integridad.db.test.ts`: 12 casos con motor real, migraciones versionadas y fixtures sintéticos.
- `src/lib/contabilidad/cxp/__tests__/integridad-lab.ts`: guardas exclusivas de QA, marcador de propiedad, parser de migraciones, barreras y observación de conexiones reales.
- `src/lib/contabilidad/cxp/__tests__/integridad-lab.test.ts`: cinco pruebas offline de las guardas y utilidades; no simulan resultados financieros del motor.
- Este expediente. No se cambian módulos productivos, índices, migraciones, permisos ni cálculos.

## Aislamiento y ciclo de vida preparado

1. Sin puerto, Vitest omite la suite explícitamente. Con puerto configurado, exige alias `qa-desechable-*` y SHA-256 del datadir autorizado **antes de abrir socket**. Sólo admite `127.0.0.1:3399|3407`; ignora `DB_HOST` y no importa el pool productivo. Una variable configurada por sí sola no acredita autorización: el operador debe obtenerla del expediente autorizado del laboratorio.
2. Consulta `VERSION()`, `@@port`, `@@datadir` y compara versión exacta 11.8.9-MariaDB, puerto y huella. El datadir no se publica en claro. Cualquier discrepancia aborta antes de CREATE.
3. Crea `cxp_qa05_<UUID aleatorio>` **sin IF NOT EXISTS**; no adopta bases existentes. Registra un token aleatorio en `qa_ownership` y verifica `DATABASE()` en el pool nuevo.
4. Prepara tablas base mínimas sintéticas y aplica los archivos reales en una misma conexión, conservando bloques `DELIMITER` y validaciones de contrato. FK/CHECK siguen activos.
5. Los casos limpian sólo sus fixtures dentro de esa base. Las inconsistencias históricas se insertan directamente allí; los casos normales usan los servicios reales de factura/pago/reverso/anulación. Ausencia de pagos se prueba retirando sólo las dos tablas nuevas de QA y reaplicando M-3B1 en `finally`.
6. Al finalizar, cierra el pool y comprueba nombre, creación efectiva y token antes de DROP de esa única base. Si falta/cambia el marcador, **bloquea la eliminación** y falla: conservar el nombre de QA para recuperación por el operador autorizado. No buscar/borrar bases por prefijo ni adoptar restos de una ejecución anterior. Un corte abrupto puede dejar la base temporal; no hay limpieza global automática.

La instrumentación observa consultas ejecutadas por mysql2 y coordina sus pausas; no sustituye respuestas SQL. El mock de `@/lib/db` redirige exclusivamente al pool temporal.

## Migraciones reales previstas

| Archivo intacto | SHA-256 del archivo en esta base |
| --- | --- |
| `sql/migrate-2026-11-cxp-m3a-base.sql` | `58f1925639253417e4facf922bd99f20dbfa699819369f20808814fab0154db4` |
| `sql/migrate-2026-11-cxp-m3b1-pagos.sql` | `14c5a10576d22b2abccc970031818e55c4c98a43a1b9f53883327f37002cb821` |

Los hashes identifican los archivos; **no prueban aplicación al motor**. La ejecución futura emitirá hash y `applied:true` únicamente después de aplicar cada archivo.

## Cobertura preparada y evidencia exigida

| Área | Aserciones preparadas | Ejecución real actual |
| --- | --- | --- |
| Vacía y estados normales | Sin facturas; sin pago, parcial, total, reversado y anulada sin pago usando servicios reales | Pendiente |
| Anomalías sintéticas | Sobreaplicación, pago vigente en anulada, proveedor distinto, descuadre, pago sin aplicaciones, varias categorías por factura; oráculo explícito de IDs/códigos y contadores | Pendiente |
| Importes | Valores DECIMAL grandes, exceso de un céntimo; reverso excluido del vigente aunque conserve hallazgo estructural | Pendiente |
| Ámbitos/filtros | Dos empresas, entidades y proveedores; inexistente/ajeno 404; estado y código; contador global independiente de página | Pendiente |
| Orden/páginas | Siete advertencias, páginas de dos, sin duplicados/omisiones, mismo orden al repetir; se contrasta con IDs sintéticos conocidos | Pendiente |
| Excel | Datos devueltos por motor; conjunto filtrado completo frente a página de dos; resumen, DECIMAL, permiso de pagos, fórmula sintética neutralizada y limitaciones; reapertura ExcelJS | Pendiente |
| Límite | Exactamente 10.000 se exportan y reabren; 10.001 produce 422 antes de cargar filas, sin truncar ni perder conexión | Pendiente |
| Concurrencia | Lector con sesión por defecto READ COMMITTED; helper productivo debe imponer REPEATABLE READ; escritor con connection ID diferente confirma después del conteo; filas y contadores conservan snapshot anterior, siguiente lectura ve el cambio | Pendiente |
| READ ONLY y error | UPDATE sin efecto sobre marcador debe fallar con errno 1792; error SQL real 1054 verifica release, reutilización de conexión e `@@in_transaction=0` | Pendiente |
| M-3B1 ausente | Reintento real por tablas ausentes: pagos no disponibles, revisadas=0, advertencia explícita de revisión incompleta en panel y Excel | Pendiente |

Las barreras se abren por eventos SQL, sin sleeps ni ventanas de tiempo para ordenar operaciones. Los timeouts de Vitest son watchdogs de fallos, no mecanismos de sincronización.

## Rendimiento y EXPLAIN preparados

El caso progresivo crea 10, 100 y 1.000 facturas, un pago y N aplicaciones por volumen; verifica esas cantidades por SQL. Cada factura tiene una sobreaplicación. Registra `queryMs` (panel), `exportMs` (consulta completa más serialización XLSX), `xlsxBytes` y advertencias. Reabre cada libro. El caso límite añade el volumen de 10.000/10.001 advertencias.

Captura EXPLAIN tabular de cuatro consultas construidas por el módulo real: facturas revisadas, total/distintas, agrupación por código y filas ordenadas/paginadas. Cada plan va asociado al volumen y a la versión/huella del laboratorio en `MIL_CXP05_EVIDENCE`. Las consultas de filas/contadores usan el UNION ALL scoped real; no un SQL alternativo simplificado. No se ha obtenido todavía ningún plan ni se propone un índice sin esa evidencia. Las mediciones futuras no acreditarán rendimiento productivo.

## Procedimiento reproducible cuando exista autorización

Usar sólo una instancia ya identificada y autorizada por su responsable; no usar los procesos desconocidos. Obtener su huella SHA-256 del texto exacto de `@@datadir` desde el expediente de aprovisionamiento aprobado (UTF-8, sin normalizar ni añadir salto de línea). No descubrirla probando conexiones a servidores desconocidos. La suite compara esa identidad antes de escribir.

En una consola PowerShell separada y con las variables limitadas a esa sesión:

```powershell
# Sólo después de identificar y autorizar el laboratorio existente:
$env:LIQ_TEST_DB_PORT = '3399' # o 3407, según expediente autorizado
$env:MIL_CXP05_LAB_ID = 'qa-desechable-cxp05'
$env:MIL_CXP05_DATADIR_SHA256 = '<64 hex del expediente autorizado>'
# MIL_CXP05_DB_USER / MIL_CXP05_DB_PASSWORD: sólo en sesión privada si se requieren.
# Por defecto reutiliza el contrato root sin contraseña del laboratorio desechable, jamás credenciales productivas.
$qaEvidence = Join-Path $env:TEMP ('mil-cxp05-' + [guid]::NewGuid().ToString('N') + '.log')
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp/integridad.db.test.ts --no-file-parallelism --reporter=verbose 2>&1 | Tee-Object -FilePath $qaEvidence
if ($LASTEXITCODE -ne 0) { throw 'Integración no aprobada; revisar log sintético y limpieza' }
```

El placeholder de huella falla antes de conectar; no reemplazarlo con un valor inventado. No cargar `.env` productivo. Ejecutar primero sólo la suite nueva: las suites DB heredadas usan guardas anteriores y no deben habilitarse globalmente sin revisar su autorización. Conservar log de Vitest, `MIL_CXP05_EVIDENCE`, versión exacta, alias, planes, volúmenes, métricas y resultado de cleanup; revisar que sólo contengan datos sintéticos antes de adjuntarlos. Actualizar este expediente en un avance auditado. Cerrar la consola elimina las variables de sesión. No generar configuraciones privadas versionadas.

## Comprobaciones locales ejecutadas

Dependencias del worktree: `npm ci --offline --ignore-scripts --no-audit --no-fund`, sin ejecutar scripts de instalación.

| Comando | Resultado |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp --no-file-parallelism` | 20 archivos aprobados / 8 omitidos; **300 pruebas aprobadas / 146 omitidas**. Incluye facturas, pagos, antigüedad, estado de cuenta, integridad, Excel, HTTP y DOM. De las omitidas, 12 corresponden a la suite nueva. Ninguna prueba DB ejecutada. |
| TypeScript global `--noEmit --incremental false` | Aprobado, código de salida 0 |
| ESLint de los tres archivos nuevos `--max-warnings 0` | Aprobado |
| `git diff --check` y revisión del alcance | Aprobado; sólo suite, utilidades de QA y este expediente |

Tras restaurar M-3B1 en `finally`, se repitió la comprobación focalizada: cinco tests offline aprobados y 12 de integración omitidos. ESLint se repitió sin advertencias. Ningún resultado omitido se presenta como evidencia SQL.

Durante preparación se corrigieron dos problemas de la propia suite: una aserción del parser asumía procedimientos en vez de bloques `BEGIN NOT ATOMIC`, y el tipo de entorno exigía `NODE_ENV` innecesariamente. No son defectos productivos; los cinco tests offline pasan. No se atribuyen fallos a código heredado.

## Criterio de continuación y aprobación

La entrega habilita auditoría de la suite, **no aprobación de integración MariaDB**. Para cerrar MIL-CXP-05 faltan laboratorio autorizado, ejecución efectiva de los 12 casos, versión exacta comprobada, migraciones aplicadas, planes, métricas y eliminación propia confirmada. Un fallo real del panel/Excel se documentará con fixtures/consulta/aserción reproducible y propuesta de ticket separado; no se corregirá silenciosamente aquí. No se ha observado un defecto productivo mediante motor porque no se ejecutó el motor.

No despliegue, merge, cambios financieros, nuevos permisos, PriceSmart ni BORR-1f. Publicación prevista como **PR Draft** y detención para auditoría independiente.
