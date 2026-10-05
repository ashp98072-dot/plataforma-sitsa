# Costeo interno — paridad estricta con «Cotizador 2026.xlsx»

Base: `75ac6cfdb2dfc43ed6f4c215c4b91c458d023a89` (posterior al PR #406).
Fuente funcional ÚNICA: `Cotizador 2026.xlsx` (hojas «Camion 1 ton», «Camion de 2.7», «Camion de 5», «Camion de 10», «Cabezales »).
**No** se usó `COTIZADOR RUTAS(3).xlsx`. Alcance: Costeo interno y Ajustes de Cotizaciones.
SQL propuesto, **no ejecutado**.

> **Orden de despliegue:** aplicar la migración (ver «SQL») ANTES de desplegar. El código nuevo lee `viaticos_hotel_viaje` al
> consultar perfiles; sin la columna, las consultas de perfiles fallan (mismo criterio del PR #406).

## Qué cambia

| Área | Cambio |
| --- | --- |
| Motor | Nuevo `COSTEO_COTIZADOR_2026` para los cálculos NUEVOS. `COSTEO_V1` y `COSTEO_EXCEL_2026` siguen leyéndose y calculándose igual. |
| Viáticos y hotel | Una sola línea «Viáticos y hotel»: override de la cotización → valor del perfil → Q0 con advertencia. **No** se multiplica por personas, guías ni días. |
| Perfil | Columna aditiva `viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL` (`viaticosHotelViaje`). |
| UI de costeo | Se quitan Guías, viático piloto/auxiliar/guía y hotel; se agrega «Viáticos y hotel (Q)» (un override opcional, con el valor del perfil como sugerencia). |
| Ajustes → Perfiles | Agrupado: Identificación, Operación, Mantenimiento, Seguro, Depreciación, Personal. «Valor del camión (Q)» único. |
| Ajustes → Parámetros | Se ocultan Piloto/día, Auxiliar/día, Viático piloto/auxiliar/guía por día y Hotel/persona/día (siguen en BD y se reenvían). |
| Desglose | Conceptos del libro: Gastos varios, Seguro mercadería, Depreciación, GPS, Seguro vehículo, Aceite, Llantas, Combustible, Piloto, Auxiliar, Viáticos y hotel, Otros costos; luego COSTO BASE, margen, subtotal, IVA, TOTAL CON IVA, precio/km. |

## Fórmulas finales (todas configurables; sin constantes del libro en el motor)

Cada concepto se calcula con Decimal (HALF_UP) y se redondea a 2 decimales; la suma no se redondea de nuevo (política heredada del PR #406).

| Concepto | Fórmula |
| --- | --- |
| Gastos generales | (administración + mantenimiento + seguridad + predios) / flota / días gastos × días |
| Seguro mercadería | anual / flota / viajes anuales (por viaje); total manual (incluso 0) prevalece; se puede excluir |
| Depreciación | valor del camión / años / 12 / divisor global × días |
| GPS | GPS mensual / viajes mensuales del perfil (por viaje) |
| Seguro vehículo | mensual / 30 × días |
| Aceite | costo cambio / intervalo km × km |
| Llantas | precio × cantidad / vida útil km × km (respaldo: juego histórico) |
| Combustible | km / rendimiento × precio usado (override por cotización; no modifica el global) |
| Piloto / Auxiliar | salario mensual del perfil / días laborales globales × personas × días (respaldo: costo diario global si el salario es NULL; 0 configurado es 0) |
| Viáticos y hotel | override ?? `perfil.viaticosHotelViaje` ?? 0 (advertencia) |
| Margen | UN margen objetivo: valor = base × margen; subtotal = base + valor; IVA después |

El libro usa dos columnas de margen en algunas hojas; Novalvion maneja la suma como un único margen (15 % + 15 % → 30 %,
20 % + 20 % → 40 %). **No** se reintroduce `margen2`.

## Compatibilidad e históricos

- Sin DROP, sin renombrar, sin transformar snapshots. La migración del PR #406 (ya aplicada) no se toca.
- `costo_piloto_dia`, `costo_auxiliar_dia`, viáticos/día, `hotel_dia`, `costo_adquisicion`, `dias_operacion_mes`, `costo_juego_llantas` y el divisor
  de depreciación del equipo se **conservan** en BD como respaldo; la UI nueva ya no los pide (se preservan al editar).
- Al guardar un perfil con desglose de llantas, `costo_juego_llantas` queda = precio × cantidad (coherente); sin desglose se conserva el valor existente.
- Si hay «Valor del camión», el divisor de respaldo de depreciación se completa con 26 (referencia del libro) solo para satisfacer el trío del esquema;
  el divisor vigente es el global «Días depreciación».
- Los snapshots `COSTEO_V1` y `COSTEO_EXCEL_2026` se muestran con su propio resultado; nunca se recalculan.
- Los campos retirados (`cantidadGuias`, `viaticoPilotoTotal`, `viaticoAuxiliarTotal`, `viaticoGuiaTotal`, `hotelTotal`) se **rechazan** en el cálculo nuevo
  (esquema estricto) en lugar de ignorarse en silencio.
- Perfiles sin `viaticos_hotel_viaje` configurado: el costeo no falla; usa Q0 y muestra la advertencia «Viáticos y hotel no configurados en el perfil».
- Thermo: infraestructura intacta para perfiles refrigerados/personalizados; oculto en perfiles normales; **no** se suma a los cinco perfiles del libro.
  `CAMION_5T_REFRIGERADO` y `CAMION_12T` se conservan sin datos del libro. No se siembra ningún valor.

## SQL (no ejecutado)

- `sql/preflight-2026-10-cotizaciones-paridad-cotizador-2026.sql` — solo lectura (SELECT/SHOW), criterios APLICAR / NOOP / DETENER.
- `sql/migrate-2026-10-cotizaciones-paridad-cotizador-2026.sql` — una sentencia:
  `ALTER TABLE tms_cotizacion_costeo_perfiles ADD COLUMN IF NOT EXISTS viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL;`
- `sql/schema.sql` — solo esa columna (2 líneas, CRLF preservado).

## Paridad por hoja

Valores del libro vs. sistema (los conceptos coinciden a 2 decimales; el libro no redondea por concepto, por eso base/subtotal coinciden a ±Q0.01).

| Hoja | Ejemplo | COSTO BASE libro | Margen | Subtotal libro |
| --- | --- | ---: | ---: | ---: |
| Camion 1 ton | diésel 45 · 75 km · 1 día · 1 piloto · 0 aux. | 789.8661 | 15 % + 15 % = 30 % | 1,026.8259 |
| Camion de 2.7 | diésel 43 · 220 km | 1,671.8140 | 15 % + 15 % = 30 % | 2,173.3582 |
| Camion de 5 | diésel 45 · 440 km | 2,708.1449 | 20 % + 20 % = 40 % | 3,791.4029 |
| Camion de 10 | diésel 55 · 460 km | 4,014.7574 | 15 % + 15 % = 30 % | 5,219.1846 |
| Cabezales | diésel 55 · 1,000 km | 9,993.1703 | 20 % | 11,991.8044 |

Las pruebas (`cotizacion-costeo-cotizador-2026.test.ts`) comparan cada concepto de las cinco hojas (gastos, seguro mercadería, depreciación, GPS, seguro, aceite,
llantas, combustible, piloto, auxiliar, viáticos y hotel), la base, el subtotal, el IVA posterior y el precio/km.

## Observaciones sobre el libro (para validar con negocio; NO se cambió nada por ellas)

1. **Constantes dentro de las fórmulas del libro** (no son celdas de entrada): rendimiento = N de `(km/N)×diésel` (1T: 30, 2.7T: 25, 5T: 17, 10T: 10.5,
   Cabezal: 7); vida útil de llantas = 50,000 km (`juego/50000`); intervalo de aceite = 5,000 km (`aceite/5000`). Se usan en las pruebas solo para
   reproducir los ejemplos y están marcadas como **inferidas**. Los rendimientos configurados hoy en Novalvion no se modificaron ni se afirman
   como fuente del libro; conviene que negocio los compare con estos valores.
2. **GPS y seguro de mercadería ×días:** el libro los multiplica por «Días» (filas 15); el motor los cobra **por viaje** (decisión documentada en el PR #406).
   Con 1 día son idénticos; con varios días difieren. No se cambió.
3. Algunos valores del libro vienen escritos a mano y redondeados (auxiliar 302 en 2.7T, piloto 339.38 en 5T, seguro de mercadería 6.34): por eso ±Q0.01.
4. El valor del camión de 1T es `=85000/1.12` (75,892.857…), sin IVA.
5. El Cabezal tiene UN solo porcentaje (20 %); en 5T el libro suma 20 % + 20 %.
6. Las hojas también traen listas de precios por ruta y los bloques «Hoja1/Hoja2»: no forman parte del modelo de costeo y no se usaron.

## Validación

Ver el reporte del PR (tsc, eslint, build, pruebas dirigidas y suite completa comparada con `origin/main`).
