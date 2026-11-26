# Identidad maestra multiempresa — Fase 1 (solo código)

**SQL requerido: NO.** No hay migraciones, ni escrituras a producción, ni cambios de esquema. Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (tsc, eslint de archivos tocados, pruebas unitarias y de integración contra MariaDB desechable con M1+M3 reales). **No probado en producción ni aprobado para producción.**

Continúa la propuesta de la PR #662 (Fases 0–3). Esta PR implementa únicamente la Fase 1.

## Corrección a la propuesta #662
La propuesta decía que Fresco Fresh no podía aprobar la identidad. En realidad el rol `Admin` ya evita el requisito de módulo Flota en `requireTenantFlota`, por lo que un Admin global sí puede aprobar en nombre de esa empresa. C1 se replantea: no abre acceso operativo a Flota, solo permite que un Admin global **delegue explícitamente** la aprobación.

## Interruptores (variables de entorno)
| Variable | Por defecto | Efecto |
|---|---|---|
| `FLOTA_IDENTIDAD_APROBACION_DELEGADA=1` | apagado | C1: un Admin con acceso a la empresa destino aprueba en su nombre (queda en evidencia y auditoría `delegadaDesde`). |
| `FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE=1` | apagado | C2: las operaciones abiertas solo bloquean la aprobación si están fuera de la ficha representante de su empresa. |
| `FLOTA_GUARDA_ALTA_IDENTIDAD=0` | encendido | C5 (kill switch): desactiva la guarda de alta contra duplicados de una identidad aprobada. |
| `FLOTA_IDENTIDAD_COLAPSO_UI=0` | encendido | C4 (kill switch): desactiva el colapso por identidad en pantallas. |

## Cambios
- **C1** `identidad-fisica-delegada.ts`, `identidad-fisica-http.ts`, `identidad-fisica.ts`, UI `identidades-fisicas.tsx`: aprobación delegada solo Admin + interruptor + acceso del usuario a la empresa destino (se revalida dentro de la transacción).
- **C2** `identidad-fisica-operaciones.ts`: representante = ficha activa propia de menor ID (misma regla que los catálogos). Viajes/planes abiertos en otra ficha siguen bloqueando.
- **C3** `chasis.ts` + PATCH de `vehiculos`: registrar chasis con auditoría `registrar_chasis_vehiculo`; inmutable (409) si la ficha ya es miembro de una identidad.
- **C4** `vehiculos-identidad.ts` + `flota-client.tsx`: una unidad por identidad aprobada, insignia y alternador «ver vinculadas». Nunca colapsa por placa. La API devuelve la lista completa.
- **C5** `vehiculos-escritura.ts`: no se crean fichas nuevas con placa de una identidad aprobada (`PLACA_CON_IDENTIDAD_VINCULADA`).

## Pruebas
- `identidad-fisica-operaciones.test.ts`, `identidad-fisica-delegada.test.ts`, `identidad-fase1.test.ts`: 39 pruebas unitarias/de ruta.
- `identidad-fase1.db.test.ts`: 10 pruebas contra MariaDB 11.8 con M1+M3 reales (se omiten si no hay `FLOTA_CANON_DB_PORT`).
- Regresión: las suites de `src/lib/flota` conservan sus 38 fallos preexistentes (mismos 8 archivos); `edicion-vehiculos-multiempresa` y `vehiculos-catalogo` fallan igual sin estos cambios (11).
- Pendiente: prueba DOM de `flota-client.tsx` y prueba manual en navegador.

## Riesgos y decisiones pendientes
- Con los interruptores apagados el comportamiento es el actual.
- Fase 0 (datos de chasis reales de los pares), Fase 2 (migración M4) y Fase 3 requieren autorización aparte.
- Ninguna ficha se fusiona ni se reasigna; no se tocan referencias históricas.
