# Canecas — redistribución de lotes (primera entrega, borrador)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en un MariaDB 10.11 desechable. NO PROBADO en el
laboratorio MariaDB 11.8.9. NO APROBADO PARA PRODUCCIÓN.** Nada de esto se ha ejecutado en Hostinger.

## Qué resuelve
Una compra de N canecas llenas puede terminar con M canecas vendibles (extras si M > N, merma si
M < N, o redistribución sin cambio de cantidad si M = N). La redistribución **no crea compras ni
recepciones**: retira las capas de costo del lote y abre capas nuevas con el **mismo costo total**,
la **antigüedad del lote original** y trazabilidad completa.

## Archivos
| Archivo | Función |
|---|---|
| `sql/migrate-2026-11-canecas-redistribucion-wip.sql` | Borrador de DDL. No instalar sin instalador controlado y contrato. |
| `src/lib/canecas/redistribucion-reglas.ts` | Reparto puro del costo y la antigüedad (sin base de datos). |
| `src/lib/canecas/redistribucion.ts` | `registrarRedistribucion` y `reversarRedistribucion` transaccionales. |
| `*.test.ts`, `redistribucion.db.test.ts` | Pruebas unitarias y de integración. |

## Modelo
- `canecas_redistribuciones`: un evento por redistribución (compra, producto, ubicación, cantidad de
  origen y resultante, `diferencia`, costo total en centavos `DECIMAL(38,0)`, moneda, documento,
  motivo, clave de operación única, movimiento de inventario y datos de reverso). Inmutable por triggers.
- `canecas_redistribuciones_origen`: capas de origen con cantidad y costo unitario histórico.
- `canecas_capas_costo.redistribucion_id`: tercera fuente posible de una capa. El CHECK
  `chk_can_capa_fuente` pasa a exigir **exactamente una** de `recepcion_id`, `valoracion_id`,
  `redistribucion_id`. El trigger `can_capa_costo_inmutable` se reemplaza para que
  `redistribucion_id` tampoco pueda cambiar.
- Movimiento de inventario `REDISTRIBUCION` con la diferencia (+extras / −merma). Si la diferencia es
  0 no hay movimiento (`canecas_movimientos` no admite cantidad 0).
- La migración es **posterior** a las tres existentes (fase 1, costos #674, salidas #678/#679) y no
  modifica ninguna de sus ramas. Al aplicarla sobre capas existentes valida sin reescribirlas.

## Reglas transaccionales (READ COMMITTED)
Orden de bloqueos: compra → saldo → capas (igual que `confirmarRecepcion`; `salidas-fifo` toma saldo → capas, sin ciclos).
1. Clave de operación idempotente; reutilizarla con otros datos da `CLAVE_REUTILIZADA`.
2. Producto y ubicación activos; **sin reservas** (`RESERVAS_PENDIENTES`).
3. Capas disponibles conciliadas con el saldo físico (`CAPAS_NO_CONCILIADAS`).
4. Lote = capas disponibles de esa compra (directas o heredadas de una redistribución previa).
5. Costo conocido y una sola moneda (`COSTO_PENDIENTE`, `MONEDA_INCOMPATIBLE`). Costo desconocido
   (NULL) se distingue de costo Q0 (0).
6. Reparto: `total / M` con el resto de centavos en las primeras (más antiguas) unidades; cada unidad
   conserva la antigüedad de la unidad de origen en la misma posición FIFO; las extras toman la
   antigüedad de la última unidad de origen; en merma se conservan las más antiguas.
7. Conciliación final en la misma transacción (unidades y costo total); si falla, `ROLLBACK`.

## Reverso
Restaura exactamente las capas de origen. Solo si **ninguna capa resultante se consumió ni se volvió a
redistribuir** (`REDISTRIBUCION_CONSUMIDA`); primero se revierten las salidas o redistribuciones
posteriores. Un reverso de salida FIFO posterior a una redistribución devuelve las unidades a sus
capas históricas, y el reverso de la redistribución lo tiene en cuenta.

## Decisiones técnicas que siguen pendientes
1. **Tratamiento contable de la merma.** Hoy el costo total se conserva en las unidades restantes
   (sube el costo unitario). Si negocio quiere reconocerla como pérdida/gasto aparte, hay que decidirlo
   antes de uso real. Reducir a 0 unidades está rechazado (`REDISTRIBUCION_INVALIDA`).
2. **Lote = todo el disponible de una compra en una ubicación.** No hay redistribución parcial de un lote.
3. **Antigüedad de las extras y descarte en merma** (ver regla 6) son convención; confirmar con negocio.
4. **Instalador controlado y contrato JSON** de esta migración (mismo patrón que
   `ejecutar-salidas-controlado.mjs`) no se incluyen aquí: el contrato real debe generarse en el
   laboratorio 11.8.9. Hasta entonces no puede instalarse.
5. **Sin API ni interfaz todavía.** Las funciones no están expuestas por `route.ts`.
6. **Empates de antigüedad (resuelto sin cambio de esquema).** `creado_en` tiene precisión de segundo y FIFO ordena por `(creado_en, id)`. Las capas redistribuidas heredan `creado_en` pero reciben un id mayor; si otra capa disponible comparte ese segundo y tenía id mayor que el origen, quedaría adelantada e invertiría el orden real de confirmación. `registrarRedistribucion` lo rechaza con `EMPATE_ANTIGUEDAD` (sin modificar nada); la compra con id mayor del empate sí puede redistribuirse. El bloqueo dura mientras la otra compra tenga existencias en ese segundo. Al exponer la API, mapear `EMPATE_ANTIGUEDAD` a 409.
7. Las capas con `valoracion_id` (existencia inicial) no son parte de ningún lote y no se redistribuyen.
