# PRICESMART-SANDBOX-S03: receta Linux privada para revision

Fecha: 2026-10-31, America/Guatemala. Base sincronizada: `492dd7c3dc83e434b504f3827652cc6a5785be49`, merge de PR #542/S02. S03 es un PR independiente. **D01-D16 siguen pendientes de ratificacion.** Ninguna propuesta de este documento constituye una decision comercial o de integracion aprobada.

Estado: plantillas revisables y pruebas offline, **sin infraestructura aprovisionada**. No se contrataron servidores, no se modifico DNS, no se abrieron puertos, no se activo PriceSmart ni se tocaron Hostinger, produccion, PR #541 o datos reales. No ejecutar esta receta hasta una revision posterior de aislamiento/seguridad y autorizacion operativa.

## Arquitectura propuesta y limite de confianza

Una VM/VPS Linux exclusiva de Monaco, sin discos, cuentas, redes privadas ni secretos compartidos con produccion. Perfil de referencia propuesto: Linux x86_64 con systemd >=252, nftables, Node 24 compatible con engines del lockfile, MariaDB 11.8, nginx y age. Ubuntu LTS o Debian mantenido son alternativas; version, paquetes, hashes, proveedor, region, soporte y presupuesto deben aprobarse y fijarse en el inventario real ANTES de instalar. La validacion de S03 no instala ni descarga esos componentes.

```text
Sin acceso publico / sin salida externa
  navegador autorizado (acceso local/gestion privada pendiente)
       -> https://localhost:4316 [nginx solo 127.0.0.1]
       -> http://127.0.0.1:3000 [Next, start-sandbox S02]
       -> 127.0.0.1:43306 [MariaDB EXCLUSIVA]
           sandbox_pricesmart + novalvion_environment
```

No hay SSH/VPN configurado por esta receta. La consola fuera de banda del proveedor es requisito para instalar/verificar/recuperar el firewall. El eventual acceso de un operador mediante tunel privado necesita revision separada de origen, autenticacion y transporte; no se agrega una excepcion SSH universal para hacerlo funcionar. Hasta entonces la UI solo se puede usar desde el propio entorno privado. No usar un navegador con sesiones productivas.

S02 ya implementa selector, secretos con namespace/hash, manifiesto, rechazo de `.env`, rutas sin enlaces, loopback y marcador por operacion DB. **S03 no modifica ni reimplementa esos guards.** El arranque propuesto llama `scripts/start-sandbox.mjs`; la suite S03 importa `validateSandboxConfig` existente. `pricesmart-plan.mjs` revisa la coherencia del unico perfil de infraestructura propuesto; no es un validador general de systemd/nftables ni aplica configuracion.

El guard DB S02 es posterior al handshake TCP: el firewall y una instancia sin produccion son necesarios. Tampoco garantiza aislamiento frente al administrador de la VM o a procesos maliciosos con el mismo UID. No montar sockets Docker, credenciales de nube, home de operadores ni backups de otros entornos.

## Archivos versionados

En [infra/pricesmart-sandbox](../../../infra/pricesmart-sandbox) estan el inventario propuesto, `isolation.json.example`, `runtime.env.example`, usuarios/directorios, MariaDB, nftables, nginx, SQL de identidad, allowlist del artefacto, backup y seis unidades systemd. Son plantillas sin secretos y **no un instalador**. Los placeholders de manifiesto/entorno/destinatario de backup fallan intencionalmente antes del uso.

Herramientas offline: `scripts/infra/pricesmart-plan.mjs`, `pricesmart-build.mjs` y `pricesmart-s03.test.mjs`; configuracion `vitest.s03.config.mts`. El builder es una entrada manual para la futura unidad aislada; no se ejecuto un build/despliegue en esta entrega.

## Identidades, permisos y almacenamiento

| Recurso | Dueno:grupo / modo propuesto | Escritura |
|---|---|---|
| `/opt/novalvion-ps-sandbox/app` y ancestros | root:novalvion-ps-sandbox, directorios 0750, archivos de codigo 0640 | Solo instalador; nunca runtime |
| node_modules y binarios nativos necesarios | root:novalvion-ps-sandbox; conservar bits de ejecucion necesarios, sin g+w/o+w | Instalador |
| `.next/cache` precreada | novalvion-ps-sandbox, 0700 | Runtime, unico subtree escribible del artefacto |
| `/srv/novalvion-ps-sandbox` | root:novalvion-ps-sandbox 0750 | Solo instalador |
| `isolation.json` | root:novalvion-ps-sandbox 0640 | Solo instalador; runtime lee |
| uploads y directorios estructurales de empresa/categoria | root:novalvion-ps-sandbox 0750 | Solo instalador |
| Hojas de uploads aprobadas | novalvion-ps-sandbox 0700; archivos 0600 | Runtime con umask 0077 |
| `/var/lib/novalvion-ps-db` | novalvion-ps-db 0700 | Solo MariaDB |
| `/etc/novalvion-ps-sandbox` | root:root 0755 | Solo instalador; recorrido permite leer configs no secretas |
| runtime.env | root:root 0600 | Solo instalador; systemd lo inyecta, no se copia a app |
| mariadb.cnf, nginx.conf, nftables.conf | root:root 0644 | Solo instalador |
| `tls/` y `tls/server.key` | root:novalvion-ps-proxy 0750 / 0640 | Solo instalador; proxy lee |
| `/run/novalvion-ps-{app,db,proxy}` | Identidad correspondiente 0700 | Solo su servicio; efimero |
| `/var/lib/novalvion-ps-build/source` | novalvion-ps-build 0700 | Builder sin runtime.env, DB o uploads |
| `/var/backups/novalvion-ps-sandbox` | root:root 0700 | Tarea de backup del operador; inaccesible a runtime |

Las cuatro cuentas sysusers no tienen login, sudo ni grupos productivos. El instalador es otra identidad administrativa; el usuario de la aplicacion **no instala paquetes, administra systemd, configura red ni posee codigo/manifiesto/ancestros**. Firewall requiere CAP_NET_ADMIN y backup requiere lectura privilegiada de archivos 0600: son tareas administrativas propuestas, separadas del runtime. Backup no es un daemon ni un usuario de aplicacion elevado.

`ReadWritePaths` acota el filesystem con `ProtectSystem=strict`; no sustituye permisos Unix ni elimina acceso por sockets Unix. Ese comportamiento y la configuracion de servicios se basan en [systemd.exec 252](https://www.freedesktop.org/software/systemd/man/252/systemd.exec.html). No usar symlinks `current`, bind mounts de produccion o chmod/chown recursivos sobre rutas existentes. `tmpfiles.conf` contiene solo directorios nuevos, sin reglas de limpieza por edad.

La lista exacta de hojas de uploads y el esquema/grants por tabla son gates previos al arranque, no permisos amplios por defecto. Si falta una hoja o Next necesita otra ruta de cache, registrar el fallo y revisar el path concreto; no conceder escritura sobre toda la raiz ni todo `.next`. El cache de Next puede requerir escritura en self-hosting; revisar las guias instaladas `node_modules/next/dist/docs/01-app/02-guides/self-hosting.md` y `environment-variables.md` de Next 16.4.1 antes de construir.

## Matriz de puertos y conexiones

| Emisor -> receptor | Transporte | Permiso propuesto |
|---|---|---|
| Operador local -> TLS | TCP 127.0.0.1:4316 | Permitido solo loopback, certificado privado para localhost |
| nginx -> Next | TCP 127.0.0.1:3000 | Permitido solo loopback |
| Next -> MariaDB | TCP 127.0.0.1:43306 | Permitido solo loopback, usuario sandbox limitado |
| Operador/backup -> MariaDB | Socket `/run/novalvion-ps-db/mariadb.sock` | Local, raiz/DB, sin password en argumentos |
| Trafico de respuesta | IPv4 loopback establecido | Permitido exclusivamente por interfaz/direccion loopback |
| Entradas publicas o privadas fuera de loopback | Cualquier puerto, IPv4/IPv6 | DENEGADAS; incluye 22/80/443/3000/4316/43306 |
| VM/runtime -> produccion/Hostinger/PriceSmart/SMTP/FEL | Cualquier IP/puerto | DENEGADAS |
| DNS, NTP, telemetria, proxies, Internet, backups remotos | UDP/TCP y resto | DENEGADOS; sin destinos externos autorizados |
| IPv6, forwarding y nuevas conexiones fuera de la lista | Cualquier protocolo | DENEGADOS |

`nftables.conf` usa tabla dedicada, input/output/forward con policy drop y solo acepta loopback IPv4 a los tres puertos. No tiene `flush ruleset`, NAT ni accepts establecidos generales sobre interfaces externas. Las reglas de estado siguen la documentacion oficial de [nftables/conntrack](https://wiki.iptables.org/wiki-nftables/index.php/Matching_connection_tracking_stateful_metainformation). `IPAddressDeny=any`/`IPAddressAllow=127.0.0.1/32` aportan otra capa para app/DB/proxy; deben verificarse soporte cgroup/BPF y efectividad en la VM segun [systemd.resource-control](https://www.freedesktop.org/software/systemd/man/252/systemd.resource-control.html). No declarar esa capa operativa PASS si el kernel la ignora.

App/DB/proxy comparten el loopback de la VM: **no** poner cada servicio en `PrivateNetwork=yes`, porque impediria sus conexiones mutuas. Builder y backup si usan red privada: el primero solo necesita loopback interno de compilacion y el segundo usa socket Unix. El ruleset completo es intencionalmente conservador y puede bloquear gestion/actualizaciones: probarlo desde consola fuera de banda, en VM nueva, nunca en hosting o un host compartido. No se configura un allowlist de produccion: todo destino externo queda cerrado, incluso IPs productivas todavia desconocidas.

## Procedimiento futuro de aprovisionamiento (NO ejecutado)

1. Monaco aprueba inventario, propietario, sistema operativo/versiones/hashes y acceso de consola. Registrar evidencia de VM vacia y discos nuevos; no clonar una imagen con datos/configuracion de negocio. Confirmar ausencia de servicios/volumenes de produccion, redes productivas, proxies y variables operativas. Mantener deny de red en el perimetro del proveedor; esta entrega no crea esa regla real.
2. En una estacion de build separada, descargar/verificar paquetes y dependencias aprobados; registrar version y SHA256 de imagen, Node, MariaDB, nginx, systemd/nftables y del lockfile. Transportar un bundle offline. Ninguna unidad runtime necesita acceso a registros/npm/apt. No relajar el firewall para resolver instalaciones o actualizaciones; mantenimiento requiere otra ventana aprobada.
3. El instalador revisa `sysusers.conf` y `tmpfiles.conf`, inspecciona que las rutas no existan ni sean enlaces, crea cuentas/directorios nuevos y copia configs root-owned. Las futuras herramientas `systemd-sysusers` y `systemd-tmpfiles --create` requieren operador administrativo; no se ejecutan aqui. No asignar privilegios administrativos a las cuentas propuestas. En maquinas existentes, abortar en vez de reapropiarse de rutas.
4. Desde consola, verificar `nft --check --file ...`, cargar la tabla dedicada y verificar input/output/forward, IPv6 y ausencia de excepciones. Instalar unidades revisadas y ejecutar `systemd-analyze verify` antes de iniciar nada. No instalar drop-ins globales ni reemplazar el firewall de otro servicio. Verificar que un fallo de firewall impide app/DB/proxy. No habilitar unidades aun.
5. Construir y revisar el artefacto segun la seccion siguiente. El instalador lo copia a un directorio nuevo real (sin alias/symlinks), fija propietarios/modos de codigo y cache, y aplica la allowlist `runtime-files.json`. No copiar `.git`, src, SQL, CI/laboratorios, docs, infra, uploads o archivos `.env*` operativos al artefacto. Mantener solo los tres scripts de arranque S02 permitidos. No copiar el builder al runtime.
6. Inicializar MariaDB SOLO con datadir vacio nuevo `/var/lib/novalvion-ps-db`, socket exclusivo y el paquete aprobado. Usar `mariadb-install-db` con autenticacion local por socket para la administracion, sin password en argv. Verificar opciones de esa version, usuario novalvion-ps-db y que el paquete soporte Type=notify. No usar su servicio global, replicacion ni importaciones de dumps productivos. Arrancar solo la unidad DB tras firewall. Inspeccionar VERSION(), @@datadir, @@port y @@bind_address por socket antes de SQL. Deshabilitar cuentas anonimas/test y grants PUBLIC heredados del instalador solo en ESTA instancia nueva; no tocar otras bases.
7. Aprobar el inventario operativo desde evidencia de la VM. Generar localmente TRES secretos distintos con CSPRNG, exactamente `sandbox:pricesmart-qa:<32 bytes hex>`; no imprimir, pasar por argv, pegar en tickets o incluir en repositorio. Mantenerlos en fichero temporal privado 0600. Cada hash SHA256 se calcula sobre los bytes UTF-8 del valor completo, sin newline; provisionar `isolation.json` desde el inventario aprobado y esas huellas. **No** autogenerar el manifiesto al arrancar desde variables arbitrarias. Un instalador valida contenido S02 antes de fijarlo root:grupo 0640.
8. Renderizar `runtime.env.example` fuera del artefacto con esos mismos valores, como root:root 0600; no usar shell `source`, no incluir otras variables o proxies y no usar NEXT_PUBLIC para secretos. Proteger backups de configuracion con el mismo criterio. El runtime no debe escribir ni reemplazar este archivo, manifiesto o sus ancestros.
9. Renderizar `provision-identity.sql.in` en area 0700/0600, sustituyendo solo el password aprobado. La primera sentencia SIGNAL bloquea deliberadamente la plantilla: solo el instalador, despues de revision independiente, elimina esa sentencia del archivo renderizado. Ejecutar por stdin/socket admin despues de verificar de nuevo identidad de la instancia. No usar `IF NOT EXISTS`: una base/cuenta previa exige abortar. La plantilla crea base nueva y marcador unico `id=1/environment=sandbox/sandbox_id=pricesmart-qa`, y solo concede SELECT del marcador. Eliminar el SQL temporal privado una vez verificado, sin publicarlo.
10. El responsable de esquema aprueba una secuencia especifica de DDL/migraciones existentes y fixtures SOLO sinteticos; registrarla con hashes/orden y pre/postchecks. **No** ejecutar init-db general, CI o semillas productivas con credenciales sandbox: S02 bloquea los administrativos y el runtime no debe tenerlos. Aplicar el esquema como provisionador, comprobar que no hay rutinas/eventos/triggers con acceso exterior y que la unica empresa/usuarios/datos son sinteticos de `kt-monaco`.
11. Elaborar una lista tabla-privilegio para las pantallas autorizadas. Conceder DML estrictamente necesario por tabla y solo SELECT sobre marcador. Sin `schema.*`, privilegios globales, roles, GRANT OPTION, FILE, EXECUTE, CREATE/ALTER/DROP ni escrituras en marcador. Revisar SHOW GRANTS y pruebas negativas de otra DB/marcador. Los ensureSchema existentes pueden fallar sin DDL: resolver en el aprovisionamiento revisado, no ampliar permisos runtime. **Sin lista/schema/hojas de uploads aprobados, no arrancar app.**
12. Provisionar certificado privado valido para localhost y clave solo legible por novalvion-ps-proxy. No modificar DNS ni usar ACME publico. Confiar en la CA privada mediante procedimiento autorizado; nunca ignorar advertencias TLS. Confirmar `nginx -t -c ...` como usuario proxy, ownership efectivo y permisos de directorios temporales. No se han generado certificados en S03.
13. Iniciar app mediante su unidad: entorno NOVALVION_ENV=sandbox ANTES de importar Next; start-sandbox valida S02 y fija `-H 127.0.0.1`. Iniciar despues proxy. Verificar `ss -lntp`, arbol de procesos y systemd cgroup; solo 127.0.0.1 en 3000/4316/43306. KillMode=control-group debe detener tambien los hijos del wrapper. Stop de app/proxy deja MariaDB funcionando.
14. Ejecutar la revision posterior: pruebas reales de filesystem/identidad/grants/red/puertos/secrets/TLS/reinicio/backup/restore. No probar destinos reales de produccion: usar sumideros sinteticos dentro de un laboratorio controlado para demostrar drops, inspeccionar counters/rules y ausencia de rutas privadas productivas. Solo despues decidir acceso privado de operador; PriceSmart permanece sin endpoint/worker/scheduler ni salida autorizada.

## Build sin credenciales productivas

S02 rechaza `npm run build` en modo sandbox. La unidad manual `novalvion-ps-build.service` limpia el entorno con `env -i`, usa un usuario diferente, no monta recursos runtime y aisla la red. `pricesmart-build.mjs` rechaza cualquier variable DB/secretos/proxies/NODE_OPTIONS/NEXT_PUBLIC y archivos `.env*`/config ancestral antes de Next. Genera solo una clave de auth efimera de compilacion en memoria, sin DB y sin NOVALVION_ENV/SANDBOX_*. Llama al `next-command.mjs build` existente. No cambia los defaults productivos ni debilita S02 para permitir build/dev.

El source viene de `git archive <SHA revisado>`, sin configuraciones operativas, mas node_modules producido con `npm ci` y el lockfile verificado para la arquitectura Linux. La instalacion de dependencias se hace en una estacion aprobada, nunca con runtime.env y no durante el build sin red. No reutilizar node_modules Windows en Linux. Revisar scripts de lifecycle antes de instalarlos. El builder no necesita secretos runtime, direcciones DB o dominios reales.

La compilacion debe terminar sin intentar red/SQL; si requiere datos o falla por prerender, registrar FAIL y revisar en otro cambio, no habilitar egress ni anadir credenciales. Inspeccionar bundle cliente, trazas `.nft.json`, dependencias nativas y contenido del artefacto contra allowlist antes de copiar. No seguir symlinks fuera de la raiz al empaquetar. Mantener package.json/lock, next.config.ts, `.next`, `public`, node_modules Linux revisado y los tres scripts S02. Probar que Next inicia con ese artefacto reducido: **pendiente**, no afirmado por tests estaticos. No ejecutar herramientas administrativas/CI desde el servicio.

## Supervisores y logs

Se proponen unidades separadas para firewall, MariaDB, app, TLS, build manual y backup manual. Solo las primeras cuatro tienen Install; **no se han habilitado**. Las dependencias exigen firewall antes de listeners. DB notify y app Restart=on-failure tienen que ensayarse en la imagen elegida; un arranque ordenado no sustituye la prueba de identidad S02 por operacion. Ante incoherencia se detiene, no se corrige automaticamente.

El instalador futuro copia `backup.sh` a `/usr/local/libexec/novalvion-ps-backup`, root:root 0750, y el destinatario publico aprobado a `/etc/novalvion-ps-sandbox/backup.recipients`, root:root 0644. Nunca instalar el placeholder como destinatario valido. Los archivos de infraestructura fijan LF mediante `.gitattributes`; usar el contenido del commit/archivo Git, no un editor que convierta los scripts a CRLF.

No activar logs SQL ni access logs HTTP. Conservar journald local con cuota/retencion aprobadas y acceso de administradores, sin exportacion remota en el perfil cerrado. No capturar Environment, `/proc/*/environ`, cookies, SQL privado o runtime.env como evidencia. Revisar logs antes de compartir; el journal existente de la app no se presupone sanitizado. No abrir un puerto de health, metricas o alertas; inspeccion local hasta revision posterior.

## Backups y recuperacion

Propuesta inicial para presupuestar: RPO 24h y RTO 4h, 7 copias diarias y 4 semanales, **pendientes de aprobacion y simulacro**. No son SLA. Monaco debe proveer volumen dedicado de backup, clave publica age y custodio de la clave privada offline. Sin mecanismo de traslado fuera de la VM aprobado, una copia en el mismo VPS NO cubre perdida del proveedor/disco. No se configuran destinatarios o credenciales reales. No hay timer ni borrado automatico de retencion en S03.

`novalvion-ps-backup.service` es una tarea administrativa de root con solo lectura DAC adicional y filesystem restringido; no eleva al usuario app. Conflicts detiene app/proxy antes de capturar DB/uploads. Usa el socket admin local, verifica DB/marcador, `mariadb-dump --single-transaction --skip-lock-tables` de UNA base, tar de uploads y manifiesto, hashes internos y cifrado age a destinatario privado pendiente. No copia tablas mysql/usuarios, claves TLS ni runtime.env. La [documentacion de mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump) condiciona consistencia a motores transaccionales y ausencia de cambios DDL: verificar todas las tablas InnoDB y bloquear escritores/DDL durante la ventana; de otro modo abortar. El script propuesto no valida motores por si mismo: es un gate del operador.

Se rechazan uploads con enlaces/tipos especiales. Los temporales claros viven solo en directorio 0700 del volumen dedicado y se eliminan al finalizar; un fallo puede dejar `.partial` cifrado, que no cuenta como backup valido. No confundir eliminacion con borrado criptografico: usar cifrado de volumen/VM nuevo y politica de destruccion aprobada. SHA256 externo se registra en inventario firmado fuera de la VM; hashes solos no prueban autenticidad. Backup **deja la app parada**; el operador valida el archivo cifrado y luego inicia app/proxy. Verificar este lifecycle antes de habilitar cualquier programacion.

Recuperacion propuesta, siempre en OTRA VM nueva y privada:

1. Verificar inventario firmado, SHA256 externo, origen y destinatario de la copia; descifrar offline como operador en staging privado con espacio suficiente. Inspeccionar ambas capas tar antes de extraer: solo paths relativos esperados, sin traversal, enlaces duros/simbolicos, dispositivos o FIFOs. No extraer archivos no verificados como root sobre el sistema activo.
2. Preparar misma version de motor y artefacto del SHA registrado, reglas deny y directorios nuevos. No restaurar sobre una DB existente ni promover a produccion. Conservar el sandbox_id solo si es recuperacion del MISMO sandbox y la instancia antigua permanece detenida; otro sandbox requiere manifiesto/marcador/secretos propios y otra revision.
3. Importar solo el dump de sandbox validado via socket en la DB nueva; comprobar identidad del marcador, tablas, counts y grants. Recrear cuentas por procedimiento aprobado, porque no se respaldan usuarios mysql. Rotar AUTH_SECRET/DB_PASSWORD, recalcular huellas y el password de la cuenta runtime; recuperar PORTAL_CREDENTIALS_KEY desde custodia cifrada separada si se necesita descifrar datos del MISMO sandbox, o resetear esos datos sinteticos de forma revisada. Sin custodia no garantizar recuperacion de secretos cifrados.
4. Restaurar uploads validados con ownership/modos del inventario, no los UID originales sin revision; verificar hashes. Restaurar manifiesto revisado y entorno por separado. Provisionar TLS nuevo si corresponde. Ejecutar de nuevo S02 y gates de aislamiento. Comprobar RPO/RTO y exportaciones exclusivamente sinteticas antes de arrancar UI.

No se ha realizado un backup, cifrado, restore o prueba de desastre real: son procedimientos propuestos verificables en la siguiente etapa.

## Reversion sin apertura de red

Antes de habilitar nada: descartar los archivos de propuesta es suficiente. En una futura VM autorizada: detener primero proxy/app (control-group), verificar que no quedan hijos/listeners; detener DB SOLO si se revierte todo el laboratorio y su identidad corresponde al inventario. Preservar datos/logs sanitizados/copia cifrada para diagnostico. Mantener firewall deny y certificados/secretos protegidos; **no** ejecutar flush ruleset, restaurar reglas permisivas o borrar discos/directorios automaticamente. Para volver a un artefacto anterior, mantener datos y esquema compatibles o restaurar en VM nueva mediante ensayo; no ejecutar migraciones inversas improvisadas. No borrar usuarios/UID hasta retener y custodiar backups. Reversion de infraestructura nunca cambia DNS ni el PR #541.

## Recursos que Monaco debe proporcionar o contratar (sin contratacion)

| Recurso/decision | Alternativas a revisar / requisito |
|---|---|
| VM exclusiva, region y proveedor | VPS privado administrado por Monaco o VM de su proveedor autorizado; sin red productiva, IP publica no necesaria, consola fuera de banda |
| Capacidad inicial para dimensionar | Propuesta de ensayo: 2 vCPU, 4 GiB RAM, 40 GiB cifrados; build separado con 4 vCPU/8 GiB si se aprueba. Medir; no garantia ni cotizacion |
| OS y suministros firmados | Linux mantenido con systemd>=252/cgroup BPF/nftables; Node24 y MariaDB11.8 candidatos; fijar patches/hashes de paquetes Linux y lockfile |
| Discos | App/root nuevos, datadir dedicado y volumen backup exclusivo; cuotas de uploads/cache/journal y monitorizacion local |
| Backup fuera del fallo de VM | Custodia offline o almacenamiento privado aprobado, sin activar egress en S03; costes/retencion/region por aprobar |
| Acceso operativo | Administrador de infraestructura separado de usuario runtime; consola y eventual gestion privada revisada; no SSH publico |
| TLS y claves | CA privada para localhost, destinatario age y custodio de claves de recuperacion; no emitir ni compartir claves en PR |
| Inventario y permisos | Responsable de schema/fixtures/grants/hojas uploads, hashes de imagen y artefacto, responsables de respuesta/restore |
| Integracion futura | Ratificacion D01-D16 y revision independiente de destinos/auth/endpoints antes de cualquier acceso PriceSmart |

No se ha elegido proveedor, plan, presupuesto, dominio o configuracion real. Estos recursos se describen para revision de Monaco.

## Validacion local y evidencia

Ver [S03-EVIDENCIA.md](S03-EVIDENCIA.md) para resultados, limites y comandos. Las pruebas no usan recursos externos; reutilizan el bloqueo de red de S02, drivers sustituidos y fixtures temporales sinteticos. No se ejecutan systemd, nftables, nginx, MariaDB, SQL, aprovisionamiento, builder, backup ni restore. La revision Linux nativa y las pruebas operativas constituyen condiciones previas al despliegue, no PASS derivados de mocks.
