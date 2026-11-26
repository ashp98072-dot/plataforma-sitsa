# Fase 0 — Acreditación de identidad física #602/#1296 y #603/#1297

**Alcance:** solo diagnóstico y verificación documental. No se escribe chasis (ni por PATCH ni por SQL), no se crean ni aprueban identidades, no hay bajas, M4, merge ni despliegue.
**SQL requerido: SÍ, únicamente SELECT, ejecución manual por el responsable** → [sql/diagnostico-2026-11-flota-fase0-acreditacion-602-603.sql](../../sql/diagnostico-2026-11-flota-fase0-acreditacion-602-603.sql). Orden: A, B, C, D. Riesgo: ninguno de escritura; los resultados son información administrativa multiempresa (no compartir fuera del equipo). Respaldo/rollback: no aplican.

## Estado: PENDIENTE DE ACREDITACIÓN (ambas parejas)
Esta sesión **no tiene acceso autenticado a producción** ni a las tarjetas de circulación físicas. Los datos de las bases de laboratorio son sintéticos y no sirven como evidencia. No se inventa ningún chasis.

## Tabla de evidencia (a completar con los resultados de producción)
| Dato | #602 (Fresco Fresh) | #1296 (Mónaco) | #603 (Fresco Fresh) | #1297 (Mónaco) |
|---|---|---|---|---|
| Placa (SQL A) | pendiente | pendiente | pendiente | pendiente |
| Chasis registrado (SQL A) | pendiente | pendiente | pendiente | pendiente |
| Tipo de unidad (SQL A) | pendiente | pendiente | pendiente | pendiente |
| Propietario registrado / NIT (SQL A) | pendiente | pendiente | pendiente | pendiente |
| Tarjeta escaneada en el sistema (SQL B) | pendiente | pendiente | pendiente | pendiente |
| **Chasis en tarjeta física** | pendiente | pendiente | pendiente | pendiente |
| **Titular en tarjeta física** | pendiente | pendiente | pendiente | pendiente |
| Relaciones (SQL D) | pendiente | pendiente | pendiente | pendiente |
| Veredicto del sistema (SQL C) | pendiente | pendiente | pendiente | pendiente |

## Criterio GO / NO-GO (por pareja)
- **GO a solicitar autorización de escritura:** chasis idéntico y válido en ambas tarjetas físicas, mismo tipo, mismo vehículo según titular/placa/documento; el sistema no tiene chasis en conflicto.
- **NO-GO:** chasis distintos (unidades distintas con placa reutilizada) o titular incompatible.
- **PENDIENTE DE ACREDITACIÓN:** falta cualquier chasis, tarjeta o resultado de SQL. **Es el estado actual.**

## Recomendación actual: NO-GO por falta de evidencia (no por contradicción)
No avanzar a escribir chasis (C3), proponer ni aprobar identidades hasta completar la tabla. Cuando esté completa, se presentan los resultados para una autorización específica de cada escritura (registro de chasis con PATCH y auditoría, luego propuesta/aprobación).

## Verificación de C4/C5 (PR #663), sin tocar producción
- Prueba DOM de la pantalla real (`identidad-fase1-ui.dom.test.ts`): una unidad por identidad, alternador de vinculadas, sin colapso cuando no hay identidad aprobada ni anotación (kill switch). Se comprobó con una mutación que la prueba falla si se quita el filtro.
- C5 y su kill switch `FLOTA_GUARDA_ALTA_IDENTIDAD=0`: probados contra MariaDB desechable (`identidad-fase1.db.test.ts`).
- **Prueba manual en navegador contra el entorno de laboratorio: NO realizada todavía.**
