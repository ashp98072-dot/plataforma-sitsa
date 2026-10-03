# Costeo interno Excel 2026

Base revisada: `53c0b8cd30db3283a73e31090d2aa85556dffbae`.
Alcance exclusivo: Costeo interno y Ajustes de Cotizaciones. Sin cambios
comerciales, rutas, PDF, permisos, RRHH ni viáticos operativos.
SQL propuesto, **no ejecutado**. No desplegar antes de validar y aplicar la
migración autorizada y configurar los costos nuevos.

## Discovery y arquitectura conservada

- `cotizacion-costeo.ts`: motor puro V1 (GPS/seguro diario, un margen).
- `cotizacion-costeo-servicio.ts`: revalida perfil por tenant, resuelve
  parámetros por fecha de emisión y recalcula en servidor. Ahora selecciona
  explícitamente `COSTEO_EXCEL_2026` para nuevos cálculos.
- `cotizacion-costeo-db.ts`: snapshot 1:1, insert-only dentro de la
  transacción existente, componentes ordenados y auditoría sin costos.
- `cotizacion-costeo-ajustes.ts`: perfiles editables y vigencias económicas
  INSERT-only; no actualiza vigencias anteriores.
- Se reutilizan los endpoints `/tms/cotizaciones/costeo/config`,
  `/costeo/calcular`, `/ajustes/parametros` y `/ajustes/perfiles`.
  Sus guards/permisos no cambian.
- UI en `cotizacion-costeo-panel.tsx` y `cotizacion-ajustes-client.tsx`;
  presentación comercial queda intacta. Costeo sigue confidencial.

## Modelo aditivo exacto

Todos los campos nuevos son NULL DEFAULT NULL: desconocido, no un monto
inventado. No se requiere tabla nueva ni transformación de históricos.

| Tabla | Columna | Tipo |
| --- | --- | --- |
| tms_cotizacion_costeo_parametros | seguro_mercaderia_anual | DECIMAL(14,2) |
| misma | cantidad_camiones | INT |
| misma | viajes_anuales | DECIMAL(10,2) |
| misma | dias_depreciacion_mes | DECIMAL(5,2) |
| misma | dias_gastos_mes | DECIMAL(5,2) |
| misma | gastos_administracion | DECIMAL(14,2) |
| misma | gastos_mantenimiento | DECIMAL(14,2) |
| misma | gastos_seguridad | DECIMAL(14,2) |
| misma | gastos_predios | DECIMAL(14,2) |
| misma | dias_laborales_mes | DECIMAL(5,2) |
| tms_cotizacion_costeo_perfiles | viajes_mes | DECIMAL(10,2) |
| misma | precio_llanta | DECIMAL(12,2) |
| misma | cantidad_llantas | INT |
| misma | salario_piloto_mensual | DECIMAL(12,2) |
| misma | salario_auxiliar_mensual | DECIMAL(12,2) |
| tms_cotizacion_costeos | resultado_snapshot | JSON |

Se conservan costos de aceite/intervalo, rendimiento, GPS mensual, seguro
mensual, vida de llantas, valor/años/divisor de vehículo y Thermo existentes.
Los componentes siguen en `tms_cotizacion_costeo_componentes`, sin DDL nuevo.

## Fórmulas nuevas

Cada concepto se calcula con Decimal (precisión 40, HALF_UP) y se redondea
al final del concepto a 2 decimales. La suma y el único margen objetivo usan Decimal.

| Concepto | Fórmula |
| --- | --- |
| GPS | mensual / viajes_mes, por viaje (no por días) |
| Combustible | km / rendimiento × precio usado |
| Aceite | costo cambio / intervalo km × km |
| Llantas | precio unitario × cantidad / vida km × km |
| Seguro vehículo | mensual / 30 × días |
| Seguro mercadería | anual / flota / viajes anuales, por viaje |
| Depreciación vehículo | valor / años / 12 / días depreciación × días |
| Thermo | mismo esquema, solo cuando solicitado y configurado |
| Gastos generales | suma 4 conceptos / flota / días gastos × días servicio |
| Salarios | mensual del perfil / días laborales globales × personas × días |
| Viáticos | diario × personas × días; total manual prevalece |
| Hotel | total manual prevalece; en su ausencia hotel diario × días |
| Margen objetivo | porcentaje único × costo base |
| Subtotal comercial | base + valor del margen redondeado |
| IVA | subtotal comercial × tasa vigente |
| Total sugerido | subtotal comercial + IVA |
| Precio/km | total / km; NULL si km = 0 |

Decisión explícita para viajes de varios días: gastos generales representan
una cuota **diaria operativa**, por eso se multiplican por días. GPS y seguro
mercadería son por viaje y NO se duplican; conceptos por km tampoco.
No se introduce una duración ni categoría salarial nueva.

Persistencia monetaria en DECIMAL existente; nuevos snapshots/envíos de
importes del motor y campos DECIMAL nuevos usan cadenas decimales en mysql2.
JSON/API conserva números para el contrato existente; ningún FLOAT/DOUBLE
se añade a SQL. Precio/km es informativo y no cambia la tarifa comercial.
La acción existente de usar precio sugerido sigue siendo explícita.

## Compatibilidad y datos pendientes de configuración

- V1 no se recalcula, modifica ni transforma. Lectura histórica mantiene
  resultados/componentes y etiquetas V1. La función pura sin selector sigue
  ejecutando V1; únicamente el servicio nuevo selecciona V2.
- `margenObjetivo` / `margen_objetivo` permanece como único margen, sin
  columnas ni campos comerciales adicionales. En históricos NO se reinterpreta el IVA/margen.
- Viajes mensuales: 20 como default inicial expresamente permitido, editable.
  El servidor guarda ese valor resuelto en el perfil snapshot.
- Sin precio/cantidad de llantas, se conserva costoJuegoLlantas histórico.
  Si se desglosan, ambos deben existir y cantidad debe ser entera positiva.
- Salarios mensuales pertenecen exclusivamente al perfil de unidad, en la
  sección PERSONAL de Ajustes. Cada perfil conserva sus propios valores;
  no se agregan salarios mensuales a las vigencias económicas globales.
  Sin salario mensual (NULL), se usa el costo diario global existente;
  0 configurado es 0, no fallback. Un salario mensual requiere el divisor
  global `diasLaboralesMes` explícito y positivo; no se infiere un salario.
- Ejemplo de pruebas (NO seed): CAMION_5T piloto Q4,000/auxiliar Q3,000;
  CAMION_10T piloto Q6,000/auxiliar Q3,500. Con divisor global 20 producen
  Q200/Q150 y Q300/Q175 por día respectivamente. Editar 5T no altera 10T.
- Sin divisor global de depreciación, se conserva divisor propio del equipo.
- Si los cuatro gastos están NULL, se excluyen **con advertencia visible de
  costeo incompleto**, que queda congelada en el resultado. NULL no confirma
  costo cero. Gastos parcialmente configurados se rechazan.
- Seguro anual NULL, incluido y sin total manual: advertencia equivalente.
  Puede desmarcarse explícitamente o ingresarse total. Un total manual,
  incluso 0, prevalece sobre el checkbox/default.
- Datos de gastos/seguro/flota/salarios nuevos deben confirmarse en Ajustes
  antes de usar cifras para decisiones comerciales. No hay seeds/backfill.
- `CAMION_1T` y `CAMION_12T` se ofrecen como códigos en Ajustes; pueden
  crearse allí con valores reales. No se insertan perfiles vacíos ni costos.

## Snapshots, overrides e IVA

El snapshot conserva perfil completo, parámetros vigentes completos, input
con overrides y selector de versión, componentes y resultado V2 completo.
`valoresUsados` hace explícitos precio combustible usado, rendimiento,
viajes mensuales, divisores efectivos, juego de llantas utilizado y los
salarios mensuales del perfil (NULL si no configurados) junto con los costos
**diarios efectivos** de piloto/auxiliar y el divisor laboral global.
El único margen objetivo, IVA y resultados quedan en `resultado_snapshot`.
Cambiar Ajustes posteriormente NO consulta/reconstruye ese resultado.

Precio combustible override solo afecta el cálculo de la cotización; el
precio global sigue en parámetros snapshot. No toca el precio de referencia
comercial del PDF (PR #403). Totales manuales de seguro, viáticos y hotel se
mantienen y no se multiplican nuevamente por días/personas.

El campo legado `costoConIva` conserva la comparación interna base×(1+IVA)
para utilidad contra tarifa comercial total. En V2 `iva` corresponde al
subtotal con el margen objetivo, NO a aquel costo comparativo; la UI V2 muestra
base, margen objetivo/valor del margen, subtotal, IVA y total, no mezcla ambas magnitudes.

## Migración y preflight

- `sql/preflight-2026-10-cotizaciones-costeo-excel.sql`: solo SELECT/SHOW,
  sin information_schema. Seleccionar explícitamente la BD real.
- APLICAR: columnas nuevas ausentes y tablas existentes compatibles.
- NOOP: todas presentes con tipos/null/default correctos.
- DETENER: parcial o incompatible, tablas ausentes o versión distinta.
- `sql/migrate-2026-10-cotizaciones-costeo-excel.sql`: tres ALTER aditivos
  ADD COLUMN IF NOT EXISTS; sin UPDATE, seeds, cambios de FK ni eliminación.
  IF NOT EXISTS no corrige tipos existentes: revisar el preflight primero.
- `sql/schema.sql` conserva tablas e índices y añade el mismo contrato.

Objetivo MariaDB 11.8.9. ADD COLUMN IF NOT EXISTS está documentado por
[MariaDB](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table).
JSON puede aparecer físicamente como LONGTEXT + JSON_VALID, según su
[documentación oficial](https://mariadb.com/docs/server/reference/data-types/string-data-types/json).
Compatibilidad documental, no prueba ejecutada contra producción.

## Pruebas y límites de paridad

Fixtures A–F reproducen fórmulas y ejemplos numéricos explícitos del ticket,
con comparación de cada concepto, un margen objetivo, IVA y precio/km. Datos
de fixture no son semillas comerciales; no se recibió en este ticket una
copia nueva del workbook 2026 para comparar celda por celda.
Se mantienen los fixtures V1 y la restauración histórica del workbook previo.

El ejemplo aislado con base Q1,671.81 y margen objetivo 30% resulta en Q501.54,
subtotal Q2,173.35, IVA Q260.80, total Q2,434.15 con esta política explícita.
La diferencia de un centavo con Q2,434.16 citado es de redondeo; no se fuerza
una corrección arbitraria al resultado.

Regresiones explícitas: base Q4,000 × 30% = Q1,200, subtotal Q5,200;
base Q4,000 × 45% = Q1,800, subtotal Q5,800; IVA posterior. Pruebas
verifican configuración/edición independiente de salarios por perfil,
fallback NULL, snapshot mensual/diario efectivo y V1 sin reinterpretación.

También hay pruebas de validación estricta, defaults/fallbacks, tenant,
inmutabilidad, persistencia/lectura V2, importes DECIMAL y UI confidencial.
La suite completa se compara contra el SHA base en la misma máquina,
Node/npm/dependencias/comando por archivo, nombre y mensaje principal.

## Validación local final

Node v24.18.0 / npm 11.16.0 / Vitest 4; mismas dependencias y máquina Windows.
Comando de suite en ambos worktrees: `npx vitest run --reporter=json --outputFile=<reporte-temporal>`.

| Ejecución | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| BASE exacta | 7964 | 21 | 15 |
| Rama final corregida | 7999 | 21 | 15 |

Pruebas dirigidas de Cotizaciones: 640/640 (incluyen A–F, overrides,
snapshots, SQL y UI). TypeScript, ESLint dirigido y diff-check limpios.
Build final exitoso, con advertencias existentes de middleware/cache y
tracing de archivos en otros módulos; no se modifican en este ticket.

Identidad comparada por archivo + nombre completo + mensaje principal: **0 nuevos, 0 resueltos**.
Los dos guards de Compras sensibles al diff fallan también en el BASE exacto;
no se deduce su condición preexistente solamente por estar fuera de Cotizaciones.
Validación final de esta corrección: BASE y HEAD ejecutados secuencialmente,
sin build concurrente. Un primer HEAD mostró un fallo textual adicional del
test de Cuadrilla por saltos de línea LF/CRLF de `schema.sql`: el DDL era idéntico.
Se preservó el CRLF del checkout sin tocar Cuadrilla ni su test. La repetición
final confirma los mismos 21 fallos del BASE exacto y **CERO REGRESIONES NUEVAS**.
El archivo `schema.sql` contiene únicamente las adiciones de Costeo aprobadas.

### Fallos reproducidos en BASE y rama

| Archivo | Nombre exacto | Mensaje principal |
| --- | --- | --- |
| `src/lib/compras/contratos.test.ts` | no modifica RRHH, credenciales ni esquema SQL | AssertionError: expected true to be false // Object.is equality |
| `src/lib/compras/requerimiento-ui.test.ts` | ajuste transversal sin SQL, RRHH, programación ni credenciales | AssertionError: expected true to be false // Object.is equality |
| `src/components/tms/centro-logistico-resumen.test.ts` | Centro logístico: navegación y resumen visual presenta el título y las secciones en el orden requerido | AssertionError: expected false to be true // Object.is equality |
| `src/lib/tms/programacion-import-excel.test.ts` | generarPlantillaProgramacion define named ranges de libro para los 3 catálogos usados en dropdowns | Error: Command failed: unzip -p "C:/Users/Admin/AppData/Local/Temp/claude/xlsxtest/plantilla-programacion-test.xlsx" xl/workbook.xml |
| `src/lib/tms/vehiculo-solicitado.test.ts` | catálogo reutilizado: perfiles de costeo por empresa GET /tms/catalogos lo expone (aditivo) con la empresa de la sesión | AssertionError: expected 'import { NextResponse } from "next/se…' to match /personal,\n\s+vehiculosSolicitables,/ |
| `src/app/e/[slug]/programacion/programacion-exportar-imagen-wiring.test.ts` | programacion-client.tsx — Exportar imagen «Exportar imagen» solo existe en Programación — ningún otro módulo importa programacion-exportar-imagen ni programacion-imagen | AssertionError: expected [ …(2) ] to deeply equal [] |
| `src/app/e/[slug]/atraccion-talento/reportes/page.test.ts` | ATRACCION-TALENTO-1/2 — closure de filtros en cargar() 38) el montaje inicial sigue siendo una sola carga: el useEffect que llama cargar() al montar tiene deps [] — cambiar un filtro por sí solo NO dispara fetch | AssertionError: expected -1 to be greater than -1 |
| `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` | PATCH — editar el TC de un viaje PROPIO editar OTROS campos conserva el TC (no reescribe las columnas TC) y el propio plan se autoexcluye de la validación | AssertionError: expected 400 to be 200 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` | PATCH — editar el TC de un viaje PROPIO el mismo TC enviado de nuevo no se re-valida (ni por taller) ni se reescribe | AssertionError: expected 400 to be 200 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` | PATCH — editar el TC de un viaje PROPIO cambiar de TC valida el nuevo (acceso + clasificación) y reescribe id + fotografía | AssertionError: expected 400 to be 200 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` | PATCH — editar el TC de un viaje PROPIO cambiar a un TC ya asignado ese día a OTRO plan -> 409 (backend, no solo UI) | AssertionError: expected 400 to be 409 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` | PATCH — editar el TC de un viaje PROPIO cambiar la fecha del plan revalida el TC contra la NUEVA fecha | AssertionError: expected 400 to be 409 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` | PATCH — editar el TC de un viaje PROPIO tcVehiculoId: null quita el TC | AssertionError: expected 400 to be 200 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` | PATCH — TC de un viaje TERCERIZADO y cambio de tipo edición conserva/actualiza el snapshot externo (tcExternoPlaca en mayúsculas) sin tocar el catálogo interno | AssertionError: expected 400 to be 200 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/programacion-viajes-tercerizados.test.ts` | PATCH /tms/planes — patchTipoViaje: cambio de tipo aislado un PATCH sin tipoViaje sigue el flujo normal (no entra a patchTipoViaje, no dispara su SELECT dedicado) | AssertionError: expected 400 to be 200 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` | PATCH /tms/planes — editar y dejar el regreso estimado en null regresoEstimado: null con piloto asignado no da 400 y guarda NULL (sin inventar una hora) | AssertionError: expected 400 to be 200 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` | PATCH /tms/planes — editar y dejar el regreso estimado en null un plan que ya no tenía regreso estimado se puede seguir editando sin exigirlo | AssertionError: expected 400 to be 200 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` | PATCH /tms/planes — editar y dejar el regreso estimado en null al editar sin regreso estimado, se valida la fecha efectiva | TypeError: Cannot read properties of undefined (reading 'sql') |
| `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` | PATCH /tms/planes — editar y dejar el regreso estimado en null editar y dejar null conserva la validación por empresa y excluye al propio plan | TypeError: Cannot read properties of undefined (reading 'sql') |
| `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` | PATCH /tms/planes — editar y dejar el regreso estimado en null editar y conflicto con un viaje abierto de OTRO plan del mismo piloto: 409 | AssertionError: expected 400 to be 409 // Object.is equality |
| `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` | identidad de personal por empleado — POST y PATCH usan la misma regla PATCH: al mover el viaje, el piloto (personal 12, empleado 55) choca con un viaje donde el mismo empleado es Auxiliar (personal 10): 409 | AssertionError: expected 400 to be 409 // Object.is equality |

## Archivos finales del PR (25)

Manifest del diff contra la base exacta, limitado a Costeo/Ajustes y sus pruebas:

```text
docs/COTIZACIONES-COSTEO-EXCEL-2026.md
package-lock.json
package.json
sql/migrate-2026-10-cotizaciones-costeo-excel.sql
sql/preflight-2026-10-cotizaciones-costeo-excel.sql
sql/schema.sql
src/components/tms/cotizacion-ajustes-client.test.ts
src/components/tms/cotizacion-ajustes-client.tsx
src/components/tms/cotizacion-costeo-panel.test.ts
src/components/tms/cotizacion-costeo-panel.tsx
src/lib/tms/cotizacion-costeo-ajustes.test.ts
src/lib/tms/cotizacion-costeo-ajustes.ts
src/lib/tms/cotizacion-costeo-db.test.ts
src/lib/tms/cotizacion-costeo-db.ts
src/lib/tms/cotizacion-costeo-excel-campos.ts
src/lib/tms/cotizacion-costeo-excel.test.ts
src/lib/tms/cotizacion-costeo-excel.ts
src/lib/tms/cotizacion-costeo-servicio.test.ts
src/lib/tms/cotizacion-costeo-servicio.ts
src/lib/tms/cotizacion-costeo-ui.test.ts
src/lib/tms/cotizacion-costeo-ui.ts
src/lib/tms/cotizacion-costeo.test.ts
src/lib/tms/cotizacion-costeo.ts
src/lib/tms/cotizacion-perfiles-restauracion-sql.test.ts
src/lib/tms/cotizaciones-costeo-sql.test.ts
```
