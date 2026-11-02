# Inventario consolidado y propuesta de laboratorio

Inventario de fuentes del commit base; no inventario de una máquina existente. No se consultó ningún servidor. Las rutas enlazadas se reutilizan sin cambios.

| Etapa | Activos revisados | Capacidad disponible y límite |
|---|---|---|
| S02 | [auditoría](../S02-PREFLIGHT-AUDITORIA.md), [configuración](../S02-CONFIGURACION-AISLAMIENTO.md), `scripts/sandbox-config.mjs`, `src/lib/sandbox-db.ts` | Selector sandbox, manifiesto privado, rutas sin enlaces, claves sintéticas distintas, origen fijo, marcador en la misma conexión y controles por operación. No prueba identidad física ni grants efectivos. |
| S03 | [diseño](../S03-INFRAESTRUCTURA-PRIVADA.md), `scripts/infra/pricesmart-plan.mjs`, `scripts/infra/pricesmart-build.mjs`, `infra/pricesmart-sandbox/` | Propuestas inventory/isolation/runtime env, sysusers/tmpfiles, MariaDB, nftables, nginx, backup y seis unidades systemd app/db/proxy/firewall/build/backup. No instaladas. SQL de identidad S03 NO se aplica antes de S04: S04 lo sustituye. |
| S04 | [protocolo](../s04/README.md), `scripts/sandbox-s04/{audit,plan,fixtures,provision}.mjs`, `infra/pricesmart-sandbox/s04/` | Plan de 26 tablas, 49 FKs, 29 filas sintéticas y marcador separado; grants SELECT individuales, ACCOUNT LOCK, journal exclusivo y rechazo de instancia previa. Plantillas SQL con parada deliberada; nunca ejecutarlas directamente ni ejecutar schema completo. El conteo debe contrastarse con motor real. |
| S05 | [procedimiento](../s05/README.md), `scripts/sandbox-s05/`, drop-ins `infra/pricesmart-sandbox/s05/` | Stage de fuentes versionadas, build offline con guard, pack/verify con ancla externa, arranque supervisado. No hay build Linux validado; reproducibilidad byte a byte no demostrada. Verificar drop-ins además de unidades base. |
| S06-A | [gates](../s06a/PREFLIGHT-Y-GATES.md), [25 pruebas](../s06a/MATRIZ-S06.md), [recuperación](../s06a/RECUPERACION.md), `scripts/sandbox-s06a/preflight.mjs`, `infra/pricesmart-sandbox/s06a/dossier.example.json` | 16 controles, 7 gates, 25 pruebas. Validador offline sin comandos externos/SQL/red; todas las entradas operativas pendientes. No implementar otro instalador, verificador de permisos ni orquestador. |

`infra/pricesmart-sandbox/backup.sh` es un backup **lógico** con mariadb-dump por socket administrativo y cifrado age; no es copia física ni recuperación probada. Conflicts de systemd no demuestra ausencia de todos los escritores. Puede dejar staging en claro o `.partial` ante fallos; debe revisarse custodia, espacio y limpieza manual autorizada. No contiene runtime.env ni contraseñas; recuperar exige reprovisión de secretos sintéticos. El protocolo de inspección segura del dump/restauración no está implementado. No se ofrece aquí un importador SQL.

## Configuración mínima propuesta, pendiente de aprobación

Una VM dedicada, completamente nueva, discos nuevos, sin redes, volúmenes, IAM, agentes, imágenes privadas o credenciales de producción. Virtualización completa con kernel propio, systemd, nftables, cgroup y BPF efectivos. Propuesta Linux x64 para reducir divergencia de toolchain; distribución, versión, imagen, kernel y libc se ratificarán antes de adquirir. No se selecciona proveedor.

| Recurso | Hipótesis de planificación | Justificación y aceptación futura |
|---|---|---|
| CPU | 2 vCPU | Dos builds secuenciales; medir tiempo y throttling, sin asumir CPU reservada. |
| RAM | 4 GiB | Build Next más servicios aislados; medir pico, OOM y margen acordado. Si insuficiente, detener y revisar presupuesto, no ampliar automáticamente. |
| Disco | 40–80 GB privados persistentes | OS 10–15, dos fuentes 12–24, dos releases 4–8, DB 4–8, backup/staging 6–12, reserva 4–13 GB; extremos suman 40–80. Cuotas, inodos, cifrado en reposo y crecimiento por medir. No borrar evidencia para ganar espacio. |
| Toolchain | Node 24, Next 16.4.1 del lock, MariaDB 11.8, nginx y age | Patches exactos, hashes, soporte, arquitectura/libc y paquetes offline requieren aprobación. No descargar ni instalar desde este expediente. |
| Recuperación | Segundo destino VM/instancia/datadir totalmente nuevos | Independiente de la VM origen y almacenamiento de backups; J2 requiere autorización específica. F3 requiere además una instancia canario nueva, nunca alterar marcador del sandbox aceptado. |

Topología propuesta existente, sin cambios: nginx TLS `127.0.0.1:4316` → Next `127.0.0.1:3000` → MariaDB `127.0.0.1:43306`; socket `/run/novalvion-ps-db/mariadb.sock`, datadir `/var/lib/novalvion-ps-db`, raíz `/srv/novalvion-ps-sandbox`, app `/opt/novalvion-ps-sandbox/app`. Ningún listener público. Firewall input/output/forward denegados por defecto, IPv4 e IPv6; sólo loopback IPv4 y puertos previstos. Sin excepciones SSH, DNS, metadata, Internet, VPN o PriceSmart. Auditar reglas efectivas de todas las tablas y rutas, no sólo la plantilla.

Consola privada fuera de banda, MFA y roles limitados, independiente de red guest, con capacidad de aislamiento/apagado autorizada. Probar rescate antes de cualquier modificación futura de red. El acceso web al loopback **no está resuelto** por una consola textual: Gate5 exige diseño independiente de canal privado y navegador confinado, sin abrir SSH/túnel por suposición ni cambiar origen S02.

Separar instalador administrativo, usuario de build, runtime sin sudo/capacidades, usuario DB, custodio age y auditor. Código del instalador sólo lectura para runtime, secretos privados 0600, backups/datadir inaccesibles al runtime. No usar root como runtime; el administrador local por socket sólo actuará bajo autorización específica futura. Los grants por tabla no son aislamiento de filas: empresa/cliente/integración también necesitan autorización de aplicación.

Backups cifrados en destino independiente fuera de VM, clave privada fuera del guest y expediente, permisos/retención/RPO/RTO aprobados antes de J1/J2. Ningún almacenamiento se presenta seguro para datos reales sin cifrado y retención ratificados.

## Costos sin cotización

No se consultaron precios, contrataron recursos ni confirmaron importes. Las cifras de recursos anteriores son estimaciones técnicas, no precios. Presupuesto pendiente: `horas VM × tarifa + GB-mes disco × tarifa + backup independiente + segunda VM temporal + consola/rescate + exportación/egress + soporte + impuestos`. Cada término monetario está **sin cotizar**. Registrar después proveedor, moneda, fecha/validez, límites y costo total en custodia privada; publicar sólo referencia sanitizada y decisión firmada. Gate1 permanece bloqueado hasta revisión de capacidad y presupuesto; aprobar una propuesta no autoriza comprarla.
