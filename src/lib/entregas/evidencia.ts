import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";

/**
 * EVIDENCIA ESCANEADA DE LA RECEPCIÓN PRESENCIAL (follow-up de PR #446).
 *
 * Diseño SIN SQL: la constancia firmada y escaneada ES la evidencia de la firma física de quien recibe, así que se guarda en la
 * MISMA fila de `firmas_electronicas` de la recepción (columnas `imagen_*`, que ya admiten ruta/nombre/mime/tamaño y el SHA-256 en
 * el payload firmado), referenciada por `documento_entregas.firma_recepcion_id`. Se distingue de una firma dibujada por
 * `origenFirma = "ESCANEADA"` dentro del payload. Así el archivo queda atado, sin tabla nueva, a: la empresa (`empresa_id` de la
 * firma y de la entrega y la carpeta `empresas/<id>/`), el módulo y documento (`modulo`/`entidad_*` de la firma), la entrega
 * (FK + `entregaId` en el payload) y el actor que lo subió (`operadorUsuarioId` en el payload y
 * `recepcion_operada_por_usuario_id` de la entrega).
 *
 * El archivo se guarda con un nombre nuevo e irrepetible (`guardarUpload`): nunca sobrescribe ni reemplaza nada, y la constancia
 * PDF se genera siempre al vuelo (no se almacena), por lo que no hay un «original» que pueda pisarse.
 */

export const MAX_EVIDENCIA_BYTES = 10 * 1024 * 1024; // 10 MB (un escaneo de una hoja pesa mucho menos)

/** Formatos aceptados y la extensión con la que se guardan (se decide por los bytes reales, nunca por lo que declare el cliente). */
export const EXTENSION_DE_MIME = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg" } as const;
export type MimeEvidencia = keyof typeof EXTENSION_DE_MIME;

export const MENSAJE_EVIDENCIA_INVALIDA = "La constancia firmada debe ser un archivo PDF, JPG o PNG de hasta 10 MB.";

/** Tipo real por «magic bytes» (PDF `%PDF-`, PNG, JPEG) o `null`. */
export function detectarTipoEvidencia(bytes: Uint8Array): MimeEvidencia | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Valida tamaño y formato REAL; devuelve el mime y la extensión, o lanza 400. */
export function validarEvidencia(bytes: ArrayBuffer): { mime: MimeEvidencia; extension: string } {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0 || bytes.byteLength > MAX_EVIDENCIA_BYTES) {
    throw new ErrorDominioFormulario(MENSAJE_EVIDENCIA_INVALIDA, 400);
  }
  const mime = detectarTipoEvidencia(new Uint8Array(bytes));
  if (!mime) throw new ErrorDominioFormulario(MENSAJE_EVIDENCIA_INVALIDA, 400);
  return { mime, extension: EXTENSION_DE_MIME[mime] };
}

export type EvidenciaEntrega = { ruta: string; nombre: string; mime: string; tamano: number | null };

function esEscaneada(payload: unknown): boolean {
  try {
    const p = JSON.parse(String(payload ?? "{}")) as { origenFirma?: unknown };
    return p.origenFirma === "ESCANEADA";
  } catch {
    return false;
  }
}

/**
 * Evidencia escaneada de UNA entrega presencial RECIBIDA, o `null` (sin evidencia: histórico, firma dibujada, no presencial, no
 * recibida). Siempre acotada por empresa: la entrega y la firma deben ser de `empresaId`.
 */
export async function leerEvidenciaEntrega(empresaId: number, entregaId: number): Promise<EvidenciaEntrega | null> {
  const filas = await query<RowDataPacket[]>(
    `SELECT fe.imagen_ruta, fe.imagen_nombre_original, fe.imagen_mime, fe.imagen_tamano, fe.payload_canonico
     FROM documento_entregas de
     JOIN firmas_electronicas fe ON fe.id = de.firma_recepcion_id AND fe.empresa_id = de.empresa_id
     WHERE de.id = ? AND de.empresa_id = ? AND de.estado = 'RECIBIDA' AND de.modo = 'PRESENCIAL' AND fe.imagen_ruta IS NOT NULL
     LIMIT 1`,
    [entregaId, empresaId],
  );
  const f = filas[0];
  if (!f || !esEscaneada(f.payload_canonico)) return null;
  return {
    ruta: String(f.imagen_ruta),
    nombre: String(f.imagen_nombre_original ?? "constancia-firmada"),
    mime: String(f.imagen_mime ?? "application/octet-stream"),
    tamano: f.imagen_tamano != null ? Number(f.imagen_tamano) : null,
  };
}

/** Ids (de entre `entregaIds`) que tienen evidencia escaneada, en una sola consulta. */
export async function idsConEvidencia(empresaId: number, entregaIds: number[]): Promise<Set<number>> {
  const ids = [...new Set(entregaIds.filter((n) => Number.isInteger(n) && n > 0))];
  const salida = new Set<number>();
  if (!ids.length) return salida;
  const filas = await query<RowDataPacket[]>(
    `SELECT de.id, fe.payload_canonico
     FROM documento_entregas de
     JOIN firmas_electronicas fe ON fe.id = de.firma_recepcion_id AND fe.empresa_id = de.empresa_id
     WHERE de.empresa_id = ? AND de.estado = 'RECIBIDA' AND de.modo = 'PRESENCIAL' AND fe.imagen_ruta IS NOT NULL
       AND de.id IN (${ids.map(() => "?").join(", ")})`,
    [empresaId, ...ids],
  );
  for (const f of filas ?? []) if (esEscaneada(f.payload_canonico)) salida.add(Number(f.id));
  return salida;
}
