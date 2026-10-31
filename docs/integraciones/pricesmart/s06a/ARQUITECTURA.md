# S06-A — arquitectura operativa propuesta

Preparación exclusivamente documental y estática, 2026-10-31. No es autorización de ejecución. Base `1f3857c2696b820e3081a468929854d9b02f53f8`, merge confirmado de PR #545; contiene S02–S05. Ningún control anterior se modifica. D01–D16 pendientes de ratificación.

## Comparación para solicitar propuestas, sin selección de proveedor

No se publican precios, regiones, stock ni disponibilidad: no se solicitaron cotizaciones y no existe capacidad contratada. Comparación de modalidades técnicas, no recomendación comercial. Cada candidato debe entregar evidencia específica para los requisitos siguientes antes de Gate 1.

| Modalidad | Ventajas a comprobar | Riesgos / evidencia exigida | Estado |
|---|---|---|---|
| VPS de virtualización completa con administración propia | Control de kernel, systemd, nftables y volúmenes; consola del hipervisor | CPU compartida/contención, BPF y rescate no presumidos. Exigir tipo de virtualización, kernel, consola independiente de red del guest, política de snapshots/exportación | No evaluada comercialmente |
| VM de nube con cómputo reservado/dedicado | Cuotas y discos separables; control de acceso del plano de gestión | Dedicado no equivale a aislado por defecto. Deshabilitar identidad con acceso a producción, metadata/agents/telemetría que dependan de egress; verificar costos de consola, snapshots y salida offline | No evaluada comercialmente |
| VM interna nueva sobre host de laboratorio segregado | Custodia física, transferencia offline y consola del hipervisor controlables | Requiere host sin cargas/red/almacenamiento productivos, respaldo y responsables disponibles; no reutilizar una VM o DB existente | No evaluada comercialmente |
| Contenedor/VPS de kernel compartido o hosting compartido | Puede ofrecer menor costo aparente, sin evidencia económica en esta fase | No acredita control de kernel/cgroup/BPF/namespace/consola requerido; no elegible hasta demostrar todos los requisitos de una VM exclusiva | Sin aprobación |

No se requiere host físico exclusivo de un proveedor público si la VM y sus discos/credenciales/red están segregados y auditados; la opción interna exige host de laboratorio separado de producción. Una afirmación del proveedor no reemplaza las pruebas de Gate 3.

## Recursos a contratar o proporcionar después de autorización

| Recurso | Hipótesis de evaluación | Condición de aceptación / responsable |
|---|---|---|
| VM principal nueva | 2 vCPU, 4 GB RAM iniciales, arquitectura x64 o arm64 por decidir | No capacidad aprobada. Medir picos de dos builds secuenciales, Next, MariaDB y backup; rechazar OOM/throttling o falta de margen. Mónaco aprueba dimensionamiento |
| Disco privado | 40–80 GB iniciales, persistente y exclusivo | No consumo medido. Separar datadir, código, staging, backups y cuotas; cifrado/reposo y recuperación del volumen documentados |
| Presupuesto de espacio propuesto | OS 10–15, dos workspaces 12–24, dos releases 4–8, DB 4–8, backups 6–12, reserva 4–13 GB; total 40–80 GB | Presupuesto para evaluación, no tamaño real de Next. Medir bytes/inodos y detener antes de agotar reserva; nada de limpieza automática de evidencia |
| Imagen Linux | Soportada por proveedor, systemd, nftables, cgroup y BPF efectivos | Kernel/OS/libc exactos con hashes/soporte y actualizaciones offline aprobados en Gate 1/3; no instalar en equipos existentes |
| Toolchain | Node 24 (S05 actual usa 24.18.0), Next 16.4.1 del lock, MariaDB 11.8, nginx, age y herramientas de inspección | Fijar patches y procedencia, arquitectura/libc, hashes, dependencias y licencias. No descargar desde el guest; no sustituir versiones silenciosamente |
| Medio offline | Caché npm completa del lock y paquetes OS firmados, con inventario | Preparar en canal de adquisición segregado aprobado; transferir mediante medio del proveedor/ISO de sólo lectura con hashes. No abrir egress para instalar |
| Consola fuera de banda | Consola/rescue desde plano de gestión separado, MFA y roles | Debe funcionar cuando guest rechaza todo tráfico y sin credenciales de producción. Registrar restauración ensayada y quién puede apagar/desconectar VM |
| Backup y snapshot | Almacenamiento cifrado independiente de VM, retención/RPO/RTO por decidir | Snapshot no es backup probado; validar consistencia, exportación y restauración. Clave age privada fuera de VM y fuera de evidencia |
| Segunda VM y disco nuevos | Destino exclusivo de ensayo de restauración, sólo Gate 6 | Cotizar pero no crear. No usar otra instancia existente; no conectar ambas a producción |
| Operadores | Instalador autorizado, runtime sin sudo, custodio de claves y auditor independiente | Separación de funciones, aliases en evidencia y autorización expresa por gate; no automatizar captura de contraseñas |
| Canal privado de acceso | Pendiente de decisión de arquitectura | Resolver incompatibilidades de red descritas abajo antes de Gate 5 |

Costos a solicitar: VM, discos, IOPS, snapshots, almacenamiento externo, exportación/egress, consola/rescate, soporte, impuestos, segunda VM temporal, retención y eliminación. Registrar proveedor, fecha de cotización, vigencia, moneda y límites en documento privado; sólo su hash y aprobación sanitizada en expediente público. Ninguna alternativa contractual modifica D01–D16.

## Topología y conexiones propuestas

Dentro de una sola VM: nginx TLS `127.0.0.1:4316` → Next `127.0.0.1:3000` → MariaDB `127.0.0.1:43306`; socket DB exclusivo `/run/novalvion-ps-db/mariadb.sock`. Procedencia y marcador S04 antes de toda operación; cuenta runtime SELECT por tabla y **ACCOUNT LOCK**. S03 define root sandbox `/srv/novalvion-ps-sandbox`, app `/opt/novalvion-ps-sandbox/app`, datadir `/var/lib/novalvion-ps-db`. No se cambian puertos ni manifiestos S02–S05.

| Origen → destino | Puerto / medio | Permiso propuesto |
|---|---|---|
| Proxy → Next, Next → DB | IPv4 loopback 3000 / 43306 | Sólo el perfil S03 y control de identidad S02 |
| Cliente de laboratorio → proxy | IPv4 loopback 4316, origen exacto `https://localhost:4316` | Sólo después de resolver ubicación del navegador y Gate 5 |
| Backup → DB | Socket UNIX local | Sólo tarea manual privilegiada S03, Gate 6; no runtime |
| Instalación → guest | Medio offline / consola independiente | Sin conexión IP de guest al exterior |
| Guest → producción, Internet, DNS, metadata, SMTP, PriceSmart | Todos | Denegar; no probar contra producción real |
| IPv6, SSH/VPN y entradas públicas | Todos | Denegados por perfil actual; no crear excepción desde S06-A |

**Acceso privado pendiente:** SSH con túnel, VPN y bastión exigirían excepciones que el firewall S03 no permite. Tampoco son soluciones ya aprobadas. La consola fuera de banda permite recuperación administrativa, pero una consola de texto no acredita navegación web local. Alternativas a estudiar: navegador dentro del guest mediante consola gráfica y origen loopback, o un diseño de túnel exclusivamente privado formalmente revisado que conserve origen/S02 y restricciones de egress. Un navegador en la estación del operador no alcanza el loopback de la VM sin ese diseño. Detener Gate 5 hasta aprobación independiente; no abrir puertos ni asumir túneles. Además, fuentes/bundles pueden referenciar dominios externos: el navegador también necesita confinamiento de red, sin perfil/cookies reales ni acceso a producción.

## Dependencias y bloqueos conocidos

1. S05 no produjo build Linux ni manifiesto real de release. Faltan dos builds, inventario por archivo, revisión de trazas y módulos nativos (sharp/SWC/libc), AFM PDFKit, logos, exportaciones y caché/ISR.
2. S04 termina con runtime bloqueado y SELECT solamente. Login funcional y varias lecturas frías pueden intentar writes/ensureSchema. Los casos positivos G y H no pueden aprobarse como navegación funcional mientras esto siga así. Esta fase no desbloquea, no crea cuenta alternativa para eludir el bloqueo y no concede DDL. Se necesita una decisión técnica separada y autorizada antes de una futura aceptación positiva; el rechazo seguro sí es un resultado esperado de F/C.
3. La protección `IPAddressDeny` depende del soporte efectivo de cgroup/BPF. Las restricciones declaradas no prueban filtrado; comprobar kernel y tráfico en Gate 3. La implementación upstream de systemd distingue explícitamente sistemas sin soporte BPF: [fuente systemd](https://github.com/systemd/systemd/blob/main/src/core/bpf-firewall.c), consultada 2026-10-31.
4. Build PrivateNetwork S03 y guard S05 podrían bloquear IPC necesario de Next: si ocurre, registrar FAIL y detener. No quitar guardas para producir PASS. No hay demostración de repetibilidad bit a bit; comparar archivos/manifiestos, incluyendo BUILD_ID, y documentar diferencias como fallo de criterio hasta revisión.
5. El backup S03 es **lógico** (`mariadb-dump`), cifrado con age; no es mariadb-backup físico. La restauración debe validar el contenido antes de importar y requiere protocolo revisado que distinga un destino nuevo de un marcador restaurado. No reutilizar ingenuamente el provisioner S04 (rechaza bases existentes), ni importar SQL sin inspección. Para una alternativa física futura se necesitarían versiones compatibles, prepare y destino vacío, según [documentación MariaDB](https://mariadb.com/docs/server/server-usage/backup-and-restore/mariadb-backup/full-backup-and-restore-with-mariadb-backup), consultada 2026-10-31. No se propone ese cambio aquí.

El siguiente paso autorizado es auditar estos documentos y plantillas. Crear infraestructura o ejecutar pruebas reales requiere una autorización posterior expresa; ni el PR ni su merge la sustituyen.
