import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { SignJWT, jwtVerify } from "jose";
import { getAuthSecretBytes } from "@/lib/auth-secret";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { guardarUploadExcel, borrarUpload, validarRutaArchivoEmpresa } from "@/lib/uploads";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { analizarExcelProveedor, hashImportacion, resumirImportacion, VERSION_HALEL, MIME_XLSX, type AnalisisImportacion, type FilaImportada } from "./combustible-importacion-parser";

type Actor = { id: number; username: string };
type Archivo = { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };
const audiencia = "combustibles-importacion-preview";
const digest = (a: AnalisisImportacion) => hashImportacion(JSON.stringify(a));
async function proveedor(empresaId: number, proveedorId: number, conn?: PoolConnection) {
  const sql = `SELECT id, nombre_comercial, activo FROM compras_proveedores WHERE empresa_id=? AND id=?${conn ? " FOR UPDATE" : ""}`;
  const rows = conn ? (await conn.query<RowDataPacket[]>(sql, [empresaId, proveedorId]))[0] : await query<RowDataPacket[]>(sql, [empresaId, proveedorId]);
  if (!rows[0]?.activo) throw new ErrorDominioFormulario("Proveedor no disponible para esta empresa.");
  return rows[0];
}
async function leer(sql: string, values: (string | number)[], conn?: PoolConnection) {
  return conn ? (await conn.query<RowDataPacket[]>(sql, values))[0] : query<RowDataPacket[]>(sql, values);
}
async function preparar(empresaId: number, proveedorId: number, buffer: Buffer, conn?: PoolConnection) {
  const sha = hashImportacion(buffer);
  const repetidos = await leer("SELECT id FROM flota_combustible_conciliaciones WHERE empresa_id=? AND proveedor_id=? AND archivo_sha256=? LIMIT 1", [empresaId, proveedorId, sha], conn);
  if (repetidos.length) throw new ErrorDominioFormulario("Este archivo ya fue importado anteriormente.", 409);
  const analisis = await analizarExcelProveedor(buffer);
  const keys = [...new Set(analisis.filas.flatMap(f => f.claveOperacion ? [f.claveOperacion] : []))];
  const previas = new Set<string>();
  for (let i = 0; i < keys.length; i += 200) {
    const lote = keys.slice(i, i + 200);
    const rows = await leer(`SELECT DISTINCT f.clave_operacion FROM flota_combustible_conciliacion_filas f
      JOIN flota_combustible_conciliaciones c ON c.empresa_id=f.empresa_id AND c.id=f.conciliacion_id
      WHERE c.empresa_id=? AND c.proveedor_id=? AND c.perfil_parser='HALEL' AND f.clave_operacion IN (${lote.map(() => "?").join(",")})`, [empresaId, proveedorId, ...lote], conn);
    rows.forEach(r => previas.add(String(r.clave_operacion)));
  }
  for (const f of analisis.filas) f.duplicadoPrevio = f.claveOperacion != null && previas.has(f.claveOperacion);
  analisis.resumen = resumirImportacion(analisis.filas);
  if (!analisis.resumen.operacionesUnicasEstimadas) throw new ErrorDominioFormulario("No hay filas operativas válidas para confirmar.");
  return { analisis, sha };
}
/** Preview no guarda archivo ni filas. Recibo firmado ligado a usuario/tenant/proveedor/hash/contenido, 15 minutos. */
export async function previewImportacion(empresaId: number, proveedorId: number, actor: Actor, buffer: Buffer) {
  await proveedor(empresaId, proveedorId);
  const { analisis, sha } = await preparar(empresaId, proveedorId, buffer);
  const token = await new SignJWT({ empresaId, proveedorId, usuarioId: actor.id, sha, vista: digest(analisis), version: VERSION_HALEL })
    .setProtectedHeader({ alg: "HS256" }).setAudience(audiencia).setIssuedAt().setExpirationTime("15m").sign(getAuthSecretBytes());
  return { ...analisis, sha256: sha, token };
}
export async function confirmarImportacion(empresaId: number, proveedorId: number, actor: Actor, buffer: Buffer, archivo: Archivo, token: string) {
  let recibo;
  try { recibo = (await jwtVerify(token, getAuthSecretBytes(), { algorithms: ["HS256"], audience: audiencia })).payload; }
  catch { throw new ErrorDominioFormulario("El preview expiró o es inválido. Analiza nuevamente el archivo.", 409); }
  if (recibo.empresaId !== empresaId || recibo.proveedorId !== proveedorId || recibo.usuarioId !== actor.id || recibo.sha !== hashImportacion(buffer) || recibo.version !== VERSION_HALEL) throw new ErrorDominioFormulario("El preview no corresponde a este archivo/proveedor/usuario.", 409);
  const conn = await getPool().getConnection();
  let subida: Awaited<ReturnType<typeof guardarUploadExcel>> | null = null, committed = false, commitIntentado = false;
  try {
    await conn.beginTransaction();
    const p = await proveedor(empresaId, proveedorId, conn); // serializa confirmaciones del mismo proveedor
    const { analisis, sha } = await preparar(empresaId, proveedorId, buffer, conn);
    if (recibo.vista !== digest(analisis)) throw new ErrorDominioFormulario("La clasificación cambió desde el preview. Analiza nuevamente para revisar las advertencias.", 409);
    subida = await guardarUploadExcel(empresaId, "flota", "importacion_proveedor", { name: archivo.name, size: buffer.length, arrayBuffer: async () => Uint8Array.from(buffer).buffer });
    const ahora = ahoraLocal();
    const [r] = await conn.execute<ResultSetHeader>(`INSERT INTO flota_combustible_conciliaciones
      (empresa_id,nombre_original,ruta_relativa,mime,tamano,hoja,subido_por,creado_at,proveedor_id,proveedor_nombre,archivo_sha256,perfil_parser,version_parser,estado_importacion,resumen_importacion,subido_por_usuario_id)
      VALUES (?,?,?,?,?,'MULTIHOJA',?,?,?,?,?,'HALEL',1,'IMPORTADA',?,?)`,
      [empresaId, subida.original, subida.relative, MIME_XLSX, subida.size, actor.username, ahora, proveedorId, String(p.nombre_comercial), sha, JSON.stringify(analisis.resumen), actor.id]);
    const id = Number(r.insertId), insertadas: number[] = [];
    for (const f of analisis.filas) {
      const [linea] = await conn.execute<ResultSetHeader>(`INSERT INTO flota_combustible_conciliacion_filas
        (empresa_id,conciliacion_id,fila_excel,estado,motivo,creado_at,hoja_origen,estado_parseo,datos_importacion,origen_celdas,fingerprint,clave_operacion,duplicado_tipo,duplicado_previo,duplicado_de_linea_id)
        VALUES (?,?,?,'DESCARTADA','Importación sin conciliación',?,?,?,?,?,?,?,?,?,?)`,
        [empresaId, id, f.fila, ahora, f.hoja, f.estado, JSON.stringify({ ...f, raw: undefined }), JSON.stringify(f.raw), f.fingerprint, f.claveOperacion, f.duplicado, f.duplicadoPrevio ? 1 : 0, f.canonica == null ? null : insertadas[f.canonica]]);
      insertadas.push(Number(linea.insertId));
    }
    await registrarAuditoriaTx(conn, { empresaId, usuario: actor.username, modulo: "flota_combustible", accion: "importar_reporte_proveedor", detalle: `Importación #${id} · proveedor #${proveedorId} · sha256 ${sha} · usuario #${actor.id} · ${analisis.filas.length} filas` });
    commitIntentado = true;
    await conn.commit(); committed = true; return { id, resumen: analisis.resumen };
  } catch (error) {
    try { await conn.rollback(); } catch { /* preserva error original */ }
    if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") throw new ErrorDominioFormulario("Este archivo ya fue importado anteriormente.", 409);
    throw error;
  } finally {
    conn.release();
    if (!committed && subida && !commitIntentado && validarRutaArchivoEmpresa(empresaId, subida.relative)) borrarUpload(subida.relative);
    // Un COMMIT sin respuesta puede haber quedado aplicado: nunca destruir su evidencia.
    if (!committed && commitIntentado) console.warn("[combustible-importacion] COMMIT incierto: verificar por empresa/hash antes de limpiar archivos", { empresaId, sha256: recibo.sha });
  }
}
export async function listarImportaciones(empresaId: number) {
  return query<RowDataPacket[]>(`SELECT id, nombre_original AS archivo, proveedor_nombre AS proveedor, subido_por AS usuario, creado_at AS fecha,
    estado_importacion AS estado, resumen_importacion AS resumen FROM flota_combustible_conciliaciones WHERE empresa_id=? AND perfil_parser='HALEL' ORDER BY id DESC LIMIT 100`, [empresaId]);
}
export async function detalleImportacion(empresaId: number, id: number) {
  const rows = await query<RowDataPacket[]>(`SELECT id,nombre_original AS archivo,proveedor_nombre AS proveedor,subido_por AS usuario,creado_at AS fecha,estado_importacion AS estado,resumen_importacion AS resumen
    FROM flota_combustible_conciliaciones WHERE empresa_id=? AND id=? AND perfil_parser='HALEL'`, [empresaId, id]);
  if (!rows[0]) return null;
  const lineas = await query<RowDataPacket[]>("SELECT id,datos_importacion,origen_celdas FROM flota_combustible_conciliacion_filas WHERE empresa_id=? AND conciliacion_id=? ORDER BY id LIMIT 10001", [empresaId, id]);
  return { ...rows[0], filas: lineas.map(r => ({ ...JSON.parse(String(r.datos_importacion)) as FilaImportada, id: Number(r.id), raw: JSON.parse(String(r.origen_celdas)) })) };
}
export async function archivoImportacion(empresaId: number, id: number) {
  const rows = await query<RowDataPacket[]>("SELECT ruta_relativa,nombre_original FROM flota_combustible_conciliaciones WHERE empresa_id=? AND id=? AND perfil_parser='HALEL'", [empresaId, id]);
  return rows[0] ?? null;
}
