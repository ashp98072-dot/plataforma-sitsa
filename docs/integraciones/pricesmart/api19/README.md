# PriceSmart API-19 — cifrado con proveedor externo de claves y verificador neutral

**Estado: IMPLEMENTADO, VERIFICADO TÉCNICAMENTE y PROBADO contra MariaDB 11.8.9 real desechable (laboratorio API-11: PASS 17 / FAIL 0 / SKIP 0) y con `npm run build` (Turbopack, `npm ci` limpio) correcto.** NO aprobado para producción. Runtime `503 DISABLED`, `ready=false`; ningún handler, endpoint ni flag cambia; nada en la aplicación importa estos módulos.

| Módulo | Qué aporta |
|---|---|
| `provider-cipher.ts` | `PayloadCipher` de **sobre (envelope)**: DEK aleatoria por carga (AES-256-GCM), envuelta por un `ExternalKeyProvider` inyectado; solo se guarda la DEK **envuelta**. Rotación (`currentKeyReference`, referencias anteriores siguen abriendo, `rewrap` sin tocar la carga), tiempo límite al proveedor, errores `CipherError` con código cerrado (`PROVIDER_UNAVAILABLE` / `INTEGRITY` / `INVALID`) y mensaje genérico, DEK borrada tras usarla. |
| `lab-demo/lab-key-provider.ts` | Proveedor **solo de laboratorio**, en memoria, claves al azar por ejecución (nada en repositorio, entorno ni base de datos); solo destino `LAB`. No es un KMS. |
| `guarded-evidence-verifier.ts` | Componentes neutrales del verificador (D02 sigue PENDIENTE): `denyAllEvidenceVerifier` y `guardEvidenceVerifier(inner)` (entrada acotada, entorno, copia de datos, tiempo límite, salida validada con `assertionSchema` y congelada, nunca lanza). **No** define formato de evidencia, ancla de confianza, audiencia ni algoritmos. |

## Separación LAB / PRODUCTION en capas
1. el proveedor declara su destino y debe coincidir con el del adaptador; 2. prefijo de referencia por destino (`lab.` / `prod.`) exigido al sellar y abrir; 3. el destino va en el AAD del texto y del envoltorio de la DEK: aunque dos proveedores compartieran material, un texto de un destino no abre en el otro (probado con material compartido y referencia re-etiquetada).

## Compatibilidad con API-16/17/18
El adaptador supera la suite de conformidad, se atesta (con la autoridad en proceso y con la autoridad por registro sobre MariaDB), pasa la compuerta y un cifrador sustituto no inscrito da `IDENTITY_MISMATCH` (caso de laboratorio `API11.17`).

## Build (equivalente a Hostinger)
`npm ci` + `npm run build` (`next build`, Turbopack): compila, ejecuta TypeScript y genera las páginas; `tsc --noEmit` limpio. El error de tipos que se veía en `vehiculos-fusion-private.db.test.ts` y el de `fake-indexeddb` proceden de un `node_modules` compartido y desactualizado entre worktrees, no del código: con una instalación limpia no aparecen. No se desactivó ninguna comprobación. Quedan 8 advertencias de Turbopack preexistentes (`scripts/sandbox-config.mjs`, patrón de archivos demasiado amplio) que no impiden el build.

## Bloqueantes restantes (no inventados)
Proveedor real de claves (KMS/HSM) y su política de rotación/retiro · mecanismo y formato de la evidencia (D02) · contrato de orden (D06) y D08/D09/D12 · proveedor de la clave de firma de la autoridad · cuenta administrativa del registro y esquema de producción · los puertos MariaDB de API-11 siguen exigiendo cuentas `sandbox_api02_*` · el entorno `production` no está modelado en el contrato de seguridad.
