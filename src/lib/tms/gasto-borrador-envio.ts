/**
 * BORR-1f — contrato de ENVÍO de «Nuevo gasto» con el borrador local. Reutiliza el puente genérico de BORR-1d/1e
 * (`@/lib/compras/requerimiento-borrador-envio`) y el adaptador de clave de BORR-1e (`envioDesdeRef`); aquí vive lo propio de Gastos.
 *
 * CONTRATO REAL de `POST /tms/gastos` (route.ts + `crearGasto` + `respuestaDeExcepcion`):
 *  - 2xx → `{ mensaje, gasto: { id } }`. Misma clave + mismo contenido → el gasto original; con la columna aún sin migrar, modo legado.
 *  - 400 → validación (Zod/dominio, p. ej. «El empleado indicado no pertenece a esta empresa»): el INSERT se revierte.
 *  - 401/403 → sesión/permiso (`requireTenantGastos`) ANTES de crear. 404 → recurso inexistente antes de crear.
 *  - 409 → `ConflictoIdempotencia`: la clave YA existe con otro contenido (una creación anterior pudo confirmarse). Los 409 de
 *    transición de estado (`ErrorGasto`) pertenecen a autorizar/rechazar, no a crear.
 *  - 500 → fallo inesperado: el resultado es DESCONOCIDO. Cualquier otro código (408/425/429/5xx/413…) también.
 * Solo 400/401/403/404 garantizan «nada se creó»; el resto es incierto (se conserva clave y contenido).
 *
 * Subida del comprobante (`POST /tms/gastos/:id/comprobante`) — operación DISTINTA y posterior a la creación: sus fallos
 * (400 formato, 404, 409 inactivo, 500) NO deshacen el gasto. El gasto ya existe; el reintento solo vuelve a subir el archivo a ese id.
 */
export type ResultadoCreacionGasto = "exito" | "rechazo_definitivo" | "incierto";

const DEFINITIVOS = new Set([400, 401, 403, 404]);

export function clasificarCreacionGasto(r: { lanzo: boolean; ok?: boolean; status?: number; gastoId?: unknown }): ResultadoCreacionGasto {
  if (r.lanzo) return "incierto";
  if (r.ok) return typeof r.gastoId === "number" && Number.isSafeInteger(r.gastoId) && r.gastoId > 0 ? "exito" : "incierto";
  return DEFINITIVOS.has(r.status ?? 0) ? "rechazo_definitivo" : "incierto";
}
