# RRHH — Justificación rápida de faltas + comprobantes de vales de cumpleaños

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local** (tsc, ESLint, pruebas unitarias y de BD contra MariaDB 11.8.9
desechable). **No probado manualmente en navegador contra datos reales; no aprobado para producción.** El SQL **no se ejecutó**
en ninguna base real.

## 1. Discovery

### Cómo se representa una «falta» hoy [CONFIRMADO en código]

| Pieza | Hallazgo |
|---|---|
| Reporte de asistencia (`reportes.ts` → `obtenerReporteAsistencias`) | La falta es **derivada**, no almacenada: día laborable ≥ `fecha_alta`, empleado `Activo`, **sin** sesión de trabajo, **sin** viaje que cubra el día, **sin** «En Ruta» y **sin** incidencia que cubra la fecha. Muestra `estadoEntrada = "Falta"`, `motivo = "Falta"`. |
| Incidencias (`incidencias`: tipo, rango de fechas, días hábiles) | Son **rangos justificativos**: si una incidencia cubre el día, la fila deja de ser «Falta» y pasa a mostrar el tipo (Vacaciones, Permiso…). No tiene observación, actor ni fecha de creación en la tabla (solo bitácora general). `Vacaciones`/`A cuenta de Vacaciones` además marcan saldos de vacaciones. |
| Tomar asistencia (`asistencia-diaria.ts`) | Al cerrar el día persiste ausencias **CONFIRMADA/ANULADA** en `rrhh_asistencia_ausencias`. El diseño dice explícitamente «NO se usa una incidencia Falta». |
| Planilla (`planilla-faltas.ts`) | Cada ausencia CONFIRMADA entra como descuento (`sueldo_base ÷ divisor`) y se **revalida** al generar/autorizar: deja de aplicar solo si ese día hay jornada, **incidencia que lo cubra**, en ruta, viaje, domingo/feriado, horario variable o fuera de la relación laboral. |
| Regla «3 tardanzas = 1 falta» | **No existe en el código** (búsqueda en `src`). No hay nada que afectar. |
| `registrarIncidenciaFalta` (`reportes.ts`) | Función existente y **sin llamadores** que «justifica» insertando una incidencia de un día. Reutilizarla borraría la ausencia del reporte, sin actor ni fecha, y eliminaría el descuento de planilla en silencio: **no encaja** con lo pedido. |
| Catálogo de motivos | `TIPOS_INCIDENCIA` (`periodos.ts`). **Se reutiliza** (sin inventar uno nuevo). |
| Permisos RRHH | Submódulos `reportes`, `incidencias` (registrar/editar), `empleados` (crear/editar/eliminar). |

### Sistema de documentos/archivos existente [CONFIRMADO]

- **`documentos_empleados`** (`empresa_id`, `id_empleado`, `tipo_documento` VARCHAR(100), `ruta_archivo`, `nombre_original`, `subido_en`,
  `subido_por`) con `documentos.ts` y endpoints de subida/descarga/eliminación del expediente.
- **`evidencias_incidencias`** (por `incidencia_id`): no aplica, porque la justificación no es una incidencia.
- **Storage privado** `@/lib/uploads` (`guardarUpload`, `borrarUpload`, raíz fuera de `public`), `MAX_UPLOAD_BYTES` = 50 MB; el
  catálogo general acepta además `.bmp`. La validación del repo es por **extensión + tamaño**.
- Patrón de borrado existente: **DELETE + borrado del archivo**, sin historial en la tabla.

## 2. Qué se implementó

### A. Justificar faltas desde Reportes de asistencia

- **Doble clic** sobre una fila **solo si es «Falta» o «Falta justificada»** (`esFilaFalta`); en cualquier otra fila (A tiempo,
  Retraso, Vacaciones, En Ruta, En viaje, incidencias) no pasa nada. Cursor `pointer`, hover, tooltip «Doble clic para justificar» y
  un botón visible secundario «Justificar» / «Ver justificación» (accesible por teclado); el doble clic se conserva.
- **Modal:** empleado, código, fecha, estado actual, tipo/motivo (catálogo reutilizado menos `Falta`, `Vacaciones` y
  `A cuenta de Vacaciones`), observación y evidencia opcional (JPG/JPEG/PNG/WebP/PDF).
- **Capa, no reemplazo:** la tabla nueva `rrhh_asistencia_justificaciones` (una fila por empresa + empleado + fecha; ACTIVA/REVERTIDA;
  nunca se borra) registra tipo, observación, quién/cuándo, y en reversión quién/cuándo/motivo. El reporte muestra **«Falta
  justificada»** (`motivo: «Falta justificada: <tipo>»`) con `horaEntrada/horaSalida = null`. **No** crea sesión/marcaje, **no**
  escribe en `incidencias`, `rrhh_asistencia_ausencias`, vacaciones ni planilla, y **no** convierte a «A tiempo».
- **Revalidación en servidor:** antes de justificar se recalcula el día con el mismo código del reporte; si no es una falta real
  (A tiempo, vacaciones, en ruta, domingo/feriado, baja, otra empresa, fecha futura) se rechaza.
- **Editar / revertir:** versión optimista (`expectedVersion`), reversión con motivo (≥ 5), reactivación de la misma fila (versión + 1).
  Cada paso deja una entrada en `auditoria` con actor, tipo, observación y estado anterior.
- **Concurrencia:** `UNIQUE (empresa_id, empleado_id, fecha)` + `SELECT … FOR UPDATE`; el doble clic rápido / doble envío no duplica
  (idempotente si el contenido es el mismo; conflicto si es distinto) y el cliente además tiene un candado síncrono.
- **Filtro** del reporte: nueva opción «Falta justificada»; el filtro «Falta» sigue incluyendo ambas (siguen siendo ausencias).

### B. Comprobantes de cumpleaños (empresa + empleado + AÑO)

- Columna **«Comprobante»** en Cumpleaños por mes: «Sin comprobante», «1 archivo», «N archivos» y botón **«Ver / Adjuntar»**.
- Modal con empleado, cumpleaños, año, archivos (nombre, fecha de carga y usuario), adjuntar, abrir/descargar y eliminar.
- **Año por separado:** el año va en `tipo_documento` («Comprobante de cumpleaños 2026»); el mismo empleado puede tener comprobantes
  de varios años, independientes. El listado cuenta los del **año consultado** en UNA consulta agrupada.
- **Excel:** una sola columna nueva **«Comprobante» = Sí/No**; sin archivos ni URLs.

## 3. ¿Hace falta SQL?

| Parte | SQL | Motivo |
|---|---|---|
| Justificación de faltas | **Sí, aditivo**: `rrhh_asistencia_justificaciones` (+ preflight y verify) | `incidencias` no guarda actor/observación/fecha y reemplazarla eliminaría la ausencia del reporte y el descuento en silencio; `rrhh_asistencia_ausencias` solo existe para días cerrados en «Tomar asistencia». |
| Comprobantes de cumpleaños | **No** | Se reutiliza `documentos_empleados` + storage privado existente; solo cambia el valor de `tipo_documento`. |

Archivos: `sql/migrate-2026-10-rrhh-justificaciones-faltas.sql`, `preflight-…`, `verify-…` y `sql/schema.sql`. Solo `CREATE TABLE IF NOT
EXISTS`; sin datos, sin ALTER, sin DROP. **No ejecutado.** Las lecturas toleran la tabla ausente (el reporte sigue como antes),
pero **justificar** falla hasta aplicar la migración.

## 4. Impacto en incidencias, descuentos, planillas (comportamiento documentado, NO modificado)

| Área | Efecto de justificar |
|---|---|
| Reporte de asistencia (pantalla, Excel, PDF) | Muestra «Falta justificada» + motivo. |
| Incidencias / `registrarIncidenciaFalta` | Sin cambios; no se crea incidencia. |
| Resumen de incidencias (`obtenerResumenIncidenciasDetallado`) | **Sin cambios**: sigue contando la ausencia como falta. |
| Tomar asistencia / `rrhh_asistencia_ausencias` | Sin cambios; una ausencia CONFIRMADA sigue CONFIRMADA. |
| **Descuentos de planilla** | **Sin cambios: justificar NO elimina un descuento.** `planilla-faltas.ts` solo se salta una falta si una *incidencia* cubre el día. |
| Vacaciones | Sin efecto (por eso `Vacaciones`/`A cuenta de Vacaciones` no son motivos). |
| «3 tardanzas = 1 falta» | No existe en el repositorio. |

El modal **avisa** cuando la falta tiene una ausencia confirmada para planilla (y si ya fue aplicada a un período) para que RRHH sepa
que la justificación no la anula. **Decisión de negocio pendiente** (no implementada): si una justificación ACTIVA de ciertos tipos
(p. ej. «Permiso con goce», «Médico») debe evitar el descuento. Opciones: que `planilla-faltas.ts` consulte
`rrhh_asistencia_justificaciones`, o que «Tomar asistencia» no confirme la ausencia de un día justificado.

## 5. Permisos (reutilizados; sin permisos nuevos)

| Acción | Permiso existente |
|---|---|
| Ver el reporte, la justificación, comprobantes y descargar archivos | `reportes:ver` |
| Justificar una falta | `incidencias:crear` |
| Editar / revertir / adjuntar o quitar evidencia | `incidencias:editar` |
| Adjuntar comprobante de cumpleaños | `empleados:editar` (o `crear`, igual que los documentos del expediente) |
| Eliminar comprobante de cumpleaños | `empleados:eliminar` |

Admin conserva el comportamiento global del catálogo. La empresa y el actor salen **siempre** de la sesión; el cuerpo/consulta solo
elige empleado, fecha/año y datos del formulario (esquemas `strict`).

## 6. Archivos privados y validación

Los archivos nunca tienen URL pública predecible: se sirven por endpoints con sesión + empresa + permiso, `Cache-Control: private,
no-store` y `nosniff`; cada endpoint **solo sirve documentos de su propio tipo** (no se puede usar para bajar DPI u otros del
expediente). Validación en servidor: extensión ∈ {JPG, JPEG, PNG, WebP, PDF} (**más estricta** que el repo, que admite BMP), tamaño
≤ `MAX_UPLOAD_BYTES` (50 MB, el del repo) y **firma real** del archivo (no basta el nombre); nombre guardado sin rutas ni caracteres
de control; si el INSERT falla se borra el archivo para no dejar huérfanos.

## 7. Riesgos y límites

1. **Descuento de planilla no cambia** (ver §4): una «Falta justificada» puede seguir descontándose hasta que negocio decida.
2. **Evidencias/comprobantes por `tipo_documento`**: el año/fecha viven en un texto (determinista y probado), no en columnas; no se
   guarda MIME ni tamaño (se validan al subir). Si negocio quiere anulación con historial o un modelo propio, sería una migración
   aparte.
3. **Eliminación** de comprobantes/evidencias es física (patrón existente del expediente) pero queda en la bitácora con actor;
   también pueden quitarse desde el expediente con `empleados:eliminar`, que no pasa por la bitácora de este flujo.
4. Los comprobantes aparecen también en el **expediente** del empleado (mismo sistema de documentos).
5. La justificación es **por día**: no hay justificación por rango (varios días = una por cada falta).
6. El reporte consulta justificaciones en **una** consulta por rango (+1 consulta fija; la prueba de rendimiento se actualizó de 8 a
   10 consultas por dos reportes).

## 8. Pruebas

- `justificaciones-comprobantes.test.ts`: reglas puras, permisos/tenant de los endpoints, formatos y firmas, arquitectura (doble clic
  solo en Falta, sin marcajes falsos, SQL aditivo).
- `justificaciones-comprobantes.db.test.ts` (MariaDB 11.8.9 desechable, migración ×2): justificar → «Falta justificada» sin marcaje
  falso, solo faltas reales, doble envío concurrente, editar/revertir/re-justificar con auditoría, aislamiento por empresa, impacto
  en planilla informado y NO modificado, JPG/JPEG/PNG/WebP/PDF, rechazo de formato/contenido/vacío/tamaño, años 2026 vs 2027,
  documentos de otra empresa y de otro tipo no accesibles.
- Verificado con mutación (sin la revalidación de falta real y sin la validación de extensión fallan pruebas).
