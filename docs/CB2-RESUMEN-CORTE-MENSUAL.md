# Resumen integrado: corte mensual y deduplicación

## Causa raíz

`resumenIntegrado(empresa, mes)` consulta históricos aprobados de la empresa
por registro **o** consumo del mes y CB2 por consumo del mes. Esa lectura puede
incluir históricos que sirven como contexto pero no contribuyen al período.
`consolidarMes` construía las firmas sobre toda esa lectura antes del corte:
un histórico registrado en otro mes podía excluir CB2 sin aportar su importe
al total consultado. Una prueba anterior reproducía ese resultado incorrecto.

## Criterio temporal

- Intervalo de presentación: primer día del mes incluido y primer día del
  siguiente mes excluido (`[desde, hasta)`).
- Histórico aprobado: contribuye por **fecha de registro** (`creado_at`). Su
  fecha de consumo identifica la operación, pero no cambia su mes de presentación.
- CB2: contribuye por **fecha de consumo** (`fecha_consumo`), independientemente
  de su fecha de importación/registro.
- Primero se seleccionan los registros que contribuyen al período. Solo con
  ellos se construyen firmas, se evalúan ambigüedades y se suman los totales.
- Solo se excluye CB2 si hay exactamente un histórico y un CB2 con la misma
  firma dentro de ese período. Las coincidencias múltiples o con diferencias
  conservan sus importes y el tratamiento provisional existente.
- La firma conserva proveedor, vehículo, vale normalizado, fecha de consumo,
  galones, precio y monto. Solo permite deduplicación exacta GTQ. USD se suma aparte.
- La función pura recibe operaciones de una sola empresa. El límite de empresa
  se mantiene en las dos consultas parametrizadas de `resumenIntegrado`.

No cambia el texto ni los parámetros de las consultas. No se modifica ningún
registro, esquema, importación, factura o asociación documental.

## Antes y después

Ejemplo: consumo de 10.123456 galones y Q202.469120.

| Histórico | Mes consultado / CB2 | Antes | Después |
| --- | --- | --- | --- |
| Consumo en agosto, registro en septiembre | Agosto | CB2 excluido; total Q0 | CB2 incluido; Q202.46912 |
| Consumo en septiembre, registro en octubre | Septiembre | CB2 excluido; total Q0 | CB2 incluido; Q202.46912 |
| Consumo y registro en agosto | Agosto | Una contribución histórica | Se conserva una contribución histórica |
| Dos históricos idénticos y un CB2 dentro del mes | Mismo mes | Tres contribuciones, provisional | Se conserva ese resultado |

Un histórico fuera del período no provoca una exclusión ni una ambigüedad
mensual. En su mes de registro se presenta por separado según el corte histórico.

## Validación sin bases de datos

- `resumen-corte.test.ts`: agosto/septiembre y septiembre/octubre; ambos órdenes
  de entrada; mes de registro; pareja exacta; múltiples por ambos orígenes;
  candidato adicional fuera de período; firma incompleta; proveedor, vehículo y
  moneda distintos; límites del intervalo; subtotales, `totalGTQ`, `excluidas`,
  `ambiguas`, `provisional`; consultas simuladas para dos empresas.
- `resumen-mensual.test.ts`: regresión de los ocho escenarios existentes,
  actualizando la expectativa que excluía incorrectamente un CB2 del mes.
- `resumen-http.test.ts`: permiso y empresa del guard, y propagación de fallos.
- Los módulos de BD se sustituyen por `vi.mock`; no se ejecutan consultas reales.
- Galones e importes siguen utilizando Decimal, incluyendo la regresión de
  10,000 operaciones y valores de seis decimales.

Resultado local: 26 pruebas aprobadas en esos tres archivos; ESLint de los
archivos afectados y `git diff --check` sin errores. Ejecutadas con las
dependencias disponibles del workspace (Vitest 4.1.11); el lock de main declara
Vitest 4.1.12. No se instalaron dependencias ni se crearon ambientes de prueba.
Como control de regresión, las 16 pruebas nuevas se ejecutaron también contra
el cálculo original de main: cinco fallaron, incluyendo ambos casos de meses
distintos. Después se restauró la corrección y las 26 pruebas pasaron.

## Riesgos residuales

Este es un resumen con criterios temporales distintos por origen, no un libro
contable por devengo. Una misma operación puede presentarse como CB2 en el mes
de consumo y como histórica en otro mes de registro. No deben sumarse meses
para inferir una conciliación global deduplicada. Cambiar ese criterio necesita
una decisión funcional independiente.

Se conserva el tratamiento anterior de datos incompletos, monedas y firmas;
no se deduplica por similitud ni se resuelven ambigüedades automáticamente.
Las pruebas de empresa verifican las consultas y el guard mediante simulaciones;
no certifican datos ni despliegues productivos.
