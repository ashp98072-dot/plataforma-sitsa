import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import type { FilaImportada } from "./combustible-importacion-parser";
import { contextosFondosCombustible, type LineaFondoCombustible } from "./combustible-fondos";
import {
  clasificarFila, compararFilaConVale, hayDiferencias, normalizarVale,
  type DatosProveedor, type DatosVale, type Diferencia, type EstadoC2c,
} from "./combustible-c2c-shared";

/**
 * C-2C — conciliación controlada reporte de proveedor (C-2B) ↔ vale interno.
 *
 * Es un VÍNCULO + auditoría: NUNCA modifica el vale (monto, galones, fecha, placa, proveedor, estado, línea de fondo).
 * Cadena: reporte proveedor → vale interno → línea de fondo (informativa); nunca reporte → fondo.
 * Orden de bloqueos (el mismo que captura y estaciones): proveedor → fila(s) → vale.
 */

export type ActorC2c = { id: number; username: string };
const CANONICA = "f.estado_parseo IN ('VALIDA','ADVERTENCIA') AND f.duplicado_de_linea_id IS NULL";
const NORMALIZADO_SQL = "UPPER(REGEXP_REPLACE(TRIM(c.numero_vale), '[[:space:]]+', ' '))";
const conflicto = (msg = "Actualiza y vuelve a intentar.") => new ErrorDominioFormulario(msg, 409);

type FilaBd = RowDataPacket & {
  id: number; hoja_origen: string; fila_excel: number; estado_parseo: string; duplicado_tipo: string | null; duplicado_previo: number | null;
  datos_importacion: string; estado_c2c: EstadoC2c | null; modo_c2c: "AUTO" | "MANUAL" | null; carga_vinculada_id: number | null;
  carga_sugerida_id: number | null; diferencias_c2c: string | null; confirmado_en: string | null;
};
type ValeBd = RowDataPacket & {
  id: number; numero_vale: string; placa: string | null; fecha_consumo: string | null; galones: string; monto: string; precio_por_galon: string | null;
  estado: string; proveedor_id: number; estacion: string | null; gasolinera: string | null; linea_fondo_id: number | null; vinculada_fila_id: number | null;
};

/** El driver devuelve las columnas JSON como texto o ya parseadas según el servidor; se acepta ambas. */
const leerJson = <T,>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
const datosDe = (f: FilaBd): FilaImportada => leerJson<FilaImportada>(f.datos_importacion);
const proveedorDe = (d: FilaImportada): DatosProveedor => ({ placaNormalizada: d.placaNormalizada, galones: d.galones, precio: d.precio, total: d.total, fechaReporte: d.fechaReporte });
const valeDatos = (v: ValeBd): DatosVale => ({ placa: v.placa, galones: v.galones == null ? null : String(v.galones), monto: v.monto == null ? null : String(v.monto), precio: v.precio_por_galon == null ? null : String(v.precio_por_galon), fechaConsumo: v.fecha_consumo });
const SELECT_VALE = `SELECT c.id, c.numero_vale, v.placa, DATE_FORMAT(c.fecha_consumo,'%Y-%m-%d') AS fecha_consumo, c.galones, c.monto, c.precio_por_galon, c.estado,
  c.proveedor_id, e.nombre AS estacion, c.gasolinera, c.solicitud_fondo_linea_id AS linea_fondo_id, l.id AS vinculada_fila_id
  FROM flota_combustible_cargas c
  LEFT JOIN flota_vehiculos v ON v.id = c.vehiculo_id
  LEFT JOIN flota_combustible_estaciones e ON e.id = c.estacion_id AND e.empresa_id = c.empresa_id
  LEFT JOIN flota_combustible_conciliacion_filas l ON l.empresa_id = c.empresa_id AND l.carga_vinculada_id = c.id`;
const trozos = <T,>(a: T[], n = 400) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

async function transaccion<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await getPool().getConnection();
  // READ COMMITTED: tras esperar el bloqueo del proveedor, cada lectura ve lo que otro usuario acaba de confirmar (sin snapshot viejo).
  try { await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"); await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; }
  catch (e) { try { await c.rollback(); } catch { /* conserva el error original */ } throw e; }
  finally { c.release(); }
}
const esDup = (e: unknown) => ["ER_DUP_ENTRY", "ER_CHECKREAD", "ER_LOCK_DEADLOCK"].includes((e as { code?: string })?.code ?? "");

async function cabecera(c: PoolConnection, empresaId: number, importacionId: number) {
  const [h] = await c.query<RowDataPacket[]>("SELECT id, proveedor_id FROM flota_combustible_conciliaciones WHERE empresa_id = ? AND id = ? AND perfil_parser = 'HALEL'", [empresaId, importacionId]);
  if (!h[0]) throw new ErrorDominioFormulario("Importación no encontrada.", 404);
  return { id: Number(h[0].id), proveedorId: Number(h[0].proveedor_id) };
}
const bloquearProveedor = async (c: PoolConnection, empresaId: number, proveedorId: number) => {
  const [p] = await c.query<RowDataPacket[]>("SELECT id FROM compras_proveedores WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresaId, proveedorId]);
  if (!p[0]) throw new ErrorDominioFormulario("Proveedor no disponible para esta empresa.");
};

/** Vales internos del proveedor cuyo número normalizado está en `claves` (pre-filtro SQL; la comparación final es en JS con NFC). */
async function valesPorClaves(c: Pick<PoolConnection, "query">, empresaId: number, proveedorId: number, claves: string[]) {
  const mapa = new Map<string, ValeBd[]>();
  for (const lote of trozos([...new Set(claves)])) {
    const [rows] = await c.query<ValeBd[]>(`${SELECT_VALE} WHERE c.empresa_id = ? AND c.proveedor_id = ? AND ${NORMALIZADO_SQL} IN (${lote.map(() => "?").join(",")})`, [empresaId, proveedorId, ...lote]);
    for (const v of rows) { const k = normalizarVale(v.numero_vale); if (lote.includes(k)) mapa.set(k, [...(mapa.get(k) ?? []), v]); }
  }
  return mapa;
}

export type ResumenRecalculo = Record<"exactas" | "conDiferencias" | "sinVale" | "ambiguas" | "sinCambios" | "manualesConservadas" | "noParticipan", number>;

/** Re-evalúa las filas CANÓNICAS no decididas a mano. Idempotente; nunca toca decisiones MANUAL ni los vales. */
export async function recalcularImportacion(empresaId: number, importacionId: number, actor: ActorC2c): Promise<ResumenRecalculo> {
  return transaccion(async c => {
    const h = await cabecera(c, empresaId, importacionId);
    await bloquearProveedor(c, empresaId, h.proveedorId);
    const [filas] = await c.query<FilaBd[]>(`SELECT f.id, f.estado_parseo, f.duplicado_de_linea_id, f.datos_importacion, f.estado_c2c, f.modo_c2c, f.carga_vinculada_id, f.carga_sugerida_id, f.diferencias_c2c
      FROM flota_combustible_conciliacion_filas f WHERE f.empresa_id = ? AND f.conciliacion_id = ? ORDER BY f.id FOR UPDATE`, [empresaId, importacionId]);
    const r: ResumenRecalculo = { exactas: 0, conDiferencias: 0, sinVale: 0, ambiguas: 0, sinCambios: 0, manualesConservadas: 0, noParticipan: 0 };
    const participan: { f: FilaBd; d: FilaImportada }[] = [];
    const sinParticipar: FilaBd[] = [];
    for (const f of filas) {
      if (f.modo_c2c === "MANUAL") { r.manualesConservadas++; continue; }
      const canonica = (f.estado_parseo === "VALIDA" || f.estado_parseo === "ADVERTENCIA") && f.duplicado_de_linea_id == null;
      if (canonica) participan.push({ f, d: datosDe(f) }); else sinParticipar.push(f);
    }
    // Filas que ya no participan (inválidas/ignoradas/duplicado exacto): se limpian si traían algo automático.
    const limpiar = sinParticipar.filter(f => f.estado_c2c != null || f.carga_vinculada_id != null || f.carga_sugerida_id != null);
    r.noParticipan = sinParticipar.length;
    // Competidoras: otras filas canónicas del MISMO proveedor (cualquier importación) con la misma clave de vale y sin vínculo propio.
    const claves = participan.map(p => normalizarVale(p.d.valeNormalizado || p.d.textos.vale)).filter(Boolean);
    const comp = new Map<string, number[]>();
    for (const lote of trozos([...new Set(claves)])) {
      const [rows] = await c.query<RowDataPacket[]>(`SELECT f.id, JSON_VALUE(f.datos_importacion, '$.valeNormalizado') AS vale FROM flota_combustible_conciliacion_filas f
        JOIN flota_combustible_conciliaciones h ON h.empresa_id = f.empresa_id AND h.id = f.conciliacion_id
        WHERE f.empresa_id = ? AND h.proveedor_id = ? AND h.perfil_parser = 'HALEL' AND ${CANONICA} AND f.carga_vinculada_id IS NULL
          AND JSON_VALUE(f.datos_importacion, '$.valeNormalizado') IN (${lote.map(() => "?").join(",")})`, [empresaId, h.proveedorId, ...lote]);
      for (const x of rows) { const k = normalizarVale(String(x.vale)); comp.set(k, [...(comp.get(k) ?? []), Number(x.id)]); }
    }
    const candidatos = await valesPorClaves(c, empresaId, h.proveedorId, claves);
    type Nuevo = { f: FilaBd; estado: EstadoC2c; vinculo: number | null; sugerida: number | null; dif: string | null };
    const nuevos: Nuevo[] = [];
    for (const { f, d } of participan) {
      const clave = normalizarVale(d.valeNormalizado || d.textos.vale);
      const todos = clave ? candidatos.get(clave) ?? [] : [];
      // Un vale ya vinculado a OTRA fila no está disponible (un vale ↔ máximo una fila).
      const libres = todos.filter(v => v.vinculada_fila_id == null || Number(v.vinculada_fila_id) === Number(f.id));
      const compet = (comp.get(clave) ?? []).filter(id => id !== Number(f.id)).length;
      let res = clasificarFila(proveedorDe(d), libres.map(valeDatos), compet);
      let unico: ValeBd | undefined = libres.length === 1 ? libres[0] : undefined;
      if (!clave) res = { estado: "SIN_VALE_INTERNO", candidatos: 0, diferencias: [], motivo: "SIN_NUMERO_VALE" };
      else if (todos.length > 0 && libres.length === 0) { res = { estado: "AMBIGUA", candidatos: todos.length, diferencias: [], motivo: "VALE_YA_VINCULADO" }; unico = undefined; }
      if (res.estado === "AMBIGUA") unico = undefined;
      const dif = res.diferencias.length || res.motivo ? JSON.stringify({ diferencias: res.diferencias, candidatos: res.candidatos, motivo: res.motivo ?? null }) : null;
      nuevos.push({ f, estado: res.estado, vinculo: res.estado === "COINCIDENCIA_EXACTA" && unico ? Number(unico.id) : null, sugerida: res.estado === "COINCIDENCIA_CON_DIFERENCIAS" && unico ? Number(unico.id) : null, dif });
    }
    const cambia = (n: Nuevo) => n.f.estado_c2c !== n.estado || n.f.modo_c2c !== "AUTO" || (n.f.carga_vinculada_id ?? null) !== n.vinculo || (n.f.carga_sugerida_id ?? null) !== n.sugerida
      || (n.f.diferencias_c2c == null ? null : JSON.stringify(leerJson(n.f.diferencias_c2c))) !== n.dif;
    const aCambiar = nuevos.filter(cambia);
    // Fase 1: liberar vínculos que cambian (evita choques del UNIQUE al reasignar un vale dentro del mismo recalculo).
    const liberar = [...aCambiar.filter(n => n.f.carga_vinculada_id != null && n.f.carga_vinculada_id !== n.vinculo).map(n => n.f.id), ...limpiar.filter(f => f.carga_vinculada_id != null).map(f => f.id)];
    for (const lote of trozos(liberar)) await c.query(`UPDATE flota_combustible_conciliacion_filas SET carga_vinculada_id = NULL, estado_c2c = 'PENDIENTE' WHERE empresa_id = ? AND id IN (${lote.map(() => "?").join(",")})`, [empresaId, ...lote]);
    const ahora = ahoraLocal();
    for (const n of aCambiar) {
      await c.execute(`UPDATE flota_combustible_conciliacion_filas SET estado_c2c = ?, modo_c2c = 'AUTO', carga_vinculada_id = ?, carga_sugerida_id = ?, diferencias_c2c = ?, calculado_en = ?, confirmado_por_usuario_id = NULL, confirmado_en = NULL
        WHERE empresa_id = ? AND id = ? AND (modo_c2c IS NULL OR modo_c2c = 'AUTO')`, [n.estado, n.vinculo, n.sugerida, n.dif, ahora, empresaId, n.f.id]);
    }
    for (const f of limpiar) await c.execute(`UPDATE flota_combustible_conciliacion_filas SET estado_c2c = NULL, modo_c2c = NULL, carga_vinculada_id = NULL, carga_sugerida_id = NULL, diferencias_c2c = NULL, calculado_en = ? WHERE empresa_id = ? AND id = ?`, [ahora, empresaId, f.id]);
    for (const n of nuevos) {
      if (n.estado === "COINCIDENCIA_EXACTA") r.exactas++; else if (n.estado === "COINCIDENCIA_CON_DIFERENCIAS") r.conDiferencias++;
      else if (n.estado === "SIN_VALE_INTERNO") r.sinVale++; else r.ambiguas++;
    }
    r.sinCambios = nuevos.length - aCambiar.length;
    if (aCambiar.length || limpiar.length) {
      await registrarAuditoriaTx(c, { empresaId, usuario: actor.username, modulo: "flota_combustible", accion: "recalcular_conciliacion_proveedor",
        detalle: `Importación #${importacionId} · proveedor #${h.proveedorId} · usuario #${actor.id} · exactas ${r.exactas} · con diferencias ${r.conDiferencias} · sin vale ${r.sinVale} · ambiguas ${r.ambiguas} · filas actualizadas ${aCambiar.length + limpiar.length}` });
    }
    return r;
  });
}

// ─────────────────────────────── acciones manuales ───────────────────────────────

export type AccionManual =
  | { accion: "confirmar"; cargaId: number }
  | { accion: "quitar" }
  | { accion: "descartar"; motivo: string }
  | { accion: "restablecer" };
/** Estado que el usuario vio: si cambió, 409 (otro usuario actuó en paralelo). */
export type EstadoEsperado = { estado: EstadoC2c | null; cargaVinculadaId: number | null };

async function filaConProveedor(c: PoolConnection, empresaId: number, filaId: number) {
  const [pre] = await c.query<RowDataPacket[]>(`SELECT f.conciliacion_id, h.proveedor_id FROM flota_combustible_conciliacion_filas f
    JOIN flota_combustible_conciliaciones h ON h.empresa_id = f.empresa_id AND h.id = f.conciliacion_id AND h.perfil_parser = 'HALEL' WHERE f.empresa_id = ? AND f.id = ?`, [empresaId, filaId]);
  if (!pre[0]) throw new ErrorDominioFormulario("Fila no encontrada.", 404);
  const proveedorId = Number(pre[0].proveedor_id);
  await bloquearProveedor(c, empresaId, proveedorId);
  const [rows] = await c.query<FilaBd[]>(`SELECT f.id, f.conciliacion_id, f.estado_parseo, f.duplicado_de_linea_id, f.datos_importacion, f.estado_c2c, f.modo_c2c, f.carga_vinculada_id, f.carga_sugerida_id, f.diferencias_c2c
    FROM flota_combustible_conciliacion_filas f WHERE f.empresa_id = ? AND f.id = ? FOR UPDATE`, [empresaId, filaId]);
  const f = rows[0];
  if (!f) throw new ErrorDominioFormulario("Fila no encontrada.", 404);
  if (!((f.estado_parseo === "VALIDA" || f.estado_parseo === "ADVERTENCIA") && f.duplicado_de_linea_id == null)) throw new ErrorDominioFormulario("Esta fila no participa en la conciliación (inválida, ignorada o duplicado exacto).", 409);
  return { fila: f, proveedorId };
}
const instantanea = (f: FilaBd) => ({ estado: f.estado_c2c, modo: f.modo_c2c, cargaVinculadaId: f.carga_vinculada_id == null ? null : Number(f.carga_vinculada_id), cargaSugeridaId: f.carga_sugerida_id == null ? null : Number(f.carga_sugerida_id) });

export async function accionManual(empresaId: number, filaId: number, actor: ActorC2c, accion: AccionManual, esperado?: EstadoEsperado) {
  if (accion.accion === "descartar" && accion.motivo.trim().length < 3) throw new ErrorDominioFormulario("Indica el motivo del descarte (mínimo 3 caracteres).");
  if (accion.accion === "confirmar" && !(Number.isSafeInteger(accion.cargaId) && accion.cargaId > 0)) throw new ErrorDominioFormulario("Vale interno inválido.");
  try {
    return await transaccion(async c => {
      const { fila, proveedorId } = await filaConProveedor(c, empresaId, filaId);
      if (esperado && (esperado.estado !== fila.estado_c2c || esperado.cargaVinculadaId !== (fila.carga_vinculada_id == null ? null : Number(fila.carga_vinculada_id)))) throw conflicto();
      const antes = instantanea(fila);
      const ahora = ahoraLocal();
      let estado: EstadoC2c, vinculo: number | null = null, dif: string | null = null, cargaAuditada: number | null = null;
      if (accion.accion === "confirmar") {
        const [bloqueo] = await c.query<RowDataPacket[]>("SELECT id FROM flota_combustible_cargas WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresaId, accion.cargaId]);
        const [rows] = bloqueo[0] ? await c.query<ValeBd[]>(`${SELECT_VALE} WHERE c.empresa_id = ? AND c.id = ?`, [empresaId, accion.cargaId]) : [[] as ValeBd[]];
        const vale = rows[0];
        if (!vale) throw new ErrorDominioFormulario("Vale interno no disponible para esta empresa.", 404);
        if (vale.proveedor_id == null || Number(vale.proveedor_id) !== proveedorId) throw new ErrorDominioFormulario("El vale pertenece a otro proveedor: no se puede conciliar con este reporte.", 409);
        if (vale.vinculada_fila_id != null && Number(vale.vinculada_fila_id) !== filaId) throw conflicto("Ese vale ya está conciliado con otra fila. Actualiza y vuelve a intentar.");
        const difs: Diferencia[] = compararFilaConVale(proveedorDe(datosDe(fila)), valeDatos(vale));
        estado = hayDiferencias(difs) ? "COINCIDENCIA_CON_DIFERENCIAS" : "COINCIDENCIA_EXACTA";
        vinculo = Number(vale.id); cargaAuditada = vinculo;
        dif = JSON.stringify({ diferencias: difs, candidatos: 1, motivo: null });
      } else if (accion.accion === "quitar") {
        if (fila.carga_vinculada_id == null && fila.carga_sugerida_id == null) throw conflicto("La fila no tiene un vale vinculado.");
        estado = "SIN_VALE_INTERNO";
      } else if (accion.accion === "descartar") {
        estado = "DESCARTADA_MANUAL"; dif = JSON.stringify({ diferencias: [], candidatos: 0, motivo: accion.motivo.trim() });
      } else {
        estado = "PENDIENTE";
      }
      const manual = accion.accion !== "restablecer";
      // Un vínculo previo se libera antes de asignar otro (cambiar vale) para no chocar con el UNIQUE.
      await c.execute("UPDATE flota_combustible_conciliacion_filas SET carga_vinculada_id = NULL, estado_c2c = 'PENDIENTE' WHERE empresa_id = ? AND id = ?", [empresaId, filaId]);
      await c.execute(`UPDATE flota_combustible_conciliacion_filas SET estado_c2c = ?, modo_c2c = ?, carga_vinculada_id = ?, carga_sugerida_id = NULL, diferencias_c2c = ?, calculado_en = ?,
        confirmado_por_usuario_id = ?, confirmado_en = ? WHERE empresa_id = ? AND id = ?`,
        [estado, manual ? "MANUAL" : null, vinculo, dif, ahora, manual ? actor.id : null, manual ? ahora : null, empresaId, filaId]);
      await registrarAuditoriaTx(c, { empresaId, usuario: actor.username, modulo: "flota_combustible", accion: `conciliacion_proveedor_${accion.accion}`,
        detalle: JSON.stringify({ importacionId: Number(fila.conciliacion_id), filaId, valeId: cargaAuditada, usuarioId: actor.id, antes, despues: { estado, modo: manual ? "MANUAL" : null, cargaVinculadaId: vinculo }, cuando: ahora, motivo: accion.accion === "descartar" ? accion.motivo.trim() : undefined }) });
      return { filaId, estado, cargaVinculadaId: vinculo };
    });
  } catch (e) {
    if (esDup(e)) throw conflicto("Ese vale ya está conciliado con otra fila. Actualiza y vuelve a intentar.");
    throw e;
  }
}

// ─────────────────────────────── lecturas ───────────────────────────────

export type FiltrosFilas = { estado?: EstadoC2c; q?: string; hoja?: string; page?: number; pageSize?: number };
export type ValeResumen = {
  id: number; numeroVale: string; placa: string | null; fechaConsumo: string | null; galones: string; monto: string; precio: string | null; estado: string;
  estacion: string | null; gasolinera: string | null; fondo: LineaFondoCombustible | null; vinculadoAFilaId: number | null;
};
const aVale = (v: ValeBd, fondos: Map<number, LineaFondoCombustible>): ValeResumen => ({
  id: Number(v.id), numeroVale: String(v.numero_vale), placa: v.placa, fechaConsumo: v.fecha_consumo, galones: String(v.galones), monto: String(v.monto), precio: v.precio_por_galon == null ? null : String(v.precio_por_galon),
  estado: String(v.estado), estacion: v.estacion, gasolinera: v.gasolinera, fondo: v.linea_fondo_id == null ? null : fondos.get(Number(v.linea_fondo_id)) ?? null, vinculadoAFilaId: v.vinculada_fila_id == null ? null : Number(v.vinculada_fila_id),
});

export async function listarConciliacion(empresaId: number, importacionId: number, f: FiltrosFilas = {}) {
  const [h] = await query<RowDataPacket[]>("SELECT id, proveedor_id, proveedor_nombre, nombre_original FROM flota_combustible_conciliaciones WHERE empresa_id = ? AND id = ? AND perfil_parser = 'HALEL'", [empresaId, importacionId]);
  if (!h) return null;
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200), page = Math.max(f.page ?? 1, 1);
  const base = `FROM flota_combustible_conciliacion_filas f WHERE f.empresa_id = ? AND f.conciliacion_id = ? AND ${CANONICA}`;
  const cuentas = await query<RowDataPacket[]>(`SELECT COALESCE(f.estado_c2c,'PENDIENTE') AS e, COUNT(*) AS n ${base} GROUP BY COALESCE(f.estado_c2c,'PENDIENTE')`, [empresaId, importacionId]);
  const resumen: Record<string, number> = Object.fromEntries(cuentas.map(r => [String(r.e), Number(r.n)]));
  const where: string[] = []; const params: (string | number)[] = [empresaId, importacionId];
  if (f.estado) { where.push("COALESCE(f.estado_c2c,'PENDIENTE') = ?"); params.push(f.estado); }
  if (f.hoja) { where.push("f.hoja_origen = ?"); params.push(f.hoja); }
  if (f.q?.trim()) { where.push("(JSON_VALUE(f.datos_importacion,'$.valeNormalizado') LIKE ? OR JSON_VALUE(f.datos_importacion,'$.placaNormalizada') LIKE ?)"); const t = `%${f.q.trim().toUpperCase().replace(/[\\%_]/g, m => `\\${m}`)}%`; params.push(t, t); }
  const filtro = where.length ? ` AND ${where.join(" AND ")}` : "";
  const [tot] = await query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${base}${filtro}`, params);
  const rows = await query<FilaBd[]>(`SELECT f.id, f.hoja_origen, f.fila_excel, f.estado_parseo, f.duplicado_tipo, f.duplicado_previo, f.datos_importacion, f.estado_c2c, f.modo_c2c, f.carga_vinculada_id, f.carga_sugerida_id, f.diferencias_c2c,
    DATE_FORMAT(f.confirmado_en,'%Y-%m-%d %H:%i:%s') AS confirmado_en ${base}${filtro} ORDER BY f.id LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  const ids = [...new Set(rows.flatMap(r => [r.carga_vinculada_id, r.carga_sugerida_id]).filter((x): x is number => x != null).map(Number))];
  const vales = new Map<number, ValeBd>();
  for (const lote of trozos(ids)) for (const v of await query<ValeBd[]>(`${SELECT_VALE} WHERE c.empresa_id = ? AND c.id IN (${lote.map(() => "?").join(",")})`, [empresaId, ...lote])) vales.set(Number(v.id), v);
  const fondos = await contextosFondosCombustible(empresaId, [...vales.values()].map(v => v.linea_fondo_id).filter((x): x is number => x != null).map(Number));
  return {
    importacion: { id: Number(h.id), proveedorId: Number(h.proveedor_id), proveedor: String(h.proveedor_nombre), archivo: String(h.nombre_original) },
    resumen, totalReal: Number(tot?.n ?? 0), page, pageSize,
    filas: rows.map(r => {
      const d = datosDe(r), id = r.carga_vinculada_id ?? r.carga_sugerida_id;
      const v = id == null ? null : vales.get(Number(id));
      const det = r.diferencias_c2c ? leerJson<{ diferencias: Diferencia[]; candidatos: number; motivo: string | null }>(r.diferencias_c2c) : null;
      return {
        id: Number(r.id), hoja: String(r.hoja_origen), filaExcel: Number(r.fila_excel), estadoParseo: String(r.estado_parseo), posibleDuplicado: r.duplicado_tipo === "POSIBLE", duplicadoPrevio: Boolean(r.duplicado_previo),
        estado: (r.estado_c2c ?? "PENDIENTE") as EstadoC2c, modo: r.modo_c2c, confirmado: r.confirmado_en != null, confirmadoEn: r.confirmado_en,
        proveedor: { vale: d.valeNormalizado || d.textos.vale, placa: d.placaNormalizada, fechaReporte: d.fechaReporte, galones: d.galones, precio: d.precio, total: d.total, piloto: d.textos.piloto, serie: d.textos.serie, factura: d.textos.factura },
        vale: v ? { ...aVale(v, fondos), sugerido: r.carga_vinculada_id == null } : null,
        diferencias: det?.diferencias ?? [], candidatos: det?.candidatos ?? 0, motivo: det?.motivo ?? null,
      };
    }),
  };
}

/** Vales internos del proveedor para elegir a mano (por defecto, los de la misma clave; con `q`, búsqueda por número o placa). */
export async function candidatosParaFila(empresaId: number, filaId: number, q = "") {
  const [f] = await query<FilaBd[]>(`SELECT f.id, f.datos_importacion, h.proveedor_id FROM flota_combustible_conciliacion_filas f
    JOIN flota_combustible_conciliaciones h ON h.empresa_id = f.empresa_id AND h.id = f.conciliacion_id AND h.perfil_parser = 'HALEL' WHERE f.empresa_id = ? AND f.id = ?`, [empresaId, filaId]);
  if (!f) return null;
  const d = datosDe(f), proveedorId = Number((f as unknown as RowDataPacket).proveedor_id);
  const termino = q.trim();
  let rows: ValeBd[];
  if (termino) {
    const t = `%${termino.toUpperCase().replace(/[\\%_]/g, m => `\\${m}`)}%`;
    rows = await query<ValeBd[]>(`${SELECT_VALE} WHERE c.empresa_id = ? AND c.proveedor_id = ? AND (UPPER(c.numero_vale) LIKE ? OR UPPER(v.placa) LIKE ?) ORDER BY c.fecha_consumo DESC, c.id DESC LIMIT 50`, [empresaId, proveedorId, t, t]);
  } else {
    rows = (await valesPorClaves({ query: (s: string, p?: unknown[]) => getPool().query(s, p) } as never, empresaId, proveedorId, [normalizarVale(d.valeNormalizado || d.textos.vale)])).get(normalizarVale(d.valeNormalizado || d.textos.vale)) ?? [];
  }
  const fondos = await contextosFondosCombustible(empresaId, rows.map(v => v.linea_fondo_id).filter((x): x is number => x != null).map(Number));
  return rows.map(v => ({ ...aVale(v, fondos), disponible: v.vinculada_fila_id == null || Number(v.vinculada_fila_id) === filaId, diferencias: compararFilaConVale(proveedorDe(d), valeDatos(v)) }));
}

export type FiltrosSinReporte = { proveedorId?: number; desde?: string; hasta?: string; estado?: "PENDIENTE" | "APROBADO" | "RECHAZADO"; placa?: string; page?: number; pageSize?: number };
/** VALE_INTERNO_SIN_REPORTE: vales sin fila canónica del proveedor (por clave) ni vínculo. El rango usa `fecha_consumo` (no la fecha de reporte). */
export async function valesSinReporte(empresaId: number, f: FiltrosSinReporte = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200), page = Math.max(f.page ?? 1, 1);
  const w = ["c.empresa_id = ?", "c.proveedor_id IS NOT NULL"]; const p: (string | number)[] = [empresaId];
  if (f.proveedorId) { w.push("c.proveedor_id = ?"); p.push(f.proveedorId); }
  if (f.desde) { w.push("c.fecha_consumo >= ?"); p.push(f.desde); }
  if (f.hasta) { w.push("c.fecha_consumo <= ?"); p.push(f.hasta); }
  if (f.estado) { w.push("c.estado = ?"); p.push(f.estado); }
  if (f.placa?.trim()) { w.push("UPPER(v.placa) LIKE ?"); p.push(`%${f.placa.trim().toUpperCase().replace(/[\\%_]/g, m => `\\${m}`)}%`); }
  const sinReporte = `NOT EXISTS (SELECT 1 FROM flota_combustible_conciliacion_filas l WHERE l.empresa_id = c.empresa_id AND l.carga_vinculada_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM flota_combustible_conciliacion_filas f JOIN flota_combustible_conciliaciones h ON h.empresa_id = f.empresa_id AND h.id = f.conciliacion_id
      WHERE f.empresa_id = c.empresa_id AND h.proveedor_id = c.proveedor_id AND h.perfil_parser = 'HALEL' AND ${CANONICA}
        AND JSON_VALUE(f.datos_importacion, '$.valeNormalizado') = ${NORMALIZADO_SQL})`;
  const desde = `FROM flota_combustible_cargas c LEFT JOIN flota_vehiculos v ON v.id = c.vehiculo_id WHERE ${w.join(" AND ")} AND ${sinReporte}`;
  const [tot] = await query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${desde}`, p);
  const rows = await query<ValeBd[]>(`SELECT c.id, c.numero_vale, v.placa, DATE_FORMAT(c.fecha_consumo,'%Y-%m-%d') AS fecha_consumo, c.galones, c.monto, c.precio_por_galon, c.estado, c.proveedor_id,
    (SELECT e.nombre FROM flota_combustible_estaciones e WHERE e.id = c.estacion_id AND e.empresa_id = c.empresa_id) AS estacion, c.gasolinera, c.solicitud_fondo_linea_id AS linea_fondo_id, NULL AS vinculada_fila_id
    ${desde} ORDER BY c.fecha_consumo DESC, c.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, (page - 1) * pageSize]);
  const fondos = await contextosFondosCombustible(empresaId, rows.map(v => v.linea_fondo_id).filter((x): x is number => x != null).map(Number));
  return { totalReal: Number(tot?.n ?? 0), page, pageSize, vales: rows.map(v => ({ ...aVale(v, fondos), proveedorId: Number(v.proveedor_id), estadoConciliacion: "VALE_INTERNO_SIN_REPORTE" as const })) };
}

export type { ResultSetHeader };
