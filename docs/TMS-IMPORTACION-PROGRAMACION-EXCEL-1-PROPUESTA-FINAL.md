# TMS — Importación masiva de Programación desde Excel — Propuesta final (Trabajo B, Fase 0→1)

Estado: **propuesta final para tu revisión. Sigue sin haber código, sin rama, sin PR.**
Continúa y reemplaza las decisiones abiertas de [TMS-IMPORTACION-PROGRAMACION-EXCEL-0-DISCOVERY.md](TMS-IMPORTACION-PROGRAMACION-EXCEL-0-DISCOVERY.md) con tus decisiones definitivas para V1.
Punto de partida: `main = 5da3646f52a9143e0c39275740f895e2ddbda81d`.
No se tocó `src/lib/rrhh/catalogos-nomina.ts`.

## Decisiones definitivas ya incorporadas

1. **Tarifa**: diferencia Excel vs. tarifa vigente del sistema = **error bloqueante**. Mensaje: `Tarifa Excel: Q... / Tarifa sistema: Q...`. Sin override manual en V1.
2. **Fila duplicada** (dentro del mismo archivo): clave normalizada `fechaSalida + horaSalida + rutaId + piloto + unidad`. La misma ruta puede repetirse con piloto/unidad distintos. Esta regla corre **además de**, no en lugar de, la detección de traslapes.
3. **Límite**: máximo **500 filas** por archivo. Si se excede, se rechaza el archivo completo antes de correr cualquier validación costosa (ni siquiera se resuelve la primera fila contra catálogo).
4. **Auditoría a nivel de lote** (no por fila, no como mecanismo anti-duplicado): empresa, usuario, fecha/hora, nombre de archivo, hash del archivo, cantidad total de filas, resultado, IDs de planes creados. No se guarda el contenido del Excel.
5. **La importación nunca crea catálogo**: ni rutas, ni clientes, ni empleados, ni pilotos, ni auxiliares, ni unidades, ni tarifas. Todo debe preexistir; si no, la fila es inválida. (Esto es un cambio respecto al discovery de rutas, que sí creaba clientes nuevos — aquí deliberadamente no.)
6. **`PLAN-YYYYMMDD-###` lo genera exclusivamente el sistema** (`asegurarCodigoPlanUnico`) — no existe columna "Código plan" en el Excel, nunca se acepta uno del archivo.

---

## Respuesta a tu pregunta sobre NIT

Pediste: *"si el NIT no existe en ese registro, reporta cómo manejarías la validación sin depender de nombres ambiguos."*

Verifiqué el esquema real: `tms_clientes.nit` es `VARCHAR(40) NULL`, **sin restricción `UNIQUE`** — y ya existe en el repo una propuesta sin aplicar (`sql/propuesta-2026-08-tms-clientes-duplicados-canonicalizacion.sql`) para consolidar clientes duplicados. Es decir: **el NIT tampoco es una clave confiable hoy** — puede estar vacío, y aunque esté lleno no hay garantía de unicidad a nivel de base de datos ni de que no existan clientes duplicados con datos parcialmente distintos.

Por eso el diseño **nunca usa NIT (ni nombre) como clave de búsqueda** para encontrar al cliente — la única clave de búsqueda real es el **código de ruta**, porque `tms_cliente_rutas.cliente_id` es `NOT NULL` y ya fija el cliente de forma inequívoca. La columna "Cliente" del Excel (NIT si existe, si no nombre) se usa **solo como contraste de cordura** contra el cliente que la ruta ya determina, nunca para ubicar/crear/decidir un cliente:

- **El cliente resuelto de la ruta tiene NIT registrado** → se compara el NIT normalizado del Excel contra `tms_clientes.nit` de ese cliente. Coincide → OK. No coincide → error bloqueante (ejemplo: `Cliente Excel (NIT 123456-7) no coincide con el cliente de la ruta (NIT 765432-1, "Distribuidora X")`).
- **El cliente resuelto de la ruta NO tiene NIT registrado** → se compara por nombre normalizado, exactamente como estaba en el discovery de la Fase 0 (sin distinguir mayúsculas/acentos/espacios), **pero el preview marca explícitamente la fila con una advertencia informativa** del tipo `"Validado por nombre — este cliente no tiene NIT registrado en el sistema"`, para que quede visible que ese renglón se validó con el criterio más débil disponible, en vez de quedar indistinguible de una validación por NIT.
- En ningún caso se busca un cliente "parecido" por NIT o nombre en todo el catálogo — el cliente ya viene fijado por la ruta; esta columna solo puede **aprobar o rechazar** esa fila, nunca resolver uno distinto.

Esto evita por completo el problema de duplicados/ambigüedad de `tms_clientes`, porque la importación deja de depender de buscar clientes — solo verifica.

---

## 1. Esquema final de columnas del Excel

Mismo orden cronológico del discovery original (salida → identificación → recursos → económico → regreso → notas), con los identificadores ya definidos:

| Col | Encabezado | Contenido / identificador | Obligatoria |
|---|---|---|---|
| A | Fecha salida | Fecha (`YYYY-MM-DD`) | Sí |
| B | Hora salida | Hora `HH:mm` (24h en la celda) | Sí |
| C | Código ruta | `tms_cliente_rutas.codigo` | Sí |
| D | Cliente (NIT o nombre) | `tms_clientes.nit` si el cliente de la ruta lo tiene registrado; si no, `tms_clientes.nombre` — **solo contraste**, ver arriba | Sí |
| E | Piloto (código empleado) | `empleados.codigo` | Sí |
| F | Placa/unidad | `tms_unidades.placa` | Sí |
| G | Auxiliar 1 (código empleado) | `empleados.codigo` | No |
| H | Auxiliar 2 (código empleado) | `empleados.codigo` | No |
| I | Tipo traslado | Texto libre (mismo campo sin catálogo cerrado que usa hoy Programación) | No |
| J | Tarifa GTQ | Monto — contrastado contra la tarifa predeterminada activa de la ruta (§ Tarifa, bloqueante si difiere) | Sí |
| K | Fecha regreso estimado | Fecha | Sí* |
| L | Hora regreso estimado | Hora `HH:mm` | Sí* |
| M | Observaciones | Texto libre → `tms_planes_viaje.notas` | No |

\* Igual que en el discovery original: el POST individual (`planes/route.ts:889-897`) exige regreso estimado en cuanto hay piloto/auxiliares/unidad — el template siempre los trae, así que K/L son obligatorias en la práctica.

La hoja de plantilla incluye, igual que `rutas-import-excel.ts`: fila de encabezado, una fila de ejemplo con formato visualmente distinto, y una hoja de ayuda aparte listando explícitamente "usa el código de ruta del catálogo de Rutas", "usa el código de empleado, no el nombre", "usa la placa exacta", "el NIT solo se usa si el cliente ya lo tiene registrado en el sistema".

---

## 2. Endpoints exactos

Un único endpoint nuevo, mismo contrato que el de Rutas:

```
GET  /api/empresas/[slug]/tms/programacion/importar
     -> descarga la plantilla .xlsx
     -> guard: requireTenantProgramacion(slug, "ver")

POST /api/empresas/[slug]/tms/programacion/importar
     multipart/form-data:
       archivo: File (.xlsx, máx. 15 MB)
       accion:  "validar" | "importar"
       decisiones: (no aplica en V1 — no hay decisiones manuales, todo es
                    resolución determinística contra catálogo o error)
     -> guard: requireTenantProgramacion(slug, "crear")  (mismo permiso
        que ya exige crear un plan individual — la importación no es más
        permisiva que crear planes uno por uno)
```

Diferencia clave frente al de Rutas: **no hay `decisiones`/`decisionesCliente`** — como la importación nunca crea ni decide catálogo ambiguo (decisión 5), no existe la fase de "el usuario elige entre candidatos". Cada fila es determinística: o resuelve limpio contra catálogo, o es un error. Esto simplifica el contrato frente al de Rutas.

`accion=validar` devuelve por fila: `estado` (`ok` | `error`), datos resueltos desde catálogo (nombres reales tomados de BD, nunca del Excel) y el detalle de cualquier error/conflicto — sin escribir nada.

`accion=importar` revalida todo igual que `validar` bajo el candado (§ Transaccional), y si pasa, ejecuta la transacción de una vez.

---

## 3. Funciones existentes a reutilizar (sin modificarlas)

- `asegurarCodigoPlanUnico(empresaId, fechaPlan, deseado?)` — [`src/lib/tms/codigo-plan.ts`](../src/lib/tms/codigo-plan.ts) — código de plan, uno por fila al momento de insertar.
- `primerConflictoTraslape(empresaId, recursos, intervalo, excluirPlanId, conn?)`, `inicioViaje`, `finViajeDesdeInput`, `mensajeConflicto` — [`src/lib/tms/disponibilidad-traslapes.ts`](../src/lib/tms/disponibilidad-traslapes.ts) — traslape fila-contra-BD.
- `listarDisponibilidadVehiculos(empresaId)` — [`src/lib/operaciones/disponibilidad.ts`](../src/lib/operaciones/disponibilidad.ts) — disponibilidad real de unidad (Flota en vivo), igual criterio que el POST individual.
- `tarifasActivasDeRuta(empresaId, rutaId)`, `tarifaParaSnapshot(empresaId, rutaId, tarifaId)` — [`src/lib/tms/ruta-tarifas.ts`](../src/lib/tms/ruta-tarifas.ts) — tarifa predeterminada activa para el contraste bloqueante.
- `guardarAuxiliaresPlan(planId, personalIds, conn?)`, `guardarParadasPlan(...)`, `sincronizarViaticosPlan(...)` — [`planes/route.ts`](../src/app/api/empresas/[slug]/tms/planes/route.ts) — mismas escrituras auxiliares que hace el alta individual, reutilizadas fila por fila dentro de la transacción del lote.
- `registrarAuditoria({empresaId, usuario, accion, modulo, detalle})` — [`src/lib/auditoria.ts`](../src/lib/auditoria.ts) — **cubre el requisito de auditoría de lote sin tabla nueva** (ver §5): `detalle` es `TEXT` libre, se guarda ahí un JSON con archivo/hash/filas/resultado/IDs.
- `requireTenantProgramacion(slug, accion)` — guard de permisos, igual que usa hoy el POST individual de planes.
- Patrón de candado `GET_LOCK('tms_traslape_<empresaId>', N)` / `RELEASE_LOCK` ya usado en `planes/route.ts:948-1003` — se replica para todo el lote.
- `crypto.createHash("sha256")` (Node built-in, ya usado en `src/lib/firmas/*`, `src/lib/auth.ts`, etc.) — hash del archivo para la auditoría.
- Andamiaje de parsing Excel de `rutas-import-excel.ts` (`cellStr`, `normalizarHora`, `normalizarTexto`, estructura de plantilla con ExcelJS) — **se reutiliza el patrón/helpers, no el archivo**, porque las columnas son distintas.

### Extracción necesaria (sin cambiar comportamiento)

- `personalDesdeEmpleado(empresaId, empleadoId, tipo)` y `validarPersonalId(empresaId, personalId, tipoEsperado)` — hoy viven sin exportar dentro de `planes/route.ts:526-582`. Se mueven tal cual a un módulo compartido nuevo para que el importador las use sin duplicar lógica (ver §4). Esto es una extracción, no una reescritura — el PR que la haga debe dejar `planes/route.ts` funcionando exactamente igual (verificable con sus tests existentes).

---

## 4. Funciones nuevas necesarias

- `src/lib/tms/personal-resolucion.ts` — reubica `personalDesdeEmpleado`/`validarPersonalId` (extracción, no nueva lógica).
- `src/lib/tms/programacion-import-excel.ts`:
  - `generarPlantillaProgramacion(): Promise<Buffer>` — plantilla con las 13 columnas de §1.
  - `parsearExcelProgramacion(buffer): Promise<FilaProgramacionExcel[]>` — parser, mismo estilo que `parsearExcelRutas`.
- `src/lib/tms/programacion-import.ts`:
  - `claveDuplicadoFila(fila)` — función pura: normaliza `fechaSalida+horaSalida+rutaId+piloto+unidad` a una clave comparable (decisión 2).
  - `primerConflictoTraslapeEnLote(filasResueltas)` — función pura nueva: compara pares de filas del mismo archivo que comparten un recurso (piloto/auxiliar/unidad) y detecta solape de intervalos — **no toca BD**, complementa (no reemplaza) a `primerConflictoTraslape`.
  - `previsualizarImportacionProgramacion(empresaId, filas)` — resuelve cada fila contra catálogo (ruta→cliente/NIT, piloto/auxiliares vía `personalDesdeEmpleado`, unidad vía `listarDisponibilidadVehiculos`, tarifa vía `tarifasActivasDeRuta`), aplica las 13 reglas de validación de la Fase 0 + duplicado en lote + traslape en lote, sin escribir nada.
  - `confirmarImportacionProgramacion(empresaId, usuario, nombreArchivo, hashArchivo, filas)` — revalida todo contra BD fresca bajo el candado, ejecuta la transacción all-or-nothing, y al final llama `registrarAuditoria` con el resumen del lote (§5).

No se necesitan funciones nuevas para crear cliente/ruta/personal/unidad — la decisión 5 las excluye explícitamente; si una fila no resuelve contra catálogo existente, es un error, punto.

---

## 5. Tablas nuevas

**Ninguna es necesaria.** La tabla genérica `auditoria` (`empresa_id`, `usuario`, `accion`, `modulo`, `detalle TEXT`, `creado_en`) ya cubre exactamente los campos pedidos para la auditoría de lote:

```json
// detalle (TEXT, un JSON.stringify):
{
  "archivo": "programacion-octubre.xlsx",
  "hashArchivo": "sha256:...",
  "filasTotales": 42,
  "filasImportadas": 42,
  "resultado": "exitoso",
  "planIds": [1234, 1235, 1236, "..."]
}
```

`registrarAuditoria({ empresaId, usuario, accion: "importar_programacion", modulo: "tms", detalle })` — un solo registro por lote (no por fila), exactamente como pediste. Como ya decidiste que esto **no es el mecanismo anti-duplicado** (eso lo cubre el chequeo de traslapes, ver Fase 0 §8), no hace falta una tabla dedicada con búsquedas por hash — es puro registro histórico.

Si en el futuro se quisiera "avisar si este archivo ya se importó antes" de forma consultable, ahí sí se justificaría una tabla o índice sobre el hash — explícitamente fuera de alcance de V1 por tu instrucción.

---

## 6. Flujo confirmado (sin cambios respecto a lo que pediste)

```
Descargar plantilla → Subir Excel → Validar SIN guardar (accion=validar)
  → Vista previa de errores (y de la única advertencia posible: cliente
    validado por nombre sin NIT)
  → Confirmar (accion=importar)
  → Revalidar TODO bajo GET_LOCK por empresa
  → Si CUALQUIER fila falla: abortar el lote completo, no crear nada
  → Si todas pasan: UNA transacción, inserta todos los planes + auxiliares
    + viáticos, commit
  → registrarAuditoria (un registro, resumen del lote)
```

Límite: **500 filas**, rechazado con `400` antes de tocar catálogo si se excede (chequeo inmediato tras el parseo, igual posición que el chequeo de `MAX_FILAS` en el endpoint de Rutas, solo que con el nuevo tope).

---

## 7. División por PRs (sin cambios de fondo respecto al discovery, solo confirmando)

- **PR 1 — Extracción sin cambio de comportamiento**: `personalDesdeEmpleado`/`validarPersonalId` → `src/lib/tms/personal-resolucion.ts`, usado por `planes/route.ts` sin alterar su lógica. Riesgo bajo, verificable con los tests actuales de `planes/route.ts`.
- **PR 2 — Parsing + plantilla**: `programacion-import-excel.ts` (plantilla de 13 columnas + parser) con tests unitarios puros. Sin endpoint, sin tocar BD.
- **PR 3 — Reglas puras nuevas**: `claveDuplicadoFila` y `primerConflictoTraslapeEnLote` en `programacion-import.ts`, con tests unitarios puros (sin BD).
- **PR 4 — Preview (solo lectura)**: `previsualizarImportacionProgramacion` + endpoint `GET`/`POST accion=validar`. Ninguna escritura a BD todavía; se puede probar contra datos reales sin riesgo.
- **PR 5 — Confirmación (escritura real)**: `confirmarImportacionProgramacion` + `POST accion=importar` (candado, transacción all-or-nothing, auditoría de lote). La fase más sensible — tests de concurrencia/rollback/duplicado obligatorios antes de pedir aprobación de merge.
- **PR 6 — UI**: botón "Importar Excel" + modal de subida/preview/confirmación en `src/app/e/[slug]/programacion/`.

Cada PR espera tu autorización explícita de merge antes de empezar el siguiente, igual criterio que el resto de esta sesión.

---

## Pendiente de tu aprobación antes de escribir código

Este documento es la propuesta final. Si lo apruebas tal cual, el siguiente paso sería crear la rama y empezar **PR 1** (la extracción, el paso de menor riesgo). Aviso explícito: **no voy a crear rama ni código hasta tu confirmación.**
