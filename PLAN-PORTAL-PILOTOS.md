  # Plan: Portal del piloto + marcaje multiubicación (Grupo SITSA)

  > Cualquier chat/sesión de Claude que retome este proyecto: **lee este archivo
  > primero y verifica el estado real del código citado** (no asumas que un
  > checkbox marcado aquí es 100% cierto sin confirmarlo — pero es el mejor
  > punto de partida disponible). Actualiza este archivo al terminar cada paso,
  > antes de pasar al siguiente.

  ## Objetivo

  Hoy los pilotos marcan entrada/salida con un usuario genérico compartido.
  Se quiere que:

  1. Cada piloto marque su propia entrada/salida de camión con kilometraje
    desde su portal individual (no un usuario fijo compartido).
  2. El sistema detecte automáticamente si Operaciones ya le asignó una ruta
    (plan de viaje en TMS).
  3. Cualquier empleado de Grupo SITSA (no solo pilotos) pueda marcar su
    entrada/salida laboral desde varias ubicaciones válidas — no solo la sede
    oficial de su empresa (hay predios y otros lugares no oficiales donde hoy
    se marca).

  ## Hallazgos confirmados (verificados en código real, no solo lo que dijo una conversación)

  - `usuario_empresa` (personal interno) ya soporta multiempresa por diseño.
  - El portal del colaborador (`colaborador-session.ts`) hoy solo soporta
    **una** empresa por sesión (`empresaId` único) — no sirve todavía para
    colaboradores en 2+ empresas (ej. dueños del grupo).
  - La geocerca de marcaje es **una sola ubicación por empresa**
    (`geocerca_lat/lng/radio` en `src/lib/rrhh/config.ts`), no una lista de
    ubicaciones.
  - `tms_personal` (pilotos en TMS) **no tiene ningún vínculo real** a
    `empleados` (RRHH) — hoy se cruzan solo comparando el nombre como texto.
    Esto es fràgil y hay que arreglarlo antes de construir nada encima.
  - `flota_viajes` (piloto, placa, km salida/llegada, destino) ya existe y ya
    tiene UI, pero la llena personal interno (no el piloto mismo) desde
    `flota-client.tsx`.
  - Al cerrar un viaje en Flota, el sistema **ya marca automáticamente**
    el plan correspondiente de `tms_planes_viaje` como "Descargado"
    (`marcarPlanDescargado`) — esa conexión Flota↔TMS ya funciona.
  - Cada piloto **sí tiene su propio código de empleado** individual (confirmado
    por el usuario) — el usuario compartido es solo para el marcaje, no porque
    falte el dato.
  - Los pilotos son personas distintas por empresa, **excepto** casos como los
    dueños del grupo, que sí están en planilla en 2+ empresas.

  ## Fases (orden recomendado: 0 → 1 → 3 → 4 → 2 → 5)

  Se pone la Fase 2 (multiempresa en sesión del portal) después de la 3/4 a
  propósito: es la más riesgosa (toca login) y el caso que resuelve (dueños en
  2+ empresas) es poco frecuente — no bloquea la mayoría del valor.

  - [ ] **Fase 0 — Unificar identidad piloto ↔ empleado.**
        Vincular `tms_personal` a `empleados` con un `id_empleado` real (columna
        + backfill), en vez de cruzar por nombre de texto. Riesgo bajo — no
        toca nada que ya funcione.

  - [ ] **Fase 1 — Ubicaciones múltiples de marcaje.**
        Reemplazar la geocerca única por empresa por una tabla de ubicaciones
        (sede, predio, patio, etc.), cada una con su propio radio. Riesgo medio
        — toca el flujo de marcaje que usan todos los empleados a diario.

  - [ ] **Fase 3 — Portal del piloto: marcar salida/entrada de camión con km.**
        Nueva pantalla en el portal del colaborador (visible solo para quien
        tenga rol/puesto de piloto), reutilizando `flota_viajes` (ya existe y
        ya está conectado a TMS). Depende de Fase 0 y Fase 1.

  - [ ] **Fase 4 — Detección automática de ruta asignada.**
        Al marcar salida, buscar automáticamente en `tms_planes_viaje` si hay
        un plan "Programado" para ese piloto y vincularlo solo. Depende de
        Fase 0 y Fase 3.

  - [ ] **Fase 2 — Sesión del portal multiempresa.**
        Ampliar `ColaboradorSessionPayload` para soportar colaboradores en 2+
        empresas (ej. dueños), similar a `usuario_empresa`. Riesgo medio-alto —
        toca autenticación, probar a fondo antes de producción.

  - [ ] **Fase 5 — Revisar y completar el módulo de "Programación" del TMS.**
        Pendiente de investigar a fondo qué tan completo está hoy antes de
        decidir el alcance de esta fase.

  ## Historial de avance

  _(Cada chat que complete un paso, agrega una línea aquí: fecha, fase, qué se
  hizo, y si quedó subido a GitHub o solo en un entorno local sin push.)_

  - 2026-08-20 — Plan inicial creado y hallazgos verificados contra el código
    real del repo. Ninguna fase iniciada todavía.



    - 2026-08-20 — Fase 0 completada y subida a GitHub (`3c81a66`). Checkbox
  corregido (había quedado sin marcar por un entorno sin push). Arrancamos
  Fase 1 en pasos chicos: Paso 1/3 = tabla `ubicaciones_marcaje` sin tocar
  todavía la validación real.