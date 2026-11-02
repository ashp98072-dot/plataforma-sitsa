# Evidencia documental sanitizada

Preparación del 2026-11-02, base `1eb1e6b906d6fa8a8554d07b03f7eb25079ef7d8`, rama `feature/pricesmart-sandbox-s06b1`. Sólo se añaden documentos en esta carpeta; ningún cambio a scripts, grants, SQL, unidades, API, TMS o contabilidad.

[evidence.json](evidence.json) registra hashes SHA256 de bytes del checkout de las fuentes principales revisadas. Pueden variar por normalización CRLF/LF; no son firmas, hashes de secretos, artefactos Linux ni evidencia de despliegue. La base identifica contenido Git; los hashes registran esta lectura local. No contiene datos de infraestructura, credenciales ni payloads.

## Comprobaciones locales ejecutadas

| Comprobación | Resultado observado | Alcance |
|---|---|---|
| `node --test scripts/sandbox-s06a/preflight.test.mjs` | 12/12 pasan | Validador documental, rechazos de entradas y conservación de bloqueos; usa fixtures sintéticos. |
| `node scripts/sandbox-s06a/preflight.mjs validate infra/pricesmart-sandbox/s06a/dossier.example.json` | exit 0; schemaValid=true, authorizedToExecute=false | Sólo formato. |
| `node scripts/sandbox-s06a/preflight.mjs assess infra/pricesmart-sandbox/s06a/dossier.example.json` | exit 2; BLOCKED; 48 pendientes; primer gate GATE1; authorizedToExecute=false; operationalIsolationCertified=false | Comportamiento esperado, no certificación. |
| `node ../../node_modules/vitest/vitest.mjs run --config vitest.pricesmart-api01.config.mts` | 22 archivos, 663 pruebas pasan | Regresión disponible S02–S05/API-01–API-05 con dobles/archivos locales; no DB/red/HTTP operativos. |
| Comparación de IDs de filas PLAN-25 con lista S06-A | 25 IDs únicos, mismo orden y cobertura | Comprobación documental local con regex; no valida verdad de evidencias. |
| `git diff --check` | Sin errores | Formato del diff. |

Se reutilizaron dependencias instaladas en el workspace padre: Vitest 4.1.11 (el manifiesto solicita 4.1.12). No se instaló software ni se alteró lock; ese desajuste limita la reproducibilidad del entorno local y debe revisarse antes de una ejecución formal. No se requiere build Next ni typecheck nuevo para esta entrega exclusivamente documental.

## Pruebas físicas

**NO EJECUTADAS:** A1, A2, B1, B2, C1, C2, C3, D1, D2, D3, E1, E2, F1, F2, F3, G1, G2, H1, I1, I2, J1, J2, K1, L2. **L1 NO EJECUTADA:** revisión formal de procedencia pendiente del custodio/auditor. Tampoco se ejecutó comunicación con PriceSmart, SQL real, TMS operativo, HTTP real o Linux. No hay fecha de ejecución, VM autorizada ni adjuntos físicos que permitan PASS.

No se ejecutaron los comandos futuros Q1–Q9 ni operaciones O1–O9. Las pruebas de software anteriores no satisfacen ninguna prueba física. No hubo compras, VM/cloud, instalaciones, inicio de servicios, SQL/migraciones, cambios firewall/SSH, Hostinger, desbloqueo S04, activación API, cambios operativos o contables, merge ni despliegue. D01–D16 permanecen pendientes. Entregar a auditoría antes de solicitar autorización operativa.
