# Roadmap RRHH — mejoras pendientes

> **Para Claude / cualquier IA que retome este trabajo:** este archivo es la
> fuente de verdad de en qué vamos con las mejoras de RRHH. Antes de asumir
> que algo falta o ya existe, revisa el estado real del código (no confíes
> solo en este archivo, puede estar desactualizado) — pero úsalo como mapa
> para no repetir trabajo ni perder contexto entre conversaciones distintas.
>
> Convención de trabajo con el usuario: se avanza en **pasos pequeños**
> (1-2 archivos por vez), cada paso se verifica con `npx tsc --noEmit`
> (build completo solo cuando el cambio es grande/riesgoso, para no gastar
> tokens de más), se entregan los archivos para descarga, y el usuario hace
> `git add/commit/push` manualmente desde VS Code. Confirmar en GitHub
> (`git log --oneline`) antes de asumir que un paso anterior ya quedó
> subido — a veces el usuario dice "listo" refiriéndose a un paso previo.

## Contexto — auditoría de 2026-08-19

Se comparó la lista de requerimientos de RRHH del usuario contra el código
real. La mayoría ya estaba construido (portal con boletas/descuentos/
viáticos, boleta+saldo de vacaciones, ficha de empleado con supervisor_id,
centros de costo, nómina por forma de pago, horas extra vía supervisor,
reporte de marcajes, calendario de entrevistas, dashboard con altas/bajas/
costo, recordatorios + bitácora legal). Quedaron 4 gaps reales:

| # | Gap | Esfuerzo | Estado |
| - | --- | -------- | ------ |
| 1 | Bitácora legal no se ve dentro de la ficha del empleado | Chico | ⏳ Pendiente |
| 2 | Dashboard gerencial no cuenta amonestaciones/despidos del mes | Chico-mediano | ⏳ Pendiente |
| 3 | Devengados (Prestaciones) y Descuentos son texto libre, sin catálogo estándar | Chico-mediano | ⏳ Pendiente |
| 4 | No hay boleta de vacaciones imprimible/firmable (PDF) | Mediano | ⏳ Pendiente |

Marcar cada fila como `✅ Hecho` (con el hash del commit) al completarla.

---

## Gap 1 — Bitácora legal en la ficha del empleado

**Qué falta:** al editar un empleado en
`src/app/e/[slug]/rrhh/empleados/page.tsx`, no se ve su historial de
`rrhh_bitacora_legal`. Hoy hay que ir a la pantalla aparte
`/rrhh/bitacora-legal` y buscarlo ahí.

**Ya existe (reusar, no reconstruir):**
- Backend: `listarBitacoraLegal(empresaId, { empleadoId })` en
  `src/lib/rrhh/bitacora-legal.ts` — ya soporta filtrar por empleado.
- API: `GET /api/empresas/[slug]/rrhh/bitacora-legal?empleadoId=123` — ya
  soporta el filtro.

**Plan:** agregar una sección de solo-lectura (o con link a "agregar
registro") dentro del formulario de edición de empleado, mostrando las
últimas N entradas de ese empleado. No requiere cambios de backend.

## Gap 2 — Dashboard gerencial no cuenta bitácora legal

**Qué falta:** `src/lib/rrhh/dashboard-gerencial.ts` calcula altas, bajas y
costo de planilla por mes, pero no cuenta cuántas entradas de
`rrhh_bitacora_legal` (por tipo) hubo cada mes.

**Plan:** agregar una consulta más a `obtenerEstadisticasGerenciales()`
(agrupada por `MONTH(fecha)` y `tipo`), y una tarjeta/columna nueva en
`src/app/e/[slug]/dashboard-rrhh/page.tsx`.

## Gap 3 — Catálogo estándar de devengados/descuentos

**Qué falta:**
- `src/app/e/[slug]/rrhh/prestaciones/page.tsx` tiene una lista fija corta
  (`Bono, Aguinaldo, Bono14, Indemnización, Otro`) sin "Viáticos" ni "Bono
  día festivo/domingo trabajado" (que el usuario mencionó explícitamente).
- `src/app/e/[slug]/rrhh/descuentos/page.tsx` (`concepto`) es 100% texto
  libre — sin catálogo de Uniformes, IGSS voluntario, Séptimo día,
  Préstamos, etc.

**Plan:** definir un catálogo de conceptos por tipo (constantes, como
`TIPOS_CONTRATO` en `contratos-pago.ts`), permitiendo igual un "Otro" con
texto libre para no perder flexibilidad. Requiere tocar backend
(validación) + ambas pantallas.

## Gap 4 — Boleta de vacaciones imprimible/firmable

**Qué falta:** existe el flujo de solicitud + aprobación
(`src/lib/rrhh/solicitudes-vacaciones.ts`), pero no un PDF formal para
firma del colaborador/empresa como respaldo legal.

**Plan:** usar la skill de PDF del entorno para generar el documento al
aprobar una solicitud (o bajo demanda desde el portal/RRHH). Repasar antes
`/mnt/skills/public/pdf/SKILL.md`.

---

## Historial de sesiones anteriores (para contexto, no repetir)

Ya completado antes de esta auditoría (commits en `main`):
- Fixes iniciales del módulo RRHH (dashboard, horario teórico, tipos de
  contrato, cálculo de ISR con Decreto 13-2026).
- Dashboard gerencial (altas/bajas/costo por mes).
- Calendario de entrevistas (RRHH + lado del portal).
- Recordatorios + Bitácora Legal (base de datos, API, UI, dashboard).
- Papelería de vehículos (Flota): tabla, API, UI, conectada a Recordatorios
  y a la campanita de notificaciones (ruteada: Licencia/DocumentoVehiculo →
  Flota; resto → RRHH).
