# Cotizaciones — paridad matemática exacta con «Cotizador 2026.xlsx» (COSTEO_COTIZ_2026_V2)

Base: `344bb72c0bdc693101a2e1f064b4cf910d206cb5` (posterior al PR #408). Fuente ÚNICA: `Cotizador 2026.xlsx`, hojas «Camion 1 ton», «Camion de 2.7», «Camion de 5», «Camion de 10» y «Cabezales »
(no `COTIZADOR RUTAS`). Las fórmulas y valores se leyeron **directamente del archivo** (openpyxl, fórmulas y valores en caché), no de capturas. SQL: ninguno ejecutado ni requerido.

## 1. Qué hacía mal el motor anterior (COSTEO_COTIZADOR_2026)
Redondeaba a 2 decimales **cada componente, el valor del margen y el IVA** antes de seguir sumando. El libro no redondea en ningún paso: conserva la precisión de las fórmulas y la celda solo
muestra 2 decimales. Resultado: el total difería del libro en **un centavo en 4 de las 5 hojas** (1T, 2.7T, 5T y 10T; solo Cabezal coincidía).

| Hoja | Total COSTEO_COTIZADOR_2026 (anterior) | Total Excel | Dif. |
| --- | ---: | ---: | ---: |
| Camion 1 ton | Q1,150.04 | Q1,150.05 | -0.01 |
| Camion de 2.7 | Q2,434.15 | Q2,434.16 | -0.01 |
| Camion de 5 | Q4,246.38 | Q4,246.37 | +0.01 |
| Camion de 10 | Q5,845.48 | Q5,845.49 | -0.01 |
| Cabezales | Q13,430.82 | Q13,430.82 | 0.00 |

## 2. Política de redondeo
| | COSTEO_COTIZADOR_2026 (anterior) | COSTEO_COTIZ_2026_V2 (nuevo) |
| --- | --- | --- |
| Componentes | `q()` a 2 decimales cada uno | precisión interna completa (Decimal.js, 40 dígitos, HALF_UP) |
| Costo base | suma de los componentes ya redondeados | suma de los componentes sin redondear |
| Margen (15 % + 15 % → 30 %) | `q(base × 0.30)` | `base × 0.30` = `base × 0.15 + base × 0.15` sin redondear cada mitad |
| Subtotal / IVA / total | `q(subtotal × 12 %)` | `subtotal × 12 %` y `total = subtotal + IVA`, sin redondear (G3 = R16 × 1.12) |
| Precio/km | `q(total / km)` | `total interno / km` (H3 = G3 / E5) |
| Redondeo | en cada paso | **una sola vez**, a 2 decimales HALF_UP, solo para mostrar/persistir |

Sin `Number` en las operaciones monetarias: todo el cálculo es Decimal. `COSTEO_V1`, `COSTEO_EXCEL_2026` y `COSTEO_COTIZADOR_2026` siguen calculando exactamente igual que antes (pruebas existentes intactas).

## 3. Versión del motor
Se introduce **`COSTEO_COTIZ_2026_V2`** (constante `COTIZACION_COSTEO_COTIZADOR_V2_VERSION`): el mismo input puede dar un centavo distinto que el motor anterior, así que es una versión propia. Los snapshots
`COSTEO_COTIZADOR_2026` existentes **no se reinterpretan ni se recalculan**; los cálculos nuevos (`prepararCosteo`) usan V2.

> **Nombre:** se usa `COSTEO_COTIZ_2026_V2` (20 caracteres) y no `COSTEO_COTIZADOR_2026_V2` (24) porque `tms_cotizacion_costeos.motor_version` es `VARCHAR(20)`.
> **Hallazgo adicional (existente desde el PR #407):** `COSTEO_COTIZADOR_2026` tiene **21** caracteres y tampoco cabe en `VARCHAR(20)`: con `sql_mode` estricto el INSERT del costeo fallaría («Data too long») y sin modo estricto
> se guardaría truncado como `COSTEO_COTIZADOR_202`. Esto no afecta a V2. Ver `sql/propuesta-2026-10-cotizaciones-motor-version.sql` (solo lectura + propuesta, **no ejecutada**). La UI toma el motor de `resultado_snapshot.motorVersion`
> (no de la columna), así que un valor truncado no cambia cómo se muestra un snapshot.

## 4. Fórmulas reales de las cinco hojas (fila 12 = entrada, fila 14 = unitario, fila 15 = multiplicador, fila 16 = valor)
Comunes a las cinco: `D16 = D15×D14` (gastos: `Q7/46/20`), `F16` (deprec: `L3/60/26`), `G16 = G15×(G12/20)` (GPS), `H16 = H15×(H12/30)` (seguro vehículo), `I16 = km×(I12/5000)` (aceite), `J16 = km×(J13/50000)` con `J13 = J12×cant. llantas`,
`K16 = (km/N)×diésel`, `O16 = SUM(D16:N16)`, `G3 = total × 1.12`, `H3 = G3/km`. Fila 15: `D15:H15 = E6` (días) en todas; `I15:K15 = km`.

| Concepto | 1T | 2.7T | 5T | 10T | Cabezal |
| --- | --- | --- | --- | --- | --- |
| Valor camión (L3) | `=85000/1.12` | 150000 | 182142.86 | 150000 | 275000 |
| Rendimiento (N de `K16`) | 30 | 25 | 17 | 10.5 | 7 |
| Llantas × precio | 4 × 750 | 4 × 850 | 6 × 1150 | 6 × 1490 | 18 × 1490 |
| **Seguro mercadería E12** | **literal 6.34** | **literal 6.34** | **literal 6.34** | **literal 6.34** | **literal 6.34** |
| Piloto L12 | `=N5` (339.3842…) | `=N5` | **literal 339.38** | `=N5` (364.3842…) | `=N5` (469.4295) |
| Auxiliar M12 | literal 0 | **literal 302** | `=N6` (301.99825…) | `=N6` | literal 0 |
| Viáticos N12 | 0 | 200 | 300 | 300 | 200 |
| Multiplicador piloto L15 | `=E6` | `=E6` | `=H15` (→E6) | `=H15` (→E6) | `=E6` |
| Multiplicador auxiliar M15 | `=L15` (días) | `=L15` (días) | literal 1 | literal 1 | literal 1 |
| Multiplicador viáticos N15 | literal 1 | `=M15` (días) | literal 1 | literal 1 | literal 1 |
| Margen | 15 % + 15 % (P16, Q16) | 15 % + 15 % | 20 % + 20 % | 15 % + 15 % | 20 % (un solo, `Q16 = P16 + O16`) |
| Subtotal / total | `R16`, `G3 = R16×1.12` | igual | igual | igual | `Q16`, `G3 = Q16×1.12` |

### Celdas LITERALES que difieren del valor derivable (se reproducen, no se normalizan)
1. **Seguro de mercadería E12 = 6.34** en las cinco hojas. `J7 = J5/J6 = 6.340579710144927` existe en el libro pero **no se usa** en la suma (`E14 = E12`). El **ticket lista 6.340579710144927 como componente, pero el costo base del libro
   (1671.8139944147158 en 2.7T) solo se obtiene con 6.34**; con J7 sería 1671.8145741… (la prueba del libro lo demuestra).
2. **Auxiliar 2.7T M12 = 302** (no `N6 = 301.99825…`).
3. **Piloto 5T L12 = 339.38** (no `N5 = 339.3842533…`).

Las tres son versiones a centavos del valor derivable, pero el libro las usa **solo en esas celdas** (el piloto de 1T/2.7T/10T y el auxiliar de 5T/10T usan precisión completa), de modo que ninguna regla única de redondeo las reproduce.
Por eso el motor no inventa una regla: se reproducen con los mismos datos de entrada que tiene el libro — seguro de mercadería manual (total del servicio, ya soportado), y salario mensual = diario escrito × 20 (302×20 = 6040; 339.38×20 = 6787.6).

## 5. Diferencias contra el motor anterior (por hoja)
| Concepto | Anterior | Nuevo (V2) |
| --- | --- | --- |
| Redondeo de cada componente / margen / IVA | sí | no (solo al final) |
| Multiplicadores de la fila 15, banderas por perfil, overrides manuales como TOTAL | ✔ (PR #407) | ✔ sin cambio |
| Fórmulas por concepto (gastos, depreciación, GPS, seguros, aceite, llantas, combustible, salarios) | ✔ | ✔ sin cambio (se verificó contra cada celda) |
| Seguro mercadería literal 6.34 / auxiliar 302 / piloto 339.38 | no reproducibles por regla | reproducibles con datos de entrada (§4) |

No había diferencias de FÓRMULA contra las cinco hojas: la diferencia era solo el redondeo intermedio.

## 6. Los cinco casos (valores del libro, doble precisión de Excel) y el resultado del motor
Con los mismos datos de entrada del libro, el motor coincide **componente por componente** (interno ≤ 1e-9; visible exacto a 2 decimales) y en todos los totales.

| Hoja | Entrada (diésel · km · días) | Costo base (O16) | Subtotal | Total con IVA (G3) | Precio/km (H3) |
| --- | --- | ---: | ---: | ---: | ---: |
| Camion 1 ton | 45 · 75 km · 1 día | 789.8660823268037 | 1026.8259070248448 | 1150.0450158678264 | 15.333933544904351 |
| Camion de 2.7 | 43 · 220 km · 1 día | 1671.8139944147158 | 2173.3581927391306 | 2434.1611758678264 | 11.064368981217394 |
| Camion de 5 | 45 · 440 km · 1 día | 2708.144940870221 | 3791.4029172183095 | 4246.371267284507 | 9.65084378928297 |
| Camion de 10 | 55 · 460 km · 1 día | 4014.757390605192 | 5219.184607786749 | 5845.48676072116 | 12.707579914611218 |
| Cabezales | 55 · 1000 km · 1 día | 9993.170303352445 | 11991.804364022933 | 13430.820887705686 | 13.430820887705686 |

Valores **visibles** (2 decimales) y comparación con el motor anterior:

| Hoja | Costo base | Subtotal | Total con IVA | Precio/km | Total anterior | Anterior vs Excel |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Camion 1 ton | Q789.87 | Q1,026.83 | **Q1,150.05** | Q15.33 | Q1,150.04 | ✘ -0.01 |
| Camion de 2.7 | Q1,671.81 | Q2,173.36 | **Q2,434.16** | Q11.06 | Q2,434.15 | ✘ -0.01 |
| Camion de 5 | Q2,708.14 | Q3,791.40 | **Q4,246.37** | Q9.65 | Q4,246.38 | ✘ +0.01 |
| Camion de 10 | Q4,014.76 | Q5,219.18 | **Q5,845.49** | Q12.71 | Q5,845.48 | ✘ -0.01 |
| Cabezales | Q9,993.17 | Q11,991.80 | **Q13,430.82** | Q13.43 | Q13,430.82 | ✔ igual |

Componentes visibles por hoja (D16:N16 y O16):

| Hoja | Gastos | Seguro mercad. | Deprec. | GPS | Seguro veh. | Aceite | Llantas | Combustible | Piloto | Auxiliar | Viáticos | Base |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Camion 1 ton | 220.91 | 6.34 | 48.65 | 5.00 | 26.33 | 26.25 | 4.50 | 112.50 | 339.38 | 0.00 | 0.00 | 789.87 |
| Camion de 2.7 | 220.91 | 6.34 | 96.15 | 5.00 | 31.67 | 77.00 | 14.96 | 378.40 | 339.38 | 302.00 | 200.00 | 1671.81 |
| Camion de 5 | 220.91 | 6.34 | 116.76 | 5.00 | 38.33 | 154.00 | 60.72 | 1164.71 | 339.38 | 302.00 | 300.00 | 2708.14 |
| Camion de 10 | 220.91 | 6.34 | 96.15 | 5.00 | 35.00 | 193.20 | 82.25 | 2409.52 | 364.38 | 302.00 | 300.00 | 4014.76 |
| Cabezales | 220.91 | 6.34 | 176.28 | 5.00 | 41.67 | 480.00 | 536.40 | 7857.14 | 469.43 | 0.00 | 200.00 | 9993.17 |

Refrigeración/Thermo: el libro tiene un bloque «Deprec Thermo» (O3:O6; 100000 / 60 / 26 = 64.1025641025641) que **no** entra en `O16`. El motor lo conserva para perfiles refrigerados con la misma precisión y no lo suma en las cinco hojas.

## 7. Diferencia restante (con configuración de producción)
Con el seguro **automático** (70,000 / 46 / 240 = 6.3405797…) y los salarios completos (N3/N4) —es decir, **sin** reproducir los tres literales—:
- 1T, 2.7T, 10T y Cabezal coinciden con Excel al centavo (la diferencia interna es de ~0.0007 por el seguro).
- **5T difiere Q0.01** (Q4,246.38 contra Q4,246.37) únicamente por el piloto literal 339.38 (L12) del libro frente al derivado 339.3842533… Con el piloto del libro como dato (salario mensual 6787.6) la paridad es exacta.
Es una decisión de negocio (¿el 339.38 de 5T es intencional?), no un defecto del redondeo: no se normaliza.

## 8. Multidía
Probado contra un evaluador independiente de las celdas del libro (D16:N16 con la fila 15 de cada hoja) para 2 y 3 días en las cinco hojas: gastos, depreciación, GPS, seguro del vehículo, piloto y seguro de mercadería × días;
auxiliar y viáticos según las banderas del perfil (deducidas de las fórmulas reales de M15/N15); aceite, llantas y combustible por km. Los totales manuales (seguro, viáticos) siguen siendo TOTAL explícito y no se multiplican.

## 9. Snapshots y persistencia
- `resultado_snapshot` (JSON) de V2 incluye `precision`: cadenas decimales de **12 decimales** de cada componente, costo base, valor del margen, subtotal, IVA, costo con IVA, total y precio/km, y `politicaRedondeo: "al_final"`. Suficiente para reconstruir el cálculo exactamente.
- Los campos numéricos del resultado (y la UI) son los valores de **presentación**, a 2 decimales.
- Columnas `DECIMAL(16,6)` y `tms_cotizacion_costeo_componentes.monto` (`DECIMAL(16,6)`): V2 guarda ahí el valor de **cálculo** a 6 decimales (p. ej. gastos `220.909228`, costo base `1671.813994`, total `2434.161176`). 6 decimales bastan para
  auditar las fórmulas del libro (error ≤ 5e-7 por valor; los totales visibles no cambian), por lo que **no hace falta migrar precisión**; el JSON conserva 12 decimales.
- `sumaComponentesCoincide` valida V2 con la suma de los componentes de cálculo (tolerancia 1e-9) y exige que `precision` tenga exactamente los mismos componentes; los motores anteriores conservan su validación.
- Historial (PR #408) intacto: las versiones nuevas son `COSTEO_COTIZ_2026_V2`; las anteriores siguen mostrándose con su propio resultado.

## 10. UI
Sin cambios visuales: importes a 2 decimales (ningún importe muestra más). El historial / «Ver configuración» muestra el resultado a 2 decimales y los inputs usados; los motores de la familia Cotizador (V1 anterior y V2) se muestran sin los globales del motor viejo.

## 11. Pruebas
`cotizacion-costeo-paridad-matematica.test.ts`: lectura de los datos del libro (fila 15, literales, ticket = libro), paridad interna y visible componente por componente, base, margen, subtotal, IVA, total y precio/km de las cinco hojas, política anterior vs nueva, multidía contra
el evaluador del libro (2 y 3 días), overrides, Thermo, configuración de producción, versionado y serialización. Más pruebas de persistencia V2, historial/UI y servicio.
