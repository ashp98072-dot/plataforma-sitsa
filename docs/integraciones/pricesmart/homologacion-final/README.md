# PriceSmart — preparación final para homologación

> **Estado: preparado técnicamente, NO desplegado.** Ningún endpoint está expuesto: sin runtime instalado todo responde `503 DISABLED`. Nada de este paquete crea servicios públicos, credenciales reales ni ejecuta SQL en Hostinger. Contrato JSON (`lab-demo-1`) y estados son **PROVISIONALES** hasta que PriceSmart los ratifique.

Leyenda: **IMPLEMENTADO Y PROBADO** (código + prueba automática; ver CI) · **PROVISIONAL** (implementado, sin ratificar) · **PENDIENTE** (sin acuerdo o sin construir). Distinción de madurez: IMPLEMENTADO → VERIFICADO TÉCNICAMENTE (CI) → PROBADO con PriceSmart → APROBADO PARA PRODUCCIÓN. Hoy el máximo alcanzado es *verificado técnicamente*.

## Documentos
| Documento | Para quién | Contenido |
|---|---|---|
| [`GUIA-PRUEBAS-PRICESMART.md`](GUIA-PRUEBAS-PRICESMART.md) | PriceSmart | POST, GET, cancelación, autenticación, errores, idempotencia, reintentos y códigos HTTP; cómo usar Postman |
| [`../api25/openapi.homologation.json`](../api25/openapi.homologation.json) | PriceSmart | OpenAPI de homologación (marcada `PROVISIONAL_LAB`) |
| [`../api25/postman_collection.homologation.json`](../api25/postman_collection.homologation.json) | PriceSmart | Colección Postman con aserciones (flujo, cancelación, errores) |
| [`PROCEDIMIENTO-SANDBOX.md`](PROCEDIMIENTO-SANDBOX.md) | Mónaco (infra) | Instalación y verificación del ambiente de homologación separado de producción, apagado y reversión |
| [`ARRANQUE-RUNTIME.md`](ARRANQUE-RUNTIME.md) | Mónaco (infra/QA) | Cableado real del runtime en Next.js: qué lo activa, qué lo impide y cómo se apaga |
| [`VERIFICACION-OPERATIVA.md`](VERIFICACION-OPERATIVA.md) | Mónaco (QA) | Los 7 pasos del flujo ↔ pruebas reproducibles (CI y local) |
| [`../api26/RUNBOOK-APROVISIONAMIENTO.md`](../api26/RUNBOOK-APROVISIONAMIENTO.md) | Mónaco (infra) | Detalle de `provision.mjs` (apply/finalize/status/destroy) |

## Ensayo de aprovisionamiento (P1–P15) — resuelto
El fallo `TMS_SCHEMA_INCOMPLETE` **no era específico de Linux**: `sql/migrate-2026-11-cb2-vinculo-unidad.sql` (módulo de combustibles CB2, 20-nov) llegó a `main` después de fijar la lista de módulos fuera de alcance (`OUT_OF_SCOPE_FILES`, 16-nov), quedó incluida en el esquema del sandbox y altera `flota_cb2_consumos`, tabla de un módulo que el sandbox no instala. Corrección mínima: declarar ese archivo fuera de alcance (`bundle.mjs`), sin tocar migraciones productivas ni relajar validaciones; más una prueba (`alcance-esquema.test.ts`) que falla si una migración incluida depende de un módulo no instalado. P1–P15 corren ahora en el CI obligatorio (`pricesmart-lab.yml`).

## Lista definitiva
### Ya está listo (implementado y verificado técnicamente en CI con MariaDB 11.8.9 desechable)
- Recepción POST por orden: M2M, validación estricta, persistencia cifrada, evento + outbox + auditoría, idempotencia, concurrencia (`DEMO.1/4/8`, `F2–F5`).
- Vinculación con la solicitud del TMS, recuperación por token, órdenes ya vinculadas y `CONTRACT_NOT_MAPPED` (`DEMO.2/10–13`, `API13.*`, `NM.1–NM.5`).
- Avance por programación (Operaciones) reflejado en GET sin afirmar entrega nunca (`DEMO.6`, `H3`, `H5`).
- GET con estados permitidos; aislamiento entre empresas; errores sin eco de datos (`DEMO.3/5`, `H1`, `H6`).
- Solicitud de cancelación durable e idempotente (no cancela viajes automáticamente) (`DEMO.7`, `F7–F8`).
- Reintentos y revisión durable (`F6`, `API13.17`), trabajador dentro de la app.
- Cuentas de mínimo privilegio, kill switch, readiness; aprovisionamiento y destrucción verificados (`homologation-runtime` R0–R14, P1–P15).
- OpenAPI, Postman y guías.

### Falta únicamente por decisión de PriceSmart
D02 (mecanismo/verificador de autenticación y evidencia) · D03 (formato/unicidad de `externalOrderId`) · D05 (entregas parciales/varias) · D06 (diccionario definitivo de la orden) · D07 (zona horaria, ventanas, fechas pasadas) · D08 (estados oficiales) · D09 (método y reglas de cancelación) · D10 (cabecera de idempotencia HTTP) · D11/D12/D14/D15 (ver `api24`/`api27`) · **D13 (entrega confirmada: hasta entonces ningún estado externo confirma entrega)**.

### Lo que debemos configurar nosotros para habilitar el sandbox
Host dedicado con MariaDB 11.8.x en `127.0.0.1` (≠ producción) · dominio, certificado TLS y proxy inverso · allowlist de IPs de PriceSmart · gestor de secretos y adaptador KMS/HSM revisado · verificador M2M según D02 · ejecutar `provision.mjs` (plan → apply → finalize) · unidad systemd · credenciales de PriceSmart emitidas por Mónaco · aprobación humana de `evaluateSandboxExposure` · `PRICESMART_RUNTIME_MODE` y kill switch. Detalle y orden en [`PROCEDIMIENTO-SANDBOX.md`](PROCEDIMIENTO-SANDBOX.md).
