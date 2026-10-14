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

## 3. ¿Hace falta SQL? y aislamiento por empresa (FK tenant-safe)

| Parte | SQL | Motivo |
|---|---|---|
| Justificación de faltas | **Sí, aditivo**: `rrhh_asistencia_justificaciones` (+ preflight y verify) | `incidencias` no guarda actor/observación/fecha y reemplazarla eliminaría la ausencia del reporte y el descuento en silencio; `rrhh_asistencia_ausencias` solo existe para días cerrados en «Tomar asistencia». |
| Comprobantes de cumpleaños | **No** | Se reutiliza `documentos_empleados` + storage privado existente; solo cambia el valor de `tipo_documento`. |

Archivos: `sql/migrate-2026-10-rrhh-justificaciones-faltas.sql`, `preflight-…`, `verify-…` y `sql/schema.sql`. Solo `CREATE TABLE IF NOT
EXISTS`; sin datos, **sin ALTER (ni índices nuevos) a `empleados`**, sin DROP. **No ejecutado.** Las lecturas toleran la tabla ausente
(el reporte sigue como antes), pero **justificar** falla hasta aplicar la migración.

### Discovery de índices de `empleados` [CONFIRMADO en el repositorio]

- `sql/schema.sql` declara en `empleados`: `UNIQUE KEY uq_emp_empresa_codigo (empresa_id, codigo)` y
  **`UNIQUE KEY uq_ruta_personal_empresa_id (empresa_id, id)`**.
- Las migraciones `migrate-2026-08-operaciones-multas.sql` (`uq_multas_empleado_empresa_id`) y
  `migrate-2026-09-rutas-personal-tarifario.sql` (`uq_ruta_personal_empresa_id`) agregan ese mismo UNIQUE `(empresa_id, id)`.
- Los preflights de `tms_plan_cuadrilla` y `rrhh_vacaciones_sync_estado` documentan que **en producción** el índice es
  `uq_multas_empleado_empresa_id` (mismo orden de columnas, distinto nombre) y que ya hay FKs compuestas aplicadas contra él.

### Decisión: FK COMPUESTA

```sql
CONSTRAINT fk_asist_just_empleado FOREIGN KEY (empresa_id, empleado_id)
  REFERENCES empleados(empresa_id, id) ON DELETE CASCADE ON UPDATE RESTRICT
```

- Una fila con `empresa_id = A` y un `empleado_id` de la empresa B es **estructuralmente imposible** (error 1452), aunque una
  escritura futura omita la validación de la aplicación. Probado en BD (también el `UPDATE` de la empresa del empleado: bloqueado).
- **El índice padre no se asume:** el preflight exige un UNIQUE `(empresa_id, id)` en `empleados` (cualquier nombre) y **DETIENE** si
  no existe. La migración **no** agrega ese índice. Si faltara, el `CREATE TABLE` falla completo y no queda una tabla parcial ni con
  una FK más débil (probado en BD). La alternativa mínima segura en ese caso es crear primero ese UNIQUE en una migración propia y
  aprobada (no se hace aquí).
- **ON DELETE CASCADE** (empleado): igual que `rrhh_asistencia_ausencias`; la limpieza administrativa de empleados
  (`limpiar-modulo.ts`) borra empleados sin listar las tablas de asistencia y depende de ese CASCADE. RESTRICT la rompería.
- **verify:** ya no se limita a buscar cruces que la estructura impide: comprueba que la FK compuesta existe (`KEY_COLUMN_USAGE`,
  decisión `decision_fk_tenant`), los CHECKs y deja la auditoría de datos solo para lo que se pudo colar con restricciones
  deshabilitadas o que el schema no puede expresar.

### Scripts resistentes al contexto de phpMyAdmin

- `preflight` y `verify` **no dependen de la base seleccionada ni de variables de sesión**: toda consulta a `information_schema`
  filtra por el literal `'u611730801_Plataforma'` (nunca `DATABASE()`), y todo `SHOW` usa nombre calificado
  (`u611730801_Plataforma.tabla`). Ejecutarlos con `information_schema` seleccionada devuelve la lectura de la base destino o un
  resultado vacío / «DETENER», no una falsa lectura de `information_schema`.
- El preflight incluye una **guarda de contexto** (`decision_contexto`): compara la base seleccionada con la esperada y dice
  «DETENER: selecciona la base u611730801_Plataforma…» antes de la migración (que usa nombres sin esquema para poder probarse).
- Para otra instalación: reemplazar **todas** las apariciones del literal (una prueba verifica que no haya otro literal).

## 4. Impacto en incidencias, descuentos, planillas (comportamiento documentado, NO modificado)

| Área | Efecto de justificar |
|---|---|
| Reporte de asistencia (pantalla, Excel, PDF) | Muestra «Falta justificada» + motivo. |
| Incidencias / `registrarIncidenciaFalta` | Sin cambios; no se crea incidencia. |
| Resumen de incidencias (`obtenerResumenIncidenciasDetallado`) | **Sin cambios**: sigue contando la ausencia como falta. |
| Tomar asistencia / `rrhh_asistencia_ausencias` | Sin cambios; una ausencia CONFIRMADA sigue CONFIRMADA. |
| **Descuentos de planilla** | **Sin cambios: justificar NO elimina ni cambia automáticamente el descuento de planilla.** `planilla-faltas.ts` solo se salta una falta si una *incidencia* cubre el día. |
| Vacaciones | Sin efecto (por eso `Vacaciones`/`A cuenta de Vacaciones` no son motivos). |
| «3 tardanzas = 1 falta» | No existe en el repositorio. |

**Regla vigente:** justificar una falta documenta/audita la razón. **NO elimina ni cambia automáticamente el descuento de planilla.**
El modal muestra **siempre** el texto «Esta justificación no modifica automáticamente el descuento en planilla.» y, cuando la falta
tiene una ausencia confirmada para planilla (y si ya fue aplicada a un período), lo repite en un aviso destacado. No se agregó
lógica nueva de planilla ni «con goce / sin goce», «pagar / no pagar», eliminación automática de la ausencia ni incidencia
artificial: eso sería una fase aparte **si RRHH lo solicita** (opciones: que `planilla-faltas.ts` consulte
`rrhh_asistencia_justificaciones`, o que «Tomar asistencia» no confirme la ausencia de un día justificado).

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
- **FK tenant-safe (BD):** estructura compuesta (`KEY_COLUMN_USAGE`), `INSERT` con empresa A + empleado de B rechazado (1452), cambio
  de empresa del empleado bloqueado, CASCADE al borrar el empleado, y migración que **falla completa** sin el UNIQUE
  `(empresa_id, id)` en `empleados` (sin tabla parcial).
- **Planilla:** la ausencia CONFIRMADA queda idéntica tras justificar, editar y revertir; no se crean tablas/filas de planilla,
  incidencias ni marcajes; el aviso «Esta justificación no modifica automáticamente el descuento en planilla.» está en el modal y en
  este documento (prueba de arquitectura).
- **Scripts SQL:** una prueba verifica que `preflight`/`verify` solo usan el literal de la base destino (sin `DATABASE()` ni variables
  de sesión), con `SHOW` calificados y decisión que DETIENE.
