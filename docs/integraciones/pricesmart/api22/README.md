# PriceSmart API-22 — entorno `production` en los contratos de seguridad (sin activar nada)

**Estado: IMPLEMENTADO, VERIFICADO TÉCNICAMENTE y PROBADO contra MariaDB 11.8.9 real desechable.** NO aprobado para producción. Endpoints `503 DISABLED`, `ready=false`, `authorizesInstallation=false`; ningún handler instalado ni bandera cambiada; registro oficial KMS (`REVIEWED_KMS_ADAPTERS`) **vacío**; sin verificador criptográfico productivo; sin SQL productivo, sin Hostinger.

## 1. Auditoría: qué obligaba a usar solo `sandbox`
| Dependencia | Dónde | Qué protege | Decisión API-22 |
|---|---|---|---|
| Literal `'sandbox'` en contratos | `security-contracts.ts` (`targetSchema`, `assertionSchema`, `integrationSchema`, contexto de `EvidenceVerifier`), `contracts.ts` (`principalSchema`/`Scope`) | Que ninguna identidad/recurso de otro entorno entrara en el motor | **Reemplazado** por `environmentSchema` (`sandbox`\|`production`, nada más; ausente o inválido ⇒ rechazo) |
| Verificación con `{ environment: 'sandbox' }` fijo | `m2m-security.ts`, `http-transport.ts`, `guarded-evidence-verifier.ts`, `port-conformance.ts` | Que el verificador solo validara evidencia de laboratorio | **Parametrizado** con el entorno del despliegue (por omisión `sandbox`, compatibilidad) |
| Entorno del despliegue vs aserción vs registro vs recurso | `m2m-security.ts` (no se comparaba: todo era `sandbox`) | Aislamiento de identidades | **Nuevo**: los cuatro deben coincidir exactamente (`sameEnvironment`); el namespace de cuotas/reclamos y el digest de la prueba de solicitud incluyen el entorno |
| `runtime-config` `PRICESMART_RUNTIME_ENVIRONMENT = sandbox` | `runtime-config.ts` | Que no se configurara un runtime de producción | `production` **se parsea pero se bloquea** (`PRODUCTION_ENVIRONMENT_NOT_AUTHORIZED`) en el ensamblaje y en el diagnóstico |
| Bloqueo `PRODUCTION_ENVIRONMENT_NOT_MODELED` | `readiness-diagnostic.ts`, `runtime-assembly.ts` | Idem | **Renombrado** a `PRODUCTION_ENVIRONMENT_NOT_AUTHORIZED`: el contrato ya lo modela, pero nada lo autoriza |

## 2. Inventario de los guardas `sandbox_api02_*` / pool sandbox (NO se eliminan ni relajan)
| Guarda | Archivo | Requisito que protege | Estado / dependencia |
|---|---|---|---|
| `isSandboxVerifiedPool` + `sandbox_api02_*` (esquema y cuenta) + `scope.environment !== 'sandbox'` + `environment` explícito solo `sandbox` | `mariadb-repository.ts` | Que órdenes cifradas solo se escriban en una base sandbox verificada | **Conservado.** Persistencia de producción depende de una decisión pendiente (esquema, cuentas, KMS, D06) |
| Idem (+ `environment` explícito) | `security-mariadb.ts` | Catálogo, revocaciones, contadores y reclamos solo en sandbox verificado | **Conservado.** Producción: esquema/cuentas reales y política de grants definitiva |
| Idem | `outbox-mariadb.ts`, `adaptation-mariadb.ts`, `source-order-mariadb.ts` | Outbox, adaptación y lectura hacia el TMS solo desde sandbox | **Conservado.** Adaptar órdenes de producción al TMS es una decisión de negocio (D06/D08/D09/D12) |
| `z.literal('sandbox')` | `outbox.ts` (`outboxScopeSchema`), `tms-adaptation-contracts.ts` (`adaptationScopeSchema`) | Que eventos/adaptación al TMS no se generen para producción | **Conservado.** Misma dependencia |
| `LAB_NAME`/pool no sandbox para PRODUCTION | `attestation-mariadb.ts` | Separación LAB/PRODUCTION del almacén de nonces | Ya separado desde API-18 |
| Esquema DDL `CHECK (environment = 'sandbox')` | `docs/…/api01`, `api09`, `api11` `staging*.sql.in` | Filas de laboratorio solo `sandbox` | **Conservado** (SQL de revisión; el esquema de producción es decisión pendiente) |

## 3. Reglas contractuales que se prueban (`environment-contract.test.ts`, caso de laboratorio `API11.22`)
Entorno = parte de la identidad, la autorización y la confianza; **matriz completa** deployment × aserción × registro × recurso (solo todo-igual autoriza); credencial de un entorno nunca autoriza en el otro; registro ambiguo en ambos entornos ⇒ DENIED; revocación y permisos separados por entorno (el puerto recibe el entorno del registro); namespace y digest de prueba incluyen el entorno; ausencia/valores inválidos ⇒ rechazo (`null`, `''`, `staging`, mayúsculas…); los puertos de laboratorio no adquieren capacidades productivas (repositorio y puertos MariaDB rechazan `production`; transporte `production` contra puertos reales no escribe nada); `REVIEWED_KMS_ADAPTERS` vacío; verificador por omisión deniega y la envoltura exige el entorno exacto (y no entrega aserciones de otro entorno); banderas/variables accidentales (`NODE_ENV=production`, `PRICESMART_RUNTIME_MODE=ENABLED`…) no activan los endpoints.

## 4. Bloqueos técnicos exactos que siguen vigentes
1. **Persistencia de producción:** los puertos MariaDB exigen sandbox verificado (`isSandboxVerifiedPool`, `sandbox_api02_*`) y el DDL fija `environment='sandbox'`. Falta decidir esquema, cuentas (con el plan de API-21), política de grants definitiva y su revisión.
2. **Verificador criptográfico productivo (D02):** no existe; solo `denyAllEvidenceVerifier` y la envoltura neutral.
3. **Proveedor KMS/HSM:** no seleccionado; `REVIEWED_KMS_ADAPTERS` vacío ⇒ `KMS_PROVIDER_NOT_SELECTED`.
4. **Outbox y adaptación al TMS** siguen sandbox-only.
5. **Instalación:** ninguna ruta produce `passed=true` para PRODUCCIÓN; `installControlledRuntime` bloquea `production` aunque todo esté «ratificado».

## 5. Qué sigue dependiendo de PriceSmart / decisiones externas
D02 (mecanismo y formato de evidencia M2M, ancla de confianza, audiencia) · D06 (contrato de orden definitivo) · D08, D09, D12 (según el registro del proyecto) · identificadores reales de integración y credenciales por entorno · selección del proveedor KMS/HSM · política de rotación/retiro de claves · autorización de adaptar órdenes de producción hacia el TMS.
