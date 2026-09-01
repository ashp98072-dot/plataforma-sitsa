# CLIENTE-PORTAL-0-DISCOVERY-SOLICITUDES-SEGUIMIENTO

**Tipo:** Discovery / investigación. **NO implementa nada.**
**Restricciones respetadas:** no se creó ninguna tabla, no se escribió SQL, no se
modificó `schema.sql`, no se tocó ningún archivo de `src/`, no se creó autenticación,
no se modificó el Portal del colaborador. Único archivo nuevo: este documento.

Base: `origin/main`, HEAD al iniciar `686fc374e6de2ea3d9c36916c8834f604d91863e`.

---

## 0. Resumen ejecutivo

Hoy **no existe ningún concepto de "cliente que inicia sesión"** en la plataforma
(confirmado por grep negativo, ver §2). Todo lo que hoy toca a un cliente
(`clientes`, `tms_clientes`, `tms_cliente_ubicaciones`, `tms_cliente_contactos`,
`tms_cliente_rutas`) es **administrado por el staff interno** (Operaciones /
Facturación) — el cliente nunca ha tenido acceso directo al sistema.

Lo que sí existe, y es reutilizable, es un patrón completo y probado para un
"portal externo autenticado con su propio scope": el **Portal del colaborador**
(`src/app/portal/*`, `src/lib/rrhh/colaborador-session.ts`,
`src/lib/rrhh/colaborador-auth.ts`). La recomendación central de este documento es
clonar ese patrón (cookie distinta, JWT con secreto compartido, payload propio)
para un **Portal del cliente**, en vez de inventar un mecanismo nuevo.

También existe, y es directamente reutilizable sin duplicar lógica, el modelo de
paradas de un viaje (`tms_plan_paradas` vía `src/lib/tms/paradas.ts`), que **ya
representa origen, entregas intermedias y destino final con el mismo campo
`tipo`** (`Carga` / `Entrega` / `Descarga`) — confirmado leyendo tanto el creador
(`POST /api/empresas/[slug]/tms/planes`) como el consumidor (portal del piloto).
Esto simplifica mucho el diseño de una futura "solicitud de cliente": su forma
final (origen + N paradas + destino) es prácticamente la misma forma que ya usa
`tms_plan_paradas` hoy.

Por el lado del **Portal del piloto**, el flujo que el ticket pide para el futuro
(salida obligatoria → paradas seleccionables → destino final bloqueado mientras
haya pendientes → kilometraje final) **es una reversión deliberada** de una
decisión de diseño reciente y explícita: **PORTAL-HARDENING-2 (Fases C y F)**
eliminó a propósito exactamente ese tipo de bloqueo ("las evidencias son
respaldo, nunca bloquean salida, llegada ni cierre"; "ya no se exige completar
evidencias primero"). No es un error a corregir — es un cambio de política de
negocio que hay que decidir conscientemente, con el dueño de Operaciones, antes
de tocar ese código (ver §13 y §25).

---

## 1. Mapa real de tablas TMS relacionadas

| Tabla | Dónde vive su `CREATE TABLE` real | Notas |
|---|---|---|
| `tms_planes_viaje` | `sql/schema.sql` (+ columnas aditivas vía `ensureColumn` en `src/lib/flota/schema.ts`) | `id, empresa_id, codigo, cliente_id (→ tms_clientes.id), lugar_carga_id, lugar_descarga_id, unidad_id, piloto_id, auxiliar_id, fecha_plan, hora_carga, tipo_traslado, regreso_estimado, tarifa_comercial, referencia_cliente, ruta_id, ruta_codigo_historico, estado, ...` |
| `tms_plan_paradas` | **Solo** en `src/lib/flota/schema.ts` (runtime, `asegurarSchemaFlotaInner()`) — **no existe ningún `CREATE TABLE` en `sql/*.sql`, ni siquiera en `schema.sql`** | `id, plan_id, orden (TINYINT), lugar_id, lugar_nombre (VARCHAR 200 NOT NULL), tipo (VARCHAR 40, 'Carga'/'Descarga'/'Entrega'), requiere_evidencia (TINYINT(1))`. `INDEX idx_tpp_plan(plan_id)`. Sin FK en `plan_id`. `cliente_ubicacion_id` fue agregada después como columna aditiva (`migrate-2026-08-viat-1-cliente-ubicaciones.sql`, confirmada aplicada). |
| `tms_lugares` | `sql/schema.sql` | Catálogo de lugares (carga/descarga), reutilizado por `upsertLugar()`. |
| `tms_cliente_ubicaciones` | `sql/schema.sql` | `id, empresa_id, cliente_id (→ tms_clientes.id), nombre, direccion, municipio, departamento, referencia, tipo ('AMBOS' default), activo, creado_en`. Ya es "las direcciones guardadas de un cliente" — candidato natural para que el cliente elija origen/paradas/destino desde una lista propia en vez de texto libre. |
| `clientes` | `sql/schema.sql` | Lado **Facturación**: `id, empresa_id, codigo, nombre, razon_social, nit, ..., tms_cliente_id (bridge)`. `UNIQUE(empresa_id, tms_cliente_id)`. **Nunca comparar `clientes.id = tms_clientes.id` directamente** — son universos distintos unidos solo por ese bridge. |
| `tms_clientes` | `sql/schema.sql` | Lado **TMS**: `id, empresa_id, nombre, nit, telefono, direccion, estado`. Es la tabla que referencia `tms_planes_viaje.cliente_id`. |
| `flota_viajes` | `sql/schema.sql` | Registro operativo del viaje físico (salida/llegada/km), 1:1 opcional con un `tms_planes_viaje` vía `plan_id` (nullable, vínculo puede ser automático o manual — ver `src/lib/tms/vincular-viaje-plan.ts`). |
| `flota_viaje_evidencias` | **Solo** en `src/lib/flota/schema.ts` (runtime) — tampoco tiene `CREATE TABLE` en `sql/*.sql` | `id, empresa_id, viaje_id, tipo, ruta_relativa, nombre_original, mime, tamano, latitud, longitud, capturado_en, subido_por, creado_at` + `parada_id` (aditiva, nullable, sin FK/CASCADE a propósito). |
| `tms_evidencias` | `sql/schema.sql` (+ `parada_id` aditiva vía `ensureColumn`) | `id, empresa_id, plan_id (→ tms_planes_viaje.id, CASCADE), tipo, ruta_archivo, nombre_original, latitud, longitud, capturado_en, subido_por, parada_id`. Evidencia "del lado TMS" — sincronizada desde `flota_viaje_evidencias` cuando el viaje está vinculado a un plan. |

**Hallazgo a documentar sin corregirlo (fuera de alcance):** `tms_plan_paradas` y
`flota_viaje_evidencias` no tienen `CREATE TABLE` en `sql/`; su esquema real solo
existe como DDL ejecutado en caliente por `src/lib/flota/schema.ts`
(`GET_LOCK('plataforma_flota_schema')` → crea si falta). Esto es un patrón
distinto al resto del proyecto (que documenta explícitamente "no runtime DDL" en
varias cabeceras de `sql/migrate-*.sql`). No se propone corregirlo aquí — es
importante que cualquier ticket de implementación posterior lo sepa, porque si el
futuro `tms_solicitudes_cliente` sigue este mismo patrón runtime, el `schema.sql`
seguiría quedando desactualizado exactamente igual que hoy con estas dos tablas.

No se encontró ninguna otra tabla TMS relacionada con clientes/paradas/evidencias
además de las listadas arriba (`tms_cliente_contactos`, `tms_cliente_rutas`
también existen pero son catálogos de contacto/ruta-plantilla, sin relación
directa con paradas o solicitudes).

---

## 2. Modelo actual de `clientes` / concepto de usuario-cliente

Búsqueda exhaustiva (`grep -ri` sobre `src/`, `sql/`, `docs/`) de
`cliente_usuario`, `usuario_cliente`, `portal.*cliente`, `acceso.*cliente`,
`credencial.*cliente`: **cero resultados**. No existe ningún concepto de login de
cliente, ni tabla, ni endpoint, ni borrador. Es un punto de partida limpio — no
hay nada que migrar ni que romper.

`clientes`/`tms_clientes` (descritas en §1) modelan al cliente como **entidad
administrada por el staff**: el staff los crea, edita, y hoy es el único que los
usa para programar viajes. No tienen columna de credenciales, email verificado,
ni ningún campo pensado para autenticación.

---

## 3. Autenticación existente — qué se puede reutilizar

### 3.1 Patrón directamente reutilizable: Portal del colaborador

`src/lib/rrhh/colaborador-session.ts` (84 líneas, leído completo) es la plantilla
recomendada:

- JWT vía `jose` (`SignJWT`/`jwtVerify`), **mismo `AUTH_SECRET`** que el staff
  (`getAuthSecretBytes()`) — comparten secreto de firma sin problema, porque lo
  que impide el cruce de sesiones es la **cookie distinta** y el **payload
  distinto**, no el secreto.
- Cookie propia: `sitsa_colab_session` (constante `COLABORADOR_SESSION_COOKIE`),
  separada de `sitsa_session` (staff).
- Payload mínimo: `{ empleadoId, empresaId, empresaSlug?, nombre?,
  debeCambiarPassword? }`.
- Expira a las 12h (`SESSION_HOURS`), cookie `httpOnly`, `secure` solo en prod,
  `sameSite: "lax"`.
- `getColaboradorSession = cache(readColaboradorSession)` — dedup por request en
  RSC.

`src/lib/rrhh/colaborador-auth.ts` (255 líneas, leído completo) es la plantilla de
gestión de credenciales: `hashPassword`/`verifyPassword`/`necesitaRehash` desde
`@/lib/password` (scrypt con migración transparente de hash legado — mismo
mecanismo que usa el staff), funciones para crear/verificar/resetear/cambiar
usuario y password, con un detalle importante: `verificarCredencialesColaborador`
**también exige `empleado.estado === 'Activo'`** — desactivar a la persona revoca
el acceso al portal automáticamente, sin tocar la fila de credenciales.

**Desviación necesaria para el cliente (no trivial, hay que diseñarla, no
copiarla literal):** `colaborador_credenciales` es estrictamente **1:1** con un
empleado (`crearCredencialColaborador` valida "exactamente una credencial por
empleado"). El ticket pide **múltiples usuarios por un mismo `cliente_id`**
(muchos-a-uno). La tabla equivalente para el portal del cliente NO puede copiar
esa restricción 1:1 — debe permitir N filas de `usuario_cliente` por 1
`cliente_id` (ver §15).

### 3.2 Propuesta conceptual de scope de sesión cliente (NO implementada)

Siguiendo el mismo patrón, el payload de una futura sesión de cliente debería
llevar como mínimo:

```
{ empresaId, clienteId, usuarioClienteId, nombre?, debeCambiarPassword? }
```

con cookie propia (ej. `sitsa_cliente_session`, nombre no final) para no
colisionar ni con `sitsa_session` (staff) ni con `sitsa_colab_session`
(colaborador). La diferencia conceptual clave frente al colaborador: el
colaborador se identifica por `empleadoId` (una persona = un empleado); el
cliente se identifica por `usuarioClienteId` (una persona puede ser una de varias
personas autorizadas por la misma empresa-cliente) **y** `clienteId` (la
empresa-cliente a la que pertenece) — **ambos** deben ir en el payload y
**ambos** deben validarse en cada query (ver IDOR, §14), no solo `empresaId`.

### 3.3 Qué NO se puede reutilizar tal cual

- `requireTenant*` (`src/lib/tenant.ts`, 17 funciones confirmadas) — todas parten
  de `getSession()` (cookie de **staff**) y de roles/permisos internos
  (`puedeEditarModulo`, `modulosPorRol`, `permisosEfectivos`). Ninguna sirve para
  un cliente. Se necesitará un guard nuevo, análogo en forma pero con fuente de
  sesión distinta (ver §14).
- `colaborador_credenciales` en sí (1:1), por lo ya explicado en 3.1.

---

## 4. Cómo se crea un plan hoy — reutilización sin duplicar lógica

`POST /api/empresas/[slug]/tms/planes` (`src/app/api/empresas/[slug]/tms/planes/route.ts:593` en adelante) es un flujo **rico y con efectos secundarios privilegiados**, no una simple inserción:

- Guard: `requireTenantProgramacion(slug, "crear")` — permiso específico de
  Programación, no genérico de TMS.
- Resuelve o **crea sobre la marcha** `tms_clientes` (por id o por nombre, con
  fallback a `crearClienteDesdeTms` o INSERT directo), `tms_unidades` (por placa,
  con `ON DUPLICATE KEY UPDATE`), `tms_personal` (piloto/auxiliares, por
  `empleadoId` o por nombre libre, creando registros nuevos si no existen).
- Valida disponibilidad real de la unidad (`listarDisponibilidadVehiculos`) y de
  piloto/auxiliares/unidad contra traslapes de horario
  (`primerConflictoTraslape`, mencionado más abajo en el archivo).
- Arma `paradasInput` a partir de `d.paradas` (formato nuevo) **o** de
  `lugarCarga`/`lugarDescarga` (compatibilidad clásica) — y aquí está la
  confirmación clave para §8: el propio creador ya trata
  `paradasInput.find(p => p.tipo === "Carga")` como el origen y
  `paradasInput.find(p => p.tipo === "Descarga" || p.tipo === "Entrega")` como el
  destino, dentro del mismo arreglo de paradas.
- Genera código único (`asegurarCodigoPlanUnico`).
- Guarda paradas vía `guardarParadasPlan` (la misma función descrita en el
  contexto previo — identity-based, no destructiva).

**Conclusión para el diseño de la solicitud de cliente:** este endpoint **no es
apto para ser llamado directamente por un cliente**, ni siquiera con más
validaciones — crea clientes/personal/unidades con datos libres del solicitante,
exactamente el tipo de escritura privilegiada que el ticket prohíbe explícitamente
que el cliente controle (piloto/auxiliar/unidad nunca los elige el cliente). La
solicitud del cliente debe ser una entidad **separada y mucho más angosta**
(solo origen + paradas + destino + observaciones, ver §6), y la conversión
solicitud → plan la sigue haciendo Operaciones **a través de este mismo
endpoint/flujo ya existente** (prellenando el formulario con los datos de la
solicitud), sin que el cliente dispare el INSERT de `tms_planes_viaje` ni de
ninguna tabla maestra. Esto evita duplicar la lógica de creación de plan (se
reutiliza tal cual) sin darle al cliente ninguno de sus efectos secundarios
privilegiados.

---

## 5. ¿Entidad "solicitud" separada, o alternativa?

Se evaluaron 3 opciones, tal como pide el ticket:

**Opción A — Reutilizar `tms_planes_viaje` con un estado "Solicitado" que el
cliente pueda crear directamente.**
Rechazada. Requeriría que el cliente pueda insertar en la tabla maestra de
planes (aunque sea con campos limitados), lo cual mezcla permisos de escritura
de una tabla operativa central con un actor externo no confiable, y obliga a que
todo el resto del sistema (reportes, cierres, viáticos, facturación, que ya leen
`tms_planes_viaje` asumiendo que solo Operaciones escribe ahí) tenga que empezar
a filtrar por estado "todavía no es un plan real". Viola separación de
responsabilidades y aumenta la superficie de IDOR sobre la tabla más crítica del
módulo TMS.

**Opción B — Guardar la solicitud como un registro genérico dentro de
`auditoria` o una tabla de "mensajes"/"tickets" sin estructura propia.**
Rechazada. La solicitud necesita campos estructurados y consultables (origen,
N paradas, destino, estado, quién la creó, cuándo, motivo de rechazo,
referencia al plan que la originó) con los que un cliente y Operaciones deben
poder filtrar/listar de forma fiable. Forzar eso dentro de una tabla de
propósito genérico (`auditoria.detalle` es texto libre) rompe trazabilidad real
y no permite transiciones de estado con integridad.

**Opción C (recomendada) — Entidad propia: `tms_solicitudes_cliente` +
`tms_solicitud_paradas`** (nombres no finales, siguiendo el ticket).

Justificación frente a los 8 criterios pedidos:

- **Seguridad/separación de responsabilidades:** el cliente solo tiene permiso de
  escritura sobre esta tabla nueva, nunca sobre `tms_planes_viaje` ni sus
  catálogos maestros. Operaciones es la única que puede convertir una solicitud
  en plan (mismo patrón de "conversión" que ya existe, ej. vínculo
  viaje↔plan en `src/lib/tms/vincular-viaje-plan.ts`).
- **Auditoría/historial:** cada solicitud es una fila con su propio ciclo de
  vida; se puede llevar bitácora con la misma tabla `auditoria` genérica ya
  existente (ver §20), sin inventar un sistema de auditoría paralelo.
- **Rechazo/cancelación:** son transiciones de estado naturales de una entidad
  propia (`RECHAZADA`, `CANCELADA`), imposibles de modelar limpiamente si la
  solicitud viviera dentro de `tms_planes_viaje`.
- **Cambios antes de programar:** el cliente puede editar/cancelar su solicitud
  mientras siga en un estado temprano (`SOLICITADA`), sin ningún riesgo de tocar
  un plan real ya en operación.
- **Concurrencia:** igual que con paradas (`bloquearParadaDelPlan`), conviene un
  `SELECT ... FOR UPDATE` sobre la fila de la solicitud antes de cualquier
  transición de estado — patrón ya probado en el proyecto, no hay que inventarlo.
- **Trazabilidad:** la solicitud queda enlazada al plan resultante vía
  `plan_id` nullable (rellenado solo cuando Operaciones la convierte), igual que
  `flota_viajes.plan_id` hoy es nullable y se llena después.

---

## 6. Modelo mínimo de estados (ejemplo conceptual, no final)

```
SOLICITADA → EN_REVISION → PROGRAMADA
     ↓             ↓
 CANCELADA     RECHAZADA
```

- `SOLICITADA`: creada por el cliente. El cliente puede editarla o cancelarla.
- `EN_REVISION`: Operaciones la está evaluando. El cliente ya no puede editarla
  (solo cancelar, si se permite en este estado — decisión de negocio pendiente,
  ver §25), evita condiciones de carrera con quien la está revisando.
- `PROGRAMADA`: Operaciones la convirtió en un `tms_planes_viaje` real —
  `plan_id` queda enlazado. A partir de aquí el cliente pasa a modo
  solo-lectura/seguimiento sobre el plan (§9 del ticket, área de seguimiento).
- `RECHAZADA`: transición exclusiva de Operaciones, con motivo obligatorio.
- `CANCELADA`: transición del cliente (mientras el estado lo permita) o de
  Operaciones.

Todas las transiciones deberían pasar por el mismo patrón de lock ya usado en el
resto del proyecto (`SELECT ... FOR UPDATE` sobre la fila de la solicitud dentro
de una transacción, luego `registrarAuditoriaTx` en la misma conexión, luego
commit) — no hay que diseñar un mecanismo de concurrencia nuevo.

---

## 7. Representación de origen / entregas / destino final

Confirmado con evidencia directa (§1, §4): **`tms_plan_paradas.tipo` ya distingue
`Carga` (origen), `Entrega` (parada intermedia) y `Descarga` (destino final)
dentro del mismo arreglo ordenado por `orden`.** No hace falta inventar una
representación nueva para la solicitud del cliente — el mismo esquema de
"paradas tipadas y ordenadas" que ya usa un plan real es la forma natural de
capturar lo que pide el ticket (origen + N paradas + destino final) en la futura
`tms_solicitud_paradas`.

Esto también simplifica la conversión solicitud → plan: si la solicitud guarda
sus paradas con la misma forma (`orden`, `lugar_nombre`/`lugar_id`, `tipo`), el
código que hoy arma `paradasInput` en el POST de planes puede recibir
prácticamente la misma estructura sin tener que traducir un modelo distinto.

---

## 8. `cantidad_entregas`: ¿campo explícito o derivado?

Recomendación: **derivado**, no un campo propio. `tms_plan_paradas`/la futura
`tms_solicitud_paradas` ya son la fuente de verdad ordenada; contar
`COUNT(*) WHERE tipo = 'Entrega'` es una consulta trivial y evita el riesgo de
que un campo `cantidad_entregas` quede desincronizado si alguien edita las
paradas sin recordar actualizar el contador (el mismo tipo de bug que
`guardarParadasPlan` ya evita al ser identity-based en vez de mantener un
contador aparte). Ningún otro conteo similar en el proyecto (evidencias
pendientes, paradas completadas) se guarda como columna — todos se calculan al
vuelo (`paradasPendientesEvidencia`, `listarParadasDePlanes`) — mantener la
misma convención.

---

## 9. Evidencias — modelo actual y visibilidad para el cliente

Ya cubierto en detalle en §1: `flota_viaje_evidencias` (origen real de la subida
del piloto) + `tms_evidencias` (espejo del lado TMS, alimentado desde el mismo
flujo cuando el viaje está vinculado a un plan). Ambas tienen `parada_id`
nullable sin FK/CASCADE — a propósito, para que la evidencia nunca se borre en
cascada si una parada cambia.

Para que un cliente vea evidencias de **su propio** viaje, la consulta deberá:

- Filtrar siempre por `empresa_id` + (`plan_id`/`viaje_id`) que a su vez estén
  ligados a un plan cuyo `cliente_id` coincida con el `clienteId` de la sesión —
  nunca al revés (nunca confiar en un `clienteId` que venga en la URL/body, ver
  §14).
- Ocultar explícitamente lo que el ticket prohíbe mostrar: auditoría interna
  (tabla `auditoria`, de uso exclusivo staff), cualquier dato de otro cliente
  (obvio por el filtro anterior, pero hay que probarlo con un caso IDOR real),
  y todo dato salarial/viáticos/administrativo de RRHH — ninguno de estos vive en
  las tablas que el cliente necesitaría consultar (`tms_planes_viaje`,
  `tms_plan_paradas`, `tms_evidencias`), así que el riesgo principal no es un
  campo suelto sino un JOIN mal filtrado que exponga por accidente una fila de
  otro cliente o de otra empresa.

La ruta de descarga de archivo (`GET .../evidencias?adjuntoId=`) en el portal del
piloto (`src/app/api/portal/viajes/[id]/evidencias/route.ts:56-77`) es un buen
modelo a imitar: valida participación/propiedad ANTES de leer el archivo del
disco, nunca sirve un archivo por id suelto sin verificar pertenencia.

---

## 10. Tracking real existente hoy

Confirmado explícitamente (no hay que asumir nada): **no existe tracking GPS en
tiempo real**. Lo que existe es:

1. **Tracking basado en eventos/estado**: `tms_planes_viaje.estado`
   (`Programado`/`Cargado`/`En ruta`/...), `flota_viajes.estado`
   (`abierto`/`cerrado`), y los eventos discretos de salida/llegada/evidencia
   registrados en `src/app/api/portal/viajes/route.ts`.
2. **Geoetiquetado puntual por foto**: cada evidencia lleva `latitud`/`longitud`
   capturadas en el momento exacto de la subida (ver `viaje-form.tsx`, captura de
   GPS + sincronización de hora de servidor + estampado en el canvas de la
   imagen antes de subir). Esto es una foto de posición en un instante, **no**
   un flujo continuo de posición.

Para el portal del cliente, lo único honesto de ofrecer en una fase temprana es
el tracking basado en eventos (estado del plan + progreso de paradas +
evidencias con su sello de tiempo/posición) — **no se debe prometer ni construir
un mapa en tiempo real**, porque no hay ninguna fuente de datos continua detrás.

---

## 11. `src/app/portal/viajes` — comportamiento actual exacto

Revisados en conjunto `viaje-form.tsx` (419 líneas), `route.ts` (acciones
`salida`/`llegada`/`contratiempo`, 540 líneas) y `[id]/evidencias/route.ts` (255
líneas).

**Salida (`accion: "salida"`):**
- La dispara el piloto asignado (`personal.tipo !== "Piloto"` → 403).
- Exige placa + (si el vehículo tiene odómetro funcional) km de salida.
- Detecta automáticamente el plan asignado (por `planId` explícito o por
  emparejamiento único piloto+placa vía `buscarPlanesParaSalida`) — si hay 0 o
  2+ candidatos, el viaje queda sin `plan_id` y Operaciones debe vincularlo
  manualmente después.
- Bloqueada por lock (`GET_LOCK` por vehículo) + doble verificación de "unidad
  ya tiene viaje abierto" / "yo ya tengo un viaje abierto" — no depende
  únicamente del `UNIQUE` de la tabla.
- Si hay plan, lo pasa a "En ruta" (`marcarPlanEnRuta`).
- **No exige ninguna parada ni evidencia para poder salir.**

**Evidencia (`POST .../evidencias`):**
- El piloto elige libremente el tipo (`tablero_salida`/`producto`/
  `tablero_llegada`/`otro`) y, si es `producto`, la parada exacta de un
  desplegable con **todas** las paradas del plan, sin importar orden ni si las
  anteriores están completas — comentario explícito en el código: *"ya NO se
  exige orden secuencial [...] el piloto ELIGE explícitamente la
  dirección/parada [...] en vez de que el sistema calcule 'la siguiente'"*.
  Esta libertad es un rediseño deliberado (PORTAL-HARDENING-2, Fase C), no un
  descuido.
- La única validación real sobre `paradaId` es que pertenezca al mismo
  plan/viaje (`validarParadaDelPlan`) — nunca que sea "la parada que toca".

**Llegada (`accion: "llegada"`):**
- Formulario **siempre visible** mientras haya un viaje abierto — no depende de
  ningún estado de las paradas.
- Valida kilometraje (≥ salida, ≥ km actual del vehículo) y geocerca del predio
  (`validarGeocercaKiosko`).
- Si hay paradas pendientes de evidencia, arma un **aviso informativo**
  (`advertencias`), nunca un bloqueo — la respuesta HTTP es 200 igual.
- Comentario explícito en el código (líneas 458-468): *"el piloto NUNCA
  finaliza, cierra ni cancela la operación [...] Registrar la llegada aquí ya NO
  cambia el estado del plan TMS, y ya NO exige completar evidencias primero."*
  Esto confirma que el registro de llegada de hoy es **puro respaldo
  operativo**, sin ningún efecto administrativo — el cierre real del plan lo
  hace exclusivamente Operaciones desde Programación
  (`src/lib/tms/cierre-viaje.ts`, ya conocido de tickets anteriores de esta
  sesión).

**Contratiempo:** solo auditoría (`registrarAuditoria`), nunca toca estado.

**Propuesta futura pedida por el ticket (SALIDA obligatoria →
paradas-seleccionables → DESTINO-FINAL-bloqueado-hasta-pendientes=0 →
kilometraje-final):**

Técnicamente es implementable reutilizando las piezas ya existentes:

1. **Salida obligatoria y no seleccionable como parada**: ya es así de facto —
   `accion: "salida"` es un paso propio, separado del formulario de evidencias;
   no aparece como opción del desplegable de paradas. No requiere cambio de
   fondo, solo reforzar (si hiciera falta) que el tipo `Carga` nunca se ofrezca
   como opción de evidencia libre.
2. **Paradas intermedias libremente seleccionables**: ya es el comportamiento
   actual tal cual (§11) — no requiere cambio.
3. **Destino final bloqueado mientras pendientes > 0**: **requiere reintroducir
   un bloqueo que Fase F retiró a propósito.** La función `paradasPendientesEvidencia(planId)`
   (`src/lib/tms/paradas.ts`) ya calcula exactamente ese conteo — la pieza de
   cálculo existe y es reutilizable; lo que falta es la decisión de negocio de
   volver a usarla como **gate bloqueante** en vez de como aviso informativo, y
   el cambio de UX correspondiente (deshabilitar la opción "Descarga"/destino
   final en el desplegable de evidencia y el botón de llegada, o separar
   "llegada física" de "cierre de entregas" como dos pasos distintos).
4. **Kilometraje final**: ya se captura junto con la llegada (`kmLlegada` en el
   mismo formulario) — no requiere cambio de esquema, solo decidir si sigue
   siendo un solo paso o se separa en dos.

**Este es el hallazgo más importante para negocio de todo el documento:** el
punto 3 no es "agregar una validación que faltaba" — es **deshacer** una decisión
de producto ya tomada y documentada en el propio código
(PORTAL-HARDENING-2, Fase C/F: "las evidencias son respaldo — no bloquea salida,
llegada ni cierre"). Debe presentarse al dueño de Operaciones como una pregunta
explícita, no implementarse como si fuera una corrección técnica neutral (ver
§25).

---

## 12. "Parada completada" — criterio actual

Hoy **no existe** un estado explícito "completada" en `tms_plan_paradas` (no hay
columna `estado`/`completada_en`). El único criterio disponible, calculado al
vuelo, es **presencia de evidencia**: `evidencias = COUNT(tms_evidencias) +
COUNT(flota_viaje_evidencias)` por `parada_id`
(`listarParadasDePlanes`/`paradasPendientesEvidencia`), sin distinguir quién la
subió ni cuándo más allá del timestamp de la evidencia misma.

Implicación directa para el portal del cliente: si se le muestra "progreso de
entregas", ese progreso hoy solo puede significar **"¿tiene al menos una
evidencia adjunta?"**, no un evento explícito de cierre de parada. Si el negocio
quiere un criterio más fuerte (ej. requerir que el piloto marque explícitamente
"entregado" además de subir foto), eso es un campo nuevo (`completada_en`,
`completada_por`) que no existe hoy y sería una decisión de negocio a tomar en
una fase de implementación, no algo que este discovery deba inventar.

---

## 13. "Destino adicional" — implicaciones técnicas

Hoy no existe ningún botón ni endpoint de "agregar destino adicional" —
confirmado por ausencia total en `viaje-form.tsx` y en las rutas de portal
revisadas. Es, tal como dice el ticket, una funcionalidad genuinamente nueva.

Reutilizando `tms_plan_paradas` (que ya soporta múltiples filas ordenadas por
`orden` con `tipo` libre), la implicación técnica más directa es: un "destino
adicional" extraordinario sería una fila más en la misma tabla, con un `tipo`
que la distinga de las paradas originalmente solicitadas por el cliente (ej. un
valor de `tipo` nuevo, o una columna booleana `agregada_en_ruta` — nombre no
final) para poder diferenciarla después en auditoría/reportes sin ambigüedad.

Puntos que deben resolverse como decisión de negocio antes de diseñar esto en
detalle (no se resuelven aquí):

- **Quién puede agregarlo**: ¿solo el piloto en ruta? ¿requiere aprobación de
  Operaciones en el momento, o se registra y se audita después?
- **Motivo obligatorio**: el patrón ya usado en "contratiempo" (motivo mínimo de
  10 caracteres, solo auditoría) es un precedente directo a imitar si se decide
  que no bloquea nada, solo se registra.
- **Preservar el destino final original**: la parada `Descarga` original nunca
  debe ser reemplazada ni reordenada por la inserción de un destino adicional —
  debe insertarse antes de ella en el `orden`, nunca sustituirla.
- **Concurrencia**: mismo patrón ya probado (`bloquearParadaDelPlan` +
  `FOR UPDATE`) para evitar que una inserción de destino adicional choque con
  una eliminación/reordenamiento concurrente de paradas por Operaciones.
- **Evidencia**: si el destino adicional también requiere evidencia, se hereda
  gratis del modelo actual (`requiere_evidencia` por parada).

---

## 14. Controles anti-IDOR obligatorios

Regla general que debe aplicarse a **cada** query nueva del portal del cliente,
sin excepción: la identidad (`empresaId`, `clienteId`, `usuarioClienteId`) sale
**siempre** de la sesión del servidor, nunca de un parámetro de la URL/body. Todo
`viajeId`/`planId`/`paradaId`/`evidenciaId` que llegue del cliente debe validarse
con un JOIN que confirme pertenencia real, no solo existencia. El patrón exacto
ya usado en el portal del colaborador es la plantilla a seguir:

- `colaboradorParticipaEnViaje` (`src/lib/flota/viajes-piloto.ts:114-140`): nunca
  confía en el `viajeId` por sí solo — hace `SELECT ... WHERE fv.id = ? AND
  fv.empresa_id = ? AND (fv.empleado_id = ? OR pil.id_empleado = ? OR ...)`,
  combinando el recurso solicitado con la identidad de sesión en la misma
  cláusula `WHERE`.
- `validarParadaDelPlan` (`src/lib/tms/paradas.ts`): mismo patrón para paradas.
- El endpoint de descarga de evidencia (§9) valida pertenencia antes de leer el
  archivo del disco.

Para el cliente, el join de aislamiento necesita **una capa extra** que el
colaborador no necesita: el colaborador se filtra solo por `empresa_id` +
"soy yo" (`empleado_id`); el cliente necesita filtrarse por `empresa_id` **y**
`cliente_id` (la empresa-cliente completa, no solo "el usuario que soy yo"),
porque varios `usuario_cliente` de la misma empresa-cliente deben poder ver los
mismos viajes de esa empresa. Cada query de solicitudes/planes/paradas/evidencias
para el portal del cliente debe llevar ambos filtros:
`... WHERE p.empresa_id = ? AND p.cliente_id = ?` (sacados de la sesión), nunca
uno solo.

No existe hoy ningún `requireTenantCliente`-equivalente (§3.3) — es una pieza
nueva a construir, con la misma forma que `requireTenant*` pero leyendo la
cookie/sesión del cliente en vez de la del staff.

---

## 15. Múltiples usuarios por cliente

Recomendado: sí, diseñar desde el inicio una entidad `usuario_cliente`
(nombre no final) en relación **muchos-a-uno** con `cliente_id` — no 1:1 como
`colaborador_credenciales` (§3.1). Campos mínimos a evaluar en la fase de diseño
detallado (no se crean aquí): `id, empresa_id, cliente_id, nombre, email,
password_hash, activo, ultimo_acceso, creado_por, creado_en`, y en una fase
posterior, permisos por usuario (§16). El campo `creado_por` es importante desde
ya conceptualmente: alguien (¿el propio cliente principal? ¿el staff, a pedido
del cliente?) debe poder dar de alta a los demás usuarios de esa empresa-cliente
— quién tiene esa capacidad es una decisión de negocio pendiente (§25).

---

## 16. Escopos de permisos futuros (sin construir RBAC completo ahora)

Los 5 escopos que pide el ticket, como conjunto mínimo a diseñar (no implementar
todavía):

- `solicitar` — crear/editar/cancelar solicitudes propias.
- `consultar_solo` — ver solicitudes/viajes/evidencias de su empresa-cliente,
  sin poder crear ni cancelar nada.
- `administrar_usuarios_del_cliente` — dar de alta/baja otros `usuario_cliente`
  de la misma empresa-cliente.
- `cancelar_solicitudes` — puede ser el mismo que `solicitar` o separado, según
  decida el negocio (¿cualquiera que solicita puede cancelar, o solo un rol
  superior dentro del cliente?).
- `consultar_reportes` — acceso a vistas agregadas/históricas, si en el futuro
  se ofrece algo más que el seguimiento de un viaje puntual.

No se requiere una tabla de roles/permisos granular en la primera fase — puede
bastar con 1-2 columnas booleanas/enum simples en `usuario_cliente` hasta que
haya una necesidad real de granularidad mayor (mismo criterio de "no construir
lo que no se necesita todavía" que ya se aplicó en otras partes del proyecto).

---

## 17. Concurrencia

Todos los escenarios de concurrencia relevantes ya tienen un patrón probado en el
proyecto, reutilizable sin inventar nada nuevo:

- **Transición de estado de una solicitud** (ej. cliente cancela justo cuando
  Operaciones la está convirtiendo en plan): `SELECT ... FOR UPDATE` sobre la
  fila de la solicitud dentro de una transacción, como ya hace
  `bloquearParadaDelPlan`.
- **Edición de paradas de una solicitud mientras Operaciones ya la está
  revisando**: mismo patrón dual usado en `guardarParadasPlan` — chequeo
  optimista rápido para UX + re-chequeo definitivo bajo lock dentro de la
  transacción real.
- **Conversión solicitud → plan** concurrente con una segunda conversión (doble
  clic, dos usuarios de Operaciones): lock sobre la fila de la solicitud antes de
  crear el plan, y solo permitir la conversión si su estado sigue siendo el
  esperado (mismo principio que ya usa `vincularViajeAPlan` para "un plan = un
  solo viaje técnico").

---

## 18. Auditoría

La tabla genérica `auditoria` (`empresa_id, usuario, accion, modulo, detalle,
creado_en`) ya es usada por absolutamente todo el proyecto (viáticos, paradas,
salida/llegada/contratiempo del portal del piloto, cambios de plan) y es
directamente reutilizable para el portal del cliente sin ningún cambio de
esquema. Dos funciones ya existentes cubren los dos casos necesarios:

- `registrarAuditoria(input)` — uso normal, fuera de una transacción, nunca
  bloquea la operación principal si falla (`try/catch` interno).
- `registrarAuditoriaTx(conn, input)` — dentro de una transacción ya abierta por
  el caller; a propósito no inicia ni cierra la transacción ni silencia errores
  (`"responsabilidad del caller"`, comentario en el propio archivo) — es la que
  debe usarse en cualquier transición de estado de solicitud que ya esté dentro
  de un `SELECT ... FOR UPDATE`/transacción.

Convención de `usuario` a seguir: el portal del colaborador usa
`portal:${empleado.codigo}` como valor de `usuario` en cada auditoría — el portal
del cliente debería seguir la misma convención (ej.
`portal-cliente:${usuarioClienteId}` o similar) para poder distinguir a simple
vista, en cualquier reporte de auditoría existente, qué acciones vinieron de un
cliente externo frente a staff o colaborador.

Eventos mínimos que deberían auditarse (mismo nivel de detalle que ya se usa
para salida/llegada/evidencia del piloto): creación de solicitud, edición de
solicitud, cancelación (cliente y staff), rechazo (staff, con motivo),
conversión a plan, y cualquier futura acción de "destino adicional" o alta/baja
de un `usuario_cliente`.

---

## 19. Esquema hipotético (SOLO PROPUESTA — nada de esto fue creado)

```
-- NINGUNA de estas tablas fue creada. Ejemplo conceptual únicamente,
-- para discutir en un ticket de implementación posterior.

tms_solicitudes_cliente
  id, empresa_id, cliente_id, usuario_cliente_id,
  estado ('SOLICITADA'|'EN_REVISION'|'PROGRAMADA'|'RECHAZADA'|'CANCELADA'),
  observaciones, motivo_rechazo,
  plan_id (nullable, se llena al convertir),
  creado_en, actualizado_en

tms_solicitud_paradas
  id, solicitud_id, orden, lugar_nombre, tipo ('Carga'|'Entrega'|'Descarga'),
  cliente_ubicacion_id (nullable, → tms_cliente_ubicaciones.id)

usuario_cliente
  id, empresa_id, cliente_id, nombre, email, password_hash,
  activo, ultimo_acceso, creado_por, creado_en
```

Ninguno de estos nombres es final; el propósito es solo mostrar que la forma
encaja con lo que ya existe (mismo patrón `orden`/`tipo` que
`tms_plan_paradas`, mismo patrón de sesión que `colaborador_credenciales`) sin
inventar conceptos nuevos donde ya hay uno probado.

---

## 20. Endpoints propuestos (hipotéticos, ninguno creado)

Siguiendo la convención ya usada por `/api/portal/*`:

- `POST /api/portal-cliente/auth/login` / `logout` / `cambiar-password`
- `GET /api/portal-cliente/solicitudes` — listar solicitudes propias
- `POST /api/portal-cliente/solicitudes` — crear
- `PATCH /api/portal-cliente/solicitudes/[id]` — editar/cancelar (solo en
  estados tempranos)
- `GET /api/portal-cliente/viajes` — seguimiento de viajes ya programados de su
  empresa-cliente (solo lectura)
- `GET /api/portal-cliente/viajes/[id]/evidencias` — solo lectura, mismo patrón
  de validación de pertenencia que el endpoint del piloto

Del lado staff, para la conversión:

- `POST /api/empresas/[slug]/tms/solicitudes/[id]/convertir-a-plan` — reutiliza
  el flujo de creación de planes ya existente, prellenado con los datos de la
  solicitud.
- `POST /api/empresas/[slug]/tms/solicitudes/[id]/rechazar`

---

## 21. Evaluación de la división en 8 fases propuesta por el ticket

La secuencia propuesta (CLIENTE-PORTAL-1..5, PORTAL-PILOTO-RUTA-1..2,
CLIENTE-PORTAL-HARDENING) es razonable y respeta el principio de "cambios
pequeños y reversibles" de este proyecto. Un ajuste sugerido:

- **Separar explícitamente la decisión de negocio del punto 3 de §11** (destino
  final bloqueado mientras pendientes > 0) de la implementación de
  PORTAL-PILOTO-RUTA-1. Es decir, antes de abrir ese ticket, debe existir una
  respuesta explícita y documentada del dueño de Operaciones a "¿confirmamos que
  se revierte la política de Fase C/F?" — no debe descubrirse como sorpresa a
  mitad de la implementación.
- **CLIENTE-PORTAL-HARDENING no debería ser la última fase** sino que cada fase
  (1-5) debería incluir su propio control anti-IDOR desde el principio (mismo
  criterio que ya se sigue en el resto del proyecto: la seguridad no se agrega al
  final). Sugerido: renombrar esa fase final a algo más específico
  (ej. "auditoría cruzada + pruebas de aislamiento multi-cliente"), reservada
  para pruebas de penetración internas entre clientes ficticios, no para la
  primera línea de defensa.
- El resto de la secuencia (modelo+auth → crear/consultar solicitudes →
  Operaciones convierte → seguimiento → evidencias visibles) sigue el orden
  natural de dependencias correctamente y no requiere cambios.

---

## 22. Riesgos

- **Riesgo de negocio, no técnico:** el punto más sensible de todo el documento
  es §11 — revertir una política de "las evidencias nunca bloquean" que fue
  removida deliberadamente. Implementarlo sin la conversación explícita con
  Operaciones podría reintroducir el problema que Fase F resolvió.
- **IDOR entre empresas-cliente:** el riesgo más grande de seguridad técnica.
  Cada query nueva debe filtrar por `cliente_id` real de sesión, nunca por un
  valor recibido del cliente — un solo JOIN mal filtrado expone datos de otra
  empresa-cliente.
- **`tms_plan_paradas`/`flota_viaje_evidencias` sin `CREATE TABLE` versionado**:
  cualquier tabla nueva de solicitudes que dependa de JOINs contra estas dos
  tablas hereda ese mismo punto ciego de `schema.sql` si no se documenta aparte.
- **Endpoint de creación de plan no apto para el cliente** (§4): si en la
  implementación real alguien intenta "ahorrar tiempo" reutilizando
  `POST /tms/planes` directamente para la conversión, hay que verificar
  explícitamente que el cliente nunca llega a ese endpoint ni a sus efectos
  secundarios (creación de `tms_clientes`/`tms_personal`/`tms_unidades`).
- **Doble sistema de credenciales**: si el futuro `usuario_cliente` no se
  diseña con cuidado desde el principio como muchos-a-uno, corre el riesgo de
  copiar la restricción 1:1 de `colaborador_credenciales` por inercia (§3.1) y
  bloquear el requisito explícito de múltiples usuarios por cliente.

---

## 23. Decisiones funcionales pendientes (requieren al dueño del negocio)

1. ¿Se confirma revertir la política "las evidencias nunca bloquean" para el
   caso específico de destino final con entregas pendientes? (§11, el hallazgo
   más importante del documento)
2. ¿Quién puede dar de alta nuevos `usuario_cliente` de una misma
   empresa-cliente — el propio cliente, o solo el staff a pedido del cliente?
   (§15)
3. ¿El cliente puede cancelar una solicitud que ya está `EN_REVISION`, o solo
   mientras sigue en `SOLICITADA`? (§6)
4. Para "destino adicional": ¿requiere aprobación en el momento, o se registra
   libremente y se audita después? ¿Quién puede agregarlo — solo el piloto, o
   también Operaciones de forma remota? (§13)
5. ¿Qué nivel de "parada completada" se necesita realmente — basta con
   "¿tiene evidencia?" (criterio ya disponible hoy) o el negocio quiere un
   evento explícito de "entregado" separado de la foto? (§12)
6. Alcance de "consultar_reportes" (§16): ¿qué reportes exactamente puede ver un
   cliente, más allá del seguimiento de un viaje puntual?

---

## 24. Fases recomendadas (ajuste sobre la propuesta del ticket)

1. **CLIENTE-PORTAL-1** — modelo (`usuario_cliente`, `tms_solicitudes_cliente`,
   `tms_solicitud_paradas`) + sesión/autenticación, con aislamiento por
   `empresa_id`+`cliente_id` desde el primer commit (no como fase aparte).
2. **CLIENTE-PORTAL-2** — crear/editar/cancelar/consultar solicitudes propias.
3. **CLIENTE-PORTAL-3** — Operaciones convierte solicitud → plan, reutilizando
   el flujo de creación de planes ya existente.
4. **CLIENTE-PORTAL-4** — seguimiento de viaje programado (estado + progreso de
   paradas, basado en eventos, nunca GPS en tiempo real).
5. **CLIENTE-PORTAL-5** — evidencias visibles al cliente (solo lectura, mismo
   patrón de validación de pertenencia que el portal del piloto).
6. **[DECISIÓN DE NEGOCIO explícita — punto de control, no un ticket]** —
   confirmar o descartar el bloqueo de destino final antes de abrir la fase 7.
7. **PORTAL-PILOTO-RUTA-1** — salida obligatoria (ya es así de facto) +
   entregas libremente seleccionables (ya es así hoy) + destino final
   bloqueado mientras pendientes > 0 (cambio real, condicionado al punto 6).
8. **PORTAL-PILOTO-RUTA-2** — destino/parada extraordinaria, con las preguntas
   de §13 ya resueltas de antemano.

---

## 25. Siguiente ticket concreto recomendado

**CLIENTE-PORTAL-1-MODELO-USUARIOS-AUTH**: diseñar y (con SQL preparado para
revisión, no ejecutado — regla de la casa) proponer el esquema real de
`usuario_cliente`/`tms_solicitudes_cliente`/`tms_solicitud_paradas`, más el
módulo de sesión/autenticación del cliente clonando el patrón de
`colaborador_session`/`colaborador_auth` con la desviación muchos-a-uno ya
identificada en §3.1/§15, y el guard `requireTenantCliente`-equivalente de
§14. Antes de abrir ese ticket, conviene resolver al menos la decisión #2 de
§23 (quién puede dar de alta usuarios de un cliente), porque afecta
directamente el diseño de la tabla.

---

## Respuestas directas a los 24 puntos del ticket

Todas las preguntas mandatorias del ticket quedaron respondidas dentro de las
secciones anteriores; este índice solo mapea pregunta → sección para facilitar
la revisión:

1–2 (mapa de tablas, `clientes`/login) → §1, §2
3 (auth reutilizable, scope de sesión) → §3
4–5 (creación de plan hoy, entidad solicitud) → §4, §5
6 (estados) → §6
7–8 (origen/entregas/destino, `cantidad_entregas`) → §7, §8
9 (evidencias/visibilidad) → §9
10 (tracking real) → §10
11 (portal piloto actual + propuesta futura) → §11
12 (parada completada) → §12
13 (destino adicional) → §13
14 (IDOR) → §14
15 (multiusuario) → §15
16 (permisos futuros) → §16
17 (concurrencia) → §17
18 (auditoría) → §18
19–20 (evaluación de las 8 fases + fases recomendadas) → §21, §24
