# PriceSmart API-19 — cifrado con proveedor externo de claves y verificador neutral

**Estado: IMPLEMENTADO, VERIFICADO TÉCNICAMENTE y PROBADO contra MariaDB 11.8.9 real desechable (laboratorio API-11: PASS 17 / FAIL 0 / SKIP 0) y con `npm run build` (Turbopack, `npm ci` limpio) correcto.** NO aprobado para producción. Runtime `503 DISABLED`, `ready=false`; ningún handler, endpoint ni flag cambia; nada en la aplicación importa estos módulos.

| Módulo | Qué aporta |
|---|---|
| `provider-cipher.ts` | `PayloadCipher` de **sobre (envelope)**: DEK aleatoria por carga (AES-256-GCM), envuelta por un `ExternalKeyProvider` inyectado; solo se guarda la DEK **envuelta**. Rotación (`currentKeyReference`, referencias anteriores siguen abriendo, `rewrap` sin tocar la carga), tiempo límite al proveedor, errores `CipherError` con código cerrado (`PROVIDER_UNAVAILABLE` / `INTEGRITY` / `INVALID`) y mensaje genérico, DEK borrada tras usarla. |
| `lab-demo/lab-key-provider.ts` | Proveedor **solo de laboratorio**, en memoria, claves al azar por ejecución (nada en repositorio, entorno ni base de datos); solo destino `LAB`. No es un KMS. |
| `guarded-evidence-verifier.ts` | Componentes neutrales del verificador (D02 sigue PENDIENTE): `denyAllEvidenceVerifier` y `guardEvidenceVerifier(inner)` (entrada acotada, entorno, copia de datos, tiempo límite, salida validada con `assertionSchema` y congelada, nunca lanza). **No** define formato de evidencia, ancla de confianza, audiencia ni algoritmos. |

## Ciclo de vida de la DEK y de las copias (propiedad explícita)
| Material | Propietario | Cuándo se borra |
|---|---|---|
| DEK generada al sellar (`randomBytes`) | adaptador | siempre, en `finally` (éxito o error) |
| Copia propia de la DEK desenvuelta (al abrir / `rewrap`) | adaptador | siempre, en `finally` |
| Copias entregadas al proveedor (`dataKey`, `wrappedKey`, `aad`) | adaptador (copias independientes) | al terminar la llamada por **cualquier** vía: éxito, excepción o tiempo límite (se borran de inmediato al vencer, aunque el proveedor siga trabajando) |
| Arreglo con la DEK que devuelve el proveedor | pasa al adaptador | se copia y se borra en el acto; si llega **tarde** nunca se usa y se borra |
| Texto en claro (`Buffer`) | adaptador | siempre |

**Límites que no se pueden garantizar en JavaScript:** las cadenas (p. ej. el JSON de la carga) son inmutables y no se pueden borrar; el motor y el recolector de basura pueden dejar copias fuera del control del código.

## Tiempo límite (sin afirmar cancelación)
`Promise.race` **no cancela** la operación del proveedor. Al vencer: se rechaza con `PROVIDER_UNAVAILABLE`, se activa un `AbortSignal` **de mejor esfuerzo** (el proveedor puede honrarlo o no; el adaptador **no afirma** que la operación externa quedó cancelada: puede seguir y completarse), se borran las copias que controla el adaptador y **la respuesta tardía se descarta** (nunca se acepta ni se usa; si es un arreglo, se borra; un rechazo tardío se absorbe sin efecto).

## Responsabilidad del proveedor externo
Un proveedor de claves confiable debe garantizar por sí mismo el manejo seguro del material que recibe: no registrarlo ni conservarlo más de lo necesario, borrarlo, no reutilizarlo y honrar el `signal` cuando pueda. El adaptador no puede verificarlo ni sustituirlo; eso es parte de la infraestructura/decisión pendiente del proveedor real.

## Entradas no serializables
`seal` solo acepta JSON simple y fiel (`isPlainJson`): rechaza con `INVALID`, **sin llamar al proveedor ni lanzar excepciones nativas**, `undefined`, funciones, símbolos, `BigInt`, `NaN`/`Infinity`, `Map`/`Set`/`Date`/instancias de clases/`Buffer`, ciclos, getters, `toJSON` que lance, propiedades ocultas o con símbolo, arreglos dispersos y estructuras demasiado profundas o grandes. Cualquier excepción nativa inesperada en `seal`/`open`/`rewrap` se convierte en un `CipherError` de código cerrado.

## Separación LAB / PRODUCTION en capas
1. el proveedor declara su destino y debe coincidir con el del adaptador; 2. prefijo de referencia por destino (`lab.` / `prod.`) exigido al sellar y abrir; 3. el destino va en el AAD del texto y del envoltorio de la DEK: aunque dos proveedores compartieran material, un texto de un destino no abre en el otro (probado con material compartido y referencia re-etiquetada).

## Compatibilidad con API-16/17/18
El adaptador supera la suite de conformidad, se atesta (con la autoridad en proceso y con la autoridad por registro sobre MariaDB), pasa la compuerta y un cifrador sustituto no inscrito da `IDENTITY_MISMATCH` (caso de laboratorio `API11.17`).

## Build (equivalente a Hostinger)
`npm ci` + `npm run build` (`next build`, Turbopack): compila, ejecuta TypeScript y genera las páginas; `tsc --noEmit` limpio. El error de tipos que se veía en `vehiculos-fusion-private.db.test.ts` y el de `fake-indexeddb` proceden de un `node_modules` compartido y desactualizado entre worktrees, no del código: con una instalación limpia no aparecen. No se desactivó ninguna comprobación. Quedan 8 advertencias de Turbopack preexistentes (`scripts/sandbox-config.mjs`, patrón de archivos demasiado amplio) que no impiden el build.

## Bloqueantes restantes (no inventados)
Proveedor real de claves (KMS/HSM) y su política de rotación/retiro · mecanismo y formato de la evidencia (D02) · contrato de orden (D06) y D08/D09/D12 · proveedor de la clave de firma de la autoridad · cuenta administrativa del registro y esquema de producción · los puertos MariaDB de API-11 siguen exigiendo cuentas `sandbox_api02_*` · el entorno `production` no está modelado en el contrato de seguridad.
