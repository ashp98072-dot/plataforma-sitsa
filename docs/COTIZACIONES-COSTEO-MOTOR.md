# Cotizaciones — Motor de costeo interno (Fase 1 + Fase 2)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (motor puro + pruebas de regresión contra el libro). No está conectado a la UI, a la base de datos ni a `tms_cotizaciones`. **No aprobado para producción** hasta la Fase 3.

Código: `src/lib/tms/cotizacion-costeo.ts` · Pruebas: `src/lib/tms/cotizacion-costeo.test.ts` · Propuesta de persistencia: `sql/propuesta-2026-09-cotizaciones-costeo.sql` (no ejecutable, en revisión).

## 1. Qué se extrajo del Excel

`COTIZADOR RUTAS.xlsx` tiene 7 hojas (COSTEO 2.7 TON, 5 TON, Hoja1, 10 TON, CABEZALES, 10, Contenedores) que repiten **un mismo modelo económico** con distintos parámetros. Se construyó **un solo motor parametrizable**, no siete implementaciones. Lo extraído:

- Estructura de costo por servicio: depreciación, refrigeración (Thermo), GPS, seguro del vehículo, seguro de mercadería, aceite, llantas, combustible, piloto, auxiliar, viáticos (piloto/auxiliar/guía) y hotel.
- Patrones de cálculo repetidos: `mensual ÷ días → diario × días` (GPS, seguro, depreciación), `costo ÷ vida útil × km` (aceite, llantas), `km ÷ rendimiento × precio` (combustible), `costo día × cantidad` (personal).
- IVA como `costo × tasa` sobre el costo operativo.

## 2. Qué NO se tomó como regla

Sirven como referencia/QA, no como reglas del sistema:

- Tablas históricas de combustible y salarios por año; salarios y precios concretos de una celda.
- `Hoja1` / ULTRUS, "PRECIO ACTUAL" y las diferencias contra precios comerciales.
- Los dos porcentajes 15 %/20 % del libro (combinaciones 15/15, 15/20, 20/20): el motor aplica **un** margen; su significado exacto queda para la Fase 3 si negocio lo confirma.
- Los multiplicadores propios de cada celda (`piloto ×2`, `auxiliar ×6/×2`): se modelan como cantidades de personal, no como reglas por ruta.
- Inconsistencias entre hojas (ver "Diferencias conocidas").

## 3. Fórmulas normalizadas

Todas sin redondeo intermedio. `d` = días de servicio, `km` = distancia.

| Componente | Fórmula |
|---|---|
| Depreciación | `valorBase ÷ (años × 12) ÷ diasOperacionMes(depreciación) × d` |
| Refrigeración | igual que depreciación con `perfil.costoRefrigeracion`; `0` si `usarRefrigeracion = false`; error si se pide y el perfil no lo tiene |
| GPS | `gpsMensual ÷ perfil.diasOperacionMes × d` (0 si `incluirGps = false`) |
| Seguro vehículo | `seguroVehiculoMensual ÷ perfil.diasOperacionMes × d` (0 si `incluirSeguroVehiculo = false`) |
| Seguro mercadería | monto del servicio (`seguroMercaderia`, sin escalar) |
| Aceite | `costoAceiteServicio ÷ vidaUtilAceiteKm × km` |
| Llantas | `costoJuegoLlantas ÷ vidaUtilLlantasKm × km` (el juego ya integra la cantidad de llantas) |
| Combustible | `km ÷ rendimientoKmGalon × precioCombustibleGalon` |
| Piloto / Auxiliares | `costoDia × d × cantidad` |
| Viático piloto / auxiliar / guía | override `*Total` si existe; si no, `viaticoDia × d × cantidad` |
| Hotel | override `hotelTotal` si existe; si no, `hotelDia × d` (por día de servicio; ver "Falta para la Fase 3") |
| Otros costos | suma de `otrosCostos[].monto`; cada renglón aparece por separado en `componentes` |
| **Costo operativo** | suma de todos los componentes (sin IVA) |
| IVA | `costoOperativo × ivaTasa` |
| Costo con IVA | `costoOperativo + iva` |
| Precio sugerido | `costoConIva × (1 + margenObjetivo)` |
| Utilidad estimada | `precioVenta − costoConIva` |
| Margen real | `utilidadEstimada ÷ costoConIva` (`null` si el costo es 0 o no hay precio de venta) |

## 4. Componentes del costo

`ResultadoCosteoServicio` devuelve cada componente por nombre y `componentes[]` (`clave`, `concepto`, `monto`) con la garantía de que **la suma de `componentes` = `costoOperativo`**. Es la base del snapshot futuro.

## 5. Semántica del IVA

El IVA se calcula **sobre el costo operativo** y llega como parámetro (`ivaTasa`, fracción entre 0 y 1; el libro usa `0.12`). No está fijo en el motor. `costoConIva` es una magnitud de **costo**, no un precio de venta.

## 6. Semántica del margen

Una única definición: `precioSugerido = costoConIva × (1 + margenObjetivo)`. El margen del input prevalece sobre el de los parámetros; si no hay ninguno se aplica `0`. `margenReal` es **margen sobre costo** (`utilidad ÷ costoConIva`), **no** margen sobre venta; los nombres están separados para no mezclarlos.

## 7. Casos de referencia (regresión contra el libro)

Se leyeron las entradas y resultados en caché de la hoja *Contenedores* (cabezal): GPS 174.10 (170.72 en Mazatenango), seguro 1550, aceite 1860/5000, llantas 38 466 con vida 50 000 km (el libro calcula `38466 ÷ 900000 × 18`, equivalente), combustible 29.89 a 9.3 km/gal, piloto 207.74, auxiliar 148.04, IVA 12 %. Reproducidos con tolerancia 1e-6:

| Escenario | km | Costo | IVA | Costo con IVA |
|---|---|---|---|---|
| Puerto Barrios | 600 | 3 907.2090967741933 | 468.8650916129032 | 4 376.074188387097 |
| Escuintla | 132 | 2 211.0894012903227 | 265.3307281548387 | 2 476.4201294451614 |
| Mazatenango | 324 | 3 247.1940455913978 | 389.6632854709677 | 3 636.8573310623656 |
| Coatepeque, Cobán, Chiquimula, Quetzaltenango | 502/437/356/392 | ver pruebas | | |

Además, la depreciación de la hoja *COSTEO 5 TON* (`182 142.86 ÷ 60 ÷ 26 = 116.758…`) y el Thermo (`100 000 ÷ 60 ÷ 26 = 64.102…`) coinciden con la fórmula normalizada y se costean por separado.

Cómo se mapea el libro al motor: los multiplicadores de personal (`×2`, `×6`) son `cantidadPilotos`/`cantidadAuxiliares` con `diasServicio = 1` (GPS y seguro del libro son de 1 día); los viáticos del libro no escalan con días ni con personas, por lo que se usan los **overrides** `viatico*Total`.

### Diferencias conocidas respecto al Excel

- **Fila Petén (hoja Contenedores)**: aceite usa 1 324 km y llantas/combustible 1 234 km — inconsistencia del libro; no se reproduce.
- **Fila Huehuetenango**: combustible a 59.89 (el resto usa 29.89) — es un dato distinto, no una regla.
- Los precios "PRECIO ACTUAL" y las diferencias contra el costo no se replican (son comparaciones comerciales).
- El libro usa `/30` para GPS/seguro y `/26` para depreciación en la misma hoja; el motor conserva esa separación (`perfil.diasOperacionMes` vs `depreciacion.diasOperacionMes`).

## 8. Costo interno vs precio sugerido vs tarifa comercial

- **Costo interno**: `costoOperativo` / `costoConIva`. Confidencial, nunca sale en el PDF comercial.
- **Precio sugerido**: costo con IVA más el margen objetivo. Es una **sugerencia** para el cotizador.
- **Tarifa comercial**: `tarifa_cotizada` de la cotización (la que ve el cliente). El costeo la **alimentará** en una fase posterior; no la reemplaza ni la modifica.

## 9. Diseño del snapshot futuro (obligatorio)

Una cotización debe guardar un snapshot de **todos** los valores usados: perfil, parámetros económicos, input del servicio y resultado con sus componentes. Una cotización histórica **no puede cambiar** si después cambian combustible, salario, viáticos, seguro, GPS, llantas, aceite, depreciación, rendimiento o parámetros de la ruta.

Propuesta (`sql/propuesta-2026-09-cotizaciones-costeo.sql`): tablas vivas `tms_cotizacion_costeo_perfiles` y `tms_cotizacion_costeo_parametros` (vigencia), y tablas **inmutables** `tms_cotizacion_costeos` (copia JSON de perfil/parámetros/input + resultados + versión del motor) y `tms_cotizacion_costeo_componentes`. Solo `INSERT`; sin FK viva hacia perfiles/parámetros. Este PR **no** escribe nada en `tms_cotizaciones` ni ejecuta SQL.

## 10. Qué falta para la Fase 3

1. Decisión de negocio sobre los dos porcentajes históricos (15 %/20 %).
2. Regla de hotel y viáticos automáticos (¿por persona? ¿noches = días − 1?); hoy hay semántica simple + overrides.
3. Política de redondeo de presentación/persistencia.
4. Revisar y aprobar la propuesta SQL (incluye el índice único `(empresa_id, id)` en `tms_cotizaciones`) y aplicarla como migración.
5. Cargar perfiles reales y parámetros vigentes (sin hardcodear valores del libro).
6. Servicios de lectura/escritura del snapshot, permisos del costeo y UI (fuera de este PR).
7. Definir cómo el costeo alimenta `tarifa_cotizada` sin tocar el flujo/estados actuales.
