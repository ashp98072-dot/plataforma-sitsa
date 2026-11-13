# PriceSmart API-15 — diagnóstico administrativo de readiness

**Estado: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE (pruebas unitarias/de ruta, tsc, ESLint). NO probado contra base de datos (no toca ninguna) y NO aprobado para producción.** La integración sigue en 503 `DISABLED`.

## Qué es
`GET /api/admin/pricesmart/readiness` (solo Admin, solo lectura). Devuelve presencia y estados, nunca valores:
modo efectivo, bloqueos, comprobaciones, decisiones D02/D06/D08/D09/D12 «declaradas por el operador» (no verificadas ni ratificadas por este código) y qué variables `PRICESMART_*` están definidas (booleanos).
No abre conexiones, no consulta datos de empresas ni del TMS, no instala ni retira handlers, no activa flags y no registra auditoría (no cambia nada). Un fallo interno devuelve un informe cerrado genérico (`DIAGNOSTIC_FAILED`).

## Inventario de bloqueos efectivos (API-01 a API-14)
| Bloqueo | Origen | Naturaleza |
|---|---|---|
| `PRODUCTION_ENVIRONMENT_NOT_MODELED` | `targetSchema.environment` solo admite `sandbox` | limitación del contrato; requiere decisión |
| `DB_USER_PATTERN_SANDBOX_ONLY` | `mariaDbOrderRepository` exige `sandbox_api02_*` | limitación del código; requiere decisión |
| `DECISION_PENDING` | D02, D06 (READ_ONLY); + D08, D09, D12 (ENABLED) | dependen de PriceSmart |
| `PORTS_NOT_WIRED` | no existe composición administrativa que aporte verificador (D02), evidencia HTTP, cifrado con gestión de claves, contrato (D06), repositorio, interruptor y sondas | falta implementar con datos que PriceSmart/infra deben definir |
| `PRODUCTION_COMPOSITION_NOT_IMPLEMENTED` | no existe composición productiva verificable; `ready` es `false` siempre, con o sin handler (incluido el de laboratorio, que nunca cuenta como evidencia: puertos `UNVERIFIED`, `PORTS_UNVERIFIED`) | hasta implementarla |
| `MODE_DISABLED` / `CONFIG_INVALID` | `PRICESMART_RUNTIME_MODE` | configuración |

## Fuera de alcance (no inventado)
Contrato de órdenes, certificados, endpoints y mecanismo de autenticación de PriceSmart; relajar el patrón de cuenta MariaDB o añadir `production` al contrato (cambios de arquitectura que requieren decisión).

## Aislamiento
El diagnóstico solo importa módulos puros (`runtime-state`, `runtime-config`, `security-contracts`, `lab-demo/gate`); una prueba recorre el cierre de importaciones y falla si alcanza la composición del laboratorio, base de datos, TMS o mysql2. `labDemoGate` tiene una única implementación (`lab-demo/gate.ts`), reutilizada por la composición.
