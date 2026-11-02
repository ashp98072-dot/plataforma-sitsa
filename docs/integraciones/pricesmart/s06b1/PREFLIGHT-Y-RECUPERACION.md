# Checklist de autorización, preflight y recuperación manual

Estado de todos los checks: **NO EJECUTADA**. Lista de preparación, no autorización ni script. Complementa sin sustituir [los 16 controles y 7 gates S06-A](../s06a/PREFLIGHT-Y-GATES.md) y [su procedimiento de recuperación](../s06a/RECUPERACION.md).

## Antes de solicitar autorización operativa

- [ ] Auditor independiente revisa PR, SHA, diff y límites de este expediente; registra hallazgos y decisión, sin aprobar operaciones por defecto.
- [ ] Gate1: responsables aprueban alcance, presupuesto sin cotizar, recursos, OS/toolchain exactos, márgenes, custodia, retención y calendario. Contratación/creación necesitan autorización separada explícita; este ticket no las permite.
- [ ] Gate2: autorización identifica VM/discos nuevos, origen de imagen, consola privada, operador, evidencia de novedad y ausencia de vínculos productivos. Sin identidad verificable, no inspeccionar destinos adicionales ni adoptar recursos.
- [ ] Gate3: administrador/seguridad aprueban previamente instrucciones exactas de paquetes offline, firewall, servicios, build y canarios. Registrar hash del procedimiento y ámbito. Verificar rescate antes de aplicar red; no hay comandos de instalación/aplicación en esta entrega.
- [ ] Gate4: autorización específica para DB sintética nueva, protocolo S04 exclusivo, journal nuevo, claves QA por canal privado, sin SQL de identidad S03 previo. No desbloquear S04, no otorgar DDL al runtime.
- [ ] Gate5: canal privado, CA/SAN/origen y navegador confinado aprobados; sin túnel/VPN/SSH implícitos. Negativos permitidos sólo bajo alcance expreso; positivos siguen bloqueados por perfil actual. Control de escritorio requiere explicación y consentimiento posterior.
- [ ] Gate6: backup independiente, clave privada fuera de VM, objetivos RPO/RTO y retención ratificados, destino de restauración nuevo, protocolo de dump/restore auditado y release anterior verificable. Falta cualquiera: no ejecutar J/K dependientes.
- [ ] Gate7: auditor valida originales, firmas, fechas y autorizaciones; resultados físicos pendientes impiden certificar infraestructura. No autoriza merge/despliegue/API/producción ni ratifica D01–D16.

## Secuencia de preflight futura, fallando cerrada

1. Abrir expediente privado por alias de laboratorio, commit/lock, fecha UTC y aprobación específica. Contrastar consola/orden/imagen/discos con PF01–04 y PF09; Q1/Q2 son observaciones auxiliares, nunca prueba suficiente de novedad. Rechazar VM/datadir desconocidos, mounts compartidos o consola dependiente del guest. No limpiar para continuar.
2. Reconciliar PF05/06 con Q3/Q4: todas las reglas IPv4/IPv6, input/output/forward, rutas, listeners y aislamiento BPF/cgroup efectivos. Validar canarios sólo con O3 autorizada y sinks sintéticos, sin Internet. No basta archivo nftables ni versión systemd. Herramienta ausente o permiso insuficiente = detener, no instalar ni elevar permisos automáticamente.
3. PF07/08/10/11: Q5/Q6 y revisión de propietarios/ACL/capacidades/cuentas; binarios y caché offline con hashes externos, arquitectura/libc/patch aprobados, activos nativos reales, recursos bajo carga. No imprimir env, credenciales, /proc de procesos, journals completos o configuraciones privadas. No relajar guard si Next necesita red/IPC.
4. PF12/13/14: acta de procedencia L1, manifiesto privado y marcador coherentes con S02, secretos nuevos sintéticos de namespace correcto y huellas verificadas sin publicar valores, dos builds/release verificada Q7. El manifiesto no sustituye identidad física; los regex no sustituyen revisión humana. No aceptar ancla dentro del mismo paquete como única confianza.
5. Sólo Gate4: PF15, O4/O5 y E/F. Cuenta exacta user@host bloqueada; matriz SELECT por tabla sin roles/globales/esquemas ajenos. No ejecutar SQL de plantilla ni consultar DB existente. No confundir autenticación negada con autorización verificada. Marca/cuenta ajenas: preservar journal/parciales y detener; nunca resetear o reintentar sobre instancia parcial.
6. Sólo Gate5: PF16, D3/I/G/H con canal/origen TLS y navegador aprobados. Certificado incorrecto debe fallar. No curl -k, fake login, rutas API nuevas o respuesta durable simulada. S04 bloquea positivos; registrar esa limitación, no corregirla ampliando permisos.
7. Sólo Gate6: J/K con condiciones siguientes. Registrar resultado por ID, aprobación, comando revisado exacto, inicio/fin UTC, exits esperado/observado, hashes de adjuntos sanitizados, alias de VM/operador y limitaciones. Un FAIL detiene su rama dependiente; un control crítico pendiente detiene avance del gate. Nunca convertir falta de evidencia en PASS.

## Parada segura y recuperación: procedimiento condicionado

No se incluyen comandos copiables de stop/kill/import/delete/reinicio. El operador futuro debe adjuntar previamente instrucciones exactas revisadas O2/O7/O8/O9 y autorización; si faltan, no ejecutar. No existe un botón de recuperación en este expediente.

| Incidente | Acción manual futura bajo autorización | Evidencia y condición de salida |
|---|---|---|
| Pérdida de red/consola | Usar consola fuera de banda aprobada, conservar reglas; si no hay control seguro, aislar/apagar mediante consola autorizada y solicitar reconstrucción nueva. No abrir SSH público ni vaciar firewall. | Cronología/control recuperado y decisión independiente. No dar por recuperado un guest inaccesible. |
| Release/build/integridad sospechosa | Detener sólo app/proxy por unidad/cgroup autorizado, verificar descendientes/listeners; DB queda aislada. No ejecutar scripts de release sospechosa; usar verificador confiable externo. | Q3/Q4, ancla/hash, evidencia preservada. No ciclo de reinicio ni bypass de guard. |
| Fallo DB/provision parcial | Detener avance; preservar datadir/journal y evidencia privada, sin reset/DROP/adopción/repetición S04. Una nueva instancia requiere nueva aprobación. | Estado parcial descrito; DDL no promete rollback total. Sin escrituras runtime ni desbloqueo. |
| Backup interrumpido | Mantener app/proxy detenidos; custodio examina permisos/espacio/staging/partial en privado. No borrar automáticamente ni publicar texto claro. | J1 sólo PASS tras comprobar cifrado, ancla independiente, destino/custodia y ausencia de escritores. Un fichero presente no prueba recuperación. |
| Restauración | Bloqueada hasta O8 auditada: VM/discos/datadir nuevos, verificar ciphertext antes de descifrar en área privada, inspeccionar contenido contra allowlist antes de cualquier SQL. Rechazar esquemas ajenos, users/grants/DEFINER/rutinas/events/triggers/file/globales/datos no sintéticos. No importar mysql.* ni aplicar S04 a DB ya importada. | J2 requiere motor real, FKs/checks/índices/filas/hashes/marker, cuentas reconstruidas bloqueadas y secretos sintéticos nuevos. Medir RPO/RTO; dump válido y conteos no bastan. Sin protocolo, NO EJECUTADA. |
| Reversión de app | Sólo release anterior real verificada, app/proxy detenidos, copia a ruta controlada sin enlaces ni sobrescribir activo; revalidar S02/ancla. No revertir DB/grants/datos. | K1: cgroups/listeners, DB/grants y hashes deterministas antes/después iguales. Sin release previa, no inventar rollback. |

Tras cualquier incidente/backup/restore, **ningún reinicio automático**. Auditor revisa evidencia, aislamiento y negativos; la autorización de reinicio debe ser explícita y limitada a loopback. Recuperación no elimina bloqueos de perfil ni habilita operaciones de negocio.

## Custodia y sanitización

Originales sólo en almacén privado aprobado; alias `qa-*`, control de acceso y retención pendientes de ratificación. En PR únicamente resumen por ID, UTC, método, exit, ruta relativa y SHA256 del adjunto **sanitizado**; el mapa original/redacción queda privado. Excluir tokens, cookies, Authorization/Set-Cookie, query/body, variables de entorno, hashes de password, claves, SQL con parámetros, IP/IDs de proveedor, rutas personales y dumps. No usar hash de secreto de baja entropía como evidencia pública. La redacción no puede ocultar un FAIL. Validar firmas/adjuntos fuera del evaluador; JSON completo sólo solicita revisión independiente.
