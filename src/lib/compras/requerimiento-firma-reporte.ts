import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { getUploadsRoot, validarRutaArchivoEmpresa } from "@/lib/uploads";
import { esPngValido, MAX_FIRMA_IMAGEN_BYTES } from "@/lib/firmas/imagen-firma";

export type FirmaCompraReporte = {
  nombre: string | null; rol: string | null; fecha: string; codigo: string;
  imagen: { buffer: Buffer; mime: string } | null;
};

/** Exclusivamente el snapshot de Fase 4: nunca consulta Mi firma ni usuarios. */
export async function firmaHistoricaCompraReporte(empresaId: number, requerimientoId: number): Promise<FirmaCompraReporte | null> {
  const rows = await query<RowDataPacket[]>(`SELECT payload_canonico, imagen_ruta, codigo_firma,
    DATE_FORMAT(fecha_hora_servidor, '%Y-%m-%d %H:%i:%s') AS fecha
    FROM firmas_electronicas WHERE empresa_id = ? AND modulo = 'COMPRAS'
    AND entidad_tipo = 'REQUERIMIENTO_COMPRA' AND entidad_id = ? AND accion = 'AUTORIZAR_COMPRA'
    ORDER BY fecha_hora_servidor DESC, id DESC LIMIT 1`, [empresaId, requerimientoId]);
  const row = rows[0];
  if (!row) return null;
  let nombre: string | null = null, rol: string | null = null;
  try {
    const payload: unknown = JSON.parse(String(row.payload_canonico));
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const p = payload as Record<string, unknown>;
      nombre = typeof p.nombreFirmante === "string" ? p.nombreFirmante : null;
      rol = typeof p.rolFirmante === "string" ? p.rolFirmante : null;
    }
  } catch { /* Históricos corruptos: no inventar identidad. */ }
  let imagen: FirmaCompraReporte["imagen"] = null;
  try {
    const abs = validarRutaArchivoEmpresa(empresaId, row.imagen_ruta);
    if (abs) {
      // También validar el archivo final: una lectura debe rechazar symlinks fuera del tenant.
      const [rootReal, archivoReal] = await Promise.all([
        realpath(resolve(getUploadsRoot(), "empresas", String(empresaId))), realpath(abs),
      ]);
      if (archivoReal.startsWith(rootReal + sep)) {
        const buffer = await readFile(archivoReal);
        if (buffer.length <= MAX_FIRMA_IMAGEN_BYTES && esPngValido(buffer)) imagen = { buffer, mime: "image/png" };
      }
    }
  } catch { /* No exponer rutas/errores físicos. El caller exige imagen para Autorizada. */ }
  return { nombre, rol, fecha: String(row.fecha), codigo: String(row.codigo_firma), imagen };
}
