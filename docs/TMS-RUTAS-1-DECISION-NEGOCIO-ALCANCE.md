# TMS-RUTAS-1-DECISION-NEGOCIO-ALCANCE

Ticket de **solo documentación y decisiones de negocio**. No se escribió
código, no se ejecutó SQL, no se modificó ningún esquema, no se creó
ningún endpoint ni UI, no se eligió algoritmo ni proveedor, no se tocó
producción. Todo lo que sigue es un cuestionario y una clasificación de
decisiones — ninguna respuesta se inventó.

## 1. Objetivo

Documentar las decisiones de negocio necesarias para definir el alcance
real del futuro módulo de optimización de rutas, antes de tomar
cualquier decisión técnica de arquitectura, esquema o algoritmo.

## 2. Contexto confirmado (base: no se reabre nada de esto)

Este ticket parte de dos discoveries ya mergeados y **no reabre ninguna
de sus conclusiones técnicas**:

- [PRICESMART-INTEGRACION-0-DISCOVERY-CONTRATO-DATOS](./PRICESMART-INTEGRACION-0-DISCOVERY-CONTRATO-DATOS.md)
- [TMS-RUTAS-0-DISCOVERY-DATOS-OPTIMIZACION](./TMS-RUTAS-0-DISCOVERY-DATOS-OPTIMIZACION.md)

Hallazgos confirmados que se dan por establecidos:

- No hay coordenadas estructuradas para destinos TMS (ni en
  `tms_lugares`, ni en `tms_cliente_ubicaciones`, ni en las paradas de
  solicitud/plan).
- No hay capacidad numérica estructurada (`flota_vehiculos.capacidad`
  es texto libre).
- No hay peso/volumen por pedido.
- No hay ventanas horarias por entrega (solo puntos de tiempo).
- No existe routing por carretera (ninguna integración de mapas/rutas).
- Sí existe disponibilidad/conflictos de piloto/unidad/auxiliar, sólida
  y reutilizable (`primerConflictoTraslape()` y módulos relacionados).
- La cardinalidad pedido↔entrega↔ruta sigue pendiente del contrato de
  PriceSmart.
- No está decidido dónde vivirán las coordenadas (4 modelos posibles
  identificados, ninguno elegido).

Este ticket **no investiga nada técnico nuevo** — parte de esos
hallazgos y los convierte en preguntas concretas para negocio.

## 3. Cuestionario completo

Preguntas agrupadas por tema, para Operaciones y/o gerencia. Ninguna
tiene respuesta todavía — ver matriz de decisiones (§4).

### A. Rutas

1. ¿El sistema debe solamente ordenar las entregas de una ruta ya
   definida o también decidir qué pedidos van juntos?
2. ¿El sistema debe decidir cuántas rutas crear?
3. ¿El sistema debe decidir qué unidad utilizar?
4. ¿Debe proponer piloto y auxiliares o eso seguirá siendo decisión
   exclusiva de Operaciones?
5. ¿Operaciones siempre debe aprobar una ruta antes de que se convierta
   en plan real?
6. ¿Se permite modificar manualmente una ruta propuesta?
7. Si Operaciones modifica una ruta optimizada, ¿la versión manual pasa
   a ser la definitiva?

### B. Punto de inicio / fin

8. ¿Las rutas normalmente comienzan siempre en una bodega/CD conocido?
9. ¿Puede haber más de un punto de carga en una misma jornada?
10. ¿La ruta debe terminar en el último destino o debe regresar a una
    bodega/base?
11. ¿Necesitamos optimizar también el desplazamiento inicial de la
    unidad hasta el punto de carga?
12. ¿Necesitamos optimizar el regreso de la unidad después de la última
    entrega?

### C. Capacidad

13. ¿La capacidad del vehículo debe limitar la asignación de pedidos?
14. ¿Qué unidad de capacidad utiliza realmente Operaciones? (peso,
    volumen, pallets, cajas/bultos, combinación de varias)
15. ¿PriceSmart u otros clientes proporcionarán esos datos?
16. ¿Actualmente Operaciones conoce la capacidad real de cada vehículo?
17. ¿Puede una ruta llevar pedidos de distintos tipos de carga
    incompatibles?
18. ¿Existen restricciones por tipo de vehículo?

### D. Horarios / ventanas

19. ¿Los clientes manejan hora exacta o ventana de entrega?
20. ¿La ventana horaria es obligatoria para todos los pedidos o solo
    para algunos clientes?
21. ¿Existe tolerancia antes/después de la ventana?
22. ¿Cuánto tarda normalmente una entrega?
23. ¿Ese tiempo depende del cliente, destino, volumen o tipo de carga?
24. ¿Existe una hora máxima para terminar una ruta?
25. ¿Se deben respetar horarios laborales de piloto/auxiliar?
26. ¿Puede una ruta continuar al día siguiente?

### E. Geografía

27. ¿Operaciones puede capturar coordenadas manualmente?
28. ¿Prefieren que el sistema geocodifique automáticamente una
    dirección?
29. ¿Se deben geocodificar las direcciones históricas o solo las
    nuevas?
30. ¿Existen destinos frecuentes que deberían guardarse como
    ubicaciones permanentes?
31. ¿Existen destinos que cambian en cada pedido y no deberían
    guardarse en catálogo?
32. ¿Se necesita visualizar la ruta propuesta en un mapa antes de
    aprobarla?

### F. Objetivo del optimizador

33. ¿Qué debe optimizar primero el sistema? (menor distancia, menor
    tiempo, menor costo, mayor cantidad de entregas, cumplimiento de
    horarios, menor número de unidades, combinación de varios)
34. Si hay conflicto entre menor distancia y entrega puntual, ¿qué
    tiene prioridad?
35. ¿La prioridad de un cliente/pedido puede alterar la ruta?
36. ¿Existe algún cliente que siempre deba atenderse primero?

### G. Momento de optimización

37. ¿Las rutas se preparan una vez al día?
38. ¿En qué horario normalmente se reciben los pedidos?
39. ¿Hasta qué hora se pueden agregar pedidos a una ruta?
40. ¿El sistema debe recalcular cuando llega un pedido nuevo?
41. ¿Se deben reoptimizar rutas que ya fueron aprobadas?
42. ¿Qué pasa si una ruta ya salió y aparece un pedido urgente?

### H. Restricciones operativas

43. ¿Hay zonas a las que ciertos vehículos no pueden entrar?
44. ¿Hay restricciones por peso/tamaño en ciertas áreas?
45. ¿Hay horarios de circulación restringida?
46. ¿Existen clientes que requieren cierto tipo de unidad?
47. ¿Existen clientes que requieren auxiliar obligatorio?
48. ¿Hay número máximo de entregas por viaje?
49. ¿Hay máximo de kilómetros o duración permitida por ruta?
50. ¿Hay restricciones especiales de seguridad?

### I. Resultado esperado

51. ¿Qué debe mostrar una ruta propuesta? Como mínimo analizar: pedidos
    incluidos, orden de paradas, distancia estimada, tiempo estimado,
    hora estimada por parada, unidad propuesta, piloto/auxiliares
    propuestos, alertas/restricciones, cumplimiento estimado de
    ventanas.
52. ¿Operaciones debe poder aprobar/rechazar la propuesta?
53. ¿Debe guardarse quién aprobó la ruta?
54. ¿Debe guardarse la ruta original propuesta y la versión modificada
    por Operaciones para auditoría?

## 4. Matriz de decisiones

**Ninguna respuesta se inventó** — las 54 preguntas quedan `PENDIENTE`
por diseño de este ticket (es exactamente lo que se le está pidiendo a
negocio que resuelva). El `IMPACTO` es una estimación cualitativa de qué
tan bloqueante es cada una para poder avanzar al siguiente ticket
técnico, no una respuesta a la pregunta.

| # | Decisión | Respuesta | Estado | Impacto |
|---|---|---|---|---|
| 1 | Ordenar vs. también agrupar pedidos | — | PENDIENTE | Alto — define si alcanza MVP A o hace falta B/C |
| 2 | Sistema decide cuántas rutas crear | — | PENDIENTE | Alto — mismo eje que #1 |
| 3 | Sistema decide qué unidad usar | — | PENDIENTE | Alto — determina si hace falta capacidad/disponibilidad de unidad en el optimizador o solo en la validación posterior |
| 4 | Sistema propone piloto/auxiliares | — | PENDIENTE | Medio — la validación de traslape ya existe independientemente de quién proponga |
| 5 | Aprobación obligatoria de Operaciones | — | PENDIENTE | Alto — afecta si "rutas propuestas" es un estado intermedio real o solo informativo |
| 6 | Permitir modificación manual de ruta propuesta | — | PENDIENTE | Medio — afecta UI y trazabilidad |
| 7 | Versión manual pasa a ser definitiva | — | PENDIENTE | Medio — mismo eje que #6/#54 |
| 8 | Rutas siempre inician en bodega/CD conocido | — | PENDIENTE | Alto — resuelve directamente si la base física de la unidad (TMS-RUTAS-0, §5/§6) es necesaria |
| 9 | Más de un punto de carga por jornada | — | PENDIENTE | Medio |
| 10 | Ruta termina en último destino o regresa a base | — | PENDIENTE | Medio — afecta cálculo de "fin de ruta" |
| 11 | Optimizar desplazamiento inicial de la unidad | — | PENDIENTE | Alto — condiciona si hace falta base física de unidad (ver #8) |
| 12 | Optimizar regreso tras última entrega | — | PENDIENTE | Medio |
| 13 | Capacidad limita asignación de pedidos | — | PENDIENTE | Alto — define si el problema es CVRP o VRP simple |
| 14 | Unidad de capacidad real usada por Operaciones | — | PENDIENTE | Alto — condiciona qué estructura de datos capturar |
| 15 | PriceSmart proveerá peso/volumen | — | PENDIENTE | Alto — **depende de PriceSmart**, ver §7 |
| 16 | Operaciones conoce capacidad real de cada vehículo hoy | — | PENDIENTE | Alto — si no la conoce, no hay dato limpio de dónde partir aunque se agregue la columna |
| 17 | Cargas incompatibles en una misma ruta | — | PENDIENTE | Medio |
| 18 | Restricciones por tipo de vehículo | — | PENDIENTE | Bajo/Medio |
| 19 | Hora exacta vs. ventana de entrega | — | PENDIENTE | Alto — define si aplica VRPTW |
| 20 | Ventana obligatoria para todos o solo algunos clientes | — | PENDIENTE | Medio |
| 21 | Tolerancia antes/después de ventana | — | PENDIENTE | Medio |
| 22 | Tiempo típico de una entrega | — | PENDIENTE | Medio — insumo de "tiempo de servicio" |
| 23 | Ese tiempo depende de cliente/destino/volumen/carga | — | PENDIENTE | Bajo/Medio |
| 24 | Hora máxima para terminar una ruta | — | PENDIENTE | Medio |
| 25 | Respetar horarios laborales de piloto/auxiliar | — | PENDIENTE | Medio — TMS-RUTAS-0 ya señaló que esto no está confirmado que TMS lo consulte hoy |
| 26 | Ruta puede continuar al día siguiente | — | PENDIENTE | Bajo/Medio |
| 27 | Operaciones puede capturar coordenadas manualmente | — | PENDIENTE | Alto — alternativa a geocoding automático |
| 28 | Preferencia por geocodificación automática | — | PENDIENTE | Alto — condiciona TMS-RUTAS-2 |
| 29 | Geocodificar histórico o solo nuevas direcciones | — | PENDIENTE | Medio |
| 30 | Destinos frecuentes como ubicaciones permanentes | — | PENDIENTE | Alto — insumo directo para TMS-RUTAS-3 (dónde viven las coordenadas) |
| 31 | Destinos variables que no deben catalogarse | — | PENDIENTE | Alto — mismo eje que #30 |
| 32 | Visualizar ruta en mapa antes de aprobar | — | PENDIENTE | Medio — UI, no bloquea el motor en sí |
| 33 | Criterio principal de optimización | — | PENDIENTE | Alto — define función objetivo |
| 34 | Prioridad ante conflicto distancia vs. puntualidad | — | PENDIENTE | Alto |
| 35 | Prioridad de cliente/pedido altera la ruta | — | PENDIENTE | Medio |
| 36 | Cliente que siempre se atiende primero | — | PENDIENTE | Bajo/Medio |
| 37 | Rutas se preparan una vez al día | — | PENDIENTE | Alto — define arquitectura batch vs. tiempo real |
| 38 | Horario habitual de recepción de pedidos | — | PENDIENTE | Medio |
| 39 | Hora límite para agregar pedidos a una ruta | — | PENDIENTE | Medio |
| 40 | Recalcular al llegar un pedido nuevo | — | PENDIENTE | Alto — mismo eje que #37 |
| 41 | Reoptimizar rutas ya aprobadas | — | PENDIENTE | Medio |
| 42 | Pedido urgente con ruta ya en curso | — | PENDIENTE | Medio |
| 43 | Zonas restringidas por tipo de vehículo | — | PENDIENTE | Bajo/Medio |
| 44 | Restricciones de peso/tamaño por área | — | PENDIENTE | Bajo/Medio |
| 45 | Horarios de circulación restringida | — | PENDIENTE | Bajo/Medio |
| 46 | Clientes que exigen tipo de unidad específico | — | PENDIENTE | Bajo/Medio |
| 47 | Clientes que exigen auxiliar obligatorio | — | PENDIENTE | Bajo/Medio |
| 48 | Máximo de entregas por viaje | — | PENDIENTE | Medio |
| 49 | Máximo de km/duración por ruta | — | PENDIENTE | Medio |
| 50 | Restricciones especiales de seguridad | — | PENDIENTE | Bajo |
| 51 | Contenido mínimo de una ruta propuesta | — | PENDIENTE | Alto — define el contrato de salida del optimizador |
| 52 | Aprobar/rechazar propuesta | — | PENDIENTE | Alto — mismo eje que #5 |
| 53 | Registrar quién aprobó | — | PENDIENTE | Medio — auditoría |
| 54 | Guardar ruta original + versión modificada | — | PENDIENTE | Alto — mismo eje que #6/#7, define trazabilidad |

Ninguna fila usa `CONFIRMADO` ni `NO APLICA` todavía — ambos estados
existen como categorías válidas para cuando negocio responda este
cuestionario, no como respuestas que este documento pueda asignar por
sí mismo.

## 5. Opciones de MVP (sin elegir algoritmo ni proveedor)

Tres alcances conceptuales, del más simple al más completo. No se elige
ninguno en este ticket — la elección depende de las respuestas de §4.

### MVP A — Ordenamiento simple

Operaciones ya seleccionó qué pedidos van en la ruta y qué unidad los
lleva; el sistema **solo propone el mejor orden de las paradas** dentro
de esa ruta ya definida.

- **Ventajas**: alcance más pequeño, no requiere resolver agrupación ni
  asignación de unidad — el humano sigue tomando esas decisiones. Es el
  único de los tres que podría funcionar razonablemente bien incluso con
  coordenadas parciales/aproximadas.
- **Requisitos mínimos**: coordenadas de las paradas de la ruta ya
  armada (o, en su defecto, alguna proxy de distancia); no requiere
  capacidad ni ventanas horarias si el negocio no las confirma como
  necesarias.
- **Complejidad relativa**: baja — es esencialmente un TSP (Traveling
  Salesman Problem) de un solo vehículo con un conjunto fijo de puntos,
  el problema de ruteo más simple de los tres.

### MVP B — Agrupación + ruta

El sistema recibe varios pedidos sueltos, **propone cómo agruparlos** en
una o más rutas y **propone el orden de entrega** de cada una;
Operaciones confirma unidad y personal después.

- **Ventajas**: reduce significativamente el trabajo manual de
  Operaciones (ya no arma la ruta a mano, solo confirma recursos);
  entrega valor real de "optimización" sin todavía comprometerse a
  decidir capacidad ni ventanas si esos datos no están confirmados.
- **Requisitos mínimos**: coordenadas de todos los pedidos candidatos;
  algún criterio de agrupación (aunque sea simple, p. ej. por zona/
  cercanía) — depende de §4 preguntas 1-3, 33-36.
- **Complejidad relativa**: media — **AJUSTE PRE-MERGE PR #182 (punto
  2)**: problema tipo VRP / agrupación y ruteo multi-ruta, con múltiples
  vehículos posibles pero sin la capa completa de restricciones
  operativas. No se afirma todavía que la formulación matemática
  definitiva sea un VRP clásico — eso depende de cómo se resuelvan las
  preguntas de agrupación (§3.A.1-3) y objetivo (§3.F), no se fija aquí.

### MVP C — Optimización completa

El sistema considera pedidos, varias unidades, capacidad, ventanas
horarias, disponibilidad de recursos, y decide agrupación + orden +
unidad + personal + restricciones, todo junto.

- **Ventajas**: el resultado más cercano a "automatizar toda la
  planificación"; aprovecha completamente la infraestructura de
  disponibilidad/conflictos ya existente (TMS-RUTAS-0, §4) integrada
  directamente al motor, no solo como validación posterior.
- **Requisitos mínimos**: todos los datos identificados como faltantes
  en TMS-RUTAS-0 (coordenadas, capacidad, ventanas, peso/volumen) deben
  existir y estar confiables — este MVP es el que menos tolera datos
  incompletos.
- **Complejidad relativa**: alta — **AJUSTE PRE-MERGE PR #182 (punto
  3)**: problema tipo VRP con capacidad, ventanas horarias y
  restricciones adicionales de recursos (piloto, auxiliares,
  disponibilidad de personas — no solo vehículos). CVRPTW (Capacitated
  Vehicle Routing Problem with Time Windows) podría ser una formulación
  base razonable para la parte vehículos/capacidad/ventanas, pero por sí
  sola no describe necesariamente todo el problema (la capa de
  disponibilidad/conflictos de personal ya existente en TMS-RUTAS-0, §4,
  no es parte estándar de un CVRPTW) — no se elige ni se considera
  suficiente todavía. Es, de las tres, la que más tiempo de desarrollo y
  más calidad de datos exige.

**No se recomienda ningún MVP todavía.** La elección depende
directamente de cómo se respondan las preguntas 1-3 (alcance de
decisión del sistema), 13-16 (capacidad), 19-21 (ventanas) y 27-31
(coordenadas) de §3/§4.

## 6. Decisiones internas SITSA/Mónaco

Preguntas de §3 que SITSA puede y debe responder por sí misma, sin
depender de ningún cliente externo — todas quedan `PENDIENTE` en la
matriz (§4), pero su resolución no requiere ninguna negociación externa:

- Todo el bloque **A (Rutas)** — 1 a 7: son decisiones de proceso
  interno de Operaciones.
- Todo el bloque **B (Punto de inicio/fin)** — 8 a 12: dependen de cómo
  opera físicamente la flota de SITSA, no de PriceSmart.
- **C.13, C.16, C.17, C.18** (si la capacidad debe limitar, si
  Operaciones conoce la capacidad real hoy, cargas incompatibles,
  restricciones por tipo de vehículo) — internas; **C.14/C.15** dependen
  parcialmente de si el cliente provee el dato (ver §7).
- Todo el bloque **D (Horarios/ventanas)** salvo D.19/D.20 (ver §7) —
  tolerancia, tiempo de servicio, hora máxima de ruta, horarios
  laborales, continuidad al día siguiente son decisiones internas.
- **E.27, E.28, E.29, E.30, E.31, E.32** — cómo SITSA decide capturar/
  gestionar coordenadas es una decisión interna, aunque el **contenido**
  de esas coordenadas para un pedido puntual de PriceSmart dependa del
  contrato (ver §7).
- Todo el bloque **F (Objetivo del optimizador)** — 33 a 36: criterio de
  negocio interno de SITSA.
- Todo el bloque **G (Momento de optimización)** — 37 a 42: proceso
  operativo interno.
- Todo el bloque **H (Restricciones operativas)** — 43 a 50: reglas
  propias de la operación de SITSA (zonas, vehículos, seguridad).
- Todo el bloque **I (Resultado esperado)** — 51 a 54: diseño de
  producto interno.

## 7. Dependencias del contrato PriceSmart

Preguntas que **no se pueden resolver desde este ticket** porque
dependen de información que solo PriceSmart puede confirmar — mismas
preguntas ya identificadas en PRICESMART-INTEGRACION-0 (§12 de ese
documento), re-listadas aquí en el contexto específico del optimizador:

- **Pedido vs. entrega** (cardinalidad, §3.A.1-3 y PRICESMART-
  INTEGRACION-0 §4/§16) — si PriceSmart manda pedidos que SITSA debe
  agrupar, o si cada pedido ya viene con su ruta implícita.
- **Coordenadas** (§3.E) — si PriceSmart provee lat/lng directamente en
  cada pedido, o si SITSA debe geocodificar una dirección de texto.
- **Ventanas horarias** (§3.D.19-21) — si PriceSmart exige una hora
  exacta, un rango, o no exige nada formal.
- **Peso/volumen** (§3.C.15) — si PriceSmart provee esos datos por
  pedido o SITSA tendría que estimarlos/capturarlos aparte.
- **Prioridades** (§3.F.35-36) — si PriceSmart puede marcar un pedido
  como urgente/prioritario.
- **Definición oficial de OTD** (ya señalada en PRICESMART-
  INTEGRACION-0 §10/§17) — relevante aquí porque el criterio de
  optimización (§3.F.33-34) podría necesitar alinearse con cómo
  PriceSmart mide puntualidad, no con un criterio inventado por SITSA.

**No se intenta resolver ninguna de estas aquí** — quedan
explícitamente a la espera de `PRICESMART-INTEGRACION-1-CONTRATO-API`
(ya recomendado y pendiente en el documento anterior, sin iniciar).

## 8. Bloqueadores

- **No hay ninguna respuesta confirmada todavía** — las 54 preguntas
  están en `PENDIENTE`; sin al menos las de impacto "Alto" resueltas, no
  se puede elegir entre MVP A/B/C ni dimensionar ningún ticket técnico
  siguiente con precisión.
- **AJUSTE PRE-MERGE PR #182 (puntos 1 y 4) — geocoding y routing son
  problemas distintos, no uno solo**: geocoding (A, dirección → lat/lng)
  y routing (B, lat/lng → distancia/tiempo real por carretera) dependen
  de decisiones separadas. Si Operaciones prefiere capturar coordenadas
  manualmente (§3.E.27), **podría no hacer falta investigar un
  proveedor de geocoding** — pero **puede seguir haciendo falta**
  investigar un proveedor/motor de **routing o matriz de distancias**,
  porque tener lat/lng no resuelve por sí solo "cuánto tarda ir de A a
  B por carretera" (TMS-RUTAS-0 ya documentó que Haversine es solo línea
  recta, no sustituye esto). Es decir: `TMS-RUTAS-2` puede seguir siendo
  necesario aunque las coordenadas terminen siendo de captura manual —
  ver la condición corregida del siguiente ticket en §10.
- **AJUSTE PRE-MERGE PR #182 (revisión final, punto 1)** — el alcance
  del optimizador (§3.A.1-3) determina la complejidad y el tipo general
  del problema — desde ordenamiento simple hasta agrupación multi-ruta
  con capacidad, ventanas y restricciones adicionales — sin fijar
  todavía la formulación matemática definitiva. Sin esa decisión de
  alcance, cualquier trabajo de diseño de esquema (coordenadas/
  capacidad/ventanas) corre el riesgo de construir estructura que el
  MVP elegido finalmente no necesita.
- **Dependencia externa real**: varias preguntas de impacto "Alto" (§7)
  no las puede resolver SITSA solo — el ticket de contrato con
  PriceSmart (`PRICESMART-INTEGRACION-1-CONTRATO-API`) sigue siendo un
  bloqueador paralelo, no solo de la integración sino también del
  alcance del optimizador si se espera que procese pedidos externos.

## 9. Recomendaciones de orden

1. Resolver primero las preguntas marcadas como impacto **Alto** en §4
   (bloques A, B.8/11, C.13-16, D.19, E.27-31, F.33-34, G.37/40, I.51/52/54)
   — son las que determinan el MVP y la arquitectura general.
2. Las preguntas de impacto Medio/Bajo (tolerancias, restricciones
   específicas de zona/seguridad, horarios de circulación) pueden
   resolverse en paralelo o después, sin bloquear la elección de MVP.
3. Correr en paralelo (no en secuencia forzada) la conversación con
   PriceSmart (§7) — varias respuestas de negocio interno (§6) no
   dependen de esa conversación y pueden avanzar mientras tanto.
4. Una vez resueltas las preguntas de impacto Alto, elegir explícitamente
   uno de los 3 MVP (§5) como alcance del siguiente ciclo de trabajo —
   esa elección debería ser su propio punto de decisión documentado, no
   implícita.

## 10. Siguiente ticket — condicionado a las respuestas

**No se recomienda todavía ninguna migración ni implementación.**

Si las decisiones de negocio permiten avanzar, el siguiente ticket
podría ser:

**TMS-RUTAS-2-COORDENADAS-DISCOVERY-PROVEEDOR**

**AJUSTE PRE-MERGE PR #182 (punto 1) — condición reformulada**: la
versión anterior de este documento condicionaba `TMS-RUTAS-2` a que se
decidiera usar geocoding automático, sugiriendo que la captura manual de
coordenadas podría hacerlo innecesario por completo. Eso trataba
geocoding y routing como si fueran el mismo problema — no lo son (ver
§8):

- **A. Captura/geocoding** — dirección → lat/lng.
- **B. Routing** — lat/lng → distancia/tiempo real por carretera.

`TMS-RUTAS-2` se inicia cuando:

1. esté definido el MVP (A, B o C, §5), y
2. esté definido cómo se obtendrán las coordenadas (captura manual por
   Operaciones, vs. geocoding automático de una dirección, §3.E.27-28),
   y
3. se sepa, con base en 1) y 2), **qué capacidades externas necesita
   realmente ese MVP**: geocoding, routing/matriz de distancias, o
   ambas.

Si las coordenadas terminan siendo de **captura manual**, la parte de
**geocoding** de `TMS-RUTAS-2` podría no ser necesaria — pero la parte
de **routing/matriz de distancias** puede seguir siendo necesaria si
corresponde según el MVP elegido (ninguno de los tres MVP de §5 tiene
hoy una fuente de distancia/tiempo real de carretera; Haversine es solo
un proxy en línea recta, TMS-RUTAS-0 §3.4/§6). **No se elige proveedor
todavía** en ningún caso.

Si las 3 condiciones de arriba **no** están resueltas, `TMS-RUTAS-2`
**no debe iniciarse todavía** — el paso siguiente sería, en cambio,
cerrar la conversación de negocio pendiente (§8/§9) y/o el contrato con
PriceSmart (§7) antes de continuar.

Se mantienen sin cambios: las 54 preguntas siguen `PENDIENTE`, ningún
MVP elegido, la cardinalidad pedido↔entrega↔ruta de PriceSmart sigue
pendiente, las coordenadas siguen sin fuente/tabla canónica decidida, y
cero implementación en cualquier caso.

---

**NO SQL. NO código. NO cambios de esquema. NO producción. NO deploy.**
Este documento es el único entregable de este ticket.
