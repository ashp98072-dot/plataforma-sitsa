import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { ErrorCB2 } from "./model";
import { rows, type Actor } from "./repository";

export type ContextoTerceros = { empresaId: number; actor: Actor; autorizar: () => Promise<void> };
export const tercerosHabilitados = () => process.env.CB2_TERCEROS_D2_APROBADA === "1";
export function exigirTerceros() { if (!tercerosHabilitados()) throw new ErrorCB2("Tercerizados deshabilitados por configuración. La activación corresponde al propietario.", 403); }
let activas = 0;
const esperando: (() => void)[] = [];
/** Gestión empresarial sin contexto, consultas ni bloqueo de proveedor. */
export async function txTerceros<T>(ctx: ContextoTerceros, fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  exigirTerceros();
  if (activas >= 4) { if (esperando.length >= 32) throw new ErrorCB2("Gestión ocupada; vuelve a intentar con las mismas referencias.", 503); await new Promise<void>(resolve => esperando.push(resolve)); }
  else activas++;
  try { return await ejecutar(ctx, fn); }
  finally { const siguiente = esperando.shift(); if (siguiente) siguiente(); else activas--; }
}
async function ejecutar<T>(ctx: ContextoTerceros, fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  for (let intento = 0;; intento++) {
    const c = await getPool().getConnection();
    let original: RowDataPacket | undefined, commit = false, limpia = true;
    try {
      [original] = await rows(c, "SELECT @@SESSION.sql_mode AS mode,@@SESSION.innodb_strict_mode AS innodb,@@foreign_key_checks AS fk,@@check_constraint_checks AS ck");
      if (Number(original.fk) !== 1 || Number(original.ck) !== 1 || String(original.mode).split(",").includes("NO_BACKSLASH_ESCAPES")) throw new ErrorCB2("Entorno SQL incompatible.", 503);
      await c.query("SET SESSION sql_mode=?", [[...new Set([...String(original.mode).split(",").filter(Boolean), "STRICT_ALL_TABLES"])].join(",")]);
      await c.query("SET SESSION innodb_strict_mode=ON");
      await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"); await c.beginTransaction();
      const [empresa] = await rows(c, "SELECT id,activa FROM empresas WHERE id=? FOR UPDATE", [ctx.empresaId]);
      exigirTerceros(); await ctx.autorizar();
      const [actor] = await rows(c, "SELECT id,activo,rol_global FROM usuarios WHERE id=? LOCK IN SHARE MODE", [ctx.actor.id]);
      if (!empresa || Number(empresa.activa) !== 1 || !actor || Number(actor.activo) !== 1 || actor.rol_global !== "Admin") throw new ErrorCB2("La gestión requiere administrador activo y empresa vigente.", 403);
      const result = await fn(c); commit = true; await c.commit(); return result;
    } catch (e) {
      try { await c.rollback(); } catch { limpia = false; }
      if (!commit && limpia && intento < 2 && ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes((e as { code?: string }).code ?? "")) continue;
      if (commit || !limpia) { limpia = false; throw new ErrorCB2("Resultado incierto. Actualiza el catálogo y revisa las mismas referencias e IDs antes de repetir.", 503, true); }
      if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new ErrorCB2("Conflicto de unicidad. Actualiza y revisa las referencias existentes.");
      throw e;
    } finally {
      if (limpia && original) { try { await c.query("SET SESSION sql_mode=?", [original.mode]); await c.query("SET SESSION innodb_strict_mode=?", [original.innodb]); } catch { limpia = false; } }
      if (limpia) { try { c.release(); } catch { try { c.destroy(); } catch { /* no sustituir el resultado */ } } }
      else { try { c.destroy(); } catch { /* no sustituir el resultado */ } }
    }
  }
}
