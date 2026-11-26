# PriceSmart ↔ Logiservicios Mónaco — cierre interno de requerimientos

Este documento resume lo que SITSA completó internamente, lo que depende de PriceSmart y lo que depende de infraestructura o aprobación. Estado máximo alcanzado: **VERIFICADO TÉCNICAMENTE** (compilación + pruebas unitarias + E2E con MariaDB 11.8.9 real en CI Linux). Ninguna parte está probada con PriceSmart ni aprobada para producción. Sin merge, despliegue, SQL productivo ni servicios expuestos.
Las áreas se entregaron en PR independientes (ver el PR de cada una para SHA, CI y SQL): **1** cierre operativo y cancelaciones · **2** Portal del Cliente · **3** KPI · **4** sandbox y cobertura de CI (este PR).

## A. COMPLETADO INTERNAMENTE
| Requisito | Estado | Código y prueba |
|---|---|---|
| POST → recepción durable → solicitud TMS → programación → GET, sin duplicados, con reintentos, aislamiento empresa/cliente/club y auditoría | Ya completo y probado; verificado sobre el código real | `lab-demo/tms-link.ts`, `link-retry.ts`; E2E `DEMO.*`, `F*`, `API13.*`, `NM.1–NM.5`, `H*`, `C*` |
| Errores de adaptación recuperables para revisión | Completo | trabajo `BLOCKED/EXHAUSTED` + bandeja (`ops-view.ts`); `NM.*`, `H2` |
| Estados que no se confunden con entrega | Completo | `confirmsDelivery:false`; sin estado «entregada»; `H3`, `cancelacion-entrega.test.ts` |
| Cancelaciones: recepción durable, idempotencia, evaluación, protección de viajes iniciados, quién solicitó, **quién resolvió, revisión por Operaciones y consulta del resultado** | Completo (la resolución es lo nuevo del área 1) | `noteCancellation`, `assessCancellation`, `cancellation-resolution.ts`; E2E `CR.1–CR.6`, `DEMO.7`, `F7–F8` |
| Portal del Cliente: consulta de órdenes de la integración (estado, viaje, paradas, evidencias, aislamiento) y acceso de **solo consulta** | Completo; migración preparada **no ejecutada** | `cliente-portal-*`, `requireClienteEscritura`; E2E `CP.1–CP.4` |
| Evidencias y confirmación de entrega: diferenciación entre entrega operativa (estado del viaje), evidencia registrada (`flota_viaje_evidencias`, `tms_parada_confirmaciones`) y entrega confirmada según PriceSmart (**no existe**, D13) | Completo como análisis y conexión; sin declarar entregas | `delivery-evidence.ts` (`assessDeliveryEvidence`), portal (nota D13), KPI (`entregaEvidenciadaEn`); `S*`, `K.*` |
| KPI: capa independiente de consulta y exportación (9 campos documentados con fuente, vinculación, disponibilidad, calidad y cálculo) | Completo; ventana e ítems NO_DISPONIBLE; el club (extraído de observaciones) va marcado `OBSERVACIONES_PROVISIONAL_D06` | `kpi/`, `lab-demo/kpi-entry.ts`; `kpi.test.ts`, E2E `K.1–K.5` |
| Aprovisionamiento del sandbox, P1–P15 en CI, prueba anti-deriva del esquema | Completo | `provision.mjs`, `bundle.mjs`; P1–P15, `alcance-esquema.test.ts` |
| Plantillas (proxy HTTPS, systemd, **MariaDB**, entorno), secretos, kill switch, readiness, monitorización, **verificación local previa a exponer (no autoriza exponer; el informe lo declara siempre)**, recuperación | Completo | `sandbox-preparacion/README.md`; `exposure-verification.test.ts` |
| El CI no declara éxito si omite E2E críticos | Completo | `e2e-cobertura-ci.test.ts` (todo `*.e2e.ts` debe estar en el runner; sin `continue-on-error`) |
| Documentación: OpenAPI (con `cancellation.resolution` provisional), Postman, guías y procedimientos | Actualizada | `api25/`, `homologacion-final/`, `cierre-operativo/`, `portal-cliente/`, `kpi/`, `sandbox-preparacion/` |

## B. PENDIENTE DE PRICESMART (decisiones; el resto se completó sin esperarlas)
D02 mecanismo y verificador de autenticación M2M · D03 formato/unicidad de `externalOrderId` · D05 una o varias entregas/parciales · D06 contrato JSON/diccionario definitivo (incluye **ventana de entrega** y **cantidad de ítems**, hoy NO_DISPONIBLE en KPI) · D07 zona horaria, ventanas y fechas pasadas (define «entrega a tiempo» por hora) · D08 estados oficiales · D09 método HTTP, motivos y reglas de cancelación (el procesamiento interno ya está) · D10 cabecera de idempotencia · D11/D12/D14/D15 · **D13 evidencia mínima y actor de la entrega confirmada** · mecanismo y credenciales de entrega de KPI (SFTP/Data/API) · si PriceSmart acepta usar un portal web.

## C. PENDIENTE DE INFRAESTRUCTURA O APROBACIÓN
Servidor dedicado para el sandbox (no el hosting compartido de producción), MariaDB 11.8.x local, dominio, certificado TLS, proxy y allowlist de IPs de PriceSmart · gestor de secretos y adaptador KMS/HSM revisado · credenciales de PriceSmart (las emite Mónaco según D02) · **aplicar manualmente, con autorización, la migración `solo_lectura` antes de crear cuentas de consulta** · aprobación humana de `evaluateSandboxExposure` · cuentas de staff del sandbox · **mitigación del login del Portal del Cliente, que hoy no limita los intentos: sin ella NO debe habilitarse ningún acceso externo al portal (ni de solo consulta); el acceso de PriceSmart sigue siendo solo la API M2M** · decisión de mostrar en el portal las cancelaciones pedidas por API · cuenta de solo lectura dedicada para consumir KPI fuera del TMS · pruebas conjuntas y autorizaciones.

## No se clasificó como externo lo que pudimos completar
Resolución interna de cancelaciones, solo consulta del portal, KPI, plantilla de MariaDB, verificación previa a exponer y cobertura del CI se resolvieron aquí. Lo que sigue en B y C requiere una decisión, un recurso o una aprobación que el código no puede suplir.
