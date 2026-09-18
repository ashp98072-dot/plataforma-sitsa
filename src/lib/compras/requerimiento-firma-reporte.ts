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
export type FirmasCompraReporte = {
  requirente: FirmaCompraReporte | null;
  encargado: FirmaCompraReporte | null;
  autorizante: FirmaCompraReporte | null;
};

/** La última asociación auditada puede ser NULL: nunca resucitar una copia
 * antigua al cambiar a una persona sin plantilla (incluido A -> B -> A).
 * Históricos anteriores sin evento conservan exclusivamente línea manual.
 */
async function firmaRolReporte(empresaId: number, requerimientoId: number, accion: "REQUERIR_COMPRA" | "GESTIONAR_COMPRA") {
  const eventos = await query<RowDataPacket[]>(`SELECT detalle FROM auditoria
    WHERE empresa_id = ? AND modulo = 'compras_requerimientos' AND accion = ?
    AND JSON_UNQUOTE(JSON_EXTRACT(CASE WHEN JSON_VALID(detalle) THEN detalle ELSE '{}' END, '$.requerimientoId')) = ?
    ORDER BY id DESC LIMIT 1`, [empresaId, `capturar_${accion.toLowerCase()}`, String(requerimientoId)]);
  if (!eventos[0]) return null;
  let firmaId: unknown;
  try { firmaId = JSON.parse(String(eventos[0].detalle)).firmaId; } catch { return null; }
  if (typeof firmaId !== "number" || !Number.isSafeInteger(firmaId) || firmaId <= 0) return null;
  return firmaHistoricaCompraReporte(empresaId, requerimientoId, accion, firmaId);
}

export async function firmasHistoricasCompraReporte(empresaId: number, requerimientoId: number, autorizada: boolean): Promise<FirmasCompraReporte> {
  const [requirente, encargado, autorizante] = await Promise.all([
    firmaRolReporte(empresaId, requerimientoId, "REQUERIR_COMPRA"),
    firmaRolReporte(empresaId, requerimientoId, "GESTIONAR_COMPRA"),
    autorizada ? firmaHistoricaCompraReporte(empresaId, requerimientoId) : Promise.resolve(null),
  ]);
  return { requirente, encargado, autorizante };
}

/** Exclusivamente el snapshot de Fase 4: nunca consulta Mi firma ni usuarios. */
export async function firmaHistoricaCompraReporte(empresaId: number, requerimientoId: number,
  accion: "AUTORIZAR_COMPRA" | "REQUERIR_COMPRA" | "GESTIONAR_COMPRA" = "AUTORIZAR_COMPRA", firmaId?: number): Promise<FirmaCompraReporte | null> {
  const rows = await query<RowDataPacket[]>(`SELECT payload_canonico, imagen_ruta, codigo_firma,
    DATE_FORMAT(fecha_hora_servidor, '%Y-%m-%d %H:%i:%s') AS fecha
    FROM firmas_electronicas WHERE empresa_id = ? AND modulo = 'COMPRAS'
    AND entidad_tipo = 'REQUERIMIENTO_COMPRA' AND entidad_id = ? AND accion = ?
    ${firmaId === undefined ? "" : "AND id = ?"}
    ORDER BY fecha_hora_servidor DESC, id DESC LIMIT 1`, [empresaId, requerimientoId, accion, ...(firmaId === undefined ? [] : [firmaId])]);
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
