# TMS — Importación masiva de Programación desde Excel — Discovery (Trabajo B)

Estado: **solo discovery/propuesta. No se escribió código, no se creó rama, no se abrió PR.**
Punto de partida: `main = 5da3646f52a9143e0c39275740f895e2ddbda81d`.
No se tocó `src/lib/rrhh/catalogos-nomina.ts`.

---

## 1. Archivos y funciones existentes reutilizables

### 1.1 Patrón de importación Excel de dos fases (Rutas) — la plantilla arquitectónica a replicar

- [`src/lib/tms/rutas-import-excel.ts`](../src/lib/tms/rutas-import-excel.ts) — parser + generador de plantilla con ExcelJS. Columnas fijas, fila de encabezado repetido + fila de ejemplo (marcadas con `CODIGOS_ENCABEZADO`/`CODIGOS_EJEMPLO` para que el parser las ignore), helpers de celda (`cellStr`, `normalizarHora`, `numeroOpcional`, `listaTexto`, `listaMontos`, `normalizarTexto`).
- [`src/lib/tms/rutas-import.ts`](../src/lib/tms/rutas-import.ts) — el núcleo reutilizable:
  - `previsualizarImportacionRutas(empresaId, filas)` → preview de solo lectura: resuelve cada fila contra catálogo, agrupa clientes ambiguos por nombre normalizado (`GrupoClientePendiente`) para que una sola decisión del usuario aplique a todas las filas que matchean.
  - `confirmarImportacionRutas(empresaId, usuario, filas, decisiones, decisionesCliente)` → fase transaccional: **revalida todo contra la BD real** (nunca confía en el preview), escribe dentro de una transacción, salta (no aborta) filas con error de validación propio y solo hace rollback ante errores inesperados de BD, cierra con `registrarAuditoria()`.
- [`src/app/api/empresas/[slug]/tms/rutas/importar/route.ts`](../src/app/api/empresas/[slug]/tms/rutas/importar/route.ts) — contrato de API: un solo endpoint, `multipart/form-data`, campo `accion` (`validar` | `importar`), `GET` para descargar plantilla, límites `MAX_FILAS=2000` / `MAX_BYTES=15MB`, solo `.xlsx`, guard `requireTenantRutas(slug, "editar")`.

**Propuesta:** Programación reutiliza esta MISMA arquitectura (parser+plantilla / preview·confirmar / un endpoint con `accion`), no un patrón nuevo.

### 1.2 Validación de disponibilidad/traslapes

- [`src/lib/tms/disponibilidad-traslapes.ts`](../src/lib/tms/disponibilidad-traslapes.ts) — `primerConflictoTraslape(empresaId, recursos, intervalo, excluirPlanId, conn?)` ya hace exactamente el chequeo "piloto/auxiliar/unidad contra viajes existentes" que pide el ticket, distinguiendo ocupación real (En ruta/Cargado sin llegada técnica = indefinida) de intervalo planificado (Programado). Acepta `conn` para reutilizar una conexión transaccional — clave para la fase de confirmación. **Se reutiliza tal cual para el chequeo "contra viajes existentes"; no se reimplementa.**
- Para el chequeo NUEVO que no existe hoy — conflictos **entre filas del mismo Excel** (dos filas nuevas que aún no están en BD) — no hay equivalente. Hace falta una función en memoria, más simple que la de BD (no hay máquina de estados `Programado/En ruta/Cargado`, todas las filas candidatas están "Programadas" por definición): comparar pares de filas que comparten el mismo recurso (piloto, auxiliar o unidad) y ver si sus intervalos `[inicio, fin)` se solapan. Ver §5.

### 1.3 Resolución de personal (piloto/auxiliares) — el hallazgo más delicado

- [`src/app/api/empresas/[slug]/tms/planes/route.ts:526-561`](../src/app/api/empresas/[slug]/tms/planes/route.ts) — `personalDesdeEmpleado(empresaId, empleadoId, tipo)`: traduce un `empleados.id` (maestro RRHH, con `codigo` estable NOT NULL) al `tms_personal.id` operativo real que usan `tms_planes_viaje.piloto_id` / `auxiliar_id` / `tms_plan_auxiliares.personal_id`, vía el puente `tms_personal.id_empleado` (nullable, se llena por backfill código→nombre, ver `sql/migrate-2026-08-fase0-tms-personal-empleado.sql`).
- `validarPersonalId(empresaId, personalId, tipoEsperado)` (líneas 563-582) — valida que un `tms_personal.id` exista, sea de esa empresa y del tipo esperado (Piloto/Auxiliar) y esté habilitado (`estado='Activo'`).
- **Estas dos funciones NO están exportadas hoy** (son locales a `planes/route.ts`). Para no duplicar lógica (regla del CLAUDE.md), la Fase 1 de implementación debería extraerlas a un módulo compartido (p. ej. `src/lib/tms/personal-resolucion.ts`) y hacer que tanto `planes/route.ts` como el nuevo importador las consuman — sin cambiar su comportamiento.
- **Por qué importa:** `tms_personal.codigo` es **nullable** y de uso interno TMS (no siempre existe). El identificador seguro y estable para "Piloto"/"Auxiliar 1"/"Auxiliar 2" en el Excel es el **`empleados.codigo`** (RRHH, `NOT NULL`), exactamente el mismo que ya usa `rutas-import.ts` (`normalizarCodigoEmpleado`, formato `/^\d+$/`) para `tms_cliente_ruta_personal.empleado_id`. El importador de Programación debe resolver **empleado→personal** con `personalDesdeEmpleado`, igual que hace el POST de planes — nunca inventar un `tms_personal.id` ni aceptar uno del Excel.

### 1.4 Resolución de unidad/placa y disponibilidad física

- `tms_unidades` usa `placa` como identificador natural (`UNIQUE (empresa_id, placa)`). El POST de planes (`planes/route.ts:726-760`) resuelve/crea por placa vía `INSERT ... ON DUPLICATE KEY UPDATE`.
- La disponibilidad real **no se valida contra `tms_unidades.estado`** (ese campo existe pero el POST no lo consulta) — se valida contra [`listarDisponibilidadVehiculos(empresaId)`](../src/lib/operaciones/disponibilidad.ts) (`src/lib/operaciones/disponibilidad.ts:103`), que lee `flota_vehiculos` + viajes abiertos (`flota_viajes.estado='abierto'`) y expone `v.puedeEnviar` / `v.motivoNoDisponible`. **Reutilizar esta función tal cual** — no inventar un nuevo criterio de disponibilidad de unidad.
- Identificador recomendado para "Placa/unidad": **`placa`**, normalizada a mayúsculas (mismo criterio que el POST).

### 1.5 Rutas, clientes y tarifas

- Tabla real: `tms_cliente_rutas` (no `tms_rutas`) — **cada ruta pertenece a exactamente un `cliente_id` (NOT NULL)**. `codigo` es `UNIQUE (empresa_id, codigo)`, confirmado como identificador global del catálogo (147 códigos, 147 únicos). → El "Código ruta" del Excel YA implica el cliente (`tms_cliente_rutas.cliente_id`); la columna "Cliente" del Excel es una **validación cruzada redundante**, no una fuente independiente de verdad (ver §3/§4).
- [`src/lib/tms/ruta-tarifas.ts`](../src/lib/tms/ruta-tarifas.ts) — `tarifasActivasDeRuta(empresaId, rutaId)`, `tarifaParaSnapshot(empresaId, rutaId, tarifaId)` (valida pertenencia+vigencia y devuelve snapshot nombre/monto/moneda). `tms_cliente_rutas.tarifa_referencia` se mantiene sincronizado con la tarifa predeterminada activa.
- `tms_clientes` **no tiene columna `codigo`** — solo `nombre` (NOT NULL) y `nit` (nullable). No existe una clave de cliente universalmente estable aparte del NIT opcional. Esto es una limitación real del sistema, no algo que se pueda inventar (ver §3).
- [`src/lib/clientes/repository.ts`](../src/lib/clientes/repository.ts) — `crearClienteDesdeTms(empresaId, {nombre})`, usado por el POST como fallback al crear cliente por nombre. **No se necesita en el importador de Programación** — ver §3 (Cliente ya está resuelto vía ruta, nunca se crea uno nuevo aquí).

### 1.6 Generación de código de plan y bloqueo de concurrencia

- [`src/lib/tms/codigo-plan.ts`](../src/lib/tms/codigo-plan.ts) — `asegurarCodigoPlanUnico(empresaId, fechaPlan, deseado?)` genera `PLAN-YYYYMMDD-###` autoincremental por empresa+día. **El código de plan nunca lo aporta el usuario/Excel** — se reutiliza tal cual, un código por fila en el momento de insertar.
- `planes/route.ts:948-1003` — patrón de candado `GET_LOCK('tms_traslape_<empresaId>', 8)` / `RELEASE_LOCK` alrededor de la verificación de traslapes + inserción, para cerrar la ventana de carrera "verificar disponibilidad → escribir". **El importador masivo necesita el mismo candado**, adquirido una sola vez para todo el lote (ver §7).

---

## 2. Estructura exacta recomendada del Excel

Siguiendo el patrón visual de `rutas-import-excel.ts` (fila de encabezado + fila de ejemplo con formato remarcado + hoja de ayuda), 13 columnas en el orden que ya propusiste:

| Col | Encabezado | Tipo | Obligatoria |
|---|---|---|---|
| A | Fecha salida | Fecha (`YYYY-MM-DD` o fecha Excel) | Sí |
| B | Hora salida | Hora (`HH:mm`, 24h en la celda; se muestra ejemplo en 12h en la ayuda) | Sí |
| C | Código ruta | Texto (código de `tms_cliente_rutas`) | Sí |
| D | Cliente | Texto (nombre) — **validación cruzada, no fuente de verdad** | Sí (para validar) |
| E | Piloto | Código de empleado (`empleados.codigo`) | Sí |
| F | Placa/unidad | Placa | Sí |
| G | Auxiliar 1 | Código de empleado | No |
| H | Auxiliar 2 | Código de empleado | No |
| I | Tipo traslado | Texto libre (mismo campo que hoy, sin catálogo cerrado en el sistema actual) | No |
| J | Tarifa GTQ | Monto | No (se contrasta contra catálogo, ver §6) |
| K | Fecha regreso estimado | Fecha | Condicional* |
| L | Hora regreso estimado | Hora | Condicional* |
| M | Observaciones | Texto libre → `notas` | No |

\* El POST actual de planes (`planes/route.ts:889-897`) exige `regresoEstimado` cuando hay piloto, auxiliares o unidad asignados — y el template SIEMPRE los trae. Por lo tanto **K y L deben tratarse como obligatorias en la práctica** para este importador (regla ya existente, no una nueva).

---

## 3. Claves/identificadores recomendados por columna

| Columna | Identificador | Por qué |
|---|---|---|
| Código ruta | `tms_cliente_rutas.codigo` | Único por empresa, ya es el identificador de catálogo probado (147/147 únicos). |
| Cliente | **nombre, solo para validar** (no crea, no decide) | `tms_clientes` no tiene código estable. El cliente REAL del viaje se toma de `tms_cliente_rutas.cliente_id` (derivado del código de ruta) — la columna Excel solo debe **coincidir** (comparación normalizada, sin distinguir mayúsculas/acentos) con `tms_clientes.nombre` de ese `cliente_id`. Si no coincide → error bloqueante ("la ruta X pertenece a otro cliente"), nunca se reinterpreta ni se crea un cliente nuevo desde aquí. |
| Piloto / Auxiliar 1 / Auxiliar 2 | `empleados.codigo` | Único identificador estable para personal (`tms_personal.codigo` es nullable/no siempre existe). Se resuelve con `personalDesdeEmpleado` (extraída a lib compartida). |
| Placa/unidad | `tms_unidades.placa` (`UNIQUE (empresa_id, placa)`) | Igual que el POST de planes. |
| Tarifa GTQ | Sin identificador — monto contrastado contra `tarifasActivasDeRuta` | Ver §6. |

**Limitación que hay que aceptar, no resolver por decreto:** para Clientes no existe un código/clave más segura que el nombre — el diseño de arriba evita el problema apoyándose en que el código de ruta ya fija el cliente, así el nombre del Excel deja de ser una fuente de verdad y pasa a ser solo una verificación de cordura.

---

## 4. Reglas de validación (mapeadas 1:1 contra tu lista)

Todas corren en la fase `validar` (preview, sin escribir) y **se repiten íntegras** en `importar` contra datos frescos de BD (mismo criterio que `confirmarImportacionRutas`).

1. **Ruta existe y está activa** — `SELECT ... FROM tms_cliente_rutas WHERE empresa_id=? AND codigo=? AND activo=1`.
2. **Cliente existe** — nombre de la fila se normaliza y compara contra `tms_clientes.nombre` del `cliente_id` de la ruta (no búsqueda libre).
3. **Ruta corresponde al cliente** — mismo chequeo que (2): al no haber una tabla intermedia además de `tms_cliente_rutas.cliente_id`, (2) y (3) son en la práctica una sola comparación.
4. **Piloto existe y habilitado** — `personalDesdeEmpleado(empresaId, empleadoId, "Piloto")` + `tms_personal.estado='Activo'` (mismo criterio de `validarPersonalId`).
5. **Auxiliares existen y habilitados** — igual, tipo `"Auxiliar"`, para cada columna no vacía.
6. **Unidad existe y disponible** — placa contra `listarDisponibilidadVehiculos`, exige `v.puedeEnviar`.
7. **Tarifa contrastada contra vigente** — ver §6.
8. **Regreso > salida** — mismo chequeo que `planes/route.ts:662-667`, por fila.
9. **Conflictos de piloto/auxiliar/unidad contra viajes existentes** — `primerConflictoTraslape` por fila (piloto, cada auxiliar, unidad como recursos).
10. **Conflictos entre filas del mismo Excel** — nueva función en memoria (§5).
11. **Filas duplicadas** — definir "duplicada" como: mismo código de ruta + mismo piloto + misma unidad + mismo intervalo de fecha/hora de salida (normalizado). Se marca como error bloqueante, no se deduplica en silencio.
12. **Intervalos, no solo mismo día** — todos los chequeos de traslape usan el intervalo real `[inicio, fin)` vía `inicioViaje`/`finViajeDesdeInput`, igual que hoy.
13. **No confiar en Excel para nombres/tarifa cuando el catálogo resuelve** — nombre de ruta/cliente/piloto/auxiliar/unidad SIEMPRE se muestra en el preview tomado de catálogo (no de la celda), igual criterio que `rutas-import.ts`.

---

## 5. Estrategia de detección de traslapes

Dos capas, ambas obligatorias:

**(a) Fila contra BD real** — reutiliza `primerConflictoTraslape(empresaId, recursos, intervalo, null, conn?)` tal cual, una llamada por fila con `recursos = [piloto, auxiliar1, auxiliar2, unidad]` resueltos.

**(b) Fila contra las demás filas del mismo Excel (nueva)** — función pura nueva, p. ej. `primerConflictoTraslapeEnLote(filasResueltas)`:
- Construye para cada fila válida su lista de recursos + intervalo (mismos tipos `RecursoAValidar`/`IntervaloViaje` que ya existen).
- Compara cada par de filas que comparte al menos un recurso (mismo `tipo`+`id`); si sus intervalos se solapan, ambas filas se marcan en conflicto.
- No necesita BD ni máquina de estados — todas las filas candidatas cuentan como "Programado". Implementación: `O(n²)` sobre filas válidas es aceptable para el límite de filas propuesto (ver §9, mismo `MAX_FILAS` que rutas).
- Se ejecuta en `validar` y se repite en `importar` (las filas restantes tras descartar las que ya fallaron otras reglas).

---

## 6. Estrategia para la tarifa

- El monto final que se guarda en `tms_planes_viaje.tarifa_comercial` **nunca sale de la celda del Excel directamente** — sale de `tarifasActivasDeRuta(empresaId, rutaId)`, tomando la tarifa **predeterminada** activa de esa ruta (mismo criterio que usaría el usuario en el formulario manual, donde el snapshot se deriva de una tarifa elegida vía `tarifaParaSnapshot`).
- La celda "Tarifa GTQ" del Excel se usa **solo para contrastar**: si difiere del monto de la tarifa predeterminada activa (tolerancia sugerida: cualquier diferencia, ya que son montos exactos en GTQ) se marca como **advertencia visible en el preview** (no necesariamente bloqueante — a decidir contigo, ver preguntas abiertas al final) para que el usuario detecte de un vistazo filas con tarifa desactualizada en el Excel de origen.
- Si la ruta no tiene ninguna tarifa activa/predeterminada → error bloqueante (no se puede snapshot-ear nada), salvo que decidas permitir tarifa manual desde el Excel en ese caso puntual (pregunta abierta).

---

## 7. Estrategia transaccional

Mismo patrón en dos fases que Rutas, adaptado a "todo o nada" (tu preferencia explícita para V1):

1. **`accion=validar`** — 100% de solo lectura. Devuelve por fila: estado (`ok` / `error` / `advertencia`), datos resueltos desde catálogo (nombres reales, no los del Excel) y el detalle de cualquier conflicto/error. Ningún candado, ninguna escritura.
2. **`accion=importar`**:
   - Adquiere el **mismo candado por empresa** (`GET_LOCK('tms_traslape_<empresaId>', N)`) que usa el POST individual — pero para **todo el lote**, no por fila, evitando que otra creación de plan (individual o de otro import) se cuele a mitad del lote.
   - Revalida **todas las reglas de §4** contra BD fresca dentro de esa sección con candado (nunca confía en el preview, igual que `confirmarImportacionRutas`).
   - Si **cualquier fila** tiene error bloqueante → aborta el lote completo, no crea nada, libera el candado, responde con el detalle de errores (así se cumple "all-or-nothing" para V1).
   - Si todas las filas pasan → abre **una única transacción** (`conn.beginTransaction()`), inserta cada plan (reutilizando el loop de reintento de `asegurarCodigoPlanUnico` ante colisión de código), sus auxiliares (`guardarAuxiliaresPlan`) y sus viáticos si aplica (`sincronizarViaticosPlan`) — todo dentro de la misma `conn`, igual que el POST individual.
   - Cualquier error inesperado en cualquier fila → `rollback()` de TODO el lote (coherente con all-or-nothing).
   - `commit()` solo si las N filas se insertaron.
   - Libera el candado en `finally`, igual patrón que el POST actual.
   - Cierra con `registrarAuditoria()` (un registro de auditoría por import, o uno por fila — a decidir, sugiero uno por import con el resumen + IDs creados).

---

## 8. Cómo evitar doble importación

Dos capas:

- **Mecanismo que ya existe y protege gratis:** cada fila del Excel trae piloto+unidad+intervalo. Si el mismo archivo se importa dos veces, la segunda corrida encuentra que ESE piloto y ESA unidad ya están ocupados en ESE intervalo exacto (por los planes creados en la primera corrida) → `primerConflictoTraslape` (capa (a) de §5) lo bloquea igual que bloquearía dos viajes reales en conflicto. Es decir: reimportar el mismo archivo se comporta igual que pegar el mismo viaje dos veces a mano, y el sistema ya sabe rechazar eso.
- **Capa adicional recomendada (opcional, más defensiva/auditable):** registrar cada intento de importación (hash del archivo + usuario + fecha + resultado) en una tabla nueva pequeña, p. ej. `tms_importaciones_programacion` (empresa_id, usuario_id, hash_archivo, filas_totales, filas_importadas, creado_en). Antes de `validar`, si el hash exacto del archivo ya fue importado con éxito antes, se muestra una advertencia temprana ("este archivo ya se importó el [fecha] por [usuario]") — no bloquea (el usuario podría querer reimportar un archivo corregido con el mismo nombre/contenido parcial), solo informa. Esto es una mejora de UX, no la protección real — la protección real es la de traslapes de arriba.

---

## 9. Endpoints/componentes nuevos necesarios

- `src/lib/tms/programacion-import-excel.ts` — parser + generador de plantilla (equivalente a `rutas-import-excel.ts`).
- `src/lib/tms/programacion-import.ts` — `previsualizarImportacionProgramacion` / `confirmarImportacionProgramacion` (equivalente a `rutas-import.ts`), incluyendo la nueva función de conflictos-entre-filas de §5.
- `src/lib/tms/personal-resolucion.ts` (extracción, no duplicación) — `personalDesdeEmpleado` / `validarPersonalId` movidas fuera de `planes/route.ts` para que ambos (POST individual y el nuevo importador) las compartan sin reescribir lógica.
- `src/app/api/empresas/[slug]/tms/programacion/importar/route.ts` — mismo contrato que el de rutas: `GET` (plantilla), `POST` multipart con `accion=validar|importar`, guard `requireTenantProgramacion(slug, "crear")` (el mismo permiso que ya exige crear un plan individual).
- Componente de UI en `src/app/e/[slug]/programacion/` — botón "Importar Excel" + modal de subida → vista previa de errores/advertencias por fila → confirmar. Puede inspirarse directamente en el componente existente de importación de Rutas (a identificar en la fase de implementación, no localizado en este discovery porque no se pidió).
- Límite de filas: reutilizar el mismo criterio (`MAX_FILAS`, `MAX_BYTES`) que rutas, valor exacto a confirmar contigo (¿2000 también aquí, o menos dado que cada fila es más pesada de validar por los traslapes?).

---

## 10. Riesgos

- **Doble espacio de IDs de personal** (§1.3) es el riesgo técnico más alto de todo el diseño: si el importador resolviera por `tms_personal.id` directo (en vez de `empleados.codigo` → `personalDesdeEmpleado`), un código mal tecleado podría silenciosamente asignar el viaje a la persona equivocada o fallar a resolver a alguien que sí existe. Mitigado por reutilizar exactamente la función ya probada.
- **`O(n²)` de conflictos entre filas** — aceptable para cientos de filas, revisar si el límite de filas propuesto (~2000, igual que Rutas) sigue siendo razonable en tiempo de respuesta; si no, se puede acotar agrupando primero por recurso (piloto/auxiliar/unidad) antes de comparar pares, bajando el costo práctico.
- **Candado único por empresa durante todo el lote** — un import grande podría mantener el `GET_LOCK` bastante tiempo, bloqueando creaciones/ediciones individuales de otros usuarios de la misma empresa mientras corre. Mitigable limitando el tamaño del lote o corriendo la revalidación fuera del candado y tomándolo solo para el tramo de escritura final (a diseñar en detalle en la fase de implementación).
- **Ambigüedad de "Tipo traslado"** — hoy es texto libre sin catálogo cerrado en el sistema; el Excel heredaría esa libertad, lo que significa que no hay forma de "validar" ese campo más allá de no vacío. Confirmar si esto es aceptable o si se espera una lista cerrada (cambio de alcance mayor, no incluido en este discovery).
- **Advertencia vs. error en la tarifa** (§6) — si se bloquea toda fila cuya tarifa Excel no calce exacto con la tarifa vigente, un Excel con montos históricos ligeramente desactualizados podría bloquear TODO el lote por la regla all-or-nothing. Recomiendo tratarlo como advertencia no bloqueante en V1, pero es una decisión de negocio tuya, no técnica.
- **`tms_planes_viaje.codigo`** se genera con reintento ante colisión (`asegurarCodigoPlanUnico`, hasta 5 intentos en el POST individual) — en un lote de N filas dentro de una sola transacción, cada fila necesita su propio ciclo de intento; hay que verificar que el `SELECT` de unicidad de `asegurarCodigoPlanUnico` funcione correctamente leído desde dentro de la misma conexión/transacción (usa `query()` global, no la `conn` de la transacción) — punto a resolver en la fase de implementación, no un bloqueante del diseño.

---

## 11. Propuesta de fases/PRs (mismo criterio que GASTOS-MULTIPLES-LINEAS-1: discovery → aprobación → implementación por etapas)

- **Fase 0 (este documento)** — discovery, sin código. **Ya entregado, pendiente de tu revisión/aprobación.**
- **Fase 1** — extracción sin cambio de comportamiento: mover `personalDesdeEmpleado`/`validarPersonalId` a un módulo compartido, usado por `planes/route.ts` (sin tocar su lógica) — PR chico, bajo riesgo, verificable con los tests existentes de `planes/route.ts`.
- **Fase 2** — `src/lib/tms/programacion-import-excel.ts` (plantilla + parser) y la función nueva de conflictos-entre-filas (§5b), con tests unitarios puros — sin endpoint todavía.
- **Fase 3** — `src/lib/tms/programacion-import.ts` (`previsualizarImportacionProgramacion`) + endpoint `GET`/`POST accion=validar` — fase de solo lectura completa, sin escritura a BD todavía.
- **Fase 4** — `confirmarImportacionProgramacion` + `POST accion=importar` (transacción, candado, all-or-nothing) — la fase de escritura real, la más sensible, con tests de concurrencia/rollback.
- **Fase 5** — UI: botón + modal de importación en Programación.

Cada fase = su propio PR pequeño y revisable, con tu autorización explícita antes de pasar a la siguiente (igual que el resto de esta sesión).

---

## Preguntas abiertas antes de implementar (Fase 1)

1. **Tarifa desactualizada en el Excel vs. catálogo**: ¿bloqueante o solo advertencia? (recomiendo advertencia, ver §6/§10).
2. **Duplicado exacto dentro del mismo Excel**: ¿la definición propuesta en §4.11 (ruta+piloto+unidad+intervalo) es la correcta, o quieres un criterio más/menos estricto (p. ej. ignorar auxiliares, o incluir cliente)?
3. **Límite de filas** del importador de Programación: ¿reutilizamos 2000 (igual que Rutas) o prefieres un tope menor dado que cada fila dispara más validaciones (traslapes)?
4. **Auditoría**: ¿un registro de auditoría por import (resumen) o uno por cada plan creado?
