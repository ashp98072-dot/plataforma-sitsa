import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { borrarUpload, guardarUpload, UploadValidationError, MAX_UPLOAD_BYTES } from "@/lib/uploads";
import {
  EXTENSIONES_EVIDENCIA,
  MENSAJE_FORMATOS_EVIDENCIA,
  extensionDe,
  firmaArchivoCoincide,
  nombreSeguro,
} from "./documentos-por-tipo-validacion";
import {
  eliminarDocumento,
  obtenerDocumento,
  registrarDocumento,
  type DocumentoEmpleado,
} from "./documentos";

/**
 * RRHH — evidencias/comprobantes guardados con el sistema EXISTENTE de documentos del empleado (`documentos_empleados` + storage
 * privado de `@/lib/uploads`), distinguidos por un `tipo_documento` determinista (p. ej. «Comprobante de cumpleaños 2026»).
 * No se crea tabla ni storage nuevos. Los archivos son privados (descarga solo por endpoint con sesión + tenant + permiso) y el
 * endpoint de cada flujo SOLO sirve documentos de su propio tipo (no puede usarse para bajar otros documentos del expediente).
 *
 * Formatos admitidos aquí (más estrictos que el catálogo general): JPG, JPEG, PNG, WebP y PDF; se valida extensión, tamaño
 * (MAX_UPLOAD_BYTES del repositorio) y la FIRMA real del archivo, no solo su nombre.
 */

export { EXTENSIONES_EVIDENCIA, MENSAJE_FORMATOS_EVIDENCIA, firmaArchivoCoincide, nombreSeguro };

export async function validarArchivoEvidencia(file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<string> {
  if (!file || typeof file.arrayBuffer !== "function") throw new ErrorDominioFormulario("Archivo requerido.", 400);
  if (file.size <= 0) throw new ErrorDominioFormulario("Archivo vacío.", 400);
  if (file.size > MAX_UPLOAD_BYTES) throw new ErrorDominioFormulario("El archivo supera el máximo de 50 MB.", 400);
  const ext = extensionDe(String(file.name ?? ""));
  if (!EXTENSIONES_EVIDENCIA.has(ext)) throw new ErrorDominioFormulario(MENSAJE_FORMATOS_EVIDENCIA, 400);
  const cabecera = new Uint8Array((await file.arrayBuffer()).slice(0, 16));
  if (!firmaArchivoCoincide(cabecera, ext)) {
    throw new ErrorDominioFormulario("El contenido del archivo no corresponde a su formato.", 400);
  }
  return ext;
}

export async function listarDocumentosPorTipo(empresaId: number, empleadoId: number, tipo: string): Promise<DocumentoEmpleado[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, empresa_id, id_empleado, tipo_documento, ruta_archivo, nombre_original, subido_en, subido_por
       FROM documentos_empleados
      WHERE empresa_id = ? AND id_empleado = ? AND tipo_documento = ?
      ORDER BY subido_en DESC, id DESC`,
    [empresaId, empleadoId, tipo],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    idEmpleado: Number(r.id_empleado),
    tipoDocumento: String(r.tipo_documento ?? ""),
    rutaArchivo: String(r.ruta_archivo),
    nombreOriginal: r.nombre_original ? String(r.nombre_original) : null,
    subidoEn: String(r.subido_en),
    subidoPor: r.subido_por ? String(r.subido_por) : null,
  }));
}

/** Cantidad de documentos de `tipo` por empleado, en UNA consulta. */
export async function contarDocumentosPorTipo(empresaId: number, empleadoIds: number[], tipo: string): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  const ids = [...new Set(empleadoIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return mapa;
  const rows = await query<RowDataPacket[]>(
    `SELECT id_empleado, COUNT(*) AS total FROM documentos_empleados
      WHERE empresa_id = ? AND tipo_documento = ? AND id_empleado IN (${ids.map(() => "?").join(",")})
      GROUP BY id_empleado`,
    [empresaId, tipo, ...ids],
  );
  for (const r of rows) mapa.set(Number(r.id_empleado), Number(r.total));
  return mapa;
}

/** Documento de la empresa SOLO si es del `tipo` pedido (nunca otro documento del expediente). */
export async function obtenerDocumentoDeTipo(empresaId: number, docId: number, tipo: string): Promise<DocumentoEmpleado | null> {
  const doc = await obtenerDocumento(empresaId, docId);
  return doc && doc.tipoDocumento === tipo ? doc : null;
}

/** Documento de la empresa SOLO si su tipo empieza con `prefijo` (endpoint de descarga/borrado por id de documento). */
export async function obtenerDocumentoConPrefijo(empresaId: number, docId: number, prefijo: string): Promise<DocumentoEmpleado | null> {
  const doc = await obtenerDocumento(empresaId, docId);
  return doc && doc.tipoDocumento.startsWith(prefijo) ? doc : null;
}

/** Empleado de ESTA empresa (id + nombre) o null. */
export async function empleadoDeEmpresa(empresaId: number, empleadoId: number): Promise<{ id: number; codigo: string; nombre: string } | null> {
  const rows = await query<RowDataPacket[]>(
    "SELECT id, codigo, nombre FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1",
    [empleadoId, empresaId],
  );
  return rows[0] ? { id: Number(rows[0].id), codigo: String(rows[0].codigo ?? ""), nombre: String(rows[0].nombre ?? "") } : null;
}

/**
 * Valida y guarda un archivo como documento del empleado con el `tipoDocumento` dado. Si el INSERT falla después de escribir el
 * archivo, se borra para no dejar huérfanos (mismo patrón que Documentos de empleado y Multas).
 */
export async function subirDocumentoPorTipo(entrada: {
  empresaId: number;
  empleadoId: number;
  tipoDocumento: string;
  prefijo: string;
  usuario: string;
  file: File;
  accionAuditoria: string;
  detalleAuditoria: string;
}): Promise<DocumentoEmpleado> {
  await validarArchivoEvidencia(entrada.file);
  let guardado: Awaited<ReturnType<typeof guardarUpload>>;
  try {
    guardado = await guardarUpload(entrada.empresaId, "documentos", entrada.prefijo, entrada.file);
  } catch (e) {
    if (e instanceof UploadValidationError) throw new ErrorDominioFormulario(e.message, 400);
    throw e;
  }
  const nombre = nombreSeguro(guardado.original);
  try {
    const id = await registrarDocumento({
      empresaId: entrada.empresaId,
      idEmpleado: entrada.empleadoId,
      tipoDocumento: entrada.tipoDocumento,
      rutaArchivo: guardado.relative,
      nombreOriginal: nombre,
      subidoPor: entrada.usuario,
    });
    await registrarAuditoria({
      empresaId: entrada.empresaId,
      usuario: entrada.usuario,
      accion: entrada.accionAuditoria,
      modulo: "rrhh",
      detalle: `${entrada.detalleAuditoria} · doc #${id} · ${nombre}`,
    });
    const doc = await obtenerDocumento(entrada.empresaId, id);
    if (!doc) throw new Error("No se pudo leer el documento recién guardado.");
    return doc;
  } catch (e) {
    borrarUpload(guardado.relative);
    throw e;
  }
}

export async function eliminarDocumentoPorTipo(entrada: {
  empresaId: number;
  docId: number;
  /** Prefijo exigido del tipo (p. ej. «Comprobante de cumpleaños »): solo se elimina un documento de ESTE flujo. */
  tipoDocumento: string;
  usuario: string;
  accionAuditoria: string;
  detalleAuditoria: string;
}): Promise<boolean> {
  const doc = await obtenerDocumentoConPrefijo(entrada.empresaId, entrada.docId, entrada.tipoDocumento);
  if (!doc) return false;
  const r = await eliminarDocumento(entrada.empresaId, entrada.docId);
  if (!r.ok) return false;
  await registrarAuditoria({
    empresaId: entrada.empresaId,
    usuario: entrada.usuario,
    accion: entrada.accionAuditoria,
    modulo: "rrhh",
    detalle: `${entrada.detalleAuditoria} · doc #${entrada.docId} · ${doc.nombreOriginal ?? ""}`,
  });
  return true;
}
