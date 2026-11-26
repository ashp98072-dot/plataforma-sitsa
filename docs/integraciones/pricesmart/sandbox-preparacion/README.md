# Sandbox de homologación — preparación final (todo lo automatizable y verificable localmente)

Estado: **VERIFICADO TÉCNICAMENTE** (plantillas y verificaciones con pruebas; aprovisionamiento P1–P15 en CI con MariaDB 11.8.9). **No** se compró, aprovisionó ni expuso ningún servidor; no se tocó Hostinger ni producción; sin credenciales reales.
**El hosting compartido de Hostinger de producción NO se asume apto** para el sandbox (base y aplicación dedicadas, proxy propio, systemd, allowlist por IP y MariaDB solo en loopback no son posibles allí); la decisión de infraestructura es externa.

## 1. Qué genera `provision.mjs plan` (archivos para REVISIÓN, sin secretos)
| Archivo | Para qué | Dónde se prueba |
|---|---|---|
| `bootstrap.sql`, `destroy.sql` (solo revisión) | DDL del sandbox / baja (la baja real la hace `destroy` con preflight de propiedad) | P1–P15 (CI) |
| `nginx-pricesmart-sandbox.conf` + `pricesmart-sandbox-proxy.conf` | Proxy HTTPS: TLS 1.2/1.3, HSTS, allowlist + `deny all`, límite de cuerpo y de tasa, **solo 3 rutas** (resto 404), proxy solo a loopback, cabecera de laboratorio eliminada | `provisioning.test.ts`, `exposure-verification.test.ts` |
| `pricesmart-sandbox.service` | systemd: usuario sin privilegios, `--hostname 127.0.0.1`, secretos en `EnvironmentFile` fuera del repositorio, endurecimiento | ídem |
| `mariadb-pricesmart-sandbox.cnf` (**nuevo**) | MariaDB 11.8.x: `bind-address=127.0.0.1`, `skip-name-resolve`, `local-infile=0`, sin acceso remoto | `exposure-verification.test.ts` |
| `runtime.env.template` | Variables de entorno documentadas (marcadores, nunca valores) | `provisioning.test.ts` |
| `monitoring.json` | 7 consultas de vigilancia y 4 alertas para la cuenta `monitor` | P4 |
| `tms-schema-phases.json` | Esquema del TMS dentro de alcance (+ prueba anti-deriva `alcance-esquema.test.ts`) | CI |

## 2. Variables de entorno (`runtime.env.template`)
Identidad y aislamiento: `NOVALVION_ENV=sandbox`, `SANDBOX_ID`, `SANDBOX_ROOT`, `NEXT_TELEMETRY_DISABLED=1`, `CB2_PUBLIC_ORIGIN`, `EMPRESA_DOMINIOS`, `UPLOAD_DIR` (los valida `scripts/sandbox-config.mjs`; **no puede existir ningún `.env*` en el directorio de la app**). Base: `DB_HOST=127.0.0.1`, `DB_PORT`, `DB_NAME=sandbox_api02_homolog_<n>`, `DB_USER`. Secretos internos (generados por `provision.mjs init-secrets`, formato `sandbox:<id>:<64 hex>`, hash en `isolation.json`): `DB_PASSWORD`, `AUTH_SECRET`, `PORTAL_CREDENTIALS_KEY`. Worker: `PS_HOMOLOG_WORKER_USER/PASSWORD`. Interruptor: `PS_HOMOLOG_KILLSWITCH_FILE`. Runtime: `PRICESMART_RUNTIME_MODE` (`DISABLED` por omisión), `PRICESMART_RUNTIME_ENVIRONMENT=sandbox`, `PRICESMART_ORIGIN_CLUB`, `PRICESMART_DB_SCHEMA`, `PRICESMART_DB_RUNTIME_USER`, `PRICESMART_RATIFIED_DECISIONS` (vacío hoy). Prohibidos en el sandbox: `PRICESMART_LAB_KEY`, `PRICESMART_LAB_DEMO`, `PRICESMART_ENABLED`, `FEL_CREDENTIALS_KEY`, variables de proxy, `NOVALVION_ENV=production`.

## 3. Gestión de secretos
Se generan en el host, `0600`, fuera del repositorio, distintos de producción, **nunca** por argumentos ni en el unit. Rotación: regenerar con `init-secrets` en una instalación nueva (el manifiesto no se sobrescribe) y `finalize`; las credenciales de PriceSmart se revocan con `revokeStatement` (efecto inmediato). Las claves del adaptador KMS/HSM y la credencial M2M definitiva (D02) son externas.

## 4. Verificación previa a la exposición — `provision.mjs verify-exposure` (nuevo; solo lectura, sin red)
```bash
node scripts/ci/pricesmart-homologation/provision.mjs verify-exposure --dir <salida de plan> --env-file /etc/pricesmart-sandbox/runtime.env \
  --killswitch <SANDBOX_ROOT>/killswitch --cert <fullchain.pem> --key <privkey.pem> --hostname sandbox.ejemplo.com
```
Comprueba (30 reglas, salida JSON, código de salida 1 si alguna falla): proxy (TLS, allowlist, 3 rutas, límites, loopback), systemd (no root, loopback, endurecimiento, secretos fuera del unit), MariaDB (loopback, opciones seguras), entorno (permisos 0600, fuera del repositorio, sin marcadores `<…>`, sandbox declarado, base/usuario `sandbox_*`, sin banderas de laboratorio/producción/proxies, secretos con formato sandbox, modo `DISABLED`/`READ_ONLY`, ninguna decisión ratificada), kill switch existente y **no** en `ON`, certificado vigente (≥7 días) que cubra el nombre y llave no legible por otros. **`authorizesExposure` es siempre `false`:** que todo pase NO autoriza exponer.
Quedan fuera de lo verificable localmente (manuales): que el puerto de MariaDB no sea alcanzable desde fuera, la cadena TLS pública, la allowlist real de PriceSmart, DNS, y la aprobación humana de `evaluateSandboxExposure` (D02 + KMS revisado).

## 5. Activación, apagado y readiness
Orden: `DISABLED` → verificar → `READ_ONLY` → verificar → `ENABLED` (solo con decisiones ratificadas, ACK y D02). Kill switch por archivo (falla cerrado: solo `ON` habilita). Readiness: `GET /api/admin/pricesmart/readiness` (solo Admin, solo lectura) y la sonda `provisioning` (el runtime no se activa si el aprovisionamiento no está `COMPLETE`). Monitorización: `monitoring.json` con la cuenta `monitor` (sin acceso a órdenes ni cargas).

## 6. Instalación y destrucción seguras
Instalación: `plan` → revisar → `init-secrets` → `apply --execute` → `finalize` → `status` = `COMPLETE` → `verify-exposure`. Destrucción: `destroy` (ACK de destrucción; exige propiedad y procedencia; `DESTROY_REFUSED` sin ningún `DROP` ante la duda) + retirar unidad, proxy, DNS, certificado y secretos; comprobar que producción no cambió. Todo el ciclo se ensaya en CI (P1–P15, MariaDB 11.8.9 real).

## 7. Recuperación
| Situación | Acción |
|---|---|
| Aprovisionamiento parcial (`BOOTSTRAP_PARTIAL` / `FINALIZE_FAILED`) | `status` (solo lectura) → `destroy` + `apply` limpio; no hay reversión parcial del DDL (P10–P12, P14) |
| Credencial de PriceSmart comprometida | `OFF` en el kill switch → `revokeStatement` → revisar `ps_api01_audit` y `monitoring.json` → emitir otra |
| Secretos internos comprometidos | `destroy` + reinstalación con secretos nuevos (los datos son sintéticos) |
| Caída del servicio / de la base | systemd reinicia la app; órdenes recibidas son durables (outbox al-menos-una-vez; reintentos sin duplicar solicitudes); el worker reanuda tras reinicio (`API13.17`) |
| Vinculaciones bloqueadas | bandeja de Operaciones: «Reconocer» y corregir; `REVIEW` es durable |
| Cancelación sin resolver | resolución por Operaciones (ver `cierre-operativo/README.md`) |
| Backup | los datos del sandbox son **sintéticos y reproducibles** (se recrean con `provision.mjs`); no se respaldan datos reales porque no existen |

## 8. Pendiente (externo)
Servidor/VPS y red, dominio, certificado TLS, allowlist de IPs de PriceSmart, gestor de secretos y KMS/HSM revisado, verificador M2M definitivo (D02), credenciales de PriceSmart, aprobación humana y pruebas conjuntas.
