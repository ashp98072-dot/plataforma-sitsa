import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

export type TipoDocumentoVehiculo =
  | "TarjetaCirculacion"
  | "PolizaSeguro"
  | "TituloPropiedad"
  | "PermisoLinea"
  | "Otro";

export type EstadoDocumentoVehiculo = "Vigente" | "Inactivo";

export type DocumentoVehiculo = {
  id: number;
  empresaId: number;
  vehiculoId: number;
  tipo: TipoDocumentoVehiculo;
  titulo: string | null;
  estado: EstadoDocumentoVehiculo;
  fechaVencimiento: string | null; // YYYY-MM-DD
  notas: string | null;
  archivo: {
    nombreOriginal: string;
    mime: string | null;
    tamano: number;
  } | null;
  subidoPor: string | null;
  creadoAt: string;
};

const TIPOS_VALIDOS = new Set<TipoDocumentoVehiculo>([
  "TarjetaCirculacion",
  "PolizaSeguro",
  "TituloPropiedad",
  "PermisoLinea",
  "Otro",
]);

function mapDocumento(r: RowDataPacket): DocumentoVehiculo {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    vehiculoId: Number(r.vehiculo_id),
    tipo: String(r.tipo) as TipoDocumentoVehiculo,
    titulo: r.titulo ? String(r.titulo) : null,
    estado: (String(r.estado) as EstadoDocumentoVehiculo) || "Vigente",
    fechaVencimiento: r.fecha_vencimiento
      ? String(r.fecha_vencimiento).slice(0, 10)
      : null,
    notas: r.notas ? String(r.notas) : null,
    archivo: r.ruta_relativa
      ? {
          nombreOriginal: String(r.nombre_original ?? "archivo"),
          mime: r.mime ? String(r.mime) : null,
          tamano: Number(r.tamano ?? 0),
        }
      : null,
    subidoPor: r.subido_por ? String(r.subido_por) : null,
    creadoAt: String(r.creado_at),
  };
}

/** Todos los documentos de un vehículo, más recientes primero. */
export async function listarDocumentosVehiculo(
  empresaId: number,
  vehiculoId: number,
): Promise<DocumentoVehiculo[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM flota_vehiculo_documentos
     WHERE empresa_id = ? AND vehiculo_id = ?
     ORDER BY creado_at DESC, id DESC`,
    [empresaId, vehiculoId],
  );
  return rows.map(mapDocumento);
}

/** Ruta/nombre de un documento puntual, para servirlo como descarga. */
export async function obtenerArchivoDocumento(
  empresaId: number,
  vehiculoId: number,
  documentoId: number,
): Promise<{ rutaRelativa: string; nombreOriginal: string; mime: string | null } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT ruta_relativa, nombre_original, mime
     FROM flota_vehiculo_documentos
     WHERE id = ? AND vehiculo_id = ? AND empresa_id = ? AND ruta_relativa IS NOT NULL
     LIMIT 1`,
    [documentoId, vehiculoId, empresaId],
  );
  if (!rows[0]) return null;
  return {
    rutaRelativa: String(rows[0].ruta_relativa),
    nombreOriginal: String(rows[0].nombre_original ?? "archivo"),
    mime: rows[0].mime ? String(rows[0].mime) : null,
  };
}

export async function crearDocumentoVehiculo(input: {
  empresaId: number;
  vehiculoId: number;
  tipo: TipoDocumentoVehiculo;
  titulo?: string | null;
  estado?: EstadoDocumentoVehiculo;
  fechaVencimiento?: string | null;
  notas?: string | null;
  archivo?: {
    rutaRelativa: string;
    nombreOriginal: string;
    mime: string | null;
    tamano: number;
  } | null;
  subidoPor: string;
}): Promise<{ ok: boolean; mensaje: string; id?: number }> {
  if (!TIPOS_VALIDOS.has(input.tipo)) {
    return { ok: false, mensaje: "Tipo de documento inválido." };
  }
  if (
    input.fechaVencimiento &&
    Number.isNaN(Date.parse(input.fechaVencimiento))
  ) {
    return { ok: false, mensaje: "Fecha de vencimiento inválida." };
  }

  const veh = await query<RowDataPacket[]>(
    `SELECT id FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [input.vehiculoId, input.empresaId],
  );
  if (!veh[0]) {
    return { ok: false, mensaje: "Vehículo no encontrado en esta empresa." };
  }

  const result = await execute(
    `INSERT INTO flota_vehiculo_documentos
      (empresa_id, vehiculo_id, tipo, titulo, estado, fecha_vencimiento, notas,
       ruta_relativa, nombre_original, mime, tamano, subido_por, creado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      input.empresaId,
      input.vehiculoId,
      input.tipo,
      input.tipo === "Otro" ? input.titulo?.trim() || null : null,
      input.estado ?? "Vigente",
      input.fechaVencimiento || null,
      input.notas?.trim() || null,
      input.archivo?.rutaRelativa ?? null,
      input.archivo?.nombreOriginal ?? null,
      input.archivo?.mime ?? null,
      input.archivo?.tamano ?? null,
      input.subidoPor,
    ],
  );
  return {
    ok: true,
    mensaje: "Documento guardado.",
    id: Number((result as ResultSetHeader).insertId),
  };
}

/**
 * Actualiza estado/fecha/notas de un documento (p.ej. marcarlo Inactivo con
 * un comentario del motivo). No reemplaza el archivo — para eso se sube uno
 * nuevo con crearDocumentoVehiculo.
 */
export async function actualizarDocumentoVehiculo(
  empresaId: number,
  vehiculoId: number,
  id: number,
  patch: {
    estado?: EstadoDocumentoVehiculo;
    fechaVencimiento?: string | null;
    notas?: string | null;
    titulo?: string | null;
  },
): Promise<{ ok: boolean; mensaje: string }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM flota_vehiculo_documentos
     WHERE id = ? AND vehiculo_id = ? AND empresa_id = ? LIMIT 1`,
    [id, vehiculoId, empresaId],
  );
  if (!rows[0]) return { ok: false, mensaje: "Documento no encontrado." };

  if (
    patch.fechaVencimiento &&
    Number.isNaN(Date.parse(patch.fechaVencimiento))
  ) {
    return { ok: false, mensaje: "Fecha de vencimiento inválida." };
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.estado !== undefined) {
    sets.push("estado = ?");
    params.push(patch.estado);
  }
  if (patch.fechaVencimiento !== undefined) {
    sets.push("fecha_vencimiento = ?");
    params.push(patch.fechaVencimiento || null);
  }
  if (patch.notas !== undefined) {
    sets.push("notas = ?");
    params.push(patch.notas?.trim() || null);
  }
  if (patch.titulo !== undefined) {
    sets.push("titulo = ?");
    params.push(patch.titulo?.trim() || null);
  }
  if (sets.length === 0) return { ok: false, mensaje: "Nada que actualizar." };

  params.push(id, vehiculoId, empresaId);
  await execute(
    `UPDATE flota_vehiculo_documentos SET ${sets.join(", ")}
     WHERE id = ? AND vehiculo_id = ? AND empresa_id = ?`,
    params,
  );
  return { ok: true, mensaje: "Documento actualizado." };
}

export async function eliminarDocumentoVehiculo(
  empresaId: number,
  vehiculoId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string; rutaRelativaBorrada?: string | null }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT ruta_relativa FROM flota_vehiculo_documentos
     WHERE id = ? AND vehiculo_id = ? AND empresa_id = ? LIMIT 1`,
    [id, vehiculoId, empresaId],
  );
  if (!rows[0]) return { ok: false, mensaje: "Documento no encontrado." };

  await execute(
    `DELETE FROM flota_vehiculo_documentos WHERE id = ? AND vehiculo_id = ? AND empresa_id = ?`,
    [id, vehiculoId, empresaId],
  );
  return {
    ok: true,
    mensaje: "Documento eliminado.",
    rutaRelativaBorrada: rows[0].ruta_relativa
      ? String(rows[0].ruta_relativa)
      : null,
  };
}