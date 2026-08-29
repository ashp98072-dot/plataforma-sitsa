import { createHash } from "node:crypto";

/**
 * VIATICOS-FIRMA (firma visual) — validación de la imagen PNG de la firma
 * manuscrita (canvas) que se adjunta a una firma electrónica interna. Mismo
 * criterio defensivo que src/lib/rrhh/foto-empleado.ts (tipoFotoEmpleado):
 * NUNCA confiar en extensión/nombre/Content-Type declarados por el
 * cliente — siempre verificar los magic bytes reales del archivo.
 *
 * Esta imagen es ADICIONAL a la firma electrónica interna ya existente
 * (contraseña + hash SHA-256 + timestamp servidor + auditoría, ver
 * src/lib/firmas/firmas-internas.ts) — nunca la sustituye.
 */

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Límite específico de la firma manuscrita — deliberadamente mucho menor
 * que MAX_UPLOAD_BYTES (50 MB, genérico de src/lib/uploads.ts, pensado
 * para documentos/evidencias): un PNG transparente de 800x300 con un solo
 * trazo pesa unos pocos KB, nunca cientos de KB.
 */
export const MAX_FIRMA_IMAGEN_BYTES = 1 * 1024 * 1024; // 1 MB

/** true solo si los primeros 8 bytes son la firma PNG real (89 50 4E 47 0D 0A 1A 0A). */
export function esPngValido(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

/**
 * SHA-256 (hex) de los bytes PNG definitivos — se incluye como
 * `imagenSha256` dentro del payload_canonico de la firma (ver
 * crearFirmaInterna) para que el hash técnico de la firma también
 * referencie exactamente la imagen manuscrita usada, sin guardar la
 * imagen (base64) en el payload.
 */
export function sha256Hex(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}
