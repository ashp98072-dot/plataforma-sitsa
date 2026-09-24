import type { RowDataPacket } from "mysql2";
import type { ResultSetHeader } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { guardarAuxiliaresPlan } from "@/lib/tms/plan-comunes";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import type { FilaResultadoEdicionRapida, ValidarEdicionRapida } from "./edicion-rapida-schema";
import { evaluarEdicionRapida, type ContextoEdicionRapida, type FilaTrabajo } from "./edicion-rapida-validar";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-2: GUARDADO ATÓMICO del estado final de un lote de cambios de piloto, auxiliares,
 * unidad y TC. TODO el lote se guarda o NADA se guarda.
 *
 * Orden: GET_LOCK('tms_traslape_<empresa>') -> BEGIN -> relectura de los planes FOR UPDATE + TODA la validación del
 * estado final (mismo núcleo que PR-1 /validar, ahora por la conexión con candado) -> si algo falla, ROLLBACK -> UPDATE
 * de todos los planes -> auxiliares -> viáticos -> auditoría por plan -> COMMIT -> RELEASE_LOCK (siempre, en finally).
 * Nunca se hace UPDATE fila por fila validando contra estados intermedios: primero se valida el estado FINAL completo.
 */
const LOCK_TIMEOUT_SEGUNDOS = 8; // igual que planes/route.ts, programacion-import.ts y programacion-lote.ts

export type FilaGuardada = { planId: number; estado: "guardado" | "sin_cambios" };
export type ResultadoGuardarEdicionRapida =
  | { ok: true; guardados: number; filas: FilaGuardada[] }
  | { ok: false; status: 409; error: string; filas?: FilaResultadoEdicionRapida[] }
  | { ok: false; status: 500; error: string };

export const MSG_LOCK_EDICION_RAPIDA = "No se pudo validar la disponibilidad de recursos porque hay otra operación en curso. Intenta de nuevo.";
export const MSG_CAMBIOS_INVALIDOS = "Los cambios ya no son válidos.";

class GuardadoAbortado extends Error {}

/** Q1,000.00 (formato fijo, independiente del locale del servidor). */
const dinero = (n: number | null) => (n == null ? "Q—" : `Q${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
const lista = (nombres: string[]) => `[${nombres.length ? nombres.join(", ") : "—"}]`;

/** Detalle de auditoría (empieza con "Plan #<id> <código> ·": así lo encuentra la bitácora del plan). */
function detalleAuditoria(f: FilaTrabajo, ctx: ContextoEdicionRapida, motivo: string | undefined, tcPlacas: Map<number, string>): string {
  const plan = f.plan!;
  const nombre = (id: number | null) => (id == null ? "—" : ctx.personal.get(id)?.nombre ?? `#${id}`);
  const cambios: string[] = [];
  if (f.cambiaPiloto) cambios.push(`piloto ${nombre(f.actual!.pilotoId)} → ${nombre(f.final!.pilotoId)}`);
  if (f.cambiaAuxiliares) cambios.push(`auxiliares ${lista(f.actual!.auxiliaresIds.map(nombre))} → ${lista(f.final!.auxiliaresIds.map(nombre))}`);
  if (f.cambiaUnidad) {
    const nueva = f.final!.flotaVehiculoId != null ? ctx.placaPorFlota.get(f.final!.flotaVehiculoId) ?? `#${f.final!.flotaVehiculoId}` : "—";
    cambios.push(`unidad ${plan.unidadPlaca ?? "—"} → ${nueva}`);
  }
  if (f.cambiaTc) {
    const placa = (id: number | null) => (id == null ? "—" : ctx.tcPlaca.get(id) ?? tcPlacas.get(id) ?? `#${id}`);
    cambios.push(`TC ${placa(f.actual!.tcVehiculoId)} → ${placa(f.final!.tcVehiculoId)}`);
  }
  if (f.cambiaTarifa) {
    const d = f.tarifaDestino!;
    const antes = plan.tarifaId != null ? `Catálogo ${plan.tarifaNombre ?? `#${plan.tarifaId}`} ${dinero(plan.tarifaComercial)}` : plan.tarifaComercial != null ? `manual ${dinero(plan.tarifaComercial)}` : "sin tarifa";
    const despues = d.tipo === "catalogo" ? `Catálogo ${d.snap.nombre} ${dinero(d.snap.monto)}` : d.tipo === "manual" ? `manual ${dinero(d.monto)}` : "sin tarifa";
    cambios.push(`tarifa ${antes} → ${despues}`);
  }
  if (f.cambiaViaticos) {
    const actual = new Map(plan.viaticos.map((v) => [v.personalId, v.montoAsignado]));
    cambios.push(`viáticos ${f.viaticosOverrides.map((v) => `${nombre(v.personalId)} ${actual.has(v.personalId) ? actual.get(v.personalId) : "—"} → ${v.montoAsignado}`).join(", ")}`);
  }
  return `Plan #${plan.id} ${plan.codigo} · edición rápida · ${cambios.join("; ")}${motivo ? ` · motivo: ${motivo}` : ""}`;
}

export async function guardarEdicionRapida(empresaId: number, usuario: string, datos: ValidarEdicionRapida): Promise<ResultadoGuardarEdicionRapida> {
  const motivo = datos.motivoCambio?.trim() || undefined;
  const lockKey = `tms_traslape_${empresaId}`;
  const conn = await getPool().getConnection();
  let lockAdquirido = false;
  try {
    // 1) candado por empresa (el mismo de POST/PATCH/importación/lote): en una conexión dedicada
    let lockRows: RowDataPacket[] = [];
    try {
      [lockRows] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS l", [lockKey, LOCK_TIMEOUT_SEGUNDOS]);
    } catch {
      lockRows = [];
    }
    lockAdquirido = Number(lockRows[0]?.l) === 1;
    if (!lockAdquirido) return { ok: false, status: 409, error: MSG_LOCK_EDICION_RAPIDA };

    // 2) transacción; 3) relectura FOR UPDATE + validación DEFINITIVA del estado final por esta conexión
    await conn.beginTransaction();
    const { resultado, filas, contexto } = await evaluarEdicionRapida(empresaId, datos, { conn });
    if (!resultado.ok) {
      await conn.rollback();
      return { ok: false, status: 409, error: MSG_CAMBIOS_INVALIDOS, filas: resultado.filas };
    }
    const aGuardar = filas.filter((f) => f.hayCambios && !f.errores.length);
    if (!aGuardar.length) {
      await conn.rollback(); // nada que escribir: ni UPDATE, ni viáticos, ni personal, ni auditoría
      return { ok: true, guardados: 0, filas: filas.map((f) => ({ planId: f.planId, estado: "sin_cambios" as const })) };
    }

    // 4) recursos a materializar (solo AHORA que todo el lote es válido): unidad de Flota -> tms_unidades (misma resolución que el PATCH)
    const unidadTmsPorFlota = new Map<number, number>();
    for (const f of aGuardar.filter((x) => x.cambiaUnidad && x.final!.flotaVehiculoId != null)) {
      const fid = f.final!.flotaVehiculoId!;
      if (unidadTmsPorFlota.has(fid)) continue;
      const placa = contexto.placaPorFlota.get(fid);
      if (!placa) throw new GuardadoAbortado("No se pudo resolver la unidad seleccionada.");
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO tms_unidades (empresa_id, placa, tipo, flota_vehiculo_id)
         VALUES (?, ?, 'Camion', ?)
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           flota_vehiculo_id = COALESCE(flota_vehiculo_id, VALUES(flota_vehiculo_id))`,
        [empresaId, placa, fid],
      );
      unidadTmsPorFlota.set(fid, Number(r.insertId));
    }

    // 5) UPDATE de TODOS los planes (estado final ya validado; el estado se re-exige en el WHERE)
    for (const f of aGuardar) {
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      if (f.cambiaPiloto) { sets.push("piloto_id = ?"); params.push(f.final!.pilotoId); }
      // auxiliar_id = primer auxiliar (o NULL si no queda ninguno): siempre coherente con tms_plan_auxiliares
      if (f.cambiaAuxiliares) { sets.push("auxiliar_id = ?"); params.push(f.final!.auxiliaresIds[0] ?? null); }
      if (f.cambiaUnidad) { sets.push("unidad_id = ?"); params.push(f.final!.flotaVehiculoId != null ? unidadTmsPorFlota.get(f.final!.flotaVehiculoId)! : null); }
      if (f.cambiaTc) {
        sets.push("tc_vehiculo_id = ?", "tc_placa_historica = ?");
        params.push(f.final!.tcVehiculoId, f.final!.tcVehiculoId != null ? contexto.tcPlaca.get(f.final!.tcVehiculoId) ?? null : null);
      }
      if (f.cambiaTarifa) {
        // Tres estados finales. Catálogo: snapshot + tarifa_comercial = monto de catálogo. Manual: snapshot NULL y
        // tarifa_comercial = monto escrito (no se crea nada en tms_ruta_tarifas). Sin tarifa: todo NULL (nunca 0).
        const d = f.tarifaDestino!;
        if (d.tipo === "catalogo") {
          sets.push("tarifa_id = ?", "tarifa_nombre_historico = ?", "tarifa_monto_historico = ?", "tarifa_moneda_historico = ?", "tarifa_comercial = ?");
          params.push(d.snap.id, d.snap.nombre, d.snap.monto, d.snap.moneda, d.snap.monto);
        } else {
          sets.push("tarifa_id = NULL", "tarifa_nombre_historico = NULL", "tarifa_monto_historico = NULL", "tarifa_moneda_historico = NULL");
          if (d.tipo === "manual") { sets.push("tarifa_comercial = ?"); params.push(d.monto); }
          else sets.push("tarifa_comercial = NULL");
        }
      }
      // Solo viáticos cambiaron: el viaje no se reescribe (el UPDATE quedaría sin columnas); los viáticos van en el paso 7.
      if (!sets.length) continue;
      const [u] = await conn.execute<ResultSetHeader>(
        `UPDATE tms_planes_viaje SET ${sets.join(", ")} WHERE id = ? AND empresa_id = ? AND estado = ?`,
        [...params, f.planId, empresaId, f.plan!.estado],
      );
      if (u.affectedRows === 0) throw new GuardadoAbortado(`El viaje ${f.plan!.codigo} cambió mientras se guardaba.`);
    }

    // 6) auxiliares (el orden define al principal) y 7) viáticos con las MISMAS reglas del PATCH (solo filas PROGRAMADO)
    for (const f of aGuardar.filter((x) => x.cambiaAuxiliares)) await guardarAuxiliaresPlan(f.planId, f.final!.auxiliaresIds, conn);
    for (const f of aGuardar.filter((x) => x.cambiaPiloto || x.cambiaAuxiliares || x.cambiaViaticos)) {
      // PR-355: los montos editados viajan como override (solo cambios reales; ya validados contra el estado final y su estado PROGRAMADO)
      await sincronizarViaticosPlan(empresaId, f.planId, { piloto: f.final!.pilotoId, auxiliares: f.final!.auxiliaresIds }, conn, f.viaticosOverrides);
    }

    // 8) auditoría POR CADA plan realmente modificado, dentro de la transacción (los sin_cambios no se auditan)
    const tcPlacas = await placasTc(conn, aGuardar, contexto);
    for (const f of aGuardar) {
      await registrarAuditoriaTx(conn, { empresaId, usuario, accion: "editar_ruta", modulo: "tms", detalle: detalleAuditoria(f, contexto, motivo, tcPlacas) });
    }

    await conn.commit();
    return { ok: true, guardados: aGuardar.length, filas: filas.map((f) => ({ planId: f.planId, estado: aGuardar.includes(f) ? "guardado" as const : "sin_cambios" as const })) };
  } catch (e) {
    try { await conn.rollback(); } catch { /* la conexión puede haberse perdido: el candado se libera abajo */ }
    if (e instanceof GuardadoAbortado) return { ok: false, status: 409, error: e.message };
    console.error("guardarEdicionRapida (rollback total)", e);
    return { ok: false, status: 500, error: "No se pudo guardar la edición rápida. No se modificó ningún viaje." };
  } finally {
    if (lockAdquirido) {
      try { await conn.query("SELECT RELEASE_LOCK(?) AS l", [lockKey]); } catch { /* ok */ }
    }
    conn.release();
  }
}

/** Placas de TC (anterior/nuevo) SOLO para el texto de la auditoría; un fallo aquí no debe impedir guardar. */
async function placasTc(conn: import("mysql2/promise").PoolConnection, filas: FilaTrabajo[], ctx: ContextoEdicionRapida): Promise<Map<number, string>> {
  const mapa = new Map<number, string>();
  const ids = [...new Set(filas.filter((f) => f.cambiaTc).flatMap((f) => [f.actual!.tcVehiculoId, f.final!.tcVehiculoId]).filter((x): x is number => x != null && !ctx.tcPlaca.has(x)))];
  if (!ids.length) return mapa;
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, placa FROM flota_vehiculos WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    for (const r of rows) mapa.set(Number(r.id), String(r.placa).toUpperCase());
  } catch { /* se audita con #id */ }
  return mapa;
}
