# PriceSmart API-26 — aprovisionamiento y composición del sandbox de homologación

**Estado: IMPLEMENTADO y PROBADO en laboratorio local (MariaDB 11.8.9 desechable). NO hay sandbox desplegado, ni URL, ni credenciales de PriceSmart.** Endpoints `503 DISABLED`, `ready=false`, `authorizesInstallation=false`, `REVIEWED_KMS_ADAPTERS` vacío, guardas `sandbox_api02_*` conservadas, sin SQL productivo, sin Hostinger, sin banderas productivas. El verificador HMAC de laboratorio no se usa fuera de pruebas en proceso.

## 1. Modelo: «sandbox appliance» (el único compatible con las guardas vigentes)
Un host dedicado con **MariaDB en 127.0.0.1**, la aplicación en 127.0.0.1 y un **proxy inverso HTTPS** delante. Es el único modelo que cumple, sin relajarlas, `validateSandboxConfig` (DB_HOST=127.0.0.1, secretos `sandbox:<id>:<hex>`, manifiesto), los puertos (cuentas `@127.0.0.1`, `sandbox_api02_*`) y `sandboxPool`. Consecuencia: el ejecutor de aprovisionamiento **solo puede conectarse a loopback**: no puede apuntar a un servidor remoto (p. ej. Hostinger).

## 2. Qué se entrega (todo reutilizable, sin reconstruir API-01…API-25)
| Componente | Archivo | Qué hace |
|---|---|---|
| Paquete de aprovisionamiento (puro) | `scripts/ci/pricesmart-homologation/bundle.mjs` | SQL de revisión (base `sandbox_api02_homolog_<n>`, fila de entorno, DDL PriceSmart, 3 cuentas con contraseñas por variables de sesión, privilegios mínimos por rol), baja, monitoreo y alertas, alta/revocación de credenciales, proxy nginx, unidad systemd, plantilla de entorno, secretos y manifiesto internos |
| CLI | `scripts/ci/pricesmart-homologation/provision.mjs` | `plan` (solo archivos), `init-secrets`, `apply`/`finalize`/`destroy` (loopback + ACK + sin marcadores de producción ni variables de laboratorio) |
| Composición del runtime | `src/lib/integrations/pricesmart/homologation/runtime.ts` | Puertos de seguridad M2M, repositorio cifrado, outbox y vinculación al TMS **ya existentes**, con verificador/extractor/cifrado/contrato **inyectados**; consumidor de la outbox; interruptor de emergencia por archivo; compuerta de proceso; instalación solo vía `installControlledRuntime` |
| Pruebas | `homologation/provisioning.test.ts` (36), e2e `homologation-provision`, `homologation-runtime`, deriva de privilegios contra `RUNTIME_PRIVILEGE_POLICY` | ver §5 |

## 3. Cuentas de mínimo privilegio (por rol, sin DELETE/DDL/GRANT OPTION/globales)
`app` (puertos PriceSmart + vinculación + alta en el TMS), `worker` (solo columnas de la cola; no lee la carga cifrada), `monitor` (solo columnas de contadores). La parte PriceSmart de `app` **coincide exactamente** con `RUNTIME_PRIVILEGE_POLICY` (prueba de deriva y auditoría `auditRoleGrants`). Las tablas del TMS que el proyecto crea en tiempo de ejecución se conceden después del paso de esquema de ejecución, con privilegios temporales **siempre revocados**.
**Riesgo conocido:** la cuenta `app` también escribe las tablas del TMS que usa el alta de la solicitud (`tms_solicitudes_cliente`, `tms_solicitud_paradas`, `auditoria`…); su lista se derivó del código y se verificó ejecutando todo el e2e **como esa cuenta** (`e2e --as-homolog-app`).

## 4. Defectos reales encontrados y corregidos
1. **Inestabilidad bajo ráfagas (503):** `sandboxPool` revalidaba la configuración (lectura de archivos + SHA-256 **síncronos**, ~18 ms) en **cada sentencia SQL**. Un GET (~100 sentencias) bloqueaba el event loop >1 s y 30–40 solicitudes simultáneas superaban el límite de 20 s: **todas** respondían 503. Ahora la validación completa se reutiliza solo si el entorno y la **huella de los archivos** no cambiaron y pasaron <250 ms (se comprueba antes de cada sentencia); cualquier cambio revalida de inmediato y la identidad de la base sigue verificándose en cada sentencia. *(Cambio en una guarda: `src/lib/sandbox-db.ts`; evidencia completa en `EVIDENCIA-CACHE-Y-FINALIZE.md`.)*
2. **Contador de cuota** (API-25) ya era de una sola sentencia; sin cambio.
3. `PRICESMART_DB_RUNTIME_USER` aceptaba solo 32 caracteres; los nombres `sandbox_api02_homolog_<n>` y de laboratorio los superan (MariaDB 11 admite 80) → límite 64; el patrón estricto sigue en puertos y compuerta.
4. `NODE_ENV=production` bloqueaba siempre el runtime, pero `next start` lo fija también en el sandbox. Ahora bloquea salvo que el proceso se declare `NOVALVION_ENV=sandbox`; `NOVALVION_ENV=production` bloquea siempre y un proceso sin declarar sigue bloqueado.
5. Guardas estáticas (`provider-cipher`, `runtime-assembly`) permiten importar los módulos de composición **solo** desde `homologation/runtime.ts`; ninguna ruta ni otro módulo lo invoca (prueba estática).

## 5. Pruebas (ver el PR para las cifras de la corrida)
Aislamiento, concurrencia (30 POST y 40 GET simultáneos), idempotencia (8 POST iguales → 1 orden y 1 solicitud, mismo id con otro contenido → 409), recuperación (TMS caído y vuelto), cancelación antes/después de vincular, revocación inmediata, interruptor de emergencia y modo solo lectura, permisos denegados por el motor para cada cuenta, respuestas sin datos sensibles, ensayo del paquete completo (aplica, falla si se reaplica, destruye) y manifiesto aceptado por `validateSandboxConfig`.

## 6. Bloqueantes exactos (qué no puede completarse sin acuerdo o infraestructura)
| Dependencia | Punto exacto en el código | Qué falta |
|---|---|---|
| **D02** autenticación | `HomologationDeps.verifier` y `.evidence`; `PRICESMART_RATIFIED_DECISIONS` debe incluir D02; `evaluateSandboxExposure` exige `verifier.kind=EXTERNAL` | Mecanismo/formato de evidencia, emisor, audiencia, ancla de confianza, rotación (PriceSmart). Hoy: nada que enchufar |
| **KMS/HSM** | `HomologationDeps.cipher`; `REVIEWED_KMS_ADAPTERS` vacío | Proveedor seleccionado y adaptador revisado |
| **D06** contrato de la orden | `HomologationDeps.contract` (hoy solo existe el provisional `lab-demo-1`); `lab-demo/tms-link.ts` lee destinatario/dirección/fecha/notas | Diccionario definitivo; adaptar el mapeo a la solicitud del TMS y la validación de entrega múltiple (D05) |
| **D09** cancelación | Ruta POST `…/cancellation-requests`; `assessCancellation` solo informa | Método (POST vs DELETE: requeriría un manejador DELETE nuevo), reglas por estado y política para órdenes programadas |
| **D13** entrega confirmada | `delivery-evidence.ts` (informativo, `confirmsDelivery:false`); `EXTERNAL_STATUSES` sin estado «entregada» | Evidencia mínima, actor autorizado, parciales |
| Infraestructura | `nginx`/`systemd`/entorno generados como plantillas | Host dedicado, MariaDB local, dominio y certificado TLS, allowlist de IPs de PriceSmart, gestor de secretos, monitoreo/alertas operativos, usuario del sistema |
| Autorización humana | `HOMOLOG_ACK`, `evaluateSandboxExposure` sin bloqueantes | Revisión del SQL, del perfil y despliegue expreso |
Además: los diseños SQL (`*.sql.in`) siguen «no ratificados»; aplicarlos en el sandbox exige la confirmación explícita (ACK).
