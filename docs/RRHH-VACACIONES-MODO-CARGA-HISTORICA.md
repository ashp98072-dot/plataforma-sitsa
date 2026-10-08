# RRHH · Vacaciones — Modo temporal de carga histórica (sin vencimiento / sin tope de 30)

Nivel: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (base de datos simulada en memoria). No probado en navegador ni contra la base real. **No** aprobado para producción.
Sin SQL, sin migraciones, sin cambiar ningún modo real, sin reparar ni sincronizar colaboradores reales.

## 1. Discovery (dónde vive cada cosa)
| Pregunta | Respuesta |
|---|---|
| ¿Dónde vive `MAX_PERIODOS_VIGENTES`? | `src/lib/rrhh/vacaciones-periodos.ts` (`= 2`). Se **conserva**; ahora es el valor de `POLITICA_NORMAL.maxPeriodosVigentes`. |
| ¿Dónde se calcula el vencimiento? | (a) Persistido: `sincronizarPeriodosVacacionesEnConexion` (`vacaciones.ts`) marca `Vencido` y pone `dias_disponibles = 0` a los completados más allá de 2. (b) En memoria: `avanzarPeriodos` (`vacaciones-reconstruccion.ts`), motor cronológico compartido por el registro histórico, el rebase, la reparación y la simulación de importación; más `estadoHoyDe` (`vacaciones-historico.ts`) y el estado inicial del rebase. |
| ¿Dónde se aplica el tope de 30? | Persistido: la misma sincronización (excedente descontado FIFO del período completo más viejo). En memoria: `avanzarPeriodos`. Invariante `usables > 30` en `reemplazarSerieEnConexion`. |
| ¿Dónde se persisten estados y disponibles? | `saldos_vacaciones.estado` / `dias_disponibles`, escritos por la sincronización, el registro (normal e histórico), la eliminación, el rebase y la reparación. |
| ¿Cambiar el modo exige reconstruir saldos persistidos? | **Sí, de forma perezosa y por colaborador**: la sincronización ya se ejecuta al consultar/registrar/eliminar y ahora conoce la política. Para converger todos los colaboradores de una vez hay una **resincronización administrada** (por colaborador, cada uno en su transacción; sin UPDATE masivo). |
| ¿Dónde guardar la bandera por empresa? | En el almacén genérico **ya existente** `configuracion(empresa_id, parametro, valor)`: `parametro = 'vacaciones_modo_carga_historica'`, `valor = '1'`. Sin tablas ni migraciones nuevas; ausente ⇒ NORMAL. Es el mismo almacén que usan RRHH (`config.ts`) y Cotizaciones. |

## 2. Arquitectura (un solo motor, política central y reversible)
- `vacaciones-politica.ts` (puro): `PoliticaVacaciones = { modo, maxPeriodosVigentes: number | null, aplicarTope }`, `POLITICA_NORMAL` (2, tope) y `POLITICA_CARGA_HISTORICA` (`null` = ilimitado, sin tope), `PARAMETRO_MODO_CARGA_HISTORICA`. Volver a 2 no requiere tocar el motor: es solo apagar la bandera.
- El **mismo motor** recibe la política (parámetro opcional, por omisión NORMAL ⇒ comportamiento anterior intacto): `avanzarPeriodos`, `reconstruirEmpleado`, `clasificarRegistro` / `planificarConsumoHistorico`, el planificador del rebase y de la reparación, y el ejecutor compartido (`aplicarTope`).
- `vacaciones-modo-db.ts`: lectura de la bandera, `cambiarModoCargaHistorica` (una transacción, `FOR UPDATE`, **idempotente**, auditoría `vacaciones_modo_historico_activado` / `_desactivado` con empresa, usuario, fecha, valor anterior y nuevo) y la política de la empresa para cada flujo.
- `vacaciones-modo-resync-db.ts`: `resincronizarSaldosEmpresa` ejecuta la sincronización normal colaborador por colaborador (cada uno su transacción; congelados #417 y errores no detienen a los demás) y audita un resumen.

## 3. Comportamiento
| | MODO NORMAL (por defecto) | MODO CARGA HISTÓRICA (temporal) |
|---|---|---|
| Períodos | todos desde `fecha_alta` (aniversario; domingos no desplazan) | igual |
| Año completo | 15 días | 15 días |
| Año en curso | proporcional (`calcularDiasAcumuladosProporcional`, domingos excluidos) | igual |
| Vencimiento | solo los 2 completos más recientes son utilizables; el resto `Vencido` | **ninguno**: todos `Vigente` por lo no consumido |
| Tope | 30 días utilizables | **sin tope** |
| Ejemplo `fecha_alta` 13/04/2023, hoy 08/10/2026, sin consumo | 30 | 15 + 15 + 15 + 7.38 = **52.38** |
| Consumo histórico de 10 días en el año 1 | — | 42.38 y el consumo permanece en el año 1 |
- **Registro histórico en modo carga**: una vacación que cae en un período **ya completado** se evalúa con el motor cronológico (disponibilidad EN ESA FECHA, solo períodos ya iniciados), no con el FIFO de hoy; en NORMAL se sigue clasificando por «período Vencido hoy» (#421 intacto).
- **Volver a NORMAL**: la sincronización reaplica vencimiento y tope con el motor existente (no un `Math.min`): p. ej. 42.38 → año 1 vence con sus 5 sin usar, el tope recorta del año 2 más antiguo vigente ⇒ 30 con la distribución `0 / 7.62 / 15 / 7.38`. El consumo del detalle FIFO se conserva y nunca reaparece como disponible.
- **Modo carga, sincronización**: `dias_disponibles = otorgados − Σ detalle FIFO` para todos los períodos con año laboral y `estado = Vigente` (idempotente). No crea ni borra períodos, incidencias, vacaciones, detalle ni evidencias; no toca fechas.
- **Compatibilidad**: la reparación individual (#423), el lote (#425), el rebase (#421) y la cobertura (#424/#426) leen la política de la empresa y siempre conservan todos los períodos; en carga histórica el invariante «≤ 30» no aplica.

## 4. API y UI (RRHH → Vacaciones)
- `GET …/rrhh/vacaciones/modo-carga-historica` (RRHH · Vacaciones · ver), `PUT` `{ activo, confirmar: true }` y `POST …/resincronizar` `{ confirmar: true }` (ambos RRHH · Configuración · editar). Empresa y usuario salen siempre del servidor.
- Aviso **«MODO DE CARGA HISTÓRICA ACTIVO»** con el texto aprobado, nota «saldo TEMPORAL», y el historial de períodos aclara que no es el saldo normal. Activar, desactivar y recalcular exigen confirmación explícita; desactivar muestra «Al volver al modo normal se reaplicará el vencimiento y el límite de períodos vigentes. Los consumos históricos se conservarán.»
- El interruptor está en la propia pantalla de Vacaciones (no se tocó la pantalla de configuración).

## 5. Pruebas
`vacaciones-modo-carga-historica.test.ts` (22, BD en memoria transaccional): casos A–O del ticket (normal 30 vs histórico 52.38; consumo 10 ⇒ 42.38 en el año 1; consumo año 1 + año 2 con FIFO; activar/desactivar no altera incidencias, vacaciones, evidencias ni detalle; regreso a normal con el motor; `fecha_alta` base; `fecha_inicio_laboral` ignorada; proporcional y domingos; empresa A/B; reparación individual y lote bajo ambos modos; nada reaparece; idempotencia; sin `Math.min`), configuración por empresa y auditoría. Rutas (8) y UI (4). Verificado por mutación (quitar la rama de sincronización, la clasificación cronológica o la política del motor hace fallar las pruebas). Todas las pruebas de vacaciones previas (#421, #423, #424, #425, #426) siguen verdes sin cambios.

## 6. Riesgos y límites
- **El saldo temporal puede verlo quien consulte saldos de esa empresa** (portal del empleado, alertas/notificaciones leen `saldos_vacaciones`): mientras el modo esté activo muestran el saldo sin tope. Conviene activarlo solo durante la carga.
- **Consumo sin detalle FIFO**: en modo carga el saldo se recalcula desde el detalle FIFO; si existieran vacaciones antiguas descontadas del saldo **sin** líneas de detalle, esos días reaparecerían como disponibles. Verificar antes de activar a gran escala.
- **Orden de captura**: cargar historia **en orden cronológico**. Si una carga posterior (fecha anterior) necesita capacidad que una vacación más nueva ya consumió del mismo período, exige una decisión explícita (déficit) y no guarda nada; no reasigna lo ya registrado.
- **Convergencia perezosa**: tras cambiar el modo, los saldos guardados de cada colaborador se actualizan al consultarlo; usar «Recalcular saldos» para hacerlo de una vez (por colaborador, transaccional).
- Probado solo con BD en memoria; falta revisión independiente y prueba manual antes de producción. **No se ha activado el modo en ninguna empresa real.**
