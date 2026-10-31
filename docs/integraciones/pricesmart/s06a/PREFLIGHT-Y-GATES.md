# S06-A — preflight y autorizaciones

Todos los controles operativos siguientes: **NO EJECUTADA**, fecha de registro 2026-10-31. No hay VM autorizada. Son instrucciones de comprobación futura por un operador autorizado, no comandos ejecutados ni un instalador. Ninguna comprobación crítica puede omitirse, inferirse de una plantilla, marcarse N/A o aprobarse por timeout. FAIL o NO EJECUTADA bloquean el avance.

## Preflight reproducible

| ID crítico | Comprobación futura y evidencia sanitizada exigida | Criterio de rechazo |
|---|---|---|
| PF01 | Cotización verificable, OS/virtualización/arquitectura, costos totales, recursos y responsables aprobados; hash de decisión Gate 1 | Sin aprobación, soporte desconocido o recursos asumidos |
| PF02 | Nueva VM: dossier privado de orden/fecha/imagen/ID del proveedor, consola y boot inicial; asociar alias local a evidencia custodiada | Instancia previa, identidad ambigua o dependencia de producción |
| PF03 | `findmnt`/`lsblk` revisados localmente: disco, UUID, datadir/socket S04, sin datos ni esquemas previos. Prueba DB sólo tras Gate 4 | Volumen reutilizado, discos compartidos con producción, datadir ajeno o incapacidad para acreditar novedad |
| PF04 | Inventario de mounts, dispositivos, unidades y rutas legibles, sin mounts compartidos, home/agents/secret stores productivos. Inspección local sin imprimir valores de env ni contenido privado | Secreto/mount productivo o procedencia desconocida; no abrirlo para investigar desde automatización |
| PF05 | Revisión autorizada de `nft list ruleset`, rutas, `ss -lntup` y contadores; denegación input/output/forward, IPv6, DNS/metadata y ausencia de listeners públicos | Regla omitida, egress inesperado, reglas efectivas distintas o imposibilidad de inspeccionarlas |
| PF06 | OS/kernel/systemd verificados; `stat -fc %T /sys/fs/cgroup`, propiedades de unidades y prueba canario de BPF/cgroup tras Gate 3. No basta versión o archivo unit | Restricción no soportada, advertencia ignorada, namespace/cgroup no efectivo |
| PF07 | `id`/`namei`/`stat` revisados: cuentas separadas S03, runtime sin sudo/capacidades, código de instalador sólo lectura, secretos 0600, dirs privados; no links ni ACL inesperadas | Propiedad insegura, path atravesable/modificable, runtime admin o acceso a datadir/backup |
| PF08 | Hashes y versiones offline de Node 24, Next 16.4.1, MariaDB 11.8, nginx, age; arquitectura/libc coinciden; carga real de sharp/SWC, AFM y assets con paquete verificado | Patch sin aprobar, binario de otra plataforma, módulo faltante o adquisición no verificable |
| PF09 | Ensayo de consola fuera de banda con red guest denegada: operador accede, conserva control y puede desconectar/apagar; evidencia sin tokens/screenshots de secretos | Consola depende de guest/SSH o se pierde control. No aplicar reglas hasta asegurar rescate |
| PF10 | `free`, `df`, inodos y medidas durante build/servicios/backup, picos de RAM/disco/CPU y margen acordado Gate 1 | OOM, disco lleno, throttling crítico o margen no ratificado. 2 vCPU/4 GB y 40–80 GB siguen siendo hipótesis |
| PF11 | Instalación/cache offline comprobada con red denegada, integridad lock/paquetes, sin lifecycle scripts no revisados; canario S05 e intentos de conexión | Cualquier descarga o dependencia externa requerida; no habilitar egress temporal |
| PF12 | Cadena de custodia de fixtures S04 y fuente; inventario no contiene dumps/usuarios/datos reales, uploads vacíos | Datos importados desconocidos o productivos, correos reales/credenciales operativas |
| PF13 | Revisión del manifiesto isolation.json, origen, paths, ID/hash de claves sintéticas mediante S02 sin mostrar valores; tenant fijo | Alteración, ruta/enlace ajeno o credenciales sin namespace de laboratorio |
| PF14 | Dos builds nuevos y release verificada contra hash externo, trazas completas, sólo caché técnica mutable, comparación por archivo | Artefacto no construido/verificado, diferencia no resuelta, secreto en bundle o script administrativo sobrante |
| PF15 | Tras Gate 4: S04 sobre nueva instancia, cuenta ACCOUNT LOCK, grants SELECT por tabla, marcador protegido y denegación de otros esquemas comprobados con conexiones controladas | Cuenta desbloqueada, permiso global/schema.*, DDL/escritura, identidad/marker ajenos |
| PF16 | Canal de acceso aprobado y probado sin modificar S03; TLS loopback y navegador confinado sin red productiva | Túnel/VPN supuesto, listener público, validación TLS omitida o estación con acceso productivo |

Los comandos de inspección Linux de esta tabla son referencias para el runbook futuro. Algunos necesitan visibilidad privilegiada y serán realizados por el administrador autorizado en S06 real, nunca por los scripts S06-A. No ejecutar `env`, `printenv`, dumps de configuraciones o journals completos en evidencia. Herramientas ausentes producen NO EJECUTADA, no instalación automática. La ausencia de procesos/secretos en una captura no demuestra ausencia histórica: correlacionar procedencia, mounts, red y cadena de custodia.

## Secuencia con puntos de detención

| Gate | Autoridad / entrada requerida | Actividad futura permitida sólo por autorización expresa | Salida y detención |
|---|---|---|---|
| 1 | Mónaco: proveedor, cotización y recursos; responsable de seguridad | Evaluar/seleccionar presupuesto y plan de adquisición offline. La aprobación debe indicar separadamente si permite contratar; S06-A no lo permite | Decisión firmada/custodiada y PF01. Sin ella no comprar ni crear VM |
| 2 | Autorización posterior de VM **nueva** y revisión de aislamiento, con alcance y operador | Creación y examen inicial sólo cuando esa autorización lo permita; consola antes de cualquier política restrictiva; PF02–PF04/PF09 | Identidad y disco nuevos acreditados. Si algo es previo/desconocido, detener y preservar evidencia; no limpiar/adoptar |
| 3 | Administrador/seguridad: aprobar OS, firewall y servicios propuestos | Validar PF05–PF11, PF13 y toolchain/build S05 sobre VM autorizada; medir y confirmar compatibilidad, sólo offline | Controles críticos PASS y expediente Linux. Sin BPF efectivo, rescate, build/artefacto o canal privado revisado no avanzar. No convertir validaciones estáticas en PASS operativo |
| 4 | Autorización expresa de aprovisionamiento MariaDB **sintético**, distinta del runtime | Sólo protocolo S04, DB y datadir nuevos, perfil/fixtures/grants revisados; sin desbloqueo ni escrituras runtime | PF12/PF15 y E/F. Fallo conserva parciales y journal, nunca adopta/reset/DROP automático. DDL no tiene rollback completo |
| 5 | Aprobación de canal privado, navegador confinado, TLS y alcance HTTP | Negativos HTTP/UI con cuenta bloqueada; positivos G/H únicamente cuando exista un perfil compatible aprobado por decisión separada | PF16 y G/H/I. Con S04 bloqueado, positivos siguen NO EJECUTADA/bloqueados. No cambiar cuenta/grants, no controles de escritorio sin explicación y consentimiento posterior |
| 6 | Autorización de backups, custodia de claves, **segunda instancia nueva**, RPO/RTO y release de reversión | J/K y recuperación descrita en RECUPERACION.md; no restaurar sobre VM/DB existente | Restauración y reversión verificadas. No reiniciar automáticamente después de error o backup |
| 7 | Auditor independiente, expediente completo y evidencias reales | Revisar todos los gates/controles/resultados y límites; resolver discrepancias | Decisión independiente. No equivale a merge, despliegue, API PriceSmart ni ratificación D01–D16 |

Cada aprobación debe identificar alcance, fecha, operador, condiciones y hash del expediente; una aprobación anterior no autoriza automáticamente el siguiente gate. Si falla un gate: detener, no continuar, marcar FAIL/NO EJECUTADA, conservar evidencia sanitizada y pedir nueva decisión específica. No hay ejecución automática al completar JSON ni a partir del merge de este PR.

## Validador offline del expediente

Usa sólo Node y módulos estándar, más el validador de paths S05 sin cambios. Lee **únicamente** el JSON sanitizado indicado explícitamente, con tamaño máximo 64 KiB; rechaza nombres de secretos, links/junctions/hardlinks, campos desconocidos y estados incompletos. No lee `.env`, secretos del operador, `/proc`, discos, red ni bases; no ejecuta comandos externos. La propia plantilla contiene 16 controles + 7 gates + 25 pruebas, todos NO EJECUTADA.

```sh
node scripts/sandbox-s06a/preflight.mjs validate infra/pricesmart-sandbox/s06a/dossier.example.json
# exit 0: formato válido; authorizedToExecute:false
node scripts/sandbox-s06a/preflight.mjs assess infra/pricesmart-sandbox/s06a/dossier.example.json
# exit 2: BLOCKED, 48 entradas pendientes, primer gate GATE1
node --test scripts/sandbox-s06a/preflight.test.mjs
```

Exit 1 indica entrada inválida; exit 0 de `validate` sólo valida formato. `assess` no devuelve certificación ni autorización incluso con todas las entradas PASS: `COMPLETE_FOR_INDEPENDENT_REVIEW` significa expediente declarativamente completo. Hash, alias y fecha **no verifican firmas, existencia del adjunto ni veracidad**; la auditoría debe validar los originales y las autorizaciones por un canal confiable. No se puede usar el evaluador como mecanismo de permisos o sustituto del gate humano. Los tests con un expediente completo artificial prueban el validador, no infraestructura.
