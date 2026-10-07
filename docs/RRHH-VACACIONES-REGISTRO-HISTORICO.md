# RRHH Vacaciones — registro histórico (años anteriores) sin cambiar la lógica de saldos

Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (BD en memoria sobre el código real). **No se ejecutó SQL, no se limpió nada, no hay migraciones.** Reemplaza el alcance de #420 (cerrado sin merge).

## 1. Qué NO cambia
15 días por año, base `empleados.fecha_alta`, acumulación proporcional, domingos/feriados, FIFO, vencimiento (solo 2 períodos completos + el en curso son utilizables), tope de 30 días y saldo actual. El **registro normal** (período actual, últimos períodos vigentes, fechas futuras, empleado sin fecha de alta) ejecuta **exactamente** el flujo de siempre (`sincronizar` + `registrarVacacionesFifoEnConexion`): una prueba compara el estado final de BD contra `registrarVacacionesFifo` con los mismos datos.

## 2. Causa exacta de la limitación a 2 períodos
`registrarVacacionesFifoEnConexion` (src/lib/rrhh/vacaciones.ts) selecciona los saldos con `estado = 'Vigente' AND dias_disponibles > 0` **al día de hoy**. El vencimiento marca `Vencido` y pone `dias_disponibles = 0` a los períodos completos más antiguos, así que una vacación de años anteriores no tenía de dónde consumir y fallaba con «Saldo insuficiente». Las lecturas del historial ya muestran todos los períodos (#417); lo que faltaba era poder **consumir contra el saldo que el período tenía en la fecha de la vacación**.

## 3. Cómo funciona el registro histórico
Orquestador `registrarVacaciones` (src/lib/rrhh/vacaciones-registro.ts), una transacción:
1. `sincronizar` (idempotente) y lectura de la fecha de alta y de los períodos **con bloqueo** (`FOR UPDATE`).
2. **Anterior a `fecha_alta` ⇒ bloqueado** (también en el registro normal).
3. **Clasificación** (`clasificarRegistro`): es «Registro histórico» cuando la fecha de inicio cae en un período que **hoy está Vencido**. Si no, camino normal.
4. **Plan** (`planificarConsumoHistorico`, módulo puro): bloquea fecha de alta ausente/sospechosa (< 1980)/futura, datos inválidos; luego, serie congelada de #417 (`ESTRUCTURA_CONGELADA`), **superposición** con otra vacación del mismo empleado (ERROR), períodos faltantes (`PERIODO_INEXISTENTE`).
5. **Decisión** si hay déficit o cruce de aniversario (ver §5).
6. Escritura: `incidencias`, fila espejo en `vacaciones`, `detalle_consumo_vacaciones` exacto, descuento del saldo de hoy **solo** en los períodos que siguen Vigentes, `sincronizar` de nuevo (vencimiento y tope; nunca aumenta saldo) y auditoría `vacaciones_registro_historico`. Cualquier fallo ⇒ `ROLLBACK` total.

### Disponibilidad en la fecha histórica (sin segundo motor)
Se reutilizan las primitivas del motor cronológico: `periodoLaboral` (períodos desde `fecha_alta`), `calcularDiasAcumuladosProporcional` (proporcional del en curso), `avanzarPeriodos` (acumulación + **vencimiento** de esa fecha + **tope de 30**; antes del tope se descuenta lo ya consumido en `detalle_consumo_vacaciones`) y `repartirDiasEnTramos` (la misma función de la reconstrucción). Reglas: solo períodos **ya iniciados** a esa fecha (nunca futuros); FIFO por `anio_laboral` ascendente; un período que hoy sigue Vigente no puede dar más que su disponible de hoy; los consumos ya registrados se modelan como **eventos cronológicos** (`detalle_consumo_vacaciones` ⨝ `incidencias`, con la `fecha_inicio` de cada vacación): al evaluar la fecha X solo se descuentan los consumos con `fecha_inicio <= X` (un consumo **posterior** no existía todavía y no reduce el saldo de X; uno anterior o del mismo día sí) más lo que la propia simulación toma entre tramos (`consumidoExtra`). Así el resultado **no depende del orden** en que RRHH capture el historial. Como red de seguridad el total de un período nunca se excede (`otorgados − todo lo registrado`): si lo registrado después ya agota el período, la vacación anterior queda con déficit (decisión explícita) en vez de sobre-consumir; el «saldo histórico disponible» que se muestra es siempre el de la fecha. Un período **hoy Vencido** puede consumirse porque en la fecha aún era utilizable; **no se reactiva** ni recupera días.

### Cómo se recalcula el saldo actual
Sólo **baja** y solo en períodos hoy Vigentes (por lo consumido); los Vencidos quedan en `Vencido`/0 (el consumo queda en el detalle y en el historial). El tope de 30 y el saldo utilizable siguen siendo los de hoy.

## 4. Edición y eliminación
- **Eliminar** (`eliminarRegistroVacaciones`, sin cambios): ya identifica el FIFO exacto en `detalle_consumo_vacaciones` y devuelve cada día **al mismo período** del que salió; a un período Vencido **no** le devuelve días (se informa como «no restaurados») y recalcula tope. Se agregaron pruebas históricas (15/15b/14).
- **Editar**: no existe un endpoint de edición; editar un histórico = eliminarlo y registrarlo de nuevo. Como la disponibilidad histórica se calcula desde `otorgados − detalle`, los días liberados vuelven a estar disponibles en esa fecha (prueba 13).

## 5. Decisiones explícitas (no se bloquea el registro histórico general)
- **Cruce de aniversario**: se parte en tramos con fechas reales (misma lógica ya implementada) y se exige una confirmación explícita.
- **Saldo insuficiente en esa fecha**: no se inventa saldo ni se descuenta de períodos futuros; se muestra el déficit y **no se guarda por defecto**.
Ambas se resuelven enviando `decision: { huella, motivo }` (la `huella` es el SHA-256 de la propuesta exacta mostrada; `motivo` ≥ 10 caracteres). Sin decisión: `409 DECISION_REQUERIDA` con el plan; con huella distinta o motivo corto: sigue sin guardar. La decisión queda en la auditoría.

## 6. API y UI
- `POST /api/empresas/[slug]/rrhh/vacaciones` (se **extiende**; permiso `crear`): nuevo campo opcional `decision`; la respuesta agrega `historico` y `plan` solo en registros históricos (la forma del registro normal no cambia).
- `GET /api/empresas/[slug]/rrhh/vacaciones/preview-historico?empleadoId&fechaInicio&fechaFin[&diasHabiles]` (permiso `ver`, **solo lectura**): `esHistorico`, períodos que consumiría y días por período, **saldo histórico disponible en esa fecha** (no el de hoy), déficit, advertencias, superposiciones y decisiones.
- RRHH → Vacaciones: el formulario **no limita las fechas** por períodos vigentes; al elegir una fecha en un período Vencido aparece «**Registro histórico**» con ese detalle y, si corresponde, la confirmación + motivo. El historial de períodos muestra **todos** los períodos con sus consumos relacionados (cada consumo con tipo, fechas y días).

## 7. Pruebas
`vacaciones-historico.test.ts` (planificador puro), `vacaciones-registro.test.ts` (BD en memoria con transacciones: período actual, hace 1/3/5+ años, Vencido hoy pero vigente entonces, FIFO histórico, sin períodos futuros, saldo actual intacto, anterior a fecha_alta, superposición, déficit, cruce de aniversario, edición, eliminación, restauración exacta, historial con períodos antiguos, tope 30, 15 días, domingos/feriados, multiempresa, fecha de alta sospechosa, no regresión del registro normal, rollback) y `registro-historico-api.test.ts` (rutas).
