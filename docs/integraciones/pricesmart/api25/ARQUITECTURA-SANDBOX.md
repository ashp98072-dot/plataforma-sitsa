# PriceSmart API-25 — arquitectura del sandbox de homologación

**Estado: DISEÑO + requisitos ejecutables. NO hay sandbox desplegado, NO hay URL, NO hay credenciales para PriceSmart.** Endpoints en `503 DISABLED`, `ready=false`, `authorizesInstallation=false`, `REVIEWED_KMS_ADAPTERS` vacío. Nada de lo que sigue autoriza una exposición externa.

## 1. Contexto acordado (reunión 30/10/2026, D01)
PriceSmart envía cada orden por **POST** (individual, no por lotes) a una API de Mónaco; consulta por **GET** el estado de cada orden (~cada hora); **notifica cancelaciones** a un endpoint de Mónaco. Mónaco gestiona planificación, recursos y entregas, y debe proveer API, sandbox, credenciales, Postman y documentación. Pruebas conjuntas previstas en diciembre de 2026; salida productiva tentativa en enero de 2027, sujeta a aprobación. KPI es un proyecto aparte. **Este acuerdo fija la dirección (D01); NO ratifica autenticación, contrato de orden, estados, cancelación ni capacidad.**

## 2. Tres entornos que no deben confundirse
| | Laboratorio local (hoy) | Sandbox de homologación (por construir) | Producción |
|---|---|---|---|
| Para qué | Desarrollo y pruebas automáticas | Que PriceSmart pruebe contra Mónaco | Operación real |
| Quién lo usa | Solo el equipo, en loopback | PriceSmart + equipo, por HTTPS | Clientes reales |
| Base de datos | MariaDB desechable en `127.0.0.1`, esquema `sandbox_api02_<id hex>` | Servidor **dedicado**, esquema `sandbox_api02_homolog_*` (cumple los guardas vigentes y se distingue del laboratorio) | Fuera de alcance (decisión pendiente) |
| Autenticación | Verificador HMAC sintético (`x-lab-evidence`), **solo laboratorio** | **Verificador acordado con PriceSmart (D02)**; el HMAC está prohibido | Ídem, con KMS aprobado |
| Datos | Ficticios | Ficticios (empresas, clubes y usuarios sintéticos) | Reales |
| Credenciales | Generadas por corrida, en `%TEMP%` | Exclusivas del sandbox, fuera del repositorio, distintas de producción | Distintas |
| Exposición | Prohibida (`labDemoGate`: no producción, loopback, bandera, claves) | Solo tras cumplir `evaluateSandboxExposure` y revisión humana | Prohibida hasta nueva decisión |

## 3. Qué se reutiliza (no se reconstruye nada)
| Función | Componente existente |
|---|---|
| POST / GET / cancelación (transporte aislado) | `http-transport.ts`, rutas `src/app/api/integrations/pricesmart/v1/orders/**` (503 DISABLED) |
| Autenticación M2M y permisos | `m2m-security.ts` + puerto `EvidenceVerifier` (`guarded-evidence-verifier.ts`), catálogo/revocación/contador/replay `security-mariadb.ts` |
| Catálogo de integraciones, scopes, clubes | `ps_api11_*` (API-11) |
| Persistencia cifrada + evento + outbox + auditoría | `mariadb-repository.ts`, `outbox*.ts` (API-01/07) |
| Procesamiento outbox → TMS | `lab-demo/outbox-link-handler.ts` (API-23), `link-retry.ts` (API-13), `tms-link.ts` (API-12) |
| Estados y cancelación | `tms-contract-proposal.ts`, `delivery-evidence.ts` (API-25) |
| Disponibilidad / diagnóstico | `readiness-diagnostic.ts` (`/api/admin/pricesmart/readiness`), `production-preflight.ts`, `installation-gate.ts` |
| Separación entornos | `environment.ts` (API-22): sandbox ≠ production |
| Aprovisionamiento del laboratorio | `scripts/ci/pricesmart-demo/demo.mjs` (`up`/`down`), `scripts/ci/pricesmart-api06a/ddl.mjs` |
| **Nuevo en API-25** | `homologation-sandbox.ts` (requisitos ejecutables), `delivery-evidence.ts` (evidencia mínima), OpenAPI/Postman de homologación |

## 4. Topología objetivo del sandbox (diseño, sin desplegar)
```
PriceSmart ──HTTPS (TLS, allowlist de red, límite de tasa)──► Gateway del sandbox
                                                               │  (instancia SEPARADA de producción)
                                                               ▼
                         Ruta Next del sandbox ─► motor M2M ─► EvidenceVerifier EXTERNO (D02)  ✗ no existe aún
                                                               │
                                       repositorio cifrado (KMS aprobado) ✗ no existe aún
                                                               ▼
                      MariaDB dedicada `sandbox_api02_homolog_*` ──► outbox ──► consumidor ──► TMS del sandbox (empresa ficticia)
```
- **Separación:** proceso, base de datos (servidor distinto del de producción), secretos, dominio y credenciales propios. Ninguna variable de producción se reutiliza; `NODE_ENV=production` y `NOVALVION_ENV=production` bloquean la composición de laboratorio.
- **Controles de acceso:** HTTPS únicamente; allowlist de red; credencial por integración con scopes mínimos (`orders:create|read|cancel`) y por club; revocación y rotación; protección contra repetición (prueba ligada a la solicitud); límites de tasa y de cuerpo.
- **Datos:** empresas, clubes y usuarios ficticios; sin datos reales; órdenes cifradas en reposo; respuestas y registros sin PII.
- **Procesamiento:** el POST confirma recepción (202) y persiste evento+outbox en una transacción; el consumidor vincula con el TMS del sandbox con reintentos; el GET proyecta el estado real y nunca afirma entrega.

## 5. Mecanismo de acceso para PriceSmart (diseño)
Un solo punto de entrada HTTPS por ambiente, con credenciales emitidas por Mónaco para la integración del sandbox (formato según D02, **sin definir**). Las credenciales se entregan por un canal seguro y se pueden revocar y rotar sin redeploy (catálogo en base de datos). **No se genera ni se comparte ninguna credencial en esta fase.**

## 6. Aprovisionamiento y destrucción reproducibles (procedimiento; NO ejecutarlo en producción)
Ver `GUIA-HOMOLOGACION.md` §5. Principio: todo parte de scripts versionados (DDL de revisión + datos sintéticos), se ejecuta solo en la infraestructura del sandbox con autorización, y puede destruirse por completo (base, usuarios, secretos, DNS) sin tocar producción.

## 7. Verificación mecánica del estado de preparación
`evaluateSandboxExposure(perfil)` (`homologation-sandbox.ts`) recibe un perfil declarativo (solo booleanos y nombres, **sin secretos**) y devuelve los bloqueantes vigentes. Siempre `authorizesExternalExposure=false`: ni con un perfil perfecto se autoriza (el adaptador KMS revisado no es declarable: depende del código). El laboratorio actual (`CURRENT_LAB_PROFILE`) se rechaza explícitamente: HMAC sintético, esquema de laboratorio, sin HTTPS/allowlist/monitoreo.
