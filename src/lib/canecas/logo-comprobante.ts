import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { absPathFromRelative } from "@/lib/uploads";

/**
 * Logo de la EMPRESA ACTIVA para el comprobante de venta, como data URI (sin pedir nada a otra URL: el logo ya está en el documento
 * cuando se imprime). `logo_url` de la empresa es una ruta relativa a uploads (la misma que usan los PDF de la plataforma); si falta, se
 * usa el logo de marca de /public/brands de ESA empresa (por su slug). Nunca el de otra empresa ni el de Novalvion: sin logo devuelve null.
 */
const MAX_BYTES = 1024 * 1024;
const LOGOS_DE_MARCA: Record<string, string> = { "kt-monaco": "public/brands/monaco/logo.png" };

function comoDataUri(archivo: string): string | null {
  try {
    if (!existsSync(archivo)) return null;
    const info = statSync(archivo);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BYTES) return null;
    const bytes = readFileSync(archivo);
    const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const jpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if (!png && !jpeg) return null;
    return `data:image/${png ? "png" : "jpeg"};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export function logoDeEmpresa(empresa: { id: number; slug: string; logoUrl: string | null }): string | null {
  const ruta = (empresa.logoUrl ?? "").trim();
  if (ruta && !ruta.includes("\0")) {
    const normalizada = ruta.replaceAll("\\", "/").replace(/^\.?\/+/, "");
    const deOtra = /^empresas\/(\d+)(\/|$)/i.exec(normalizada);
    if (!(deOtra && Number(deOtra[1]) !== empresa.id)) {
      try { const propio = comoDataUri(absPathFromRelative(ruta)); if (propio) return propio; } catch { /* ruta inválida: se intenta el logo de marca */ }
    }
  }
  const marca = LOGOS_DE_MARCA[empresa.slug];
  return marca ? comoDataUri(join(process.cwd(), marca)) : null;
}
