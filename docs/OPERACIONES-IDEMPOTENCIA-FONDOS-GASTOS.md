# Operaciones — idempotencia de creación y observaciones en exportaciones (PR A: Fondos y Gastos)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** en la rama; **no probado en producción** ni aprobado. La migración es una
**propuesta** (no se ejecuta desde la aplicación ni desde este PR).

Alcance de esta PR: Solicitudes de Fondo y Solicitudes de Gastos. Requerimientos de Compras va en una PR aparte (PR B) y
reutiliza `src/lib/idempotencia/clave-envio.ts`.

## 1. Problema

- Los botones de «Crear solicitud» (Fondos) y «Guardar» (Gastos) eran `type="button"` con `onClick`, sin estado de guardado:
  dos clics (o un reintento) enviaban dos `POST` y creaban dos registros.
- El backend no tenía ninguna protección: el `UNIQUE (empresa_id, codigo)` no impide duplicados lógicos porque el código sale
  del `id` recién generado.
- En Gastos, si el `POST` se confirmaba y la subida del comprobante fallaba, volver a presionar «Guardar» creaba **otro** gasto.
- Hallazgo adicional (verificado con peticiones concurrentes reales): `crearSolicitudFondo` insertaba `codigo = ''` como
  marcador; dos creaciones simultáneas de la misma empresa competían por el `UNIQUE (empresa_id, codigo)` y terminaban en
  **deadlock**. Gastos ya usaba un marcador único (`TMP-<hex>`); Fondos pasa a usar el mismo criterio.

## 2. Diseño

| Pieza | Detalle |
|---|---|
| Clave de envío | Token aleatorio (`crypto.randomUUID`) que el formulario genera al primer «Guardar» de un registro **nuevo** y reutiliza en cada reintento. Formato `^[A-Za-z0-9_-]{16,64}$`. **No** se deriva de monto/fecha/solicitante/concepto. |
| Persistencia | `clave_idempotencia VARCHAR(64) NULL` + `huella_idempotencia CHAR(64) NULL` y `UNIQUE (empresa_id, clave_idempotencia)` en `tms_solicitudes_fondo` y `tms_gastos_operativos`. Históricos quedan en `NULL`. |
| Aislamiento | La unicidad es por empresa: la misma clave en otra empresa es otro registro. |
| Huella | SHA-256 del JSON canónico del contenido funcional (lista blanca por módulo, `src/lib/tms/idempotencia-envio.ts`): cabecera funcional, observaciones, total, y líneas **en orden**. Excluye id, código, timestamps y la propia clave. Solo se guarda el hash. |
| Misma clave + mismo contenido | Se devuelve la creación original (no se crea otra). |
| Misma clave + contenido distinto | **HTTP 409** (`ConflictoIdempotencia`). |
| Carrera | La búsqueda previa va antes de abrir la transacción; si dos peticiones pasan la búsqueda, el `UNIQUE` rechaza el `INSERT` de la perdedora, que hace `ROLLBACK`, relee con instantánea nueva y devuelve la ganadora (o 409 si el contenido difiere). Solo se interpreta como reintento el `ER_DUP_ENTRY` **del índice de la clave**; un duplicado de código se propaga. |
| Compatibilidad | La clave es **opcional** en el backend durante la primera ventana de despliegue: sin clave, comportamiento legado. El frontend nuevo **siempre** la envía. Endurecerla (obligatoria) se hará en una PR posterior cuando el frontend nuevo esté desplegado. |
| Migración pendiente | Si la columna aún no existe (`ER_BAD_FIELD_ERROR`), la creación continúa en modo legado en vez de fallar. |

### Frontend

- Guard síncrono `crearGuardEnvio()` (`useState` lazy): la bandera `enVuelo` se activa en el mismo tick, por lo que dos clics,
  clic + Enter o repeticiones no disparan dos envíos; se libera siempre en `finally` (el botón vuelve a habilitarse tras un error).
- `guardando` pinta el botón (`disabled`, «Guardando…»).
- Gastos: la orquestación crear → subir comprobante vive en `src/lib/tms/gastos-envio-cliente.ts` (`enviarGasto`). Si el
  comprobante falla, la clave se **conserva**; el siguiente «Guardar» recupera el mismo gasto y vuelve a subir el comprobante a
  ese id.
- Tras un 409 se refresca el listado para que el usuario vea la creación existente antes de reintentar.

## 3. Observaciones en exportaciones

| Documento | Antes | Ahora |
|---|---|---|
| Fondos — PDF individual (autorizado) | no | bloque «OBSERVACIONES» entre el TOTAL y las firmas |
| Fondos — PDF mensual | no | bloque por solicitud, tras `TOTAL SOLICITUD` y antes de las firmas |
| Fondos — Excel individual | no | columna final «Observaciones» (wrapText, saltos, altura suficiente) |
| Fondos — Excel reporte consolidado | no | columna 20 «Observaciones» (las 19 previas no se mueven; autofiltro hasta `T`) |
| Gastos — PDF individual (autorizado) | no | bloque «OBSERVACIONES» entre el TOTAL y las firmas |
| Gastos — PDF de listado (`SOLICITUD DE GASTOS`) | no | sección «OBSERVACIONES» al final: una entrada por gasto (`GASTO-######`, fecha, nombre) |
| Gastos — Excel | sí | **sin cambios** |

Criterios: se usa el **mismo campo de BD** (`observaciones`, ≤ 300 caracteres); texto completo y saltos de línea; vacío/null no
dibuja bloque ni inventa texto; los totales y las columnas existentes no cambian; las «Notas» fijas del pie de Fondos son
otra cosa y se conservan. El bloque no se parte entre páginas y las firmas conservan su salto controlado.

**No modificados a propósito:** el PDF tabular compacto de Fondos (`variante=tabular`, 10 columnas fijas, sin código ni firmas).

## 4. Archivos

- Nuevos: `src/lib/idempotencia/clave-envio.ts`, `src/lib/tms/idempotencia-envio.ts`, `src/lib/tms/gastos-envio-cliente.ts`,
  `src/lib/tms/observaciones-export.ts`, y las pruebas asociadas.
- Modificados: `src/lib/tms/{fondos,gastos}.ts`, rutas `POST` de fondos y gastos, páginas `fondos/page.tsx` y `gastos/page.tsx`,
  `fondos-solicitud-pdf.ts`, `fondos-mensual-pdf.ts`, `gastos-individual-pdf.ts`, `gastos-solicitud-pdf.ts`,
  `gastos-export-excel.ts`, `reportes-gastos.ts` (observaciones en el reporte de Fondos).
- SQL (propuestas, **no ejecutadas**): `sql/migrate-2026-10-operaciones-idempotencia-fondos-gastos.sql`,
  `sql/preflight-2026-10-operaciones-idempotencia-fondos-gastos.sql`, `sql/diagnostico-2026-10-fondos-77-78-duplicado.sql`,
  `sql/diagnostico-2026-10-posibles-duplicados-fondos-gastos.sql`.

## 5. Orden de despliegue sugerido

1. Revisar y aprobar el PR.
2. Ejecutar el preflight (solo lectura) y, con autorización, la migración. El orden respecto del código no es crítico (el
   código tolera la ausencia de las columnas), pero la protección solo existe cuando ambas cosas están aplicadas.
3. Desplegar el código.
4. En una PR posterior, volver obligatoria la clave en el backend.

## 6. Qué NO resuelve

- Duplicados **históricos** (p. ej. Fondos 77 y 78): solo hay consultas de revisión de solo lectura; no se corrige ni elimina nada.
- Dos envíos genuinamente distintos con las mismas datos y claves distintas se conservan como registros legítimos (por diseño).
- La edición (`PATCH`) no usa clave: actúa sobre un id existente y no crea registros. Tampoco cambia la semántica de concurrencia de la edición (fuera de alcance).
