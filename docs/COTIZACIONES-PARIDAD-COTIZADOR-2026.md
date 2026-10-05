# Costeo interno — paridad estricta con «Cotizador 2026.xlsx»

Base: `75ac6cfdb2dfc43ed6f4c215c4b91c458d023a89` (posterior al PR #406).
Fuente funcional ÚNICA: `Cotizador 2026.xlsx` (hojas «Camion 1 ton», «Camion de 2.7», «Camion de 5», «Camion de 10», «Cabezales »).
**No** se usó `COTIZADOR RUTAS(3).xlsx`. Alcance: Costeo interno y Ajustes de Cotizaciones.
SQL propuesto, **no ejecutado**.

> **Orden de despliegue:** aplicar la migración (ver «SQL») ANTES de desplegar. El código nuevo lee `viaticos_hotel_viaje`,
> `auxiliar_multiplica_dias` y `viaticos_hotel_multiplica_dias` al consultar perfiles; sin las columnas, las consultas de perfiles fallan (mismo criterio del PR #406).

## Qué cambia

| Área | Cambio |
| --- | --- |
| Motor | Nuevo `COSTEO_COTIZADOR_2026` para los cálculos NUEVOS. `COSTEO_V1` y `COSTEO_EXCEL_2026` siguen leyéndose y calculándose igual. |
| Viáticos y hotel | Una sola línea «Viáticos y hotel»: override de la cotización (TOTAL explícito, nunca se multiplica) → valor del perfil (× días solo si el perfil lo indica) → Q0 con advertencia. **No** se multiplica por personas ni guías. |
| Diferencias por perfil | El libro NO trata igual a todas las hojas con varios días. Se reproducen con dos banderas editables del perfil (sin ramificar por código de perfil): `auxiliarMultiplicaDias` y `viaticosHotelMultiplicaDias`. |
| Perfil | Tres columnas aditivas, todas `NULL DEFAULT NULL`: `viaticos_hotel_viaje DECIMAL(12,2)`, `auxiliar_multiplica_dias TINYINT(1)`, `viaticos_hotel_multiplica_dias TINYINT(1)`. |
| UI de costeo | Se quitan Guías, viático piloto/auxiliar/guía y hotel; se agrega «Viáticos y hotel (Q)» (un override opcional, con el valor del perfil como sugerencia). |
| Ajustes → Perfiles | Agrupado: Identificación, Operación, Mantenimiento, Seguro, Depreciación, Personal. «Valor del camión (Q)» único. En Personal: «Auxiliar se cobra por cada día de servicio» y «Viáticos y hotel se cobran por cada día de servicio» (Sin configurar / Sí / No). |
| Ajustes → Parámetros | Se ocultan Piloto/día, Auxiliar/día, Viático piloto/auxiliar/guía por día y Hotel/persona/día (siguen en BD y se reenvían). |
| Desglose | Conceptos del libro: Gastos varios, Seguro mercadería, Depreciación, GPS, Seguro vehículo, Aceite, Llantas, Combustible, Piloto, Auxiliar, Viáticos y hotel, Otros costos; luego COSTO BASE, margen, subtotal, IVA, TOTAL CON IVA, precio/km. |

## Fórmulas finales (todas configurables; sin constantes del libro en el motor)

Cada concepto se calcula con Decimal (HALF_UP) y se redondea a 2 decimales; la suma no se redondea de nuevo (política heredada del PR #406).

| Concepto | Fórmula |
| --- | --- |
| Gastos generales | (administración + mantenimiento + seguridad + predios) / flota / días gastos × días |
| Seguro mercadería | (anual / flota / viajes anuales) **× días**; un total manual (incluso 0) es el TOTAL explícito del servicio y **no** se multiplica; se puede excluir |
| Depreciación | valor del camión / años / 12 / divisor global × días |
| GPS | (GPS mensual / viajes mensuales del perfil) **× días** |
| Seguro vehículo | mensual / 30 × días |
| Aceite | costo cambio / intervalo km × km |
| Llantas | precio × cantidad / vida útil km × km (respaldo: juego histórico) |
| Combustible | km / rendimiento × precio usado (override por cotización; no modifica el global) |
| Piloto | salario mensual del perfil / días laborales globales × personas **× días siempre** (respaldo: costo diario global si el salario es NULL; 0 configurado es 0) |
| Auxiliar | (salario mensual / días laborales × cantidad) **× días solo si** `auxiliarMultiplicaDias`; si no, una sola vez |
| Viáticos y hotel | override de la cotización (TOTAL explícito, **no** se multiplica) ?? `perfil.viaticosHotelViaje` **× días solo si** `viaticosHotelMultiplicaDias` ?? 0 (advertencia) |
| Margen | UN margen objetivo: valor = base × margen; subtotal = base + valor; IVA después |

El libro usa dos columnas de margen en algunas hojas; Novalvion maneja la suma como un único margen (15 % + 15 % → 30 %,
20 % + 20 % → 40 %). **No** se reintroduce `margen2`.

## Viajes de varios días y diferencias por perfil

La fila 15 de las cinco hojas es `=E6` (Días) para gastos, seguro de mercadería, depreciación, GPS y seguro del vehículo (`D16 = D15 × D14`, …),
así que el motor nuevo los multiplica por días en **todos** los perfiles. El piloto también va × días en las cinco hojas.
Las hojas **no** coinciden entre sí en el auxiliar ni en «Viáticos y hotel»; se reproducen tal cual (no se normalizan):

| Concepto | Con varios días |
| --- | --- |
| Gastos generales, depreciación, seguro vehículo | × días (todos los perfiles) |
| GPS | (mensual / viajes mensuales) × días |
| Seguro mercadería automático | (anual / flota / viajes anuales) × días |
| Seguro mercadería manual | total explícito del servicio: **no** se multiplica (Q50 con 3 días = Q50) |
| Piloto | × personas × días (todos los perfiles) |
| Auxiliar | × días **solo si** el perfil tiene `auxiliarMultiplicaDias` |
| Viáticos y hotel (valor del perfil) | × días **solo si** el perfil tiene `viaticosHotelMultiplicaDias` |
| Viáticos y hotel (override de la cotización) | TOTAL explícito: **nunca** se multiplica (2.7T, 3 días, perfil Q200, override Q350 ⇒ Q350, no Q1,050) |
| Aceite, llantas, combustible | dependen de los km, no de los días |

### Configuración de referencia por hoja (para configurar desde Ajustes → Perfiles; NO se siembra en BD)

| Perfil | Auxiliar × días | Viáticos y hotel × días | Origen en el libro |
| --- | :---: | :---: | --- |
| CAMION_1T | Sí | No | auxiliar `=L15`→Días; viáticos `1` fijo |
| CAMION_2_7T | Sí | Sí | auxiliar `=L15`→Días; viáticos `=M15`→Días |
| CAMION_5T | No | No | ambos `1` fijo |
| CAMION_10T | No | No | ambos `1` fijo |
| CABEZAL | No | No | ambos `1` fijo |

El piloto siempre es diario × cantidad × días; no tiene bandera.

Ejemplo con 2 días (piloto × 2 en todos): 1T auxiliar = diario × 2 y viáticos una vez · 2.7T auxiliar × 2 y viáticos Q200 × 2 = Q400 ·
5T y 10T auxiliar una vez (diario) y viáticos Q300 una vez · Cabezal auxiliar Q0 y viáticos Q200 una vez.

### Perfil sin configurar (bandera NULL)

Las columnas son `NULL DEFAULT NULL` para no inventar valores. Mientras una bandera esté en NULL el motor usa el comportamiento previo
(auxiliar **por día**, como el PR #406; viáticos del perfil **una vez**, como la primera versión de este PR) y, si hay más de un día y existe
un valor que escalar, agrega una **advertencia visible** («El perfil no indica si el auxiliar / “Viáticos y hotel” se cobra por cada día de servicio…»).
`false` configurado respeta el No y no genera advertencia. Los valores efectivos usados quedan en `valoresUsados` del snapshot
(`auxiliarMultiplicaDias`, `viaticosHotelMultiplicaDias`). Con las banderas en NULL, un viaje de más de un día coincide con el libro salvo en: auxiliar de 5T y 10T (el libro lo cobra una vez; NULL lo cobra por día) y «Viáticos y hotel» de 2.7T (el libro × días; NULL una vez). Configurar las banderas en Ajustes elimina esas diferencias.

`COSTEO_EXCEL_2026` y `COSTEO_V1` **no** cambian y ignoran estas banderas; ningún snapshot existente se recalcula.

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
- Perfiles con banderas «por cada día» en NULL (todos, hasta que se configuren): el costeo no falla; ver «Perfil sin configurar».
- Perfiles sin `viaticos_hotel_viaje` configurado: el costeo no falla; usa Q0 y muestra la advertencia «Viáticos y hotel no configurados en el perfil».
- Thermo: infraestructura intacta para perfiles refrigerados/personalizados; oculto en perfiles normales; **no** se suma a los cinco perfiles del libro.
  `CAMION_5T_REFRIGERADO` y `CAMION_12T` se conservan sin datos del libro. No se siembra ningún valor.

## SQL (no ejecutado)

- `sql/preflight-2026-10-cotizaciones-paridad-cotizador-2026.sql` — solo lectura (SELECT/SHOW), criterios APLICAR / NOOP / DETENER.
- `sql/migrate-2026-10-cotizaciones-paridad-cotizador-2026.sql` — una sentencia con tres columnas, sin UPDATE ni seeds:
  `ALTER TABLE tms_cotizacion_costeo_perfiles ADD COLUMN IF NOT EXISTS viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL, ADD COLUMN IF NOT EXISTS auxiliar_multiplica_dias TINYINT(1) NULL DEFAULT NULL, ADD COLUMN IF NOT EXISTS viaticos_hotel_multiplica_dias TINYINT(1) NULL DEFAULT NULL;`
- `sql/schema.sql` — las tres columnas dentro de `tms_cotizacion_costeo_perfiles` (CRLF preservado).

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
llantas, combustible, piloto, auxiliar, viáticos y hotel), la base, el subtotal, el IVA posterior y el precio/km, y los casos multidía de la sección anterior
(incluida una comparación contra las fórmulas de la hoja 2.7T para 2 días), más los casos multidía por perfil, el override manual, las banderas en NULL y los históricos.

## Observaciones sobre el libro (para validar con negocio; NO se cambió nada por ellas)

1. **Constantes dentro de las fórmulas del libro** (no son celdas de entrada): rendimiento = N de `(km/N)×diésel` (1T: 30, 2.7T: 25, 5T: 17, 10T: 10.5,
   Cabezal: 7); vida útil de llantas = 50,000 km (`juego/50000`); intervalo de aceite = 5,000 km (`aceite/5000`). Se usan en las pruebas solo para
   reproducir los ejemplos y están marcadas como **inferidas**. Los rendimientos configurados hoy en Novalvion no se modificaron ni se afirman
   como fuente del libro; conviene que negocio los compare con estos valores.
2. **Diferencias entre hojas en la fila 15 (auxiliar y «Viáticos y hotel»):** el auxiliar escala por días en 1T y 2.7T pero es `1` fijo en 5T, 10T y Cabezales; «VIATICOS Y HOTEL»
   es `1` fijo en 1T, 5T, 10T y Cabezales y `=M15` (→ Días) en 2.7T. **Decisión de negocio:** se respetan tal cual, sin normalizar (ver «Viajes de varios días y diferencias por perfil»);
   se modelan como banderas por perfil y no hay un valor sembrado. Conviene validar con negocio que el libro refleja la intención en 5T, 10T y Cabezales.
3. Algunos valores del libro vienen escritos a mano y redondeados (auxiliar 302 en 2.7T, piloto 339.38 en 5T, seguro de mercadería 6.34): por eso ±Q0.01.
4. El valor del camión de 1T es `=85000/1.12` (75,892.857…), sin IVA.
5. El Cabezal tiene UN solo porcentaje (20 %); en 5T el libro suma 20 % + 20 %.
6. Las hojas también traen listas de precios por ruta y los bloques «Hoja1/Hoja2»: no forman parte del modelo de costeo y no se usaron.

## Validación

Ver el reporte del PR (tsc, eslint, build, pruebas dirigidas y suite completa comparada con `origin/main`).
