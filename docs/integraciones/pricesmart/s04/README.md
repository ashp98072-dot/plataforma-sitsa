# NOVALVION / PRICESMART-SANDBOX-S04

Fecha: 2026-10-31, America/Guatemala. Base: `99bc0799` (origin/main actualizado; merge #543/S03, que incorpora #542/S02). Rama/PR independientes. **D01-D16 siguen pendientes de ratificacion.** La decision de merge corresponde a auditoria independiente.

Entrega: esquema seleccionado, fixtures y protocolo de instalacion preparados para validacion real en S06. **No se certifica aislamiento operativo.** No se inicio MariaDB, no se ejecuto SQL contra un motor, no se creo servidor, no se importaron dumps, no se toco Hostinger/produccion/DNS/PR #541 ni se desplego o fusiono nada. Los unicos recursos usados por las pruebas son archivos temporales y dobles locales; las contrasenas efimeras son sinteticas.

## Inventario y procedencia

[schema-inventory.json](schema-inventory.json) inventaria codigo fuente, NO el estado de una DB:

- `sql/schema.sql`: 108 definiciones de tabla, 337 definiciones de indice (incluidas PRIMARY/UNIQUE inline normalizadas), 252 FKs inline y 6 ALTER diferidos. Se conservan columnas/definiciones, nombres, referencias compuestas, linea y hash SHA256 normalizado LF.
- 280 archivos SQL, incluidos migraciones/prechecks/postchecks/propuestas: hashes y sitios DDL/SET/PREPARE/EXECUTE con lineas. El orden de nombres no se trata como orden de migracion aplicado.
- `additionalDefinitions`: 70 definiciones literales adicionales (64 nombres distintos ausentes del baseline), con columnas/indices/FKs y procedencia de migraciones/propuestas o CREATE runtime. No se fusionan sus variantes ni se presuponen aplicadas.
- AST de src sin tests: 42 candidatos DDL/metadata en 12 archivos, 151 llamadas a ensure/asegurar Schema/Column y 14 referencias cualificadas a information_schema. Las directivas JavaScript `use client/server` no se cuentan como SQL USE.
- Los calificadores literales encontrados en src son metadatos information_schema; no se detecto un esquema de negocio externo literal en esos candidatos. Esto NO demuestra ausencia de SQL dinamico, imports calculados o dependencias fuera del grafo revisado.

Limites: el separador entiende comentarios, literales y comillas con punto y coma; NO es parser completo MariaDB. Comentarios ejecutables/versionados, procedimientos/DELIMITER, DDL dinamico y backfills se inventarian como fuentes a revisar, no se ejecutan ni se deduce su efecto final. El inventario registra el baseline de schema y cambios de fuentes, no pretende consolidar todas las migraciones en una supuesta DB actual. S06 debera contrastarlo con INFORMATION_SCHEMA y SHOW CREATE TABLE de su instancia NUEVA, nunca consultar produccion para completar este trabajo.

### Subconjunto minimo y dependencias

Minimo de autenticacion/seleccion: empresas, usuarios, usuario_empresa y usuario_modulo, mas el marcador S02. No necesita un esquema PriceSmart nuevo. El perfil ampliado S04 de lectura sintetica incluye **26 tablas / 49 FKs**:

| Grupo | Tablas |
|---|---|
| Identidad y acceso | novalvion_environment, empresas, usuarios, usuario_empresa, usuario_modulo |
| Maestros | auditoria, clientes, empleados, tms_clientes, tms_lugares, flota_vehiculos, tms_unidades, tms_personal, flota_vehiculo_acceso |
| Rutas y ubicaciones | tms_cliente_ubicaciones, tms_cliente_contactos, tms_cliente_rutas, tms_cliente_ruta_personal, tms_cliente_ruta_paradas, tms_cliente_ruta_tarifas, tms_ruta_tarifas |
| Solicitudes y padres necesarios | tms_cliente_usuarios, tms_solicitudes_cliente, tms_solicitud_paradas, tms_planes_viaje, tms_cotizacion_costeo_perfiles |

El generador hace cierre transitivo de FKs, incluidas las diferidas de schema, y ordena CREATE antes de cargar datos; aplica los ALTER seleccionados despues de crear TODOS los padres. No desactiva FK ni CHECK, no usa IF NOT EXISTS, no importa DML/backfills originales ni ejecuta el schema completo. Las tablas planes/perfiles de costeo se crean como dependencias reales de FK aunque quedan SIN filas; la solicitud sintetica tiene plan_id=NULL y no se convierte a viaje.

Procedencia adicional explicitada en `plan.json`:

- `tms_cliente_ruta_tarifas` viene de `sql/migrate-2026-09-rutas-tarifario-historial.sql`; no esta en el baseline schema.
- `flota_vehiculo_acceso` viene del CREATE literal en `src/lib/flota/schema.ts`; no tiene FK fisica en esa definicion. Sus enlaces a vehiculo/empresa se comprueban como referencias LOGICAS adicionales, sin inventar una nueva FK productiva.
- Dos ALTER de `sql/migrate-2026-08-fase0-tms-personal-empleado.sql` agregan id_empleado y su FK; se excluye el UPDATE historico por coincidencia de nombres. La columna se crea SIN IF NOT EXISTS en el esquema nuevo.
- rtu y condicion_credito de clientes se extraen de las definiciones existentes de `src/lib/clientes/schema.ts`; el baseline no las contiene. No se ejecuta la funcion runtime para conseguirlas.
- El CREATE del marcador es el de la plantilla S03, sin modificar S02/S03.

`plan.json` conserva orden, DDL, hashes de fuentes, columnas/indices/FKs y grants. Los `.sql.in` generados son legibles y comienzan con SIGNAL deliberado: no ejecutarlos directamente ni quitar esa parada para saltarse el protocolo. El modulo de instalacion usa el plan revisado, NO ejecuta esos archivos a ciegas.

### Migradores y ensureSchema: bloqueos reales

`scripts/init-db.mjs` lee configuracion operativa, contiene semillas corporativas y hashes legacy; S02 lo bloquea en sandbox y S04 no lo usa. No existe en este cambio un runner general de todas las migraciones.

`asegurarSchemaClientes()` hace CREATE TABLE aun si la tabla existe y despues inspecciona columnas/ALTER; `asegurarModulosClientesFacturacion()` puede actualizar modulos_json y el puente de clientes puede escribir vinculos. Catalogos GET tiene catches, pero eso no prueba que todos sus subflujos funcionen sin permisos de escritura. `asegurarSchemaFlota()` ejecuta metadatos, GET_LOCK, ALTER/CREATE e incluso migraciones de paradas; su variante Lectura tambien lo intenta en frio. RRHH/Facturacion y herramientas administrativas tienen otros caminos registrados en el inventario.

Crear previamente una tabla NO elimina el requisito CREATE de un CREATE TABLE IF NOT EXISTS: [MariaDB CREATE TABLE](https://mariadb.com/docs/server/server-usage/tables/create-table). Por ello **no** se concede DDL al runtime para ocultar estas dependencias. El perfil cubre login/seleccion y funciones de lectura auditadas, NO todo Centro Logistico, Programacion, Flota, dashboards, conversion a viaje o escritura TMS. El funcionamiento HTTP/UI completo con estos grants queda PENDIENTE S06; una ruta que llame un migrador obligatorio debe fallar o quedar fuera del alcance hasta un cambio revisado, no obtener ALTER/CREATE.

## Fixtures ficticios y limites

[fixtures.json](../../../../infra/pricesmart-sandbox/s04/fixtures.json) contiene **29 filas** con IDs reservados 710001-792003, nombres QA, correos example.invalid y direcciones explicitamente ficticias, sin coordenadas, NIT, telefono, cliente real ni dato contable. Fechas de solicitud: 2035-01-15.

Empresa principal: `kt-monaco`, codigo QA_MONACO_S04 y nombre de laboratorio. Segundo tenant `qa-denied-s04` es exclusivamente un control sintetico de denegacion. Usuarios Visualizador sin Admin/acceso_todas_empresas, asignados por usuario_empresa; permisos explicitos de lectura para el lector principal. No se prueban defaults administrativos como sustituto del aislamiento.

No se encontro una tabla/entidad propia `sucursales`: dos puntos de laboratorio se representan mediante tms_lugares y una ubicacion ficticia del cliente mediante tms_cliente_ubicaciones. Esto NO implementa un maestro corporativo de sucursales ni un modelo PriceSmart. Si se requiere otra semantica, mantenerla pendiente en vez de inventar estructuras.

Vehiculo/unidad y piloto/empleado ficticios mantienen sus enlaces. La ruta tiene unidad recurrente, contacto, empleado y parada reales DEL FIXTURE, con tarifa/viatico cero. La solicitud SOLICITADA contiene Carga/Entrega/Descarga conforme al validador de dominio actual. Su usuario de portal tiene activo=0: es solo un padre de FK, no habilita login de portal ni endpoints nuevos. Perfiles de costeo, planes, auditoria e historiales adicionales permanecen vacios.

Los hashes/salts de usuarios son placeholders. `materialize()` exige tres secretos distintos, nuevos, con namespace sandbox:pricesmart-qa y 64 hex, distintos de las tres claves runtime. Usa `src/lib/password.ts` existente (scrypt), sin duplicar el algoritmo. Se necesita Node 24 para importar ese helper TS desde MJS; no se cambia package.json para este uso administrativo. No imprimir ni versionar claves, hashes materializados, cookies o SQL con parametros. El origen sintetico se apoya ademas en inventario/fixtures revisados: un prefijo por si solo no demuestra procedencia de un secreto.

## Matriz de permisos

[permissions.json](../../../../infra/pricesmart-sandbox/s04/permissions.json) enumera cada una de las 26 tablas y cada operacion: SELECT=true; INSERT/UPDATE/DELETE/DDL/GRANT OPTION=false. [grants.sql.in](../../../../infra/pricesmart-sandbox/s04/grants.sql.in) refleja la misma matriz tabla por tabla para sandbox_pricesmart@127.0.0.1.

Es el minimo del perfil de LECTURA seleccionado, no una matriz para todos los modulos de Novalvion. Auth con hashes scrypt no requiere el UPDATE de rehash legacy. Cambiar password, altas, auditorias de escritura y CRUD/conversion de solicitudes/rutas no estan habilitados; los ejecuta exclusivamente el instalador durante fixtures o requieren otro perfil revisado.

No hay schema.*, privilegios globales efectivos, roles, FILE, EXECUTE, DDL ni acceso a otra base. USAGE ON *.* se admite solo como ausencia de privilegios; el validador rechaza cualquier otro grant global, PUBLIC con permisos, cuenta/host distinto, GRANT OPTION o permiso adicional, y exige los 26 SELECT. El marcador solo es legible y su fila unica esta restringida por PK/CHECK.

La cuenta runtime queda **ACCOUNT LOCK incluso al terminar**. No se habilita su uso hasta S06 autorizado; no hay sentencias ACCOUNT UNLOCK en S04. El usuario administrativo usa socket Unix root local sin password, distinto de la cuenta app. La separacion replica la instalacion administrativa S03; no da sudo al runtime.

Los grants por tabla no son row-level security: el runtime DB podria leer ambos tenants sinteticos. La denegacion entre usuarios/empresas depende de la autorizacion de aplicacion S02/tenant; se prueba con dobles y debe acreditarse por HTTP en S06. Tampoco debe interpretarse el acceso de visibilidad limitada a information_schema como un grant a otra base de negocio. Reglas de privilegios: [MariaDB GRANT](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant).

## Protocolo futuro S06: nueva instancia, nunca adopcion

**No se ejecuta en S04.** Preparar una VM/instancia MariaDB nueva requiere aprobacion adicional. No conectar este modulo a MySQL/MariaDB existentes de la estacion o del hosting. La plantilla `approval.example.json` tiene autorizacion=false y placeholders.

1. Cumplir S03: VM exclusiva, firewall cerrado, Linux/Node24/MariaDB11.8 aprobados, UID/codigo/config/secretos privados, sin mounts productivos. Identificar VM/discos/PID, socket y datadir fisico sin enlaces; registrar evidencia firmada/independiente y SHA256. La aprobacion declarativa no prueba por si misma que la VM sea nueva: un operador debe comprobarlo fuera de este modulo.
2. Inicializar SOLO el datadir nuevo `/var/lib/novalvion-ps-db`, con los paquetes aprobados y administracion local por socket. Retirar test/usuarios anonimos/grants PUBLIC del instalador en ESTA instancia nueva antes de S04, sin tocar otras instancias. Deben existir unicamente los esquemas de sistema mysql/sys/information_schema/performance_schema y cuentas locales root/mysql/mariadb.sys/novalvion-ps-db autorizadas. Toda otra cuenta/base causa rechazo; no se borra para continuar.
3. **S04 sustituye el paso de SQL de identidad S03**, no se ejecuta despues: NO aplicar antes `provision-identity.sql.in` de S03. Si ya existe sandbox_pricesmart o su usuario, rechazar y preservar ese laboratorio. Crear una instancia NUEVA para este protocolo; no resetear tablas ni adoptar el marcador anterior.
4. El instalador prepara manifiesto y env privados siguiendo S02/S03 y tres claves QA nuevas por canal privado (no argv, consola o transcript). Revisar SHA del codigo/plan/fixtures contra este PR. La identidad sandbox (id/nombre/user/puerto) es fija y debe coincidir con S03. El manifiesto no se deriva automaticamente de variables arbitrarias.
5. Crear un directorio de journal NUEVO de instalador fuera del artefacto/runtime, por ejemplo `/var/lib/novalvion-ps-installer`, root:root 0700, ancestros protegidos y sin enlaces. `fileJournal()` reutiliza assertSandboxPath S02, exige propietario/modo en Linux y crea `s04-attempt.json` con wx/0600, fsync y sin secretos. Nunca borrar/reescribir un intento para reejecutar. La comprobacion de modos POSIX y durabilidad real se ensaya en S06.
6. Un harness S06 revisado crea UNA conexion fisica mysql2 por `/run/novalvion-ps-db/mariadb.sock`, usuario root local, sin password y sin base seleccionada. S04 no contiene driver, lector de credenciales, --apply ni CLI para abrir conexiones. Importar `prepare(conn, {env,cwd,approval,journal,passwords})` solo despues de autorizacion S06, con evidencia de instancia nueva. El caller cierra esa conexion en finally y no usa pools/callbacks que cambien de conexion.
7. Antes de modificar datos se aplica el validador S02 al env/manifiesto; se comprueba igualdad del plan contra fuentes revisadas y credenciales QA separadas. En la conexion se verifican MariaDB 11.8, datadir, puerto 43306, bind127.0.0.1, FK/CHECK=1, local_infile=0, SQL_MODE estricto, root@localhost y CONNECTION_ID estable. Se rechaza transporte TCP, password administrativo, cuenta app como instalador o base inicial seleccionada.
8. Consultar esquemas, mysql.user y SHOW GRANTS FOR PUBLIC. Reclamar journal exclusivo y GET_LOCK no bloqueante; releer identidad/vacio bajo lock para rechazar carreras. Solo despues CREATE DATABASE sin IF NOT EXISTS, USE de esa base fija y los 34 DDL seleccionados. Identidad/CONNECTION_ID se verifican antes de cada mutacion. No SET FOREIGN_KEY_CHECKS=0 ni cambios de politicas globales.
9. Antes de filas: comprobar conjunto exacto de 26 tablas InnoDB, indices declarados (incluidos los de ALTER), conjunto de 49 FKs y ausencia de triggers/rutinas/eventos. Cargar marcador y fixtures en transaccion con parametros. Validar cada FK mediante antijoin, counts de filas, unicidad/columnas/referencias fisicas y logicas del fixture. `postcheck.sql.in` publica las consultas de integridad, sin desactivar constraints. S06 debera comprobar ademas tipos/indices efectivos con SHOW CREATE TABLE.
10. Commit de las filas; crear cuenta app NUEVA bloqueada con su clave S02 y aplicar SELECT por tabla. Verificar SHOW GRANTS exacto. Persistir `PREPARED_LOCKED_REQUIRES_S06`. No publicar secretos ni arrancar app automaticamente. El instalador entrega evidencia sanitaria (version, hashes, nombres/IDs QA, counts, resultados), no logs de driver, private env, passwords o hashes materializados.
11. Cualquier error detiene el flujo y deja `INCOMPLETE_DO_NOT_REUSE_<fase>` si se reclamo journal. Rollback solo de DML propio si identidad sigue igual; nunca DROP/TRUNCATE/reparacion/reintento automatico. DDL hace commit implicito y no se promete rollback del esquema: [MariaDB implicit commits](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit). Preservar instancia/parciales y diagnosticar; la siguiente aceptacion usa OTRO laboratorio nuevo autorizado. Si falla la durabilidad del journal o se pierde la conexion, bloquear emision de credenciales y verificar manualmente la cuenta bloqueada; el caller debe cerrar la conexion.
12. Solo tras gates S06 y aprobacion del operador, habilitar temporalmente la cuenta dentro del laboratorio privado para pruebas reales. Probar SELECT, login/selector, rutas/solicitudes auditadas y denegacion de UPDATE/INSERT/DELETE/ALTER/CREATE sobre marcador/tablas, acceso a una base canario EXCLUSIVAMENTE sintetica y escritura fuera de tabla. Con sesion del lector principal comprobar tenant denegado, portal inactivo y ausencia de conversion/viajes/contabilizacion. Probar cold-start para detectar ensureSchema, sin ampliar grants para hacerlo pasar. Mantener red cerrada y endpoints PriceSmart apagados. Registrar todo como PASS/FAIL/NO EJECUTADA.

Ni el motor ni los mocks garantizan frente a un administrador hostil que cambie datos concurrentemente. GET_LOCK solo coordina instaladores cooperantes; la revision de VM, permisos y ausencia de otros escritores sigue siendo obligatoria. El hash de evidencia es una referencia a aprobacion externa, no verificacion criptografica de su firma dentro del engine.

## Artefactos y comandos offline

```text
node scripts/sandbox-s04/audit.mjs --write
node scripts/sandbox-s04/plan.mjs --write
node node_modules/vitest/vitest.mjs run --config vitest.s04.config.mts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js scripts/sandbox-s04 vitest.s04.config.mts
git diff --check
git diff --cached --check
```

Los dos primeros SOLO leen fuentes y escriben los artefactos versionados; no conectan ni ejecutan SQL. Las plantillas SQL deliberadamente abortan si alguien las entrega directamente a un cliente. No existe un comando S04 que aplique SQL a una URL/host proporcionado. El modulo Node24 de fixtures puede emitir advertencia de tipado de modulo al importar password.ts directamente; no modifica configuracion del proyecto ni imprime secretos.

Los scripts de instalacion/fixtures/inventario, el SQL y el journal **no forman parte del artefacto runtime S03**. No actualizar su allowlist para incluirlos. Se conservan sin cambios los guards y plantillas fusionados de S02/S03. Resultados y pendientes: [EVIDENCIA.md](EVIDENCIA.md).
