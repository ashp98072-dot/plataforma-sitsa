# PriceSmart API-18 — composición administrativa: nonces durables, autoridad de identidad y compuerta de instalación

**Estado: IMPLEMENTADO, VERIFICADO TÉCNICAMENTE y PROBADO contra MariaDB 11.8.9 real desechable (loopback, datos sintéticos): laboratorio API-11 PASS 16 / FAIL 0 / SKIP 0.** NO aprobado para producción. Runtime `503 DISABLED`, `ready=false`; ningún handler, endpoint ni flag cambia; nada en la aplicación importa estos módulos.

| Módulo | Qué aporta |
|---|---|
| `attestation-mariadb.ts` | `NonceStore` durable y compartido (PK `(target, hash)`: de N canjes simultáneos exactamente 1 `FRESH`) y lector del registro de identidad. LAB solo con pool verificado de sandbox y nombres `sandbox_api02_*`; PRODUCTION solo con pool no sandbox y nombres que no sigan el patrón de laboratorio. Solo INSERT/SELECT. |
| `registry-identity-authority.ts` | Autoridad de identidad **distinta de la de laboratorio**: existencia, estado y `subject` salen de un registro que escribe una cuenta administrativa (el runtime solo lo lee); firma con una clave de un proveedor inyectado; `enroll` inmutable. `assertDisjointTrust` exige confianza disjunta LAB/PRODUCTION. |
| `mariadb-composition.ts` | Descriptor con los puertos reales de API-11 (contador, replay, catálogo, reloj) y lista de **faltantes**: cifrado con gestión de claves y verificador (D02). |
| `installation-gate.ts` | `checkInstallationEligibility` (sin efectos) y `redeemInstallationEligibility` (consume el nonce): rechaza composición incompleta, identidad no verificada, atestación caducada/manipulada/no conforme/incompleta/de otro destino, autoridad de laboratorio en producción, reloj no disponible. «Elegible» ≠ autorización y no instala nada. |
| `staging-attestation.sql.in` | DDL propuesto (con SIGNAL de bloqueo; **no ejecutado** fuera del laboratorio): nonces y registro. |

## Qué falta para conectar los puertos reales (no inventado)
Cifrado de cargas con gestión de claves (KMS) · verificador de evidencia (D02) · proveedor de la clave de firma de la autoridad · cuenta administrativa que escriba el registro y almacén/esquema de producción · limitación vigente: los puertos MariaDB de API-11 exigen aún cuenta `sandbox_api02_*`. D02/D06/D08/D09/D12 siguen pendientes.

## Límites honestos
La confianza real depende de la separación de privilegios del registro y de la custodia de la clave de firma (infraestructura); estos módulos la usan pero no la pueden garantizar. El arnés de laboratorio ahora crea las tablas de API-18 y concede solo `SELECT, INSERT` sobre nonces y `SELECT` sobre el registro.
