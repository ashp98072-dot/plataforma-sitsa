# Verificación operativa reproducible del flujo PriceSmart

Cada paso del flujo acordado se cubre con pruebas automáticas contra **MariaDB 11.8.9 real y desechable** (laboratorio sintético: M2M y TMS con dobles de prueba; **no** se prueba el verificador real de PriceSmart, D02). Resultado y estado: *verificado técnicamente*, no «probado con PriceSmart» ni «aprobado para producción».

## Cómo reproducir
| Dónde | Comando | Alcance |
|---|---|---|
| GitHub Actions (obligatorio) | workflow **Laboratorio PriceSmart E2E (MariaDB 11.8.9)** (`.github/workflows/pricesmart-lab.yml`) en cada PR que toque PriceSmart, SQL o el laboratorio; también `workflow_dispatch` | Unitarias + 4 fases E2E, incluido el ensayo de aprovisionamiento P1–P15 |
| Linux con `mariadbd` 11.8.9 | `PS_API06A_LAB_ACK=SINTETICO-LOCAL-SIN-PRODUCCION-NI-HOSTINGER node scripts/ci/pricesmart-demo/run-linux.mjs` | Las mismas 4 fases (`PS_E2E_FILES=a.e2e.ts,b.e2e.ts` limita los archivos) |
| Windows (laboratorio original) | `node scripts/ci/pricesmart-demo/demo.mjs up` → `e2e` → `down` | Idéntico, con binarios `winx64` verificados por hash |
| Unitarias | `npx vitest run --config vitest.config.mts src/lib/integrations/pricesmart` | Puertos simulados, sin base de datos |
Nada de lo anterior toca producción, Hostinger ni credenciales reales.

## Los 7 pasos ↔ pruebas
| # | Paso del flujo | Pruebas (E2E con base real) | Qué verifican |
|---|---|---|---|
| 1 | PriceSmart envía una orden por POST | `DEMO.1`, `DEMO.9`, `F10–F12`, `contract-dictionary C1` | `202`, M2M (evidencia, replay, permisos, entorno), orden cifrada + evento + outbox + auditoría |
| 2 | Mónaco la recibe y registra **sin duplicados** | `DEMO.4`, `DEMO.8` (6 POST simultáneos), `F3`, `F5`, `C2` | misma orden → mismo recibo; una orden y una solicitud; reproceso sin duplicar |
| 3 | Se vincula con la solicitud del TMS | `DEMO.2`, `DEMO.11–13`, `API13.1–16`, `NM.1–NM.5` | solicitud `SOLICITADA` con datos logísticos; colisiones entre integraciones; solicitud preexistente no se reutiliza; caídas entre operaciones; `CONTRACT_NOT_MAPPED`, orden ya vinculada, recuperación por token |
| 4 | Avanza por programación y entrega | `DEMO.6`, `H3` (por cada estado del plan), `H4`, `H5` | Operaciones toma en revisión y programa → GET refleja `IN_REVIEW`/`SCHEDULED`/… ; estados incoherentes → `REVIEW_REQUIRED`; **ningún estado confirma entrega** |
| 5 | GET devuelve el estado permitido | `DEMO.3`, `DEMO.5`, `S1–S6`, `R2`, `C4` | `confirmsDelivery:false`; sin datos del destinatario en respuestas/registros; aislamiento entre empresas (404) |
| 6 | Se recibe una solicitud de cancelación | `DEMO.7`, `F7`, `F8`, `H4`, `R4`, `S5` | queda trazada, idempotente, **no** cancela solicitudes/planes/viajes; cancelar antes de vincular impide la vinculación |
| 7 | Errores y reintentos quedan registrados | `H1`, `H2`, `DEMO.10`, `F2`, `F4`, `F6`, `API13.17`, `H6` | 400 sin eco; rechazo del TMS → sin vincular y GET pide revisión; reintentos acotados → **REVIEW durable**; trabajador tras reinicio; sin datos sensibles en el registro |

## D13: entrega sin confirmar
El estado externo **no** incluye «entregada». `confirmsDelivery` es siempre `false` y «descargado»/«cerrado» no equivalen a entrega aceptada (`H3` lo verifica por cada estado del plan; `src/lib/integrations/pricesmart/delivery-evidence.ts` define la evidencia mínima interna). Cambiarlo requiere ratificar D13 y es un cambio de contrato explícito.

## Qué NO cubre esta verificación
Verificador/credenciales reales de PriceSmart (D02), diccionario definitivo (D06), método de cancelación ejecutada (D09), estados oficiales (D08), exposición pública, TLS y rendimiento. Se cubren con el procedimiento de `PROCEDIMIENTO-SANDBOX.md` y con las pruebas conjuntas.
