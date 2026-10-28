# C3C-1: calendario contable por empresa y entidad

Implementado y validado en laboratorio desechable MariaDB 11.8.9. La migración sigue pendiente fuera del laboratorio.
No acredita despliegue ni equivalencia completa con Milenium.

## Contrato

Crear y consultar ejercicios con períodos explícitos. Ambos estados son exclusivamente `CONFIGURADO` (también restringido por CHECK).
No hay edición, borrado, apertura, cierre, reapertura, numeración nueva, saldos iniciales ni vínculo/restricción sobre asientos.
No se modifican `sql/schema.sql` ni su respaldo. No se importan catálogos ni registros de Milenium.

Las fechas son DATE inclusivas (1000-01-01 a 9999-12-31); el ejercicio puede ser no anual. No se supone enero-diciembre ni doce meses.
De 1 a 366 períodos, en orden de captura, cada uno con código ASCII alfanumérico/guion/guion bajo (máximo 40), normalizado a mayúsculas.
Los períodos deben cubrir todo el ejercicio consecutivamente, sin huecos, inversiones o solapamientos. Código de ejercicio único por libro;
código y orden de período únicos por ejercicio. El orden lo asigna el servidor. No puede haber ejercicios solapados dentro del mismo libro.

Esta es la regla aprobada para Novalvion, no una equivalencia demostrada de Milenium. Calendario fiscal real, períodos de ajuste y cierres
requieren decisiones funcionales de entregas posteriores. C3C discovery es el antecedente; la aprobación de C3C-1 concreta dos niveles.

## Servicios y aislamiento

`calendario-schema.ts` es puro y reutilizado por formulario y servidor. `calendario.ts` crea ejercicio, períodos y auditoría en la misma conexión.
Reutiliza `bloquearAmbito`: bloqueo empresa -> entidad -> búsqueda de conflictos con current read -> inserciones -> auditoría -> commit.
Así compiten en el mismo candado incluso dos creaciones sobre un libro vacío. Actualmente también serializa entidades de una misma empresa.
No se cambió ese mecanismo ni los escritores de asientos. Las lecturas validan empresa/entidad y no bloquean el libro; admiten entidades inactivas.
Las escrituras exigen entidad activa. FK compuestas protegen los vínculos. No se aplica `cont_entidad_usuarios` (misma política actual del módulo).

La cobertura completa y la ausencia de solapamientos se garantizan en el servicio; FK/CHECK no pueden comprobar invariantes entre filas.
Escrituras SQL externas podrían eludirlas. Las APIs no exponen UPDATE/DELETE. No hay inicialización automática de tablas desde páginas o GET.

Reintento tras respuesta incierta: consultar calendario y conservar código. La unicidad/solapamiento evitan crear otro ejercicio idéntico;
no se incorpora idempotencia por contenido. Fallos de período o auditoría revierten todo. DDL nunca se ejecuta desde servicios.

## API e interfaz

Base `/api/empresas/[slug]/contabilidad/ejercicios`:
- GET `?entidad=` lista ejercicios del libro.
- POST `?entidad=` recibe `{codigo,fechaInicio,fechaFin,periodos:[{codigo,fechaInicio,fechaFin}]}` (esquema estricto).
- GET `/[id]/periodos?entidad=` consulta períodos de un ejercicio del mismo libro.
- GET `/opciones` reutiliza el catálogo de entidades de la empresa para el selector.

Empresa y actor salen de sesión; entidad es parámetro obligatorio único validado. 400: entrada inválida; 403: permiso;
404: libro/ejercicio ajeno; 409: código, solapamiento o conflicto transaccional; 503: esquema pendiente. Lecturas private/no-store.

Pantalla `/e/[slug]/contabilidad/calendario`, enlazada en la navegación contable. Entidad con una sola activa se preselecciona con el helper existente.
Cambiar libro desmonta formulario/detalle y aborta lecturas anteriores; entidad inactiva solo se consulta. La captura valida cobertura y evita doble envío.
Si falla la consulta de períodos, su botón de reintento repite solo esa lectura y conserva el formulario.
El guard del calendario usa `requireTenant(..., { soloLectura: true })` tanto en página como en API: autoriza la empresa solicitada
sin renovar cookies durante el renderizado, incluso si la sesión tiene seleccionada otra empresa autorizada.
Advertencia permanente: «Calendario configurado; todavía no controla el registro de partidas».

Permisos propios del catálogo de Usuarios: `contabilidad_calendario_ver:ver` y `contabilidad_calendario_crear:crear` (crear requiere ver).
Ningún rol no Admin los recibe por defecto. No heredan `contabilidad:editar`. Admin conserva el comportamiento central existente.
La matriz activa la base de lectura de Contabilidad al conceder acciones del grupo, igual que el resto del catálogo; no concede captura de asientos.

## SQL propuesto y limitaciones

`sql/{preflight,migrate,postcheck}-2026-10-contabilidad-calendario-c3c1.sql`.
Preflight y postcheck solo consultan metadatos/conteos. Cada sentencia devuelve exactamente una fila `control/errores`;
el runner exige cero y detiene la ejecución ante un resultado distinto, ausente o un error SQL.
Preflight comprueba destino, versión, FK activas, padres InnoDB (empresas, entidades, usuarios y auditoría), tipos/índices y ausencia de tablas nuevas.
La migración contiene exclusivamente dos CREATE TABLE cualificados con `{{C3C1_SCHEMA}}`; no se ejecuta directamente.
Solo el runner sustituye el marcador por su base nueva `c3c1_lab_<32 hex>` después de verificar instancia, identidad y preflight.
No crea ni elimina procedimientos; no contiene DROP, ALTER, backfill ni datos. Un fallo detiene las sentencias restantes.
DDL tiene commit implícito: si falla la segunda tabla puede quedar la primera. Se conserva evidencia; no hay rollback DDL ni limpieza automática.
Postcheck verifica columnas, índices, FK compuestas y sus acciones, CHECK declarados e invariantes de datos.
CHECK_CONSTRAINTS se une a TABLE_CONSTRAINTS por esquema/nombre: TABLE_NAME procede de esta última, compatible con el catálogo de MySQL 8.0.
La sintaxis está propuesta para MySQL 8.0.16+ y validada en MariaDB 11.8.9; la compatibilidad efectiva con MySQL sigue pendiente.
El runner está limitado a MariaDB 11.8 y exige además `check_constraint_checks=1`; no afirma probar MySQL.

## Validación permitida ahora

Solo suites explícitas puras/con mocks: `calendario-schema`, `calendario`, `calendario-http`, `calendario-ui`, `calendario-sql`,
`calendario-lab`, `calendario-lab-connection` y `tenant-calendario`.
Se permite además regresión pura/con mocks de asientos, catálogo y guards. No usar `npm test` indiscriminadamente: el glob incluye suites de BD.
Usar `--config scripts/ci/c3c1/vitest.config.mts`: `envDir: false` impide que Vite cargue archivos `.env`.
TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false`. No compilar/arrancar la app para probar esta entrega contra referencia.
Las pruebas SQL son inspección textual, no ejecución del migrador. El test concurrente usa un candado simulado; no demuestra el comportamiento de InnoDB.

## Laboratorio validado (cada nueva ejecución requiere autorización)

1. Revisar `scripts/ci/c3c1/{run-windows,connection,safety}.mjs`, `fixture.sql` y `vitest.config.mts`.
   Requiere Windows, Node/dependencias existentes y distribución local `.lab-runtime/mariadb-11.8.9-winx64` con su ZIP de SHA-256 fijado en el runner.
   No descarga ni instala binarios. La ayuda local de 11.8.9 confirma los argumentos Windows del inicializador:
   `--datadir=<nuevo> --socket=<pipe exclusivo> --skip-networking --config=<runDir>/init-template.ini`.
   El runner crea esa plantilla con exclusividad (`wx`), sección mysqld, skip-networking y named-pipe, sin includes ni servicio Windows.
   Según `MariaDB/server` tag `mariadb-11.8.9`, `sql/mysql_install_db.cc` (create_myini/init_bootstrap_command_line),
   la plantilla se copia al nuevo data/my.ini y el bootstrap usa explícitamente `--defaults-file=my.ini`, sin búsqueda de configuraciones globales.
   El inicializador no admite `--no-defaults`; se conserva esa opción como primer argumento del servidor posterior.
   El inicializador corregido se ejecutó satisfactoriamente en el laboratorio; cualquier fallo detiene el proceso sin fallback.
2. Solo después de autorización expresa: `node scripts/ci/c3c1/run-windows.mjs --run-isolated`.
   Crea directorio temporal nuevo con UUID, datadir nuevo y pipe exclusivo. Inicia únicamente su proceso hijo con `--no-defaults --skip-networking`.
   El entorno del hijo es una lista permitida de variables del sistema, sin DB_* ni herencia general; Vitest no carga `.env`.
3. La conexión usa solo socketPath de named pipe. No admite host, puerto, URL, stream ni sustitución de base; no existe fallback TCP.
   Antes de escrituras verifica datadir, archivo PID, PID vivo, pipe, versión, red desactivada y restricciones activas.
   El bootstrap verifica ausencia de la base y crea una marca aleatoria de identidad. Cada operación del pool vuelve a verificar instancia, base y token.
   Usa root sin contraseña únicamente dentro de esa instancia temporal sin TCP; no reutiliza credenciales existentes.
4. Carga padres mínimos y datos ficticios de fixture.sql; ejecuta preflight, las dos sentencias DDL y postcheck, deteniéndose al primer fallo.
   Conserva el manifiesto bajo la raíz temporal y solo entonces lanza la suite de integración explícita con la configuración propia.
5. `calendario.integration.test.ts` sustituye `@/lib/db` por el pool verificado y prohíbe query/execute globales y loadRuntimeEnv.
   Prepara escrituras reales, auditoría, rollback por error SQL de auditoría y del segundo período, concurrencia solapada/duplicada,
   aislamiento de empresas/entidades, FK compuesta y rechazo de los siete CHECK. La suite inicial aprobó siete casos;
   tras endurecer las aserciones y corregir el adaptador, se repitieron exclusivamente los dos casos concurrentes.
6. En una validación posterior separada, probar UI autenticada con usuarios ficticios y entidad inactiva, extremos compartidos y flujo de asientos.
7. Guarda logs sintéticos y detiene solo la instancia verificada o su propio handle hijo. No elimina bases ni directorios.
   No reutilizar un laboratorio parcial: una nueva ejecución crea otro UUID. No autoriza el siguiente PR.

Pendientes: navegador autenticado, compatibilidad real con MySQL y repetir la suite completa sobre la revisión final si se autoriza.
Las pruebas de render no sustituyen interacción DOM:
`happy-dom` está declarada en package.json pero no disponible en node_modules de esta estación; no se instaló ninguna dependencia.
Nada habilita el siguiente PR automáticamente.

## Antecedente: concurrencia y error interno 123

El segundo laboratorio aprobó siete pruebas, pero sus dos rechazos concurrentes no identificaban el motivo.
Ese resultado inicial no bastaba para cerrar la observación. Las aserciones endurecidas detectaron después ER_CHECKREAD;
la última ejecución, tras corregir la lectura de identidad, aprobó ambos escenarios sin errores 123 (ver resultado final).
`calendario-errores.ts` separa conflicto funcional del servicio, UNIQUE (1062), deadlock (1213), timeout (1205),
registro cambiado (`ER_CHECKREAD`, 1020) y fallo inesperado. El 123 del log del motor no es el errno SQL 1020 del cliente.
No se clasifican por texto ni solo por SQLSTATE. Códigos simbólicos/números contradictorios se consideran inesperados.
HTTP mantiene UNIQUE/deadlock/timeout como 409 con códigos públicos distintos. ER_CHECKREAD y errores internos conservan 500.
No se introducen reintentos ni cambios de aislamiento: sin confirmar el error de cliente, un retry ocultaría la evidencia.
Ante un transitorio confirmado se deberá evaluar por separado reiniciar la transacción completa después de rollback;
nunca reintentar automáticamente un COMMIT con resultado incierto.

Las dos pruebas de concurrencia ahora reservan dos conexiones independientes, registran CONNECTION_ID, aislamiento,
snapshot, marcas ISO de tiempo y sentencia parametrizada (sin valores), así como code/errno/sqlState/tipo en cada fallo.
Exigen una creación y un ErrorCalendario 409 por incompatibilidad; UNIQUE, deadlock, timeout y ER_CHECKREAD no satisfacen esa aserción.
Antes de exigir el motivo validan un ejercicio, exactamente dos períodos y una auditoría del ganador, correspondencia
de auditorías con ejercicios y postcheck completo. Un error del motor hará fallar la prueba aunque no duplique datos.

Procedimiento futuro, requiere nueva autorización para inicialización y DDL en una instancia temporal NUEVA:

```powershell
node scripts/ci/c3c1/run-windows.mjs --run-isolated --concurrency-only
```

Conserva las mismas barreras, fixture ficticio, preflight, migración y postcheck; filtra únicamente los dos casos
`concurrencia C3C-1:`. No reutiliza el laboratorio anterior ni omite la preparación segura.
Correlacionar `conexion` y marcas de tiempo de tests.log con server.log, exigir dos aprobadas/cinco omitidas,
revisar códigos de rechazo y comprobaciones posteriores. Si falla, conservar evidencia y detenerse sin repetir SQL.

## Corrección de la vista obsoleta

El laboratorio de concurrencia estricto confirmó ER_CHECKREAD/1020/HY000 en ambos escenarios bajo REPEATABLE READ
y snapshot=1. La secuencia efectiva era BEGIN -> verificación del adaptador (SELECT token normal de InnoDB)
-> empresa FOR UPDATE (puede esperar) -> entidad FOR UPDATE -> ejercicios FOR UPDATE -> inserciones/auditoría -> COMMIT.
El SELECT token de `verificarConexion` introducía una lectura consistente antes de que la segunda solicitud
obtuviera el lock de empresa. La consulta de conflictos posterior encontraba la fila recién confirmada fuera de esa vista.
Esto identifica una interferencia del adaptador del laboratorio; el servicio no contiene lecturas normales antes del lock.
La instrumentación de sentencias de servicio no mostraba las consultas internas del adaptador.

La corrección mínima es verificar la marca inmutable con `LOCK IN SHARE MODE`, una lectura con bloqueo,
no una lectura consistente. Se conservan identidad y token antes de cada operación. Los locks compartidos de la marca
son compatibles: no sustituyen la exclusión por empresa ni serializan artificialmente las dos conexiones.
El primer acceso de negocio sigue siendo empresa FOR UPDATE, seguido de entidad y conflictos dentro de la transacción.
Mientras todos los creadores usen ese lock estable, el segundo solicitante espera el COMMIT/ROLLBACK del primero;
sin la vista anticipada introducida por el wrapper, observa el ejercicio ganador y lanza ErrorCalendario 409.
La última ejecución confirmó este resultado en los dos escenarios previstos, sin afirmar cobertura de todas las intercalaciones posibles.

No se cambia `calendario.ts` salvo el comentario del contrato, ni los asientos, DDL o la política HTTP de errores.
La sintaxis LOCK IN SHARE MODE existe en MySQL 8 y MariaDB 11.8. El runner sigue limitado a MariaDB.
Se evaluó READ COMMITTED solo por transacción: el lock X de empresa mantendría la exclusión, pero no es necesario
introducir ese cambio de semántica para retirar esta lectura consistente accidental. Tampoco se cambia
innodb_snapshot_isolation, ni se agregan retries o conversiones de errores SQL en conflictos funcionales.

Las pruebas puras cubren el orden BEGIN/locks/conflictos/inserciones, la exclusión simulada y las consultas reales
emitidas por el adaptador con driver simulado. Se conserva intacta la exigencia de dos conexiones independientes,
rechazo funcional 409 y postchecks en `--concurrency-only`.

## Resultado final para revisión del PR

El 2026-10-27, la ejecución autorizada de concurrencia tras corregir safety.mjs obtuvo dos pruebas aprobadas,
cero fallidas y cinco omitidas en MariaDB 11.8.9, REPEATABLE READ e innodb_snapshot_isolation=1.
Ambos escenarios utilizaron conexiones independientes (IDs 6 y 7), produjeron una creación y un ErrorCalendario 409
por código o fechas incompatibles, y comprobaron un ejercicio, dos períodos y auditoría consistente por escenario.
Preflight, migración exclusiva del laboratorio y postchecks aprobaron. No aparecieron errores 123 ni entradas ERROR
en server.log. El servidor temporal terminó normalmente; la evidencia sintética permanece local y fuera del repositorio.
Dictamen: APTO PARA PR. No autoriza migración de entornos existentes, despliegue, publicación ni C3C-2.
