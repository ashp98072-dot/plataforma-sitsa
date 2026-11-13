# PriceSmart API-20 — adaptación KMS/HSM, separación MariaDB y preflight productivo

**Estado: IMPLEMENTADO, VERIFICADO TÉCNICAMENTE y PROBADO contra MariaDB 11.8.9 real desechable (laboratorio API-11: PASS 19 / FAIL 0 / SKIP 0) y con `npm ci` + `npm run build` correctos.** NO aprobado para producción. Runtime `503 DISABLED`, `ready=false`; ningún handler, endpoint ni flag cambia; nada en la aplicación importa estos módulos. No se ejecutó SQL productivo ni se tocó Hostinger.

| Módulo | Qué aporta |
|---|---|
| `kms-adapter.ts` | Puerto neutral `KmsClient` (cifrar/descifrar la DEK por alias con contexto, salud de solo lectura) + `parseKmsConfig` (función pura: destino, alias vigente y lista cerrada, límites; **rechaza** cualquier variable con aspecto de credencial o desconocida) + `createKmsKeyProvider` (→ `ExternalKeyProvider` de API-19): alias por destino (`lab.`/`prod.`), mamparo de concurrencia sin cola, reintentos acotados solo para errores marcados `retryable`, respeto del `AbortSignal` y no reenvío de material ya borrado, validación de respuestas, errores sin detalles. La autenticación hacia el KMS real es del cliente inyectado. |
| `lab-demo/lab-kms-client.ts` | Cliente KMS de **laboratorio** en memoria (claves al azar por ejecución, solo `lab.*`). |
| `grants-audit.ts` | Auditoría PURA de `SHOW GRANTS` contra una política mínima cerrada (`RUNTIME_PRIVILEGE_POLICY`): rechaza globales, esquema completo, otros esquemas, tablas ajenas, privilegios en exceso, `GRANT OPTION` y roles; no devuelve nunca el texto de las líneas. |
| `database-identity.ts` | Validación PURA de separación producción/laboratorio (host, puerto, esquema y **tres cuentas distintas**: ejecución, escritura del registro, migración; sin nombres de laboratorio ni cuentas privilegiadas). No cambia los guardas sandbox existentes. |
| `production-preflight.ts` + `preflight-mariadb.ts` | `runProductionPreflight`: KMS (config/destino/salud), separación de BD, identidad de sesión, privilegios, confianza LAB/PRODUCTION disjunta y atestación (sin consumir nonce). El lector de BD ejecuta **exactamente dos lecturas fijas** (`SELECT DATABASE(), CURRENT_USER()` y `SHOW GRANTS FOR CURRENT_USER()`), sin SQL libre. Informe con ids/estados/códigos y resumen SHA-256, **sin valores**. |

## Alcance honesto
`passed` es una verificación técnica: **no autoriza instalar**, no cambia el readiness y no declara nada listo (`ready: false`, `authorizesInstallation: false` fijos). Un preflight de PRODUCCIÓN contra recursos de laboratorio nunca pasa (probado en el laboratorio real). Los puertos MariaDB de API-11 siguen exigiendo cuentas `sandbox_api02_*`; relajarlo es una decisión pendiente y explícita, no incluida aquí.

## Bloqueantes restantes (no inventados)
Cliente KMS/HSM real y su identidad de servicio · D02 (mecanismo/formato de evidencia) · D06 (contrato de orden) · D08, D09, D12 · proveedor de la clave de firma de la autoridad · cuentas y esquema de producción reales y su política de grants definitiva · el entorno `production` no está modelado en el contrato de seguridad · cambio de los guardas `sandbox_api02_*` de los puertos de API-11.
