# PRICESMART-INTEGRACION-0-DISCOVERY-CONTRATO-DATOS

Ticket de **solo discovery**. No se implementó consumo real de API, no se
ejecutó SQL, no se tocó producción. Todo lo marcado como "propuesta" o
"hipotético" en este documento es exactamente eso — nada de eso existe hoy
en el repositorio.

## 0. Resumen ejecutivo

SITSA ya tiene, en producción, la tubería completa desde "un cliente pide
un traslado" hasta "el piloto entrega y sube evidencia":
**Portal del Cliente → `tms_solicitudes_cliente` → conversión a
`tms_planes_viaje` (Programación) → Portal del Piloto (salida/evidencias/
llegada) → seguimiento visible de nuevo en el Portal del Cliente**.
Esa tubería se construyó ticket a ticket (CLIENTE-PORTAL-1 a 4) y ya está
mergeada.

**AJUSTE PRE-MERGE PR #180 (punto 4)** — lo que los datos reales del
sistema confirman es más limitado de lo que decía la versión anterior de
este resumen: existe un cliente `PRICESMART` configurado en TMS, existe
al menos una cuenta de Portal para ese cliente, y existe un plan real
(`PLAN-20260901-005`) que fue generado a partir de al menos una
solicitud/prueba creada en producción. **Eso es evidencia de una
prueba/demo del flujo manual, no una confirmación de que PriceSmart usa
el Portal del Cliente de forma operacional y recurrente.** No se afirma
aquí que "una persona de PriceSmart entra y llena el formulario" como
hecho operativo — solo que el mecanismo manual existe, funciona, y ya se
probó al menos una vez con datos reales de este cliente.

La integración con la API de PriceSmart, en esencia, **no reemplaza esa
tubería — la alimenta desde otro punto de entrada**: en vez de que una
persona llene el formulario del Portal, un adaptador recibiría el pedido
de la API de PriceSmart y crearía (o debería crear) el mismo tipo de
registro que hoy crea `crearSolicitudCliente()`. El resto de la tubería
(revisión, conversión a plan, Programación, piloto, evidencias,
seguimiento) se reutiliza tal cual.

Lo que **falta** para eso, y es el contenido real de este documento:

1. Ningún concepto de "pedido de una API externa" existe hoy — todo
   asume un `usuarioClienteId` humano de una sesión de Portal.
2. No hay `external_order_id` en ningún lado del modelo actual, y
   **AJUSTE PRE-MERGE PR #180 (punto 2)** — todavía no se puede
   determinar en QUÉ tabla/nivel debería vivir, porque no está
   confirmada la cardinalidad real pedido↔solicitud↔plan (ver §4/§16).
3. No hay ningún lugar para guardar el payload crudo que llega de
   PriceSmart (la tabla `auditoria` es texto libre, no estructurada).
4. No existe ningún motor de optimización de rutas en el repo — sería
   100% nuevo, y su punto de entrada natural es ANTES de
   `programarSolicitud()`, nunca reemplazándolo. Debe operar sobre
   pedidos/entregas candidatos, no sobre solicitudes ya creadas 1:1 (ver
   §7).
5. **AJUSTE PRE-MERGE PR #180 (punto 1)** — existe, parcialmente, el
   concepto de "hora planificada vs hora real", pero **a nivel de
   viaje/ruta completo** (`regreso_estimado` vs
   `flota_viajes.hora_llegada`), NO a nivel de cada pedido/entrega
   individual. Un viaje con varias entregas de distintos pedidos puede
   llegar "a tiempo" globalmente mientras una entrega puntual específica
   se atrasó — la estructura actual no distingue eso. Ver §9/§10.
6. No existe ningún mecanismo de autenticación máquina-a-máquina en todo
   el repo (0 ocurrencias de "api key"/"webhook" en `src/`) — y
   **AJUSTE PRE-MERGE PR #180 (punto 3)** — tampoco está confirmado
   todavía si SITSA recibe pedidos (push, PriceSmart llama a SITSA) o
   los consulta (pull, SITSA llama a la API de PriceSmart), lo cual
   cambia por completo qué tipo de credencial/guard hace falta. Ver
   §13.

## 1. Mapa real de lo revisado

### 1.1 `tms_clientes` — catálogo TMS del cliente

`sql/schema.sql:545-560`. Tabla delgada: `id, empresa_id, nombre, nit,
telefono, direccion, estado`. `UNIQUE (empresa_id, id)` — es el destino
de todas las FK compuestas que ya usa el Portal del Cliente
(`tms_cliente_usuarios`, `tms_solicitudes_cliente`).

Existe un **segundo** catálogo de clientes, más rico
(`clientes`, con identidad fiscal, tipo, etc. — módulo Clientes de
Operaciones), y un puente entre ambos: `clientes.tms_cliente_id`
(`src/lib/clientes/repository.ts:201-300`,
`resolverTmsClienteId()`/`asegurarVinculosTmsClientes()`/
`crearClienteDesdeTms()`). **PriceSmart, si ya opera en el sistema, ya
tiene fila en ambas tablas** — la integración NO necesita crear un
cliente nuevo, solo referenciar el `tms_clientes.id` (o el `clientes.id`
general) que ya existe.

### 1.2 `tms_solicitudes_cliente` / `tms_solicitud_paradas` — el pedido, tal como existe hoy

`sql/schema.sql:850-896`. Creadas por CLIENTE-PORTAL-1
(`sql/migrate-2026-09-tms-portal-clientes-base.sql`) y reforzadas por
CLIENTE-PORTAL-1B. Columnas de `tms_solicitudes_cliente`:

```
id, empresa_id, cliente_id, creado_por_usuario_cliente_id,
estado ('SOLICITADA'|'EN_REVISION'|'PROGRAMADA'|'RECHAZADA'|'CANCELADA'),
fecha_solicitada, hora_solicitada, referencia_cliente, observaciones,
motivo_rechazo, plan_id (NULL hasta programarse), version (optimista),
creado_en, actualizado_en
```

`creado_por_usuario_cliente_id` es **`NOT NULL`** con FK compuesta a
`tms_cliente_usuarios(empresa_id, cliente_id, id)` — es decir, **toda
solicitud hoy EXIGE un usuario humano de Portal que la haya creado**. Este
es el primer punto de fricción real para un pedido que llega de una API:
no hay "usuario cliente" que lo haya tecleado.

`tms_solicitud_paradas` (`schema.sql:882-896`): `orden, tipo
('Carga'|'Entrega'|'Descarga'), lugar_nombre, cliente_ubicacion_id
(opcional), referencia`. El `orden` **lo reconstruye el servidor**, nunca
se confía en lo que mande el cliente
(`src/lib/tms/solicitudes-cliente.ts`, `crearSolicitudCliente()`) — mismo
criterio que tendría que aplicarse a un payload de PriceSmart.
`cantidadEntregas` es **derivada**, no una columna — se cuenta
`tipo='Entrega'` en el momento de leer.

### 1.3 `tms_planes_viaje` / `tms_plan_paradas` — el viaje real ya programado

`sql/schema.sql:601-657` (plan) y `src/lib/flota/schema.ts:538-547`
(paradas, creada en runtime vía `ensureSchema`, no en `schema.sql`). El
plan es la unidad operativa real: código propio
(`PLAN-YYYYMMDD-###`, por empresa — ver `src/lib/tms/codigo-plan.ts`),
piloto/unidad/auxiliar, `estado`, `regreso_estimado`. **No tiene ninguna
columna para un id externo** de ningún tipo — ni de PriceSmart ni de
cualquier otro origen.

### 1.4 Programación — cómo se crea/convierte un plan hoy

Dos caminos que ya existen y **ambos se reutilizarían tal cual**:

- **POST `/api/empresas/[slug]/tms/planes`** (`route.ts:593-1064`) — alta
  manual desde Programación (staff). Transaccional, con candado
  `GET_LOCK`/`primerConflictoTraslape` para evitar traslapes de
  piloto/unidad/auxiliar, código único con reintentos.
- **`programarSolicitud()`** (`src/lib/tms/solicitudes-cliente-operaciones.ts:350+`)
  — conversión solicitud→plan. `SELECT ... FOR UPDATE`, idempotencia real
  vía `plan_id IS NULL` (si ya se programó, 409 sin duplicar), exige
  `estado='EN_REVISION'` y `version` correcta (optimista), copia
  fecha/hora/observaciones de la solicitud al plan nuevo,
  piloto/unidad/auxiliar quedan `NULL` (Operaciones los asigna después).

Un pedido de PriceSmart, en el diseño más simple, terminaría pasando por
`programarSolicitud()` sin cambios — el trabajo real de la integración es
todo lo que pasa **antes**, hasta dejar una fila válida en
`tms_solicitudes_cliente` + `tms_solicitud_paradas`.

### 1.5 Portal del Piloto — registro real de la ejecución

`src/app/api/portal/viajes/route.ts`. Acción `"salida"`: crea
`flota_viajes` (estado `'abierto'`), intenta vincular automáticamente
`plan_id` si hay un único candidato (`vincularViajeAPlan()`,
`src/lib/tms/vincular-viaje-plan.ts`) y llama `marcarPlanEnRuta()` →
`tms_planes_viaje.estado = 'En ruta'`. Acción `"llegada"`: solo registra
`km_llegada`/`hora_llegada` en `flota_viajes` (estado `'cerrado'`) — **no
cambia el estado del plan** (ver comentario explícito en el propio
código). El cierre administrativo (Descargado → Cerrado) lo hace
Operaciones aparte (`src/lib/tms/cierre-viaje.ts`).

Punto crítico ya confirmado en tickets anteriores (CLIENTE-PORTAL-0/4):
**si `flota_viajes` nunca logra vincularse a un plan (0 o 2+ candidatos),
la ejecución real de ese viaje queda invisible para cualquier consumidor
por `plan_id`** — incluida cualquier integración futura que quiera leer
"¿cuándo llegó de verdad el pedido de PriceSmart?".

### 1.6 Evidencias — dos tablas, una vigente y una legacy

- `flota_viaje_evidencias` (`src/lib/flota/schema.ts:432-449`) — **fuente
  vigente**, el piloto SIEMPRE escribe aquí al subir cualquier foto
  (`src/lib/flota/viaje-evidencias.ts`, `guardarEvidenciaViaje()`).
- `tms_evidencias` (`schema.sql:659-672`) — espejo **legacy/parcial**,
  solo se llena si el viaje YA estaba vinculado a un plan en el momento
  de subir la foto; sin backfill retroactivo.

Ambas tienen `parada_id` nullable **sin FK** (evidencia de tablero de
salida/llegada no tiene parada asociada). Este es el mismo hallazgo ya
documentado y resuelto en CLIENTE-PORTAL-4
(`src/lib/tms/cliente-portal-seguimiento.ts`) — cualquier KPI/consumo
nuevo de evidencias debe usar `flota_viaje_evidencias` como fuente única
de contenido, exactamente como ya hace el Portal del Cliente.

### 1.7 Estados de viaje — máquina de estados real

`tms_planes_viaje.estado` (VARCHAR libre, sin ENUM, comentario en
`schema.sql:636-641`):

```
Programado / Cargado (equivalentes para "aún no salió")
  → En ruta
  → Descargado (piloto terminó, PENDIENTE de cierre administrativo)
  → Cerrado (cierre de Operaciones, permiso viajes_cerrar)
— o Cancelado en cualquier punto anterior.
```

Ya existe un indicador derivado **`atrasado`** en el propio GET de
Programación (`SQL_ATRASADO`,
`src/app/api/empresas/[slug]/tms/planes/route.ts:111-119`): viaje
`'En ruta'`/`'Cargado'` cuyo `regreso_estimado` ya venció y aún no hay
llegada registrada en `flota_viajes`. Es el antecedente más cercano a un
KPI de puntualidad — pero es un indicador **en vivo** ("va tarde ahora
mismo"), no un histórico de "llegó a tiempo o no" una vez cerrado.

### 1.8 Auditoría — qué guarda hoy, y qué NO

`auditoria` (`schema.sql:532-542`): `id, empresa_id, usuario, accion,
modulo, detalle (TEXT libre), creado_en`. `registrarAuditoria()`
(`src/lib/auditoria.ts:18-40`) — inserción best-effort (nunca bloquea la
operación principal si falla). Las lecturas
(`listarAuditoriaPlan`/`listarAuditoria`) filtran por `LIKE` sobre
`detalle` con una convención de texto (`"Plan #123 CODIGO · ..."`) — es
decir, **es un log humano-legible, no un almacén estructurado**. No hay
columna JSON, no hay tamaño garantizado para un payload completo, no hay
forma de indexar/consultar por un campo específico del payload (como
`external_order_id`) sin un `LIKE` frágil.

### 1.9 Portal del Cliente — la puerta de entrada actual

CLIENTE-PORTAL-1 a 4 (todos mergeados). Cadena de autorización
establecida y ya probada: `requireClienteSession()` (JWT + revalidación
DB) → `empresaId+clienteId+usuarioClienteId` de sesión → nunca del
body/query. `crearSolicitudCliente()`
(`src/lib/tms/solicitudes-cliente.ts`) valida mínimo 1 entrega, fecha
calendario real, ubicaciones pertenecientes al cliente, y hace TODO en
una transacción (`beginTransaction`/`commit`) separada de los efectos
post-commit. El seguimiento (`cliente-portal-seguimiento.ts`) ya expone
al cliente: estado del viaje (mapeado a
`PROGRAMADO`/`EN_RUTA`/`FINALIZADO`/`CANCELADO`/`DESCONOCIDO`), progreso
por parada (criterio: `evidencias >= 1`), galería de evidencias, piloto
(solo nombre), unidad. Es exactamente la superficie donde debería
aparecer, sin duplicarla, el resultado de un pedido creado por API.

## 2. Qué tablas actuales se pueden reutilizar (punto 1)

Reutilizables **sin cambios de esquema**:

- `tms_clientes` / `clientes` (PriceSmart ya existe aquí, asumiendo que
  es el mismo cliente visible en los datos de ejemplo).
- `tms_planes_viaje` / `tms_plan_paradas` — el viaje resultante es
  idéntico sea cual sea su origen.
- `flota_viajes` / `flota_viaje_evidencias` — ejecución real y
  evidencias, sin ningún cambio.
- `tms_cliente_ubicaciones` — si PriceSmart manda direcciones que
  coinciden con ubicaciones ya guardadas, se resuelven igual que hoy.
- `auditoria` — sigue sirviendo para el log humano-legible
  ("Pedido PS-000123 recibido y convertido a solicitud #456"), en
  paralelo a lo que se decida para el payload crudo (ver punto 5).

Reutilizables **con una extensión aditiva** (nunca reescritos):

- `tms_solicitudes_cliente` / `tms_solicitud_paradas` — son el modelo
  correcto para "un pedido pendiente de revisión", pero
  `creado_por_usuario_cliente_id NOT NULL` asume un humano (ver punto 3).

## 3. Qué conceptos faltan para pedidos externos (punto 2)

1. **Origen del pedido** — hoy todo registro en
   `tms_solicitudes_cliente` es indistinguible de "un humano lo tecleó en
   el Portal". Falta un campo tipo `origen` (`'PORTAL'` | `'API'`, o
   similar) para que Operaciones sepa qué está revisando y para que
   ningún reporte mezcle ambos orígenes sin poder separarlos.
2. **Identidad del pedido externo** — `external_order_id` (punto 4).
3. **Actor no-humano** — `creado_por_usuario_cliente_id` es `NOT NULL`
   con FK a `tms_cliente_usuarios`. Un pedido de API no tiene un usuario
   de Portal detrás. Dos opciones técnicamente viables, **ninguna
   decidida todavía** (ver §14/§16): volver la columna nullable con una
   regla aplicativa "uno de los dos debe existir", o crear un
   `creado_por_integracion_id` aparte — no forzar un usuario-cliente
   sintético en la tabla de humanos parece preferible, pero es una
   preferencia técnica, no una decisión cerrada.
4. **Payload crudo / trazabilidad completa** — ninguna tabla hoy guarda
   "esto fue exactamente lo que PriceSmart mandó" (punto 5).
5. **Motor de optimización** — no existe ningún cálculo de rutas
   automatizado hoy; toda la creación de paradas es 1:1 con lo que pide
   el cliente o teclea Operaciones (punto 6).
6. **Hora real vs planificada, agregada** — existe el dato crudo
   (`regreso_estimado` vs `hora_llegada`) pero no hay ninguna vista/KPI
   que lo resuma (punto 8/9).
7. **Autenticación máquina-a-máquina** — cero infraestructura hoy (punto
   12).

## 4. `external_order_id` — cómo manejarlo (punto 3)

**No inventar el nombre exacto del campo del lado de PriceSmart** — eso
depende del contrato real que confirme PriceSmart (ver punto 11). Del
lado de SITSA, la recomendación es tratarlo como un **identificador
externo opaco**, guardado tal cual (string, sin parsear ni interpretar
su formato) — nunca reutilizando ninguna columna existente
(`referencia_cliente` ya se usa para otra cosa: una referencia libre que
el cliente escribe a mano en el Portal, y mezclar ambos conceptos
rompería el Portal actual).

**AJUSTE PRE-MERGE PR #180 (punto 2) — corrección importante sobre DÓNDE
vive ese identificador**: la versión anterior de este documento
recomendaba `external_order_id` como columna directa de
`tms_solicitudes_cliente`, asumiendo implícitamente que **1 pedido de
PriceSmart = 1 `tms_solicitudes_cliente`**. Esa cardinalidad NO está
confirmada, y el propio discovery ya identifica un escenario real donde
sería falsa:

```
PED-001 \
PED-002  → agrupados por SITSA en UNA sola RUTA/PLAN A
PED-003 /

PED-004 \
PED-005  → agrupados en RUTA/PLAN B
```

Si PriceSmart manda pedidos individuales y SITSA (o un optimizador
futuro) los agrupa en una ruta, entonces `external_order_id` identifica
un **pedido/entrega**, no necesariamente una solicitud completa — varios
`external_order_id` podrían terminar asociados a la misma
`tms_solicitudes_cliente`/`tms_planes_viaje`, cada uno a su propia
`tms_solicitud_paradas`/`tms_plan_paradas` (o a un nivel más fino que
tampoco existe hoy, un "pedido/entrega" separado de "parada").

Por eso, **este documento ya NO recomienda una columna definitiva ni en
qué tabla debe vivir** — se documentan las piezas que casi con seguridad
hará falta poder trazar, sin comprometerse a la forma final:

```
pedido externo (external_order_id, dueño: PriceSmart)
  → entrega/destino (1 pedido puede tener 1 o más destinos — sin confirmar)
  → agrupación/optimización (varias entregas -> propuesta de ruta)
  → ruta propuesta
  → tms_solicitudes_cliente / tms_solicitud_paradas
  → tms_planes_viaje / tms_plan_paradas
```

La trazabilidad **pedido ↔ parada ↔ plan** debe conservarse en cualquier
diseño final, sea cual sea la cardinalidad real — pero la cardinalidad
exacta (1:1, 1:N, N:1) queda **pendiente hasta el contrato real de
PriceSmart** (§16, §17). El `UNIQUE` a nivel de base de datos sigue
siendo la herramienta correcta para duplicados (§5) una vez se sepa en
qué tabla/nivel aplicarlo.

## 5. Cómo evitar pedidos duplicados (punto 4)

El patrón **ya existe y está probado varias veces en este mismo
repositorio** — no hace falta inventar uno nuevo:

- `esDuplicadoEmail()` en `src/lib/tms/cliente-usuarios.ts:49-52`
- `esDuplicadoNumeroFactura()` en `src/lib/facturacion/facturas.ts`
- `esDuplicadoCodigoPlan()` (CLIENTE-PORTAL-3, `solicitudes-cliente-operaciones.ts`)

Todos siguen la misma receta, documentada explícitamente en el propio
código (`cliente-usuarios.ts:37-48`): un `SELECT` optimista primero (da
un mensaje claro en el caso normal), pero **la autoridad real es siempre
un `UNIQUE KEY` de MySQL** — el helper solo detecta el código de error
(`ER_DUP_ENTRY` / errno `1062`) y lo convierte en un mensaje funcional en
vez de un 500 genérico.

**AJUSTE PRE-MERGE PR #180 (punto 2)** — el principio ("`UNIQUE` de base
de datos + helper `esDuplicadoXxx()`") se mantiene como la defensa real
contra un reintento de PriceSmart (timeout de su lado, reenvío del mismo
pedido, etc.), pero **sobre qué tabla y qué columnas exactas** va ese
`UNIQUE` depende de la cardinalidad pedido↔solicitud todavía sin
confirmar (§4). Si un `external_order_id` identifica un pedido/entrega
individual y varios terminan en la misma solicitud/plan, el `UNIQUE`
tendría que vivir en la tabla que registre esa identidad de pedido (por
ejemplo, el log de payloads del punto 6, o una tabla de
pedidos/entregas dedicada), no necesariamente en
`tms_solicitudes_cliente`. El principio de diseño queda fijado aquí; la
tabla exacta se decide junto con el contrato de PriceSmart (§17).

## 6. Cómo mantener payload original / auditoría (punto 5)

`auditoria.detalle` (TEXT, filtrado por `LIKE`) **no es el lugar
correcto** para un payload JSON completo de PriceSmart — no hay forma de
indexarlo ni de consultarlo por campo, y mezclar textos humanos con JSON
crudo degradaría los reportes de auditoría que ya existen para el resto
del sistema (`listarAuditoriaPlan`).

Propuesta (sin crear nada todavía): tabla nueva y dedicada, algo como

```
tms_integracion_pedidos_log (
  id, empresa_id, cliente_id, origen_integracion,
  external_order_id, payload_recibido JSON NOT NULL,
  solicitud_id INT NULL,               -- se llena cuando el pedido se acepta y se crea la solicitud
  estado_procesamiento VARCHAR(30),    -- RECIBIDO | ACEPTADO | RECHAZADO | ERROR
  motivo_rechazo VARCHAR(500) NULL,
  recibido_en DATETIME
)
```

Esto guarda **cada** intento (incluidos los rechazados/duplicados/con
error), independiente de si terminó en una `tms_solicitudes_cliente` —
crítico para poder responderle a PriceSmart "por qué su pedido X no
apareció" sin depender de logs de servidor efímeros. `auditoria` sigue
usándose en paralelo para el resumen humano-legible, exactamente como ya
hace TMS/Programación hoy, sin duplicar su propósito.

## 7. Dónde entraría el motor de optimización (punto 6)

**No existe hoy ningún motor de optimización de rutas en el
repositorio** — ni una librería, ni un algoritmo, ni un endpoint que
calcule/proponga agrupaciones o secuencias de paradas más allá de lo que
el cliente/Operaciones ya decide a mano. Esto sería trabajo
**enteramente nuevo**, no una extensión de algo existente.

Punto de entrada conceptual correcto (sin implementar): **entre** la
recepción/validación del pedido crudo de PriceSmart **y** la creación de
cualquier `tms_solicitudes_cliente`. **AJUSTE PRE-MERGE PR #180 (punto
2)** — a diferencia de lo que decía la versión anterior de este
documento, el optimizador **NO debe asumir que cada pedido ya llegó
convertido 1:1 en una solicitud/parada**: debe operar sobre los
**pedidos/entregas candidatos** tal como los valida el adaptador (§13),
y ser él quien decida — o proponga — cómo se agrupan en una o más rutas.
Recién el resultado de esa agrupación/optimización (una o más "rutas
propuestas") es lo que se convierte en `tms_solicitudes_cliente` +
`tms_solicitud_paradas`, reutilizando la misma conversión transaccional
que ya usa Operaciones (`programarSolicitud()`) — nunca escribiendo
directo a `tms_planes_viaje` por fuera de esa vía. Esto mantiene una sola
vía de creación de planes, consistente con "no crear una segunda fuente
de verdad" (mismo principio ya aplicado en CLIENTE-PORTAL-4 para
evidencias/seguimiento) — solo que ahora el punto de entrada del
optimizador es ANTES de que exista cualquier solicitud, no después.

Si el optimizador agrupa varios pedidos de PriceSmart en un mismo viaje,
eso confirma el escenario N:1 ya señalado en §4 — pero sigue siendo una
decisión de negocio mayor (¿siempre agrupa, nunca agrupa, o depende de
reglas que confirme PriceSmart/Operaciones?) que requiere confirmación
explícita — no se asume aquí (ver §16, decisiones pendientes).

## 8. Cómo pasar una ruta propuesta a Programación (punto 7)

Con el diseño de arriba, "pasar una ruta propuesta" es simplemente:
**crear la fila en `tms_solicitudes_cliente` (estado `SOLICITADA` o
directo `EN_REVISION`) + sus `tms_solicitud_paradas`, en el orden que
decidió el optimizador**. Programación **ya tiene** la pantalla para
revisar/tomar-en-revisión/rechazar/programar esas solicitudes
(`/e/[slug]/tms/solicitudes-clientes`, CLIENTE-PORTAL-3) — no hace falta
ninguna pantalla nueva para que un operador vea y confirme una ruta que
vino de PriceSmart vía API, siempre que se le muestre claramente el
origen (de ahí el campo `origen`/`origen_integracion` del punto 3).

## 9. Cómo registrar hora planificada vs hora real (punto 8)

**AJUSTE PRE-MERGE PR #180 (punto 1) — distinción obligatoria** que la
versión anterior de este documento no hacía explícita: existen dos
niveles de puntualidad completamente distintos, y la estructura actual
**solo cubre uno de los dos**:

**A) Puntualidad del viaje/ruta completo** — SÍ existe, parcialmente, hoy:

| Concepto | Planificado | Real |
|---|---|---|
| Salida/carga | `tms_planes_viaje.hora_carga` | `flota_viajes.hora_salida` |
| Llegada/entrega (del viaje completo) | `tms_planes_viaje.regreso_estimado` | `flota_viajes.hora_llegada` |

Falta solo una vista/consulta que las **cruce** explícitamente por
`plan_id` (vía `flota_viajes.plan_id`, columna nullable ya existente —
`src/lib/flota/schema.ts:426-427`) — hoy cada mitad vive en su propia
tabla y ningún reporte las junta más allá del indicador `atrasado` (en
vivo, no histórico — §1.7).

**B) Puntualidad por pedido/entrega individual** — **NO existe ninguna
base para esto en la estructura actual.** `regreso_estimado` y
`hora_llegada` son **una sola hora por viaje**, no una hora por parada ni
por pedido. Un viaje con 3 entregas de 3 pedidos distintos de PriceSmart
tiene HOY una sola "hora de llegada" registrada — no hay forma de saber,
con lo que existe, si la entrega del pedido `PED-001` (primera parada)
llegó a tiempo mientras la del `PED-003` (última parada) se atrasó.
`tms_plan_paradas`/`tms_evidencias`/`flota_viaje_evidencias` sí tienen
`parada_id` y `capturado_en` (hora de la evidencia, no necesariamente
"hora de entrega confirmada"), pero **ninguna columna hoy representa una
"hora prometida" ni un "estado de entrega" por parada** — sería
estructura enteramente nueva.

El requerimiento real comunicado por PriceSmart es sobre **B) —
puntualidad por pedido/entrega**, no A). Este documento marca
explícitamente: **la estructura actual NO contiene suficiente
información confirmada para calcular OTD por pedido.**

## 10. Cómo calcular el KPI OTD (punto 9)

**A) OTD a nivel de viaje/ruta** — cálculo mínimo viable con lo que ya
existe, **conceptual, no implementado**:

```
a_tiempo_viaje := flota_viajes.hora_llegada <= tms_planes_viaje.regreso_estimado
```

sobre viajes ya cerrados (`estado IN ('Descargado','Cerrado')`) y con
`flota_viajes.plan_id` resuelto.

**B) OTD a nivel de pedido/entrega** — que es lo que PriceSmart necesita
controlar según el ticket — **requiere datos que hoy no se capturan en
ningún punto del sistema**. Sin diseñar todavía columnas definitivas, lo
que casi con certeza haría falta conservar por cada pedido/entrega:

- `external_order_id` (identidad del pedido, ver §4)
- ventana u hora prometida de entrega (dato que tendría que venir de
  PriceSmart en el pedido original, o negociarse como SLA)
- hora real de entrega (¿el registro del piloto en el Portal Piloto por
  parada, o una confirmación aparte de PriceSmart en su propia bodega?
  — sin confirmar)
- estado de la entrega (entregado / rechazado / parcial / reprogramado
  — vocabulario sin definir)
- minutos de atraso (derivado, pero requiere las dos horas anteriores
  ya confiables)
- motivo de atraso (¿lo captura el piloto, Operaciones, o PriceSmart al
  recibir?)
- la relación **pedido ↔ parada ↔ plan/ruta** (§4) — sin esa
  trazabilidad no hay forma de calcular B) aunque existan las horas.

Para **ambos** niveles (A y B), quedan las mismas preguntas de negocio
sin resolver, ahora explícitamente separadas por nivel:

- **Tolerancia**: ¿"a tiempo" es estricto, o se permite un margen (p. ej.
  ±30 min)? ¿La misma tolerancia para A) que para B)? No hay ningún
  precedente de tolerancia en el sistema hoy.
- **Qué hora cuenta como "entrega real"**: ¿la del Portal Piloto, o
  PriceSmart tiene su propia hora de recepción en bodega que habría que
  reconciliar por separado? Esto es aún más crítico en B) que en A).
- **Denominador**: ¿el OTD se calcula sobre viajes/pedidos cerrados, o
  también cuenta cancelados/rechazados como "no cumplidos"?
- **Definición oficial de OTD**: PriceSmart puede tener ya una definición
  propia (usada con otros transportistas) que SITSA debería adoptar en
  vez de inventar una nueva — ver §12/§17.

Ninguna de estas se puede resolver sin confirmación de negocio — se deja
explícitamente pendiente, no se inventa un criterio, y **B) en
particular no se puede diseñar en absoluto sin el contrato real de
PriceSmart**.

## 11. Cómo exponer resultados en el Portal del Cliente (punto 10)

El Portal del Cliente **ya tiene** el lugar natural: la sección
"Recorrido programado" de `/cliente-portal/solicitudes/[id]`
(CLIENTE-PORTAL-4) ya muestra estado del viaje, piloto, unidad, progreso
por parada y evidencias — un pedido creado por la API de PriceSmart, una
vez convertido a plan, aparecería ahí **exactamente igual** que uno
creado a mano en el Portal, sin ningún cambio de UI. Lo único
potencialmente nuevo sería:

- Mostrar el `external_order_id` de PriceSmart junto al código interno
  `PLAN-...` (si PriceSmart necesita reconciliar por su propio id).
- Un indicador de OTD — nivel A) viaje/ruta es el único calculable con
  la estructura actual; nivel B) por pedido/entrega (el que
  probablemente le interesa más al cliente) depende de que primero
  exista la estructura descrita en §9/§10 — si el negocio confirma que
  debe ser visible al cliente y no solo interno/reportes.

Ninguna de las dos requiere una pantalla nueva — son campos adicionales
sobre la misma estructura ya construida en `cliente-portal-seguimiento.ts`.

## 12. Qué datos exactos pedirle a PriceSmart (punto 11)

Lista mínima para poder construir el adaptador sin inventar nada — **por
confirmar con PriceSmart antes del siguiente ticket**:

1. **Identificador único del pedido** de su lado (nombre exacto del
   campo, formato, si se reutiliza en reintentos o cambia).
2. **Mecanismo de entrega**: ¿PriceSmart empuja (webhook/POST hacia
   SITSA) o SITSA debe consultar (polling a un endpoint de ellos)? Esto
   cambia completamente la arquitectura del adaptador (§13).
3. **Autenticación**: API key, OAuth, certificado mutuo, IP allowlist —
   qué mecanismo soporta su plataforma.
4. **Formato y contenido exacto del pedido**: dirección(es) de
   carga/entrega (¿texto libre o con algún catálogo de ubicaciones de
   ellos?), fecha/hora solicitada, cantidad de bultos/peso/volumen si
   aplica, referencia/orden de compra, contacto en destino.
5. **Múltiples entregas por pedido, o un pedido por entrega**: define si
   un "pedido PriceSmart" mapea 1:1 a una `tms_solicitud_paradas` con
   varias entregas, o si cada entrega llega como un pedido separado que
   SITSA debe agrupar (afecta directamente al diseño del optimizador,
   §7).
6. **Ventanas de tiempo**: ¿PriceSmart exige una hora exacta de entrega,
   o una ventana (p. ej. "antes de las 14:00")? Afecta el diseño de
   `regreso_estimado` y del KPI OTD.
7. **Confirmaciones que esperan de vuelta**: ¿necesitan un callback/
   webhook de SITSA cuando el pedido se acepta, se programa, se
   entrega? ¿O solo consultan por su propio id cuando quieren?
8. **Cancelaciones/modificaciones**: ¿PriceSmart puede cancelar o
   modificar un pedido ya enviado? Si sí, con qué identificador y hasta
   qué estado del ciclo de vida en SITSA se permite.
9. **Volumen esperado** (pedidos/día, picos) — dimensiona si con
   polling/webhook simple basta o si hace falta cola/reintentos más
   robustos.
10. **Ambiente de pruebas**: si PriceSmart tiene un sandbox/staging para
    probar la integración antes de producción real.

## 13. Arquitectura recomendada para el adaptador API (punto 12)

Sin infraestructura previa que reutilizar (cero webhooks/API keys en el
repo hoy), la recomendación se apoya en los patrones **ya establecidos**
en este proyecto para todo lo demás, en vez de traer algo externo. **Todo
lo de esta sección asume, sin confirmar, un escenario de tipo "PriceSmart
empuja hacia SITSA" (push/inbound)** — ver la aclaración de autenticación
más abajo (AJUSTE PRE-MERGE PR #180, punto 3) para el escenario contrario.

- **Ruta dedicada** bajo `/api/integraciones/pricesmart/pedidos` (o
  similar), Next.js Route Handler — mismo mecanismo que ya usa el resto
  de la API (`src/app/api/...`), no un servicio aparte. **Válido solo si
  el modelo es push** (PriceSmart llama a SITSA); si es pull (SITSA debe
  consultar la API de PriceSmart), la pieza equivalente sería un job/
  worker que consulta periódicamente, no un Route Handler que recibe.
- **Guard nuevo, no reutilizar `requireTenant*`/`requireClienteSession()`**:
  esos dos asumen una sesión de un humano (cookie + JWT); el guard para
  máquina-a-máquina es un concepto distinto en cualquier escenario
  (push o pull). Su forma exacta depende de qué soporte PriceSmart —
  API key simple, OAuth2 client credentials, certificado mutuo, bearer
  token, etc. — y de **quién llama a quién** (ver punto 3 abajo). El
  principio que sí se puede fijar ya: la identidad (`empresaId`/
  `clienteId`) nunca debe salir del body/query de la petición, siempre
  de la credencial ya validada — mismo principio que ya aplica
  `requireClienteSession()`.
- **Validación con `zod`** del payload — mismo patrón que usa
  literalmente cada POST del proyecto (`solicitudes/route.ts`,
  `planes/route.ts`, etc.), no una validación ad hoc.
- **Flujo interno** (asumiendo push, y sin comprometerse a la
  cardinalidad de §4): recibir/validar pedido → verificar no-duplicado
  por `external_order_id` (§5, tabla exacta pendiente) → registrar en el
  log de payloads (§6) → si aplica, pasar por el optimizador (§7) → crear
  `tms_solicitudes_cliente` + `tms_solicitud_paradas` reutilizando (o
  extrayendo a una función compartida) la misma lógica transaccional de
  `crearSolicitudCliente()` → responder con el id interno (y el/los
  `external_order_id` de vuelta, para que PriceSmart pueda reconciliar).
- **Sin motor de optimización en la primera versión** de la integración
  — el pedido entra tal cual a revisión de Operaciones, igual que hoy
  entra un pedido tecleado a mano; el optimizador (§7) es una fase
  posterior sobre la misma tubería, no un prerrequisito para tener
  pedidos automáticos funcionando.
- **Idempotencia por diseño, no por convención**: el `UNIQUE` de base de
  datos (§4/§5) es la única garantía real contra reintentos — cualquier
  chequeo aplicativo previo es solo para dar un mensaje más claro, nunca
  la autoridad.

**AJUSTE PRE-MERGE PR #180 (punto 3)** — push vs pull y el mecanismo de
autenticación siguen **sin confirmar** con el equipo técnico de
PriceSmart, y cambian la arquitectura de raíz:

- Si **PriceSmart llama a SITSA** (push): SITSA emite y valida una
  credencial propia — algo tipo API key con hash (nunca texto plano,
  mismo criterio que `tms_cliente_usuarios.password_hash`) es razonable.
- Si **SITSA llama a la API de PriceSmart** (pull): SITSA necesita
  **recuperar en texto** (no solo verificar un hash) la credencial que
  PriceSmart le entregue — API key recuperable, client id/secret de
  OAuth2 client-credentials, certificado, token — y renovarla si expira.
  Ese es un problema de almacenamiento de secretos distinto (cifrado
  reversible, no hash), no cubierto por ningún patrón existente en el
  repo hoy.

**No se decide aquí cuál aplica.** El esquema de credenciales (§14) se
deja explícitamente como ejemplo de un solo escenario, no como diseño
recomendado.

## 14. Esquema hipotético — SOLO PROPUESTA, nada de esto fue creado

**AJUSTE PRE-MERGE PR #180 (puntos 2 y 3)** — la versión anterior de
esta sección presentaba un `ALTER TABLE tms_solicitudes_cliente` y una
tabla `tms_integracion_credenciales` como si fueran el diseño ya
decidido. Ninguno de los dos lo es: el primero asumía la cardinalidad
1 pedido = 1 solicitud (§4), que sigue sin confirmarse; el segundo
asumía un escenario de autenticación (push/inbound con API key) que
tampoco está confirmado (§13). Lo que sigue es **únicamente el
inventario de piezas que casi con certeza hará falta poder representar
de alguna forma**, no una propuesta de columnas/tablas definitiva.

**Lo único que se mantiene como propuesta concreta** es el log de
payloads (§6), porque no depende de la cardinalidad pedido↔solicitud ni
del sentido de la integración — cualquier payload recibido/enviado se
puede registrar igual:

```sql
-- PROPUESTA CONCEPTUAL — NINGUNA de estas sentencias se ejecutó.
-- Nombres/tipos exactos sujetos a lo que confirme PriceSmart (§12)
-- y a decisión de negocio (§16).

CREATE TABLE tms_integracion_pedidos_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  origen_integracion VARCHAR(40) NOT NULL,
  -- external_order_id identifica el PEDIDO/ENTREGA tal como lo mande
  -- PriceSmart — no se asume todavía que corresponda 1:1 a una fila de
  -- tms_solicitudes_cliente (ver §4). Puede terminar siendo la
  -- identidad "de nivel más bajo" de todo el modelo, con la agregación
  -- pedido(s)->solicitud->plan resuelta en otro lugar.
  external_order_id VARCHAR(120) NOT NULL,
  payload_recibido JSON NOT NULL,
  -- Nullable a propósito: varios external_order_id distintos podrían
  -- terminar apuntando a la MISMA solicitud si se confirma agrupación
  -- (§4/§7) — este campo por sí solo no alcanza para expresar esa
  -- relación N:1 sin una tabla puente adicional, que tampoco se define
  -- aquí todavía.
  solicitud_id INT NULL,
  estado_procesamiento VARCHAR(30) NOT NULL DEFAULT 'RECIBIDO',
  motivo_rechazo VARCHAR(500) NULL,
  recibido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_integlog_pedido (empresa_id, cliente_id, origen_integracion, external_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Piezas identificadas pero explícitamente SIN diseño de columnas
todavía** (requieren el contrato de PriceSmart, §17, antes de poder
proponerse en concreto):

- Extensión de `tms_solicitudes_cliente` (o una tabla intermedia nueva)
  para el origen del pedido y el actor no-humano — la forma exacta
  depende de si es 1:1, 1:N o N:1 con el pedido externo (§4), y de si
  `creado_por_usuario_cliente_id` (hoy `NOT NULL`) se vuelve nullable o
  se resuelve con un usuario-sistema (§16).
- Almacenamiento de credenciales de integración — **NO se propone una
  tabla concreta aquí**. Si el escenario final resulta ser push
  (PriceSmart llama a SITSA), un hash de API key sería razonable, mismo
  criterio que `tms_cliente_usuarios.password_hash`; si es pull (SITSA
  llama a PriceSmart), hace falta almacenamiento de secreto
  **recuperable** (cifrado reversible), un patrón que este repo no tiene
  hoy en ningún lado y que no debería inventarse sin confirmar antes con
  el equipo de desarrollo de PriceSmart qué mecanismo de autenticación
  soporta realmente su plataforma.
- Estructura para OTD por pedido (nivel B, §9/§10) — ventana prometida,
  hora real de entrega, estado, motivo de atraso, todos pendientes del
  contrato real.

## 15. Riesgos

- **Confundir origen de solicitudes**: si el diseño final no incluye
  alguna forma de distinguir el origen del pedido (nombre de
  columna/tabla exacto aún sin decidir, ver §3/§14), Operaciones no
  podría diferenciar un pedido de PriceSmart de uno tecleado a mano —
  impacta soporte/reportes desde el día uno.
- **Duplicados sin `UNIQUE` real**: cualquier chequeo solo aplicativo (sin
  el índice único de MySQL) tiene ventana de carrera, exactamente el
  mismo hallazgo ya documentado para `crearUsuarioCliente()` en
  CLIENTE-PORTAL-1.
- **Vínculo plan↔viaje real no garantizado**: si `flota_viajes` nunca se
  vincula a un plan (0 o 2+ candidatos), un pedido de PriceSmart
  "desaparece" del seguimiento y del cálculo de OTD sin que nadie lo note
  — limitación ya existente, no nueva, pero se vuelve más visible con un
  cliente que espera trazabilidad automática.
- **Motor de optimización es trabajo 100% nuevo**: no hay ninguna base
  de código para partir — dimensionar esto como su propio proyecto, no
  como una fase menor de esta integración.
- **Seguridad de credenciales de integración**: un secreto de API mal
  guardado (texto plano, en logs, en query string) sería una fuga real
  hacia un tercero — debe seguir el mismo estándar que ya usa el proyecto
  para contraseñas (`scrypt`/hash, nunca texto plano, ver
  `src/lib/password.ts`).
- **Multiempresa**: si SITSA maneja más de una empresa dentro de la
  plataforma y PriceSmart eventualmente opera con más de una, cada
  credencial de integración debe quedar atada a `empresa_id +
  cliente_id` explícitos — nunca una API key "global" que pueda cruzar
  empresas.

## 16. Decisiones de negocio pendientes (no se pueden resolver técnicamente)

1. ¿Un pedido de PriceSmart es 1:1 con una `tms_solicitudes_cliente`, o
   varios pedidos pueden agruparse en una sola solicitud/plan?
2. ¿Los pedidos de la API entran directo a `EN_REVISION` (Operaciones
   los revisa igual que uno manual) o se permite algún camino de
   auto-aprobación para ciertos casos?
3. ¿El KPI OTD que le importa a PriceSmart es a nivel de viaje/ruta (A,
   §9/§10) o de cada pedido/entrega (B)? Según lo comunicado, parece ser
   B) — lo que implica construir estructura nueva, no solo un cálculo
   sobre datos existentes. Además: tolerancia de tiempo, y qué hora
   cuenta como "entregado" (la del Portal Piloto vs. una confirmación
   propia de PriceSmart).
4. ¿PriceSmart empuja (webhook) o SITSA consulta (polling)? Determina la
   arquitectura del adaptador antes de construir nada (§13).
5. ¿Se le expone a PriceSmart un callback/webhook de vuelta (estado
   cambia → SITSA le avisa), o solo consulta por su propio id?
6. ¿`creado_por_usuario_cliente_id` se vuelve nullable, o se crea un
   "usuario sistema" por integración dentro de `tms_cliente_usuarios`?
   Ambas opciones son técnicamente viables; ninguna es obviamente
   correcta sin una decisión de producto.
7. ¿El motor de optimización es parte de este roadmap a corto plazo, o
   una fase muy posterior? Cambia si el siguiente ticket debe incluirlo.

## 17. Siguiente ticket recomendado

**No** "implementar el adaptador" todavía — antes hace falta la
confirmación de PriceSmart sobre el punto 11 (datos exactos, push vs
pull, autenticación) y las decisiones de negocio del punto 16, ninguna de
las cuales se puede resolver desde el código.

**AJUSTE PRE-MERGE PR #180 (punto 5)** — la versión anterior de esta
sección recomendaba como siguiente paso un ticket de **extensión de
esquema** (`PRICESMART-INTEGRACION-1-EXTENSION-SOLICITUDES-ORIGEN`).
Se retira esa recomendación: diseñar y ejecutar cambios de esquema
todavía sería prematuro — la cardinalidad pedido↔solicitud (§4/§7) y el
mecanismo de autenticación (§13) son exactamente lo que determina qué
columnas/tablas hacen falta, y ninguna de las dos está confirmada.
Construir el esquema ahora arriesgaría tener que deshacerlo o migrarlo
otra vez apenas llegue el contrato real.

El siguiente paso correcto es un ticket de **contrato, no de esquema**:

**PRICESMART-INTEGRACION-1-CONTRATO-API** — reunión/documento de
alcance con el equipo técnico de PriceSmart, **sin tocar código ni base
de datos**, que debe dejar registrado por escrito:

- push vs pull (quién llama a quién)
- mecanismo de autenticación soportado
- endpoint(s) exactos (URLs, métodos, versión de API)
- **el JSON real** de un pedido de ejemplo (no un campo inventado por
  SITSA)
- identificador único del pedido (nombre exacto, formato, estabilidad
  en reintentos)
- **pedido vs entrega**: cardinalidad exacta (1 pedido = 1 entrega
  siempre, o un pedido puede traer varias entregas/destinos)
- coordenadas/direcciones: formato exacto que manda PriceSmart
- ventanas horarias prometidas por entrega
- cancelaciones/modificaciones: cómo y hasta cuándo se permiten
- callbacks que espera PriceSmart de vuelta (si los hay)
- vocabulario de estados que PriceSmart espera ver (recibido, en
  revisión, programado, en ruta, entregado, etc.)
- volumen esperado (pedidos/día, picos)
- ambiente de sandbox/pruebas
- **definición oficial de OTD** que ya use PriceSmart con otros
  transportistas, si existe — para no inventar una propia

**Solo después de tener ese contrato por escrito** se diseña el esquema
definitivo (extensión de `tms_solicitudes_cliente`, tabla(s) de pedidos
externos, credenciales) — como un ticket técnico aparte, posterior a
este.

## Respuestas directas a los 12 puntos del ticket

*(Actualizado tras AJUSTE PRE-MERGE PR #180 — ver las 5 correcciones
marcadas en el cuerpo del documento.)*

1. **Tablas reutilizables**: `tms_clientes`/`clientes`,
   `tms_planes_viaje`, `tms_plan_paradas`, `flota_viajes`,
   `flota_viaje_evidencias`, `tms_cliente_ubicaciones`, `auditoria` (sin
   cambios); `tms_solicitudes_cliente`/`tms_solicitud_paradas`
   (reutilizables, pero la forma exacta de la extensión depende de la
   cardinalidad pedido↔solicitud, todavía sin confirmar). Ver §2.
2. **Conceptos que faltan**: origen del pedido, id externo (nivel/tabla
   sin confirmar), actor no humano, log de payload crudo, motor de
   optimización (opera sobre pedidos candidatos, no sobre solicitudes ya
   creadas), estructura para OTD por pedido, autenticación M2M. Ver §3.
3. **`external_order_id`**: identificador externo opaco, nunca
   reutilizar `referencia_cliente` — pero **NO se recomienda todavía**
   como columna directa de `tms_solicitudes_cliente`: la cardinalidad
   real pedido↔solicitud (1:1, 1:N o N:1, según agrupación de rutas) está
   sin confirmar, y determina en qué tabla/nivel debe vivir. Ver §4/§14.
4. **Evitar duplicados**: principio fijado — `UNIQUE KEY` de MySQL +
   helper `esDuplicadoXxx()`, mismo patrón ya usado 3 veces en el repo —
   pero la tabla exacta sobre la que aplica depende del mismo punto 3.
   Ver §5.
5. **Payload original/auditoría**: tabla nueva dedicada
   (`tms_integracion_pedidos_log`, JSON, con `external_order_id` a nivel
   de pedido/entrega, no necesariamente 1:1 con `solicitud_id`),
   `auditoria` sigue para el resumen humano-legible en paralelo. Ver §6.
6. **Motor de optimización**: no existe hoy, sería 100% nuevo; opera
   sobre **pedidos/entregas candidatos** (nunca asumiendo que cada uno ya
   es una solicitud independiente) y entrega una o más rutas propuestas
   antes de `programarSolicitud()`. Ver §7.
7. **Pasar ruta propuesta a Programación**: crear
   `tms_solicitudes_cliente`+paradas con el origen marcado, a partir del
   resultado del optimizador; la pantalla de revisión ya existe
   (CLIENTE-PORTAL-3), sin cambios de UI. Ver §8.
8. **Hora planificada vs real**: existe **solo a nivel de viaje/ruta
   completo** (`regreso_estimado`/`hora_carga` vs
   `hora_llegada`/`hora_salida`) — falta la vista que los cruce. A nivel
   de cada pedido/entrega individual (lo que PriceSmart necesita según el
   ticket) **no existe ninguna base hoy**, sería estructura enteramente
   nueva. Ver §9.
9. **KPI OTD**: cálculo simple posible **solo a nivel de viaje/ruta**
   (A) con los datos actuales; a nivel de pedido/entrega (B, el
   relevante para PriceSmart) la estructura actual **no contiene
   suficiente información confirmada** — requiere ventana prometida, hora
   real de entrega, estado y motivo de atraso por pedido, ninguno
   capturado hoy. Tolerancia y definición de "entregado" son decisión de
   negocio pendiente en ambos niveles. Ver §10/§16.
10. **Exponer en Portal Cliente**: ya tiene el lugar natural
    (`cliente-portal-seguimiento.ts`/detalle de solicitud), sin pantalla
    nueva; solo campos adicionales si se decide mostrarlos (incluido un
    futuro OTD por pedido, una vez exista esa estructura). Ver §11.
11. **Datos exactos a pedirle a PriceSmart**: lista de 10 puntos (id,
    push/pull, auth, formato exacto, agrupación de entregas, ventanas de
    tiempo, callbacks, cancelaciones, volumen, sandbox). Ver §12.
12. **Arquitectura del adaptador**: Route Handler bajo
    `/api/integraciones/` **si el escenario resulta ser push**; guard
    nuevo para máquina-a-máquina cuya forma exacta (API key con hash vs.
    secreto recuperable) depende de si PriceSmart llama a SITSA o
    viceversa — **sin decidir todavía**; validación `zod`; idempotencia
    por `UNIQUE` de DB; sin motor de optimización en la primera versión.
    Ver §13.

---

**NO SQL ejecutado. NO implementación. NO producción. NO deploy.**
Este documento es el único entregable de este ticket.
