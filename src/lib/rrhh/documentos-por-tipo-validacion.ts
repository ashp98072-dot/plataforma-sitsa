/**
 * Validación PURA (sin BD ni disco) de archivos de evidencia/comprobantes: formatos admitidos, firma real del archivo y nombre
 * seguro. Los usa `documentos-por-tipo.ts`; separado para poder probarse sin dependencias.
 */

export const EXTENSIONES_EVIDENCIA = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
export const MENSAJE_FORMATOS_EVIDENCIA = "Formato no permitido. Usa JPG, JPEG, PNG, WebP o PDF.";

export function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i >= 0 ? nombre.slice(i).toLowerCase() : "";
}

/** Firma («magic bytes») coherente con la extensión declarada. */
export function firmaArchivoCoincide(bytes: Uint8Array, ext: string): boolean {
  const eq = (offset: number, sig: number[]) => sig.every((b, i) => bytes[offset + i] === b);
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return eq(0, [0xff, 0xd8, 0xff]);
    case ".png":
      return eq(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".webp":
      return eq(0, [0x52, 0x49, 0x46, 0x46]) && eq(8, [0x57, 0x45, 0x42, 0x50]); // RIFF....WEBP
    case ".pdf":
      return eq(0, [0x25, 0x50, 0x44, 0x46]); // %PDF
    default:
      return false;
  }
}

/** Nombre mostrable seguro: sin rutas ni caracteres de control. */
export function nombreSeguro(nombre: string): string {
  const base = nombre.split(/[\\/]/).pop() ?? "archivo";
  return base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_").trim().slice(0, 255) || "archivo";
}
