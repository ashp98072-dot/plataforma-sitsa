import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { createHash } from "node:crypto";
import { placaComparable } from "./combustible-coincidencias";
import { predicadoVehiculoAccesible } from "./acceso";
import { ErrorCB2 } from "./cb2/model";

const rows = async (c: PoolConnection, sql: string, args: (string | number)[] = []) => (await c.query<RowDataPacket[]>(sql, args))[0];
const firma = (v: RowDataPacket) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export type VehiculoRevision = { id: number; empresaId: number; placa: string; tipo: string; descripcion: string; marca: string; modelo: string; chasis: string; sucursal: string; estado: string; activo: boolean; propio: boolean; revision: string };
export type ReferenciaVehiculo = { tabla: string; campo: string; cantidad: number | null; ids: number[] };
export type RevisionDuplicado = { vehiculo: VehiculoRevision; referencias: ReferenciaVehiculo[]; puedeDesactivar: boolean; motivos: string[] };
function presentar(v: RowDataPacket, empresa: number): VehiculoRevision {
  return { id: Number(v.id), empresaId: Number(v.empresa_id), placa: String(v.placa), tipo: String(v.tipo_unidad ?? "No registrado"), descripcion: String(v.descripcion ?? ""), marca: String(v.marca ?? ""), modelo: String(v.modelo ?? ""), chasis: String(v.chasis ?? ""),
    sucursal: String(v.sucursal_nombre ?? v.sucursal ?? "No registrada"), estado: String(v.estado), activo: Number(v.activo) === 1, propio: Number(v.empresa_id) === empresa, revision: firma(v) };
}
export async function listarPlacasDuplicadas(empresa: number) {
  const c = await getPool().getConnection();
  try {
    const catalogo = await rows(c, `SELECT v.* FROM flota_vehiculos v WHERE ${predicadoVehiculoAccesible("v", "?")} ORDER BY v.id`, [empresa, empresa]);
    const grupos = new Map<string, VehiculoRevision[]>();
    for (const v of catalogo) { const placa = placaComparable(String(v.placa)); if (placa) grupos.set(placa, [...(grupos.get(placa) ?? []), presentar(v, empresa)]); }
    return [...grupos].filter(([, vehiculos]) => vehiculos.length > 1).map(([placa, vehiculos]) => ({ placa, vehiculos }));
  } finally { c.release(); }
}
const quoted = (s: string) => { if (!/^[A-Za-z0-9_]+$/.test(s)) throw new ErrorCB2("Esquema no verificable; desactivación bloqueada."); return `\`${s}\``; };
/** Incluye referencias sin FK, comparticiones y snapshots CB2; ninguna lectura cambia vínculos.
 * Los conteos/IDs ajenos no se revelan: solo se informa que existe una referencia bloqueante. */
async function referencias(c: PoolConnection, empresa: number, id: number, lock: boolean): Promise<ReferenciaVehiculo[]> {
  const columnas = await rows(c, "SELECT c.TABLE_NAME,c.COLUMN_NAME,t.ENGINE,t.TABLE_TYPE FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME WHERE c.TABLE_SCHEMA=DATABASE() ORDER BY c.TABLE_NAME,c.ORDINAL_POSITION");
  const fks = await rows(c, "SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='flota_vehiculos' AND REFERENCED_COLUMN_NAME='id'");
  if (!columnas.some(r => r.TABLE_NAME === "flota_vehiculos" && r.COLUMN_NAME === "id")) throw new ErrorCB2("Inventario de referencias incompleto.", 503);
  if (!columnas.some(r => r.TABLE_NAME === "flota_vehiculos" && r.ENGINE === "InnoDB" && r.TABLE_TYPE === "BASE TABLE")) throw new ErrorCB2("Catálogo sin garantías transaccionales; revisión bloqueada.", 503);
  const tablas = new Map<string, Set<string>>();
  for (const r of columnas) { const t = String(r.TABLE_NAME); const fields = tablas.get(t) ?? new Set<string>(); fields.add(String(r.COLUMN_NAME)); tablas.set(t, fields); }
  const encontrados: ReferenciaVehiculo[] = [];
  for (const [tabla, fields] of tablas) {
    if (tabla === "flota_vehiculos") continue;
    const campos = [...fields].filter(campo => /(^|_)vehiculo(_.*)?_id$/.test(campo) || campo === "vehiculo_id" || campo === "unidad_recurrente_id" || fks.some(r => r.TABLE_NAME === tabla && r.COLUMN_NAME === campo));
    const snapshots: Record<string, string[]> = { flota_cb2_filas: ["decision"], flota_cb2_asignaciones: ["anterior", "nuevo"] };
    for (const campo of [...campos, ...(snapshots[tabla] ?? []).filter(campo => fields.has(campo))]) {
      if (!columnas.some(r => r.TABLE_NAME === tabla && r.ENGINE === "InnoDB" && r.TABLE_TYPE === "BASE TABLE")) throw new ErrorCB2("Una fuente de referencias no permite comprobar bloqueos transaccionales.", 503);
      const json = (snapshots[tabla] ?? []).includes(campo);
      const columna = quoted(campo), t = quoted(tabla);
      const predicado = json ? `(JSON_VALUE(${columna},'$.vehiculoId')=? OR JSON_VALUE(${columna},'$.vehiculo_id')=?)` : `${columna}=?`;
      const args = json ? [id, id] : [id];
      const [count] = await rows(c, `SELECT COUNT(*) AS n FROM ${t} WHERE ${predicado}${lock ? " FOR UPDATE" : ""}`, args);
      if (!Number(count.n)) continue;
      const propia = fields.has("empresa_id");
      const visibles = propia ? await rows(c, `SELECT ${fields.has("id") ? "id" : "empresa_id AS id"} FROM ${t} WHERE ${predicado} AND empresa_id=? LIMIT 5`, [...args, empresa]) : [];
      // Una sola referencia, incluso histórica, impide esta desactivación conservadora.
      encontrados.push({ tabla: propia && visibles.length ? tabla : "Otros ámbitos o relaciones sin empresa directa", campo: propia && visibles.length ? campo : "Referencia preservada", cantidad: null, ids: propia && fields.has("id") ? visibles.map(r => Number(r.id)) : [] });
      if (propia) {
        const [visible] = await rows(c, `SELECT COUNT(*) AS n FROM ${t} WHERE ${predicado} AND empresa_id=?`, [...args, empresa]);
        if (Number(visible.n) === Number(count.n)) encontrados[encontrados.length - 1].cantidad = Number(visible.n);
      }
    }
  }
  return encontrados;
}
async function revision(c: PoolConnection, empresa: number, id: number, lock = false): Promise<RevisionDuplicado> {
  const [v] = await rows(c, `SELECT v.* FROM flota_vehiculos v WHERE v.id=? AND ${predicadoVehiculoAccesible("v", "?")}${lock ? " FOR UPDATE" : ""}`, [id, empresa, empresa]);
  if (!v) throw new ErrorCB2("Vehículo no disponible en esta empresa.", 404);
  const refs = await referencias(c, empresa, id, lock), motivos: string[] = [];
  if (Number(v.empresa_id) !== empresa) motivos.push("Solo la empresa propietaria puede desactivar este registro.");
  if (Number(v.activo) !== 1 || v.estado !== "Activo" || Number(v.en_taller ?? 0) !== 0) motivos.push("El registro debe estar activo y fuera de taller.");
  if (refs.length) motivos.push("Existen referencias históricas u operativas. Se conservan y requieren revisión fuera de esta herramienta.");
  return { vehiculo: presentar(v, empresa), referencias: refs, puedeDesactivar: !motivos.length, motivos };
}
export async function revisarPlacaDuplicada(empresa: number, id: number) {
  const c = await getPool().getConnection(); try { return await revision(c, empresa, id); } finally { c.release(); }
}
export async function desactivarDuplicado(ctx: { empresaId: number; usuario: string; autorizar: () => Promise<void> }, op: { id: number; conservarId: number; revision: string; motivo: string }) {
  const c = await getPool().getConnection();
  let estado: "INICIO" | "ABIERTA" | "COMMIT" | "CONFIRMADA" = "INICIO", limpia = false;
  try {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); await c.beginTransaction(); estado = "ABIERTA";
    // Orden estable; ninguna elección se hace por placa sin revisar los IDs.
    const bloqueados = await rows(c, "SELECT * FROM flota_vehiculos WHERE id IN (?,?) ORDER BY id FOR UPDATE", [Math.min(op.id, op.conservarId), Math.max(op.id, op.conservarId)]);
    await ctx.autorizar();
    const v = bloqueados.find(v => Number(v.id) === op.id), conservar = bloqueados.find(v => Number(v.id) === op.conservarId);
    if (op.id === op.conservarId || !v || !conservar || Number(v.empresa_id) !== ctx.empresaId || Number(conservar.empresa_id) !== ctx.empresaId) throw new ErrorCB2("Revisa dos IDs propios distintos de esta empresa.", 403);
    if (firma(v) !== op.revision) throw new ErrorCB2("El registro cambió. Vuelve a revisar sus referencias.");
    if (!placaComparable(String(v.placa)) || placaComparable(String(v.placa)) !== placaComparable(String(conservar.placa)) || Number(conservar.activo) !== 1 || conservar.estado !== "Activo") throw new ErrorCB2("El ID conservado debe estar activo y tener la misma placa normalizada.");
    const chasis = (valor: unknown) => String(valor ?? "").normalize("NFC").trim().toUpperCase().replace(/\s+/g, "");
    if (v.tipo_unidad !== conservar.tipo_unidad || (chasis(v.chasis) && chasis(conservar.chasis) && chasis(v.chasis) !== chasis(conservar.chasis))) throw new ErrorCB2("Tipo o chasis contradictorios: la placa no demuestra redundancia. Requiere revisión independiente.");
    const r = await revision(c, ctx.empresaId, op.id, true);
    if (!r.puedeDesactivar) throw new ErrorCB2(r.motivos.join(" "));
    await c.execute("UPDATE flota_vehiculos SET activo=0,estado='Inactivo' WHERE empresa_id=? AND id=? AND activo=1", [ctx.empresaId, op.id]);
    await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.usuario, modulo: "flota", accion: "desactivar_duplicado_revisado", detalle: JSON.stringify({ id: op.id, conservarId: op.conservarId, motivo: op.motivo, revision: op.revision, referencias: 0 }) });
    estado = "COMMIT"; await c.commit(); estado = "CONFIRMADA"; limpia = true;
    return { id: op.id, activo: false, conservado: op.conservarId };
  } catch (error) {
    if (estado === "ABIERTA" || estado === "COMMIT") { try { await c.rollback(); limpia = estado === "ABIERTA"; } catch { limpia = false; } }
    if (estado === "COMMIT") throw new ErrorCB2("Resultado incierto. Recarga la revisión del ID antes de volver a actuar.", 503, true);
    throw error;
  } finally {
    if (limpia) { try { c.release(); } catch { try { c.destroy(); } catch {} } }
    else { try { c.destroy(); } catch {} }
  }
}
