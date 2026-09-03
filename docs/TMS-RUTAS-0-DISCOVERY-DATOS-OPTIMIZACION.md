# TMS-RUTAS-0-DISCOVERY-DATOS-OPTIMIZACION

Ticket de **solo discovery**. No se implementó ningún algoritmo, no se
instaló ninguna librería de optimización, no se creó ningún endpoint ni
UI, no se ejecutó SQL, no se modificó ningún esquema, no se tocó
producción. Todo lo marcado como "propuesta"/"conceptual" en este
documento es exactamente eso — nada de eso existe hoy en el repositorio.

## 1. Resumen ejecutivo

El sistema hoy modela **correctamente el "qué" y el "cuándo" a nivel de
viaje completo** (quién, con qué unidad, qué día, con qué horario
aproximado) pero **no modela casi nada de lo que un motor de
optimización de rutas necesita a nivel de geometría/capacidad**:

- **Cero coordenadas** en cualquier tabla relacionada con direcciones de
  carga/entrega (`tms_lugares`, `tms_cliente_ubicaciones`,
  `tms_plan_paradas`, `tms_solicitud_paradas`). Las únicas coordenadas
  que existen en todo el repositorio son de **dos dominios completamente
  distintos**: GPS de captura de evidencias (dónde se tomó una foto) y
  geocercas de marcaje de asistencia de RRHH (`ubicaciones_marcaje`) —
  ninguna de las dos representa "dónde queda el destino de una entrega".
- **Cero capacidad estructurada de unidad** — `flota_vehiculos.capacidad`
  es `VARCHAR(80)` de texto libre, no un número utilizable en una
  restricción de capacidad (peso/volumen/pallets).
- **Cero peso/volumen/bultos por pedido o parada.**
- **Cero ventana horaria** — solo existe un punto de tiempo
  (`hora_solicitada`, `hora_carga`, `regreso_estimado`), nunca un rango
  "entre las X y las Y".
- **Cero motor de ruteo/distancia por carretera** — no hay integración
  con Google Maps, Mapbox, OSRM, ni ningún proveedor de rutas. Sí existe,
  reutilizable, una función de **distancia en línea recta** (Haversine,
  `src/lib/rrhh/geocerca.ts`), pero fue construida para geocercas de
  marcaje, no para ruteo, y no sustituye una distancia/tiempo real de
  carretera.

En cambio, **sí existe, y es sólido y reutilizable**, todo lo relacionado
con **disponibilidad y conflictos de recursos** (piloto, auxiliar,
unidad): un módulo ya probado (`disponibilidad-traslapes.ts`) que
determina si un recurso está físicamente ocupado en un intervalo, con
reglas ya afinadas por varias correcciones reales de producción (OPS-4.1,
OPS-4.2a/b). Cualquier motor de optimización futuro debería **reutilizar
ese módulo tal cual** para la restricción de disponibilidad de recursos,
no reimplementarla.

**Conclusión de tipo de problema** (sin elegir algoritmo, ticket sección
10): con los datos actuales, y una vez agregadas coordenadas/capacidad/
ventanas (que no existen), el problema se parece a un **VRPTW (Vehicle
Routing Problem with Time Windows)** con restricción de capacidad — pero
hoy, sin esos datos, ni siquiera un TSP/VRP más simple (sin ventanas) es
resoluble de forma realista, porque falta el insumo más básico: **dónde
está cada punto en el mapa**.

## 2. Tablas/modelos revisados

| Tabla/módulo | Rol | Evidencia |
|---|---|---|
| `tms_solicitudes_cliente` | Pedido del cliente, pendiente de revisión/conversión | `sql/schema.sql:850-880` |
| `tms_solicitud_paradas` | Paradas de un pedido (Carga/Entrega/Descarga) | `sql/schema.sql:882-896` |
| `tms_planes_viaje` | Viaje real ya programado | `sql/schema.sql:601-657` |
| `tms_plan_paradas` | Paradas de un viaje ya programado | `src/lib/flota/schema.ts:538-547` |
| `tms_cliente_ubicaciones` | Direcciones guardadas por cliente (paradas frecuentes) | `sql/schema.sql:737-752` |
| `tms_lugares` | Catálogo de lugares (carga/descarga) | `sql/schema.sql:562-569` |
| `clientes` / `tms_clientes` | Catálogo de clientes (general y TMS) | `sql/schema.sql:545-560`, `src/lib/clientes/repository.ts` |
| `tms_unidades` / `flota_vehiculos` | Unidad TMS / vehículo real de Flota | `sql/schema.sql:571-588`, `sql/schema.sql:899-929` |
| `tms_personal` | Piloto/Auxiliar (catálogo operativo TMS) | `sql/schema.sql:590-599` |
| `src/lib/operaciones/disponibilidad.ts` | Disponibilidad de vehículos (taller/en ruta/inactivo) | — |
| `src/lib/operaciones/disponibilidad-personal.ts` | Disponibilidad de piloto/auxiliar (ausencias, otros planes del día) | — |
| `src/lib/tms/disponibilidad-traslapes.ts` | Conflictos reales de traslape piloto/auxiliar/unidad | — |
| `src/lib/rrhh/geocerca.ts` | Distancia Haversine + geocercas de marcaje (dominio distinto) | — |
| `ubicaciones_marcaje` | Coordenadas + radio de sitios de marcaje RRHH (NO de TMS) | `src/lib/rrhh/geocerca.ts:86-118` |

## 3. Datos actuales — qué existe, campo por campo

### 3.1 Pedido/solicitud (sección 1 del ticket)

| Dato pedido por el ticket | ¿Existe? | Dónde |
|---|---|---|
| Origen | Parcial | `tms_solicitud_paradas.tipo='Carga'`/`tms_plan_paradas` — nombre de lugar en texto (`lugar_nombre`), sin coordenadas |
| Destino | Parcial | `tipo='Descarga'`/`'Entrega'` — mismo texto libre, sin coordenadas |
| Múltiples entregas | Sí | `tms_solicitud_paradas`/`tms_plan_paradas` con `orden` — ya soporta N paradas tipo `Entrega` |
| Dirección | Parcial | `lugar_nombre` (texto libre) en las paradas; `tms_cliente_ubicaciones.direccion`/`municipio`/`departamento` cuando la parada referencia una ubicación guardada (`cliente_ubicacion_id`) |
| Coordenadas | **No existe** | Ninguna columna lat/lng en `tms_lugares`, `tms_cliente_ubicaciones`, `tms_plan_paradas`, ni `tms_solicitud_paradas` |
| Fecha | Sí | `tms_solicitudes_cliente.fecha_solicitada` / `tms_planes_viaje.fecha_plan` (DATE) |
| Hora | Sí (un punto, no rango) | `hora_solicitada` / `hora_carga` (VARCHAR/TIME, un solo valor) |
| Ventana horaria | **No existe** | No hay `hora_desde`/`hora_hasta` en ninguna parada; `regreso_estimado` es un único DATETIME a nivel de VIAJE completo, no por parada |
| Prioridad | **No existe** | Ninguna columna de prioridad/urgencia en solicitud ni parada |
| Referencia | Sí | `tms_solicitudes_cliente.referencia_cliente`, `tms_solicitud_paradas.referencia` |
| Observaciones | Sí | `tms_solicitudes_cliente.observaciones` (a nivel de solicitud completa, no por parada) |
| Orden de paradas | Sí | `orden` (TINYINT) en ambas tablas de paradas — **reconstruido por el servidor**, nunca confiado del cliente (`crearSolicitudCliente()`, `src/lib/tms/solicitudes-cliente.ts`) |

`cantidadEntregas` es **derivada** (se cuenta `tipo='Entrega'` al leer), no una columna — ya confirmado en discovery previo (CLIENTE-PORTAL-0).

### 3.2 Unidades (sección 2 del ticket)

| Dato pedido | ¿Existe? | Dónde |
|---|---|---|
| Capacidad de carga | **No estructurado** | `flota_vehiculos.capacidad` es `VARCHAR(80)` — texto libre ("5 ton", "20 pallets", lo que haya escrito quien la registró), no un número usable en una restricción matemática |
| Peso máximo | **No existe** | Ninguna columna numérica |
| Volumen | **No existe** | Ninguna columna |
| Pallets | **No existe** | Ninguna columna |
| Tipo de unidad | Sí | `tms_unidades.tipo` (VARCHAR libre, default `'Camion'`) |
| Disponibilidad | Sí, y robusto | `src/lib/operaciones/disponibilidad.ts` — `estadoDisponibilidad` (`disponible`/`en_taller`/`en_ruta`/`inactivo`), `puedeEnviar` (booleano ya calculado) |
| Estado activo/inactivo | Sí | `flota_vehiculos.activo`, `flota_vehiculos.estado` |
| Restricciones (ej. no circula cierto horario, solo cierto tipo de carga) | **No existe** | Ninguna columna/tabla de restricciones operativas por unidad |
| Empresa | Sí | `empresa_id` en ambas tablas (multiempresa respetado) |
| Placa | Sí | `tms_unidades.placa` / `flota_vehiculos.placa` |
| Ubicación/base | **No existe** | Ninguna columna de "de dónde sale" la unidad — ni base fija ni última posición conocida |
| Horarios (jornada de la unidad) | **No existe** | Nada distinto de lo que ya define el viaje (`hora_carga`) |
| Mantenimiento/bloqueos | Sí | `flota_vehiculos.en_taller`, `fecha_entrada_taller`, `motivo_taller`, `km_actual`/`km_intervalo_servicio`/`km_ultimo_servicio` (mantenimiento preventivo por kilometraje) |

Además: `esPropio`/`compartido` (`disponibilidad.ts`) — una unidad puede
pertenecer a otra empresa del grupo y estar compartida; relevante si el
optimizador algún día debe decidir entre flota propia y compartida.

### 3.3 Pilotos y auxiliares (sección 3 del ticket)

| Dato pedido | ¿Existe? | Dónde |
|---|---|---|
| Piloto / Auxiliar | Sí | `tms_personal` (`tipo`: `'Piloto'`\|`'Auxiliar'`) |
| Disponibilidad | Sí, y robusto | `src/lib/operaciones/disponibilidad-personal.ts` — cruza ausencias/incidencias de RRHH (`empleados`), viaje físicamente abierto ahora mismo, y otros planes del mismo día |
| Empresa | Sí | `tms_personal.empresa_id` |
| Horarios (jornada laboral fija) | **No confirmado para TMS** | RRHH sí tiene concepto de horario teórico (`src/lib/rrhh/horario-teorico.ts`) para nómina/asistencia, pero no hay evidencia de que la asignación de viajes en TMS lo consulte — el único horario que hoy limita una asignación es el intervalo del viaje mismo |
| Asignaciones existentes | Sí | `tms_planes_viaje.piloto_id`/`auxiliar_id` + `tms_plan_auxiliares` (múltiples auxiliares por viaje) |
| Conflictos de horario | Sí, y ya resuelto con precisión | `primerConflictoTraslape()` (§4 abajo) |
| Estados activo/inactivo | Sí | `tms_personal.estado`, más el estado del `empleados` vinculado (`id_empleado`) |
| Relación con unidad o viaje | Sí | FK directas en `tms_planes_viaje` + tabla puente `tms_plan_auxiliares` |

**Mecanismo ya existente y directamente reutilizable para impedir
asignaciones duplicadas/traslapadas** (ver también §4): `tms_personal.id`
es la identidad física real — la validación de traslape trata "piloto" y
"auxiliar" como el mismo tipo de recurso (`buscarConflictoPersonal()`,
`src/lib/tms/disponibilidad-traslapes.ts:156-190`) porque es la misma
persona sin importar el rol que tenga en cada viaje — una persona no
puede estar en dos viajes traslapados sea cual sea su rol en cada uno.

### 3.4 Coordenadas y geolocalización (sección 4 del ticket)

Búsqueda exhaustiva en todo `src/`:

**A) Qué existe:**

- `distanciaMetros()` (Haversine, línea recta) — `src/lib/rrhh/geocerca.ts:7-26`. Función pura, sin dependencias externas, matemáticamente correcta para distancia en línea recta entre dos coordenadas.
- `ubicaciones_marcaje` — tabla con `lat`, `lng`, `radio_m` reales — pero es **exclusiva de geocercas de asistencia RRHH** (verificar que un empleado esté físicamente cerca de un sitio autorizado al marcar entrada/salida). No tiene ninguna relación con clientes, pedidos, ni TMS.
- Coordenadas de **captura de evidencia** — `flota_viaje_evidencias.latitud`/`longitud`, `tms_evidencias.latitud`/`longitud` — GPS del dispositivo en el momento de subir una foto (dónde estaba el piloto cuando tomó la foto), no la dirección planificada de la parada.
- Coordenadas de **marcaje de colaborador** (`src/lib/rrhh/marcajes.ts`, `marcaje-portal-foto.test.ts`) — mismo dominio que geocercas, asistencia de personal, no rutas.

**B) Qué está incompleto:** nada — no hay una integración a medias; lo
que existe (Haversine + geocercas) está completo **para su propósito
original** (asistencia), simplemente ese propósito no es ruteo.

**C) Qué NO existe en absoluto:**

- Coordenadas de direcciones de clientes/lugares/paradas (§3.1).
- Cualquier integración con Google Maps, Mapbox, OpenStreetMap, HERE, o
  cualquier proveedor de geocoding/routing — **cero** ocurrencias en todo
  el repositorio.
- Cálculo de distancia o tiempo **por carretera** (routing real) — solo
  existe distancia en línea recta, y solo en el módulo de geocercas.
- GPS en vivo de una unidad/piloto durante el viaje (tracking en tiempo
  real) — lo que existe es la ubicación de captura de cada evidencia
  puntual, no un stream de posición continuo.

No se propone proveedor definitivo (fuera de alcance de este ticket, ver
ticket sección 4 y sección 10).

## 4. Reglas de programación reutilizables (sección 5 del ticket)

Este es el hallazgo más sólido del discovery — infraestructura real, ya
probada en producción con varias correcciones documentadas (OPS-4.1,
OPS-4.2a, OPS-4.2b), directamente reutilizable por un futuro optimizador:

- **`primerConflictoTraslape()`** (`src/lib/tms/disponibilidad-traslapes.ts:236-267`)
  — dado un intervalo de tiempo y una lista de recursos (piloto/
  auxiliares/unidad), devuelve el primer conflicto real de ocupación.
  Reutilizable tal cual como función de validación de restricción de
  recursos para cualquier ruta que proponga un optimizador, antes de
  confirmarla.
- **`intervaloOcupacionReal()` / `seSolapaConOcupacionReal()`** (mismo
  archivo) — criterio unificado de "¿está este recurso realmente
  ocupado ahora?", distinguiendo viaje planificado vs. viaje físicamente
  en curso sin llegada técnica todavía. Un motor de optimización que
  proponga asignar piloto/unidad a una ruta nueva necesita EXACTAMENTE
  este criterio, no uno reinventado.
- **`GET_LOCK`/`RELEASE_LOCK` por empresa** (`planes/route.ts`, patrón
  `tms_traslape_${empresaId}`) — exclusión mutua real contra condiciones
  de carrera al confirmar una asignación; un optimizador que proponga
  rutas y las confirme en lote debería usar el mismo candado, no uno
  nuevo.
- **`listarDisponibilidadVehiculos()`** (`src/lib/operaciones/disponibilidad.ts`)
  y **`listarDisponibilidadPersonal()`** (`src/lib/operaciones/disponibilidad-personal.ts`)
  — universo de recursos candidatos (ya filtrados por activo/taller/
  ausencias/otros compromisos del día) — el punto de partida natural
  para "qué unidades y personal están disponibles para asignar" antes de
  correr cualquier optimización.
- **`asegurarCodigoPlanUnico()`** (`src/lib/tms/codigo-plan.ts`) —
  generación de código único por plan, reutilizable si el optimizador
  termina generando varios planes de una corrida.
- **`programarSolicitud()`** (`src/lib/tms/solicitudes-cliente-operaciones.ts`)
  — conversión transaccional solicitud→plan, con `SELECT...FOR UPDATE` e
  idempotencia real. **AJUSTE PRE-MERGE PR #181 (punto 1)** — candidato
  fuerte para que una ruta propuesta se convierta en plan real sin
  inventar una segunda vía, pero condicionado a que la cardinalidad
  pedido↔entrega↔ruta (PRICESMART-INTEGRACION-0, §4/§16) resulte
  compatible con la forma actual de `tms_solicitudes_cliente` — ver §7.
- **`guardarParadasPlan()`** (`src/lib/tms/paradas.ts`) — ya soporta
  actualizar/agregar/eliminar paradas de un plan existente de forma
  idempotente (identity-based) — reutilizable si el optimizador necesita
  ajustar el orden de paradas de un plan ya creado.

Lo que **no** existe y sería enteramente nuevo: cualquier lógica de
"cuál es la mejor combinación/orden de paradas" — todo lo de arriba
resuelve "¿es válida esta asignación?", nunca "¿cuál es la asignación
óptima?".

## 5. Input mínimo de un futuro optimizador (sección 6 del ticket)

Sin implementar — clasificación conceptual de qué necesitaría un motor
de rutas, separado por obligatoriedad:

### PEDIDO / ENTREGA

| Dato | Clasificación | Estado actual |
|---|---|---|
| Identificador | **Obligatorio** | Existe (`id` de solicitud/parada), aunque no hay `external_order_id` para pedidos externos (ver PRICESMART-INTEGRACION-0) |
| Dirección (texto) | **Obligatorio** | Existe (`lugar_nombre`) |
| Latitud/longitud | **Obligatorio** para cualquier optimización geométrica real | **No existe** |
| Ventana horaria | Deseable (obligatorio si se quiere VRPTW real) | **No existe** |
| Peso | Deseable (obligatorio si hay restricción de capacidad) | **No existe** |
| Volumen | Deseable (obligatorio si hay restricción de capacidad) | **No existe** |
| Prioridad | Opcional | **No existe** |
| Tiempo de servicio (cuánto tarda la descarga en el sitio) | Deseable | **No existe** (ni siquiera un estimado fijo por tipo de parada) |

### UNIDAD

| Dato | Clasificación | Estado actual |
|---|---|---|
| Capacidad | **Obligatorio** si hay restricción de capacidad | **No estructurado** (texto libre) |
| Tipo | Deseable | Existe |
| Disponibilidad | **Obligatorio** | Existe, robusto |
| Restricciones (p. ej. no entra a cierta zona) | Opcional | **No existe** |

### OPERACIÓN

| Dato | Clasificación | Estado actual |
|---|---|---|
| Punto de inicio operativo de la ruta | **Obligatorio** | Existe, parcialmente — hoy es la primera parada tipo Carga del viaje (p. ej. el CD de PriceSmart), no una propiedad de la unidad. **AJUSTE PRE-MERGE PR #181 (punto 3)**: si todas las rutas parten de un punto de carga fijo conocido (bodega/CD), esa parada Carga alcanza como nodo inicial del problema — no hace falta conocer dónde estaba la unidad antes |
| Base/posición física previa de la unidad | **Condicional** — solo si el optimizador también decide el desplazamiento del vehículo hasta el punto de carga | **No existe** ningún concepto de "de dónde sale la unidad" separado del primer punto de carga del viaje. No se trata como obligatorio universal: depende del alcance que se confirme en §9 |
| Fin de ruta | Deseable | Parcial — `regreso_estimado` es un estimado a nivel de viaje, no calculado desde una ruta real |
| Horario laboral (jornada máxima) | Deseable | No confirmado que TMS lo consulte (§3.3) |
| Máximo de entregas por viaje | Opcional | **No existe** ningún límite modelado |
| Máximo de km/tiempo | Opcional | **No existe** |

## 6. Matriz de disponibilidad (sección 7 del ticket)

| Dato | Existe | Dónde | Calidad | Falta |
|---|---|---|---|---|
| Latitud/longitud destino | No | — | — | Falta la estructura Y falta decidir dónde vive (ver AJUSTE PRE-MERGE PR #181, punto 2, abajo) + un proceso de geocoding (proveedor sin elegir) |
| Latitud/longitud origen | No | — | — | Igual que destino |
| Dirección en texto | Sí | `tms_*_paradas.lugar_nombre`, `tms_cliente_ubicaciones.direccion` | Parcial (texto libre, sin normalizar) | Confirmar si alcanza para geocoding automático o hace falta captura estructurada |
| Múltiples entregas por viaje | Sí | `tms_plan_paradas`/`tms_solicitud_paradas`, `orden` | Completa | — |
| Ventana horaria por parada | No | — | — | Nueva estructura; hoy solo hay un punto de tiempo a nivel de viaje |
| Peso/volumen por entrega | No | — | — | Nueva estructura |
| Capacidad de unidad (numérica) | No | `flota_vehiculos.capacidad` existe pero es texto libre | Insuficiente | Migrar a columnas numéricas si se confirma la necesidad |
| Tipo de unidad | Sí | `tms_unidades.tipo`/`flota_vehiculos` | Completa para clasificar, no para restricción numérica | — |
| Disponibilidad de unidad | Sí | `disponibilidad.ts` | Completa y robusta | — |
| Disponibilidad de piloto/auxiliar | Sí | `disponibilidad-personal.ts` | Completa y robusta | — |
| Conflictos de traslape (piloto/auxiliar/unidad) | Sí | `disponibilidad-traslapes.ts` | Completa, ya corregida varias veces en producción | — |
| Mantenimiento/bloqueo de unidad | Sí | `flota_vehiculos.en_taller`, kilometraje | Completa | — |
| Base/ubicación fija de unidad | No | — | — | **AJUSTE PRE-MERGE PR #181 (punto 3)**: no existe el concepto de "de dónde sale la unidad" separado del primer punto de carga del viaje — pero no se trata como obligatorio universal: si toda ruta parte de un punto de carga conocido (Carga inicial), ese nodo alcanza; la base física de la unidad solo hace falta si el optimizador también decide el desplazamiento previo del vehículo hasta la carga |
| Distancia línea recta | Sí | `distanciaMetros()` (Haversine) | Completa mecánicamente, pero para otro dominio (geocercas), no probada/usada para rutas | Evaluar reutilizar como proxy inicial, documentando que NO es distancia real de carretera |
| Distancia/tiempo por carretera | No | — | — | Requiere proveedor externo de ruteo, sin elegir |
| Prioridad de pedido | No | — | — | Nueva columna si se confirma que el negocio la necesita |
| Historial de rutas óptimas pasadas | No | — | — | No hay ningún registro de "esta secuencia de paradas fue la elegida por optimización" — todo el `orden` actual es el que decidió un humano al crear la solicitud/plan |

**AJUSTE PRE-MERGE PR #181 (punto 2) — dónde vivirían las coordenadas: pendiente, no decidido en este documento.** La versión anterior de este
documento proponía agregar lat/lng directamente a `tms_lugares` y
`tms_cliente_ubicaciones`. Se retira esa recomendación por prematura —
una coordenada podría corresponder a al menos 4 modelos distintos, y
elegir uno ahora sería inventar arquitectura sin el contrato real:

- **A)** ubicación permanente/catalogada del cliente (`tms_cliente_ubicaciones`) — tendría sentido si el cliente reutiliza las mismas direcciones una y otra vez.
- **B)** destino puntual de un pedido — PriceSmart podría mandar una coordenada específica por pedido sin que ese destino deba convertirse en una ubicación permanente/catalogada.
- **C)** parada normalizada (`tms_plan_paradas`/`tms_solicitud_paradas`) — coordenada resuelta en el momento, ligada a la parada, no a un catálogo de cliente.
- **D)** otro modelo intermedio no identificado todavía (p. ej. una tabla propia de "direcciones geocodificadas", reutilizable entre catálogo y pedido puntual).

El hallazgo que **sí** se mantiene firme es: **faltan coordenadas
estructuradas para los destinos, en cualquiera de sus formas posibles**
— la tabla/fuente canónica exacta queda pendiente de diseño (ver §10).

## 7. Arquitectura conceptual (sección 8 del ticket)

Sin código — flujo propuesto, marcando qué se reutiliza y qué sería
nuevo.

**AJUSTE PRE-MERGE PR #181 (punto 1)** — la versión anterior de este
documento afirmaba que una "ruta propuesta" pasa a
`tms_solicitudes_cliente` y reutiliza `programarSolicitud()`/la pantalla
de revisión **tal cual**. Eso todavía no está confirmado: PRICESMART-
INTEGRACION-0 dejó explícitamente pendiente la cardinalidad
pedido↔entrega↔ruta (varios pedidos externos podrían agruparse en una
sola ruta propuesta) — si eso se confirma, `tms_solicitudes_cliente`
podría no tener hoy suficiente trazabilidad para representar "esta
solicitud viene de estos N pedidos externos" sin alguna extensión. Se
agrega una etapa nueva, explícitamente sin resolver, entre "rutas
propuestas" y "revisión Operaciones":

```
pedidos/entregas candidatos
  (NUEVO: origen puede ser Portal del Cliente actual — ya existe — o una
   futura integración externa tipo PriceSmart — ver
   PRICESMART-INTEGRACION-0, todavía sin contrato)
       │
       ▼
normalización
  (NUEVO — hoy no existe: resolver direcciones a coordenadas
   [geocoding, proveedor sin elegir], completar/validar campos
   faltantes — ventana horaria, peso/volumen si se confirma que hacen
   falta)
       │
       ▼
optimizador
  (100% NUEVO — no existe ningún algoritmo de ruteo en el repo hoy;
   consume: pedidos normalizados + disponibilidad de recursos vía
   listarDisponibilidadVehiculos()/listarDisponibilidadPersonal()
   [REUTILIZABLE] + distancia [Haversine REUTILIZABLE como proxy, o un
   proveedor de ruteo real NUEVO, sin elegir])
       │
       ▼
rutas propuestas
  (NUEVO concepto — no existe hoy ninguna representación de "propuesta
   de ruta" separada de una solicitud/plan ya confirmado)
       │
       ▼
persistencia/representación — PENDIENTE DE DECISIÓN
  (AJUSTE PRE-MERGE PR #181, punto 1: `tms_solicitudes_cliente` +
   `programarSolicitud()` son CANDIDATOS FUERTES a reutilización — la
   forma de la tabla, la validación de mínimo 1 entrega, la conversión
   transaccional a plan, todo encaja conceptualmente — pero NO se afirma
   aquí que sean reutilizables "tal cual" sin extensión. La decisión
   depende de la cardinalidad real pedido↔entrega↔ruta y del contrato de
   PriceSmart [PRICESMART-INTEGRACION-0, §4/§16] — si una ruta propuesta
   siempre corresponde a una única solicitud, sí bastaría tal cual; si
   puede agrupar varios pedidos externos, hace falta antes decidir cómo
   se representa esa relación N:1, algo que ningún ticket ha diseñado
   todavía.)
       │
       ▼
revisión Operaciones
  (REUTILIZABLE, con la misma salvedad de arriba — pantalla ya existente
   /e/[slug]/tms/solicitudes-clientes, CLIENTE-PORTAL-3 — Operaciones ya
   revisa/toma-en-revisión/rechaza/programa solicitudes; una "ruta
   propuesta" se le mostraría con una mecánica equivalente, marcando su
   origen, una vez resuelta la etapa anterior)
       │
       ▼
plan TMS
  (REUTILIZABLE, con la misma salvedad — `programarSolicitud()`,
   conversión transaccional solicitud→plan ya existente y probada, ES
   CANDIDATO FUERTE pero no confirmado "tal cual" hasta resolver la
   cardinalidad)
       │
       ▼
asignación piloto/unidad/auxiliar
  (REUTILIZABLE tal cual — esta etapa SÍ es independiente de la
   cardinalidad de arriba: `primerConflictoTraslape()` +
   GET_LOCK/RELEASE_LOCK ya validan y protegen esta asignación sin
   importar cuántos pedidos externos representó la solicitud; el
   optimizador puede PROPONER una asignación, pero la validación final
   de que no hay traslape sigue siendo la misma de siempre, nunca una
   paralela)
       │
       ▼
ejecución
  (REUTILIZABLE tal cual — Portal del Piloto, evidencias, cierre —
   ninguna de estas piezas necesita cambiar para que un plan haya
   nacido de un optimizador en vez de una asignación manual)
```

**Resumen**: de las 9 etapas, **2 (asignación de recursos, ejecución)
se reutilizan tal cual sin ninguna salvedad**; **3 (persistencia/
representación, revisión Operaciones, plan TMS) tienen candidatos
fuertes de reutilización pero condicionados a resolver primero la
cardinalidad pedido↔entrega↔ruta**; **2 son completamente nuevas**
(normalización con geocoding, el optimizador en sí); y **2 más**
(pedidos candidatos, rutas propuestas) son conceptos nuevos construidos
sobre infraestructura parcialmente existente. La etapa de "validación"
de la versión anterior de este documento se fusionó dentro de
"normalización" para evitar sugerir una secuencia más definida de la que
realmente se puede afirmar hoy.

## 8. Riesgos (sección 9 del ticket)

- **Direcciones sin coordenadas**: el riesgo más grande y más seguro de
  ocurrir — todo el historial de `lugar_nombre`/`direccion` es texto
  libre no normalizado, escrito por humanos en momentos distintos
  ("Bodega PriceSmart", "bodega price smart zona 4", etc.) — el
  geocoding automático fallará o dará resultados incorrectos para una
  fracción real de esos textos.
- **Datos incompletos históricos**: cualquier intento de "aprender" de
  rutas pasadas (§6, última fila) parte de cero — no hay ningún dato
  histórico de qué ruta fue mejor que otra, todo lo que existe es la
  ruta que un humano decidió.
- **Unidades sin capacidad estructurada**: si el negocio confirma que
  necesita restricción de capacidad, hoy no hay ningún dato limpio de
  donde partir — habría que recapturar `capacidad` para toda la flota.
- **Ventanas horarias ausentes**: sin ellas, un VRPTW real no es
  posible — el optimizador solo podría trabajar con fecha+un punto de
  hora, no con "entre las 8 y las 10".
- **Duplicados**: ya cubierto en detalle por PRICESMART-INTEGRACION-0
  (mismo hallazgo aplica aquí si el optimizador recibe pedidos de
  múltiples fuentes) — la garantía real siempre debe ser un `UNIQUE` de
  base de datos, nunca solo un chequeo aplicativo.
- **Pedidos incompatibles entre sí**: sin peso/volumen/tipo de carga
  modelado, el optimizador no puede detectar que dos pedidos no caben
  juntos en la misma unidad — agruparía a ciegas.
- **Restricciones no modeladas**: horarios de circulación restringida,
  zonas prohibidas para cierto tipo de vehículo, preferencias de cliente
  sobre franja horaria — ninguna existe hoy; un optimizador que las
  ignore podría proponer rutas operativamente inviables aunque
  matemáticamente válidas.
- **Rutas imposibles**: sin distancia/tiempo real de carretera (solo
  línea recta disponible), el optimizador podría proponer secuencias que
  en el mapa se ven razonables pero que en la carretera real son
  absurdas (ríos, montañas, calles de un solo sentido, tráfico).
- **Conflictos de asignación**: mitigado — este es el único riesgo de la
  lista que YA tiene una defensa real y probada (§4), siempre que el
  optimizador pase por `primerConflictoTraslape()` antes de confirmar
  cualquier propuesta, nunca la ignore por "ya lo calculé yo".
- **Confundir distancia línea recta con distancia real**: riesgo
  específico de reutilizar `distanciaMetros()` sin dejarlo documentado —
  dos puntos separados por 500m en línea recta pueden estar a varios
  kilómetros por la única carretera real que los conecta.

## 9. Decisiones pendientes (sección 10 del ticket — sin elegir algoritmo)

**No se decide aquí** entre heurísticas propias, OR-Tools, un proveedor
externo de VRP, o qué API de mapas usar — eso requiere primero tener los
datos base (coordenadas, capacidad, ventanas) y una decisión de negocio
sobre alcance.

Lo único que se puede decir, según los datos disponibles **si algún día
existieran completos**: el problema descrito por el negocio (varios
pedidos, varias unidades, restricciones de tiempo y posiblemente
capacidad) tiene la forma general de un **VRP (Vehicle Routing Problem)**,
que se vuelve **VRPTW** en cuanto existan ventanas horarias reales, y
**CVRP** (o **CVRPTW**) en cuanto exista capacidad estructurada. Hoy, sin
coordenadas, **ni siquiera la versión más simple es resoluble** con datos
reales — es un problema de calidad/existencia de datos antes que un
problema de elección de algoritmo.

Decisiones de negocio que tampoco se pueden resolver técnicamente:

1. ¿El negocio realmente necesita restricción de capacidad (peso/
   volumen/pallets), o en la práctica cada unidad siempre alcanza para
   los pedidos que se le asignan?
2. ¿Los clientes (PriceSmart u otros) van a proveer ventanas horarias
   reales, o eso tendría que negociarse/inventarse como SLA interno?
3. ¿Vale la pena invertir en geocoding automático de todo el historial
   de direcciones, o el negocio prefiere que Operaciones capture
   coordenadas manualmente hacia adelante (sin migrar lo histórico)?
4. ¿El optimizador debe correr en tiempo real (cada vez que llega un
   pedido) o en lotes (una corrida diaria que agrupa lo acumulado)?
   Cambia radicalmente la arquitectura y el presupuesto de cómputo.
5. ¿Hay presupuesto para un proveedor de mapas/ruteo de pago (Google
   Maps/Mapbox tienen costo por consulta), o se espera algo gratuito
   (OSRM autoalojado, OpenStreetMap)?

## 10. Siguientes tickets recomendados

**No** implementar el optimizador ni elegir proveedor todavía — antes
hacen falta, en este orden:

1. **TMS-RUTAS-1-DECISION-NEGOCIO-ALCANCE** — resolver las 5 preguntas
   de negocio de §9 con el dueño del producto/Operaciones. Sin código,
   sin SQL — mismo formato que este ticket.
2. **TMS-RUTAS-2-COORDENADAS-DISCOVERY-PROVEEDOR** (condicionado a que
   §9.3/§9.5 se resuelvan a favor de invertir en geocoding) —
   investigación específica de proveedores de geocoding/ruteo
   (costo, límites de uso, cobertura en Guatemala/región), sin
   integrarlo todavía — un discovery técnico enfocado, no una decisión
   de arquitectura completa.
3. **TMS-RUTAS-3-DISEÑO-MODELO-DATOS-GEO-RESTRICCIONES** (renombrado en
   AJUSTE PRE-MERGE PR #181, punto 2 — antes
   `TMS-RUTAS-3-EXTENSION-ESQUEMA-COORDENADAS`) — solo después de 1) y
   2). **No es un ticket de migración** — es un ticket de **diseño**:
   decidir primero dónde viven conceptualmente coordenadas, ventanas
   horarias, capacidad y restricciones (¿en `tms_cliente_ubicaciones`?
   ¿en la parada misma? ¿en una tabla nueva de "direcciones
   geocodificadas" reutilizable? — ver las 4 opciones de §6), con el
   contrato real de PriceSmart (o de cualquier otra fuente externa) ya
   confirmado. **Solo después** de ese diseño, un ticket técnico
   separado y posterior propondría la migración idempotente concreta
   (revisión SQL antes de ejecutar, mismo patrón que CLIENTE-PORTAL-1B)
   — no se recomienda todavía ninguna migración específica aquí.
4. **TMS-RUTAS-4-OPTIMIZADOR-MVP** — el primer algoritmo real, alcance
   mínimo (posiblemente sin ventanas ni capacidad si el negocio decidió
   en 1) que no las necesita todavía) — recién aquí se elige entre
   heurística propia, OR-Tools u otro enfoque, con los datos reales ya
   disponibles.

Este ticket (TMS-RUTAS-0) y PRICESMART-INTEGRACION-0 son complementarios:
uno investiga los datos internos para optimizar, el otro investiga cómo
entrarían pedidos externos — ambos coinciden en que la cardinalidad
pedido↔entrega↔ruta y las coordenadas son los bloqueos centrales antes de
construir nada.

---

**NO SQL ejecutado. NO código. NO cambios de esquema. NO producción. NO
deploy.** Este documento es el único entregable de este ticket.
