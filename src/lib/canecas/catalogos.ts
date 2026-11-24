import { z } from "zod";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/**
 * Catálogos EXCLUSIVOS de Canecas: proveedores y clientes. No usan compras_proveedores ni los clientes de
 * Operaciones/TMS/Facturación y se aíslan por empresa. La empresa y el usuario siempre vienen de la sesión.
 */
export type Catalogo = "proveedores" | "clientes";
const TABLAS: Record<Catalogo, string> = { proveedores: "canecas_proveedores", clientes: "canecas_clientes" };

const base = (v: string | null | undefined) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
/** Identidad de nombre: sin acentos, sin mayúsculas, espacios colapsados. Solo sirve para comparar. */
export const normalizarNombreCatalogo = (nombre: string) => base(nombre);
/** Identidad de NIT: sin espacios, puntos ni guiones. Vacío -> null (no participa en la unicidad). */
export const normalizarNitCatalogo = (nit: string | null | undefined): string | null => base(nit).replace(/[\s.-]/g, "") || null;

const opcional = (max: number, patron?: RegExp) => z.string().trim().max(max).refine(v => !v || !patron || patron.test(v)).optional().nullable().transform(v => (v ? v : null));
export const esquemaCatalogo = z.object({
  nombre_comercial: z.string().trim().min(1).max(200).refine(v => base(v).length > 0),
  nit: opcional(30, /^[A-Za-z0-9 .\-/]+$/),
  telefono: opcional(40, /^[0-9 +().\-]{3,40}$/),
  direccion: opcional(300),
}).strict();
export type DatosCatalogo = z.infer<typeof esquemaCatalogo>;

export class ErrorCatalogoDuplicado extends Error {
  constructor(public campo: "nombre" | "nit") { super("CATALOGO_DUPLICADO"); }
}
export class ErrorCatalogoNoEncontrado extends Error { constructor() { super("CATALOGO_NO_ENCONTRADO"); } }

const enteroPositivo = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const valida = (...ids: number[]) => { if (!ids.every(enteroPositivo)) throw new Error("CATALOGO_INVALIDO"); };

/** SELECT de listado (un solo parámetro: empresa_id). Lo usan la API y listarCatalogo. */
export const sqlListarCatalogo = (catalogo: Catalogo) =>
  `SELECT id,nombre_comercial,nit,telefono,direccion,activo,IF(activo=1,'Activo','Inactivo') AS estado,creado_en FROM ${TABLAS[catalogo]} WHERE empresa_id=? ORDER BY nombre_comercial,id`;

export async function listarCatalogo(pool: Pool, catalogo: Catalogo, empresaId: number) {
  valida(empresaId);
  const [rows] = await pool.query<RowDataPacket[]>(sqlListarCatalogo(catalogo), [empresaId]);
  return rows;
}

async function buscarDuplicado(pool: Pool, catalogo: Catalogo, empresaId: number, nombreNorm: string, nitNorm: string | null, excluirId?: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id,nombre_normalizado,nit_normalizado FROM ${TABLAS[catalogo]} WHERE empresa_id=? AND (nombre_normalizado=? OR (? IS NOT NULL AND nit_normalizado=?)) AND (? IS NULL OR id<>?) LIMIT 2`,
    [empresaId, nombreNorm, nitNorm, nitNorm, excluirId ?? null, excluirId ?? null]);
  const choque = rows[0];
  if (!choque) return;
  throw new ErrorCatalogoDuplicado(choque.nombre_normalizado === nombreNorm ? "nombre" : "nit");
}

function traducirDuplicado(error: unknown): never {
  const e = error as { code?: string; errno?: number; message?: string };
  if (e?.code === "ER_DUP_ENTRY" || e?.errno === 1062) throw new ErrorCatalogoDuplicado(/_nit/.test(String(e.message)) ? "nit" : "nombre");
  throw error;
}

export async function crearCatalogo(pool: Pool, catalogo: Catalogo, empresaId: number, usuarioId: number, datos: DatosCatalogo) {
  valida(empresaId, usuarioId);
  const d = esquemaCatalogo.parse(datos);
  const nombreNorm = normalizarNombreCatalogo(d.nombre_comercial), nitNorm = normalizarNitCatalogo(d.nit);
  await buscarDuplicado(pool, catalogo, empresaId, nombreNorm, nitNorm);
  try {
    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO ${TABLAS[catalogo]} (empresa_id,nombre_comercial,nombre_normalizado,nit,nit_normalizado,telefono,direccion,creado_por) VALUES (?,?,?,?,?,?,?,?)`,
      [empresaId, d.nombre_comercial, nombreNorm, d.nit, nitNorm, d.telefono, d.direccion, usuarioId]);
    return r.insertId;
  } catch (error) { return traducirDuplicado(error); }
}

export async function editarCatalogo(pool: Pool, catalogo: Catalogo, empresaId: number, usuarioId: number, id: number, datos: DatosCatalogo) {
  valida(empresaId, usuarioId, id);
  const d = esquemaCatalogo.parse(datos);
  const nombreNorm = normalizarNombreCatalogo(d.nombre_comercial), nitNorm = normalizarNitCatalogo(d.nit);
  await buscarDuplicado(pool, catalogo, empresaId, nombreNorm, nitNorm, id);
  try {
    const [r] = await pool.execute<ResultSetHeader>(
      `UPDATE ${TABLAS[catalogo]} SET nombre_comercial=?,nombre_normalizado=?,nit=?,nit_normalizado=?,telefono=?,direccion=?,actualizado_por=?,actualizado_en=CURRENT_TIMESTAMP WHERE empresa_id=? AND id=?`,
      [d.nombre_comercial, nombreNorm, d.nit, nitNorm, d.telefono, d.direccion, usuarioId, empresaId, id]);
    if (!r.affectedRows) throw new ErrorCatalogoNoEncontrado();
  } catch (error) { if (error instanceof ErrorCatalogoNoEncontrado) throw error; traducirDuplicado(error); }
}

export async function cambiarEstadoCatalogo(pool: Pool, catalogo: Catalogo, empresaId: number, usuarioId: number, id: number, activo: boolean) {
  valida(empresaId, usuarioId, id);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE ${TABLAS[catalogo]} SET activo=?,actualizado_por=?,actualizado_en=CURRENT_TIMESTAMP WHERE empresa_id=? AND id=?`, [Number(activo), usuarioId, empresaId, id]);
  if (!r.affectedRows) throw new ErrorCatalogoNoEncontrado();
}

/** El proveedor debe existir en la empresa y estar activo (compras nuevas). */
export async function proveedorActivo(pool: Pool, empresaId: number, proveedorId: number) {
  valida(empresaId, proveedorId);
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id FROM canecas_proveedores WHERE empresa_id=? AND id=? AND activo=1", [empresaId, proveedorId]);
  return rows.length === 1;
}

/**
 * Mapeo MANUAL y explícito de una compra histórica a un proveedor de Canecas. Nunca modifica proveedor_id ni los
 * costos; solo completa canecas_proveedor_id cuando está vacío, dentro de la misma empresa y con un proveedor activo, y deja
 * constancia de quién lo hizo en canecas_compras_mapeo_proveedor.
 */
export async function mapearProveedorCompra(pool: Pool, empresaId: number, usuarioId: number, compraId: number, proveedorId: number) {
  valida(empresaId, usuarioId, compraId, proveedorId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [compras] = await conn.query<RowDataPacket[]>("SELECT id,proveedor_id,canecas_proveedor_id FROM canecas_compras WHERE empresa_id=? AND id=? FOR UPDATE", [empresaId, compraId]);
    if (!compras[0]) throw new ErrorCatalogoNoEncontrado();
    if (compras[0].canecas_proveedor_id != null) throw new Error("COMPRA_YA_MAPEADA");
    const [prov] = await conn.query<RowDataPacket[]>("SELECT id FROM canecas_proveedores WHERE empresa_id=? AND id=? AND activo=1 FOR UPDATE", [empresaId, proveedorId]);
    if (!prov[0]) throw new Error("PROVEEDOR_INVALIDO");
    await conn.execute("UPDATE canecas_compras SET canecas_proveedor_id=? WHERE empresa_id=? AND id=? AND canecas_proveedor_id IS NULL", [proveedorId, empresaId, compraId]);
    // Bitácora inmutable: quién mapeó, cuándo y qué proveedor anterior tenía la compra (dato histórico, sin FK a Compras).
    await conn.execute("INSERT INTO canecas_compras_mapeo_proveedor (empresa_id,compra_id,proveedor_anterior_id,canecas_proveedor_id,realizado_por) VALUES (?,?,?,?,?)", [empresaId, compraId, compras[0].proveedor_id ?? null, proveedorId, usuarioId]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
