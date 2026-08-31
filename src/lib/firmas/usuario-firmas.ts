import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { absPathFromRelative, borrarUpload, guardarUpload } from "@/lib/uploads";
import { sha256Hex } from "@/lib/firmas/imagen-firma";

/**
 * MI-FIRMA-1 — firma manuscrita personal reutilizable. `usuario_firmas`
 * es GLOBAL por usuario (la tabla `usuarios` es global a la plataforma,
 * no por empresa — ver sql/propuesta-2026-08-usuario-firmas.sql), con
 * UNIQUE(usuario_id): una sola firma activa por usuario, sin versionar.
 *
 * Esta plantilla es SOLO la fuente visual para rellenar el canvas al
 * autorizar/liquidar — nunca se referencia directamente desde
 * firmas_electronicas. Cada uso genera una COPIA física independiente
 * (ver guardarImagenFirma en src/lib/tms/viaticos.ts, que ya crea un
 * archivo nuevo sin importar el origen de los bytes) con su propio
 * código/hash/imagenSha256 — así, cambiar o eliminar esta plantilla
 * nunca modifica una firma histórica ya generada.
 */
export type FirmaUsuario = {
  id: number;
  usuarioId: number;
  imagenRuta: string;
  imagenNombreOriginal: string | null;
  imagenMime: string;
  imagenTamano: number;
  imagenSha256: string;
  creadoEn: string;
  actualizadoEn: string;
};

function mapFirmaUsuario(r: RowDataPacket): FirmaUsuario {
  return {
    id: Number(r.id),
    usuarioId: Number(r.usuario_id),
    imagenRuta: String(r.imagen_ruta),
    imagenNombreOriginal: r.imagen_nombre_original != null ? String(r.imagen_nombre_original) : null,
    imagenMime: String(r.imagen_mime),
    imagenTamano: Number(r.imagen_tamano),
    imagenSha256: String(r.imagen_sha256),
    creadoEn: String(r.creado_en ?? ""),
    actualizadoEn: String(r.actualizado_en ?? ""),
  };
}

/** El usuario SIEMPRE viene de la sesión del servidor — nunca se acepta usuario_id del cliente (responsabilidad del endpoint). */
export async function obtenerFirmaUsuario(usuarioId: number): Promise<FirmaUsuario | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, usuario_id, imagen_ruta, imagen_nombre_original, imagen_mime, imagen_tamano, imagen_sha256, creado_en, actualizado_en
     FROM usuario_firmas WHERE usuario_id = ? LIMIT 1`,
    [usuarioId],
  );
  return rows[0] ? mapFirmaUsuario(rows[0]) : null;
}

/**
 * Guarda (o reemplaza) la firma personal del usuario. Flujo atómico con
 * compensación — mismo patrón que guardarImagenFirma/autorizarViatico en
 * src/lib/tms/viaticos.ts: el archivo NUEVO se escribe a disco ANTES de
 * abrir la transacción; si el commit no llega a completarse (DB falla),
 * se borra el archivo nuevo y se CONSERVA el anterior intacto (nunca se
 * tocó). Si el commit sí llega, el archivo ANTERIOR (si había uno
 * distinto) se borra recién DESPUÉS, best-effort.
 *
 * `empresaId` se usa ÚNICAMENTE para la ruta física de almacenamiento
 * (guardarUpload la requiere) — la fila en `usuario_firmas` es global,
 * sin empresa_id; un usuario con acceso a varias empresas comparte la
 * misma firma sin importar desde cuál la registró/cambió.
 */
export async function guardarFirmaUsuario(
  empresaId: number,
  usuarioId: number,
  imagen: { bytes: ArrayBuffer; original: string },
): Promise<FirmaUsuario> {
  const guardada = await guardarUpload(empresaId, "firmas", `perfil_usuario_${usuarioId}`, {
    name: imagen.original || "firma.png",
    size: imagen.bytes.byteLength,
    arrayBuffer: async () => imagen.bytes,
  });
  const sha256 = sha256Hex(imagen.bytes);

  let conn: PoolConnection | null = null;
  let committed = false;
  let rutaAnterior: string | null = null;
  try {
    conn = await getPool().getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT imagen_ruta FROM usuario_firmas WHERE usuario_id = ? LIMIT 1 FOR UPDATE`,
      [usuarioId],
    );
    rutaAnterior = rows[0] ? String(rows[0].imagen_ruta) : null;

    await conn.execute<ResultSetHeader>(
      `INSERT INTO usuario_firmas
        (usuario_id, imagen_ruta, imagen_nombre_original, imagen_mime, imagen_tamano, imagen_sha256)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         imagen_ruta = VALUES(imagen_ruta),
         imagen_nombre_original = VALUES(imagen_nombre_original),
         imagen_mime = VALUES(imagen_mime),
         imagen_tamano = VALUES(imagen_tamano),
         imagen_sha256 = VALUES(imagen_sha256)`,
      [usuarioId, guardada.relative, guardada.original, "image/png", guardada.size, sha256],
    );

    await conn.commit();
    committed = true;
  } finally {
    if (conn) {
      if (!committed) {
        try {
          await conn.rollback();
        } catch {
          // best-effort — nunca oculta el error real que ya se está propagando.
        }
      }
      conn.release();
    }
    if (!committed) {
      // Compensación: el archivo NUEVO ya se había escrito a disco. Se
      // borra (best-effort) y se conserva el anterior intacto — nunca se
      // tocó dentro de una transacción que no llegó a comprometerse.
      borrarUpload(guardada.relative);
    }
  }

  // Éxito recién confirmado: ahora sí se borra el archivo ANTERIOR (si
  // había uno distinto al nuevo), best-effort, DESPUÉS del commit.
  if (rutaAnterior && rutaAnterior !== guardada.relative) {
    borrarUpload(rutaAnterior);
  }

  const firma = await obtenerFirmaUsuario(usuarioId);
  if (!firma) throw new Error("No se pudo leer la firma recién guardada.");
  return firma;
}

/**
 * Elimina la firma personal del usuario (fila + archivo físico,
 * best-effort). Nunca toca `firmas_electronicas` — las copias históricas
 * ya generadas quedan intactas, cada una con su propio archivo
 * independiente.
 */
export async function eliminarFirmaUsuario(usuarioId: number): Promise<{ ok: boolean }> {
  const conn = await getPool().getConnection();
  let rutaABorrar: string | null = null;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT imagen_ruta FROM usuario_firmas WHERE usuario_id = ? LIMIT 1 FOR UPDATE`,
      [usuarioId],
    );
    if (!rows[0]) {
      await conn.rollback();
      return { ok: false };
    }
    rutaABorrar = String(rows[0].imagen_ruta);
    await conn.execute(`DELETE FROM usuario_firmas WHERE usuario_id = ?`, [usuarioId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  if (rutaABorrar) borrarUpload(rutaABorrar);
  return { ok: true };
}

/**
 * MI-FIRMA-1 — lee los bytes ACTUALES de la firma guardada del usuario,
 * para que el caller (autorizar/liquidar route.ts) genere una COPIA
 * física independiente vía guardarImagenFirma (src/lib/tms/viaticos.ts)
 * — nunca se reutiliza esta ruta directamente en firmas_electronicas.
 * `null` si el usuario no tiene firma guardada, o si el archivo ya no
 * existe en disco (p. ej. se eliminó/reemplazó justo en ese instante) —
 * el caller debe tratar `null` como "no hay firma guardada disponible",
 * nunca lanzar una excepción por esto.
 */
export async function leerBytesFirmaGuardada(
  usuarioId: number,
): Promise<{ bytes: ArrayBuffer; original: string } | null> {
  const firma = await obtenerFirmaUsuario(usuarioId);
  if (!firma) return null;
  const abs = absPathFromRelative(firma.imagenRuta);
  if (!existsSync(abs)) return null;
  const buf = await readFile(abs);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return { bytes, original: firma.imagenNombreOriginal || "firma.png" };
}
