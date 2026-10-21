import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { bd } = await import("./vacaciones-registro-bd.testutil");
  return { query: bd.consulta, getPool: () => ({ getConnection: async () => bd.conexion() }) };
});
import { bd, EMPRESA, escenario } from "./vacaciones-registro-bd.testutil";
import { registrarVacaciones, previsualizarRegistro } from "./vacaciones-registro";
import { eliminarRegistroVacaciones } from "./vacaciones-eliminar";
import { rebasearVacacionesEnConexion } from "./vacaciones-rebase-db";
import { resincronizarSaldosEmpresa } from "./vacaciones-modo-resync-db";
import { sincronizarPeriodosVacaciones } from "./vacaciones";
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const key = `${EMPRESA}:1`;
const registro = () => registrarVacaciones({ empresaId: EMPRESA, idEmpleado: 1, fechaInicio: "2026-10-05", fechaFin: "2026-10-05", diasATomar: 1 });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 12, 12)); bd.reiniciar(escenario()); });
afterEach(() => vi.useRealTimers());
describe("invalidación real con motor FIFO/histórico y transacción simulada", () => {
  it("registro FIFO y eliminación incrementan generación del mismo empleado", async () => {
    const r = await registro(); expect(r.ok).toBe(true); expect(bd.sync[key]).toEqual({ dirty: 1, generacion: 1 });
    if (!r.ok || !r.incidenciaId) throw new Error("registro falló");
    await eliminarRegistroVacaciones(EMPRESA, r.incidenciaId, "rrhh");
    expect(bd.sync[key]).toEqual({ dirty: 1, generacion: 2 });
  });
  it("si la escritura dirty falla, consumo e incidencia hacen rollback íntegro", async () => {
    await sincronizarPeriodosVacaciones(EMPRESA, 1);
    const antes = bd.instantanea(); bd.fallarSi = (sql) => sql.includes("INSERT INTO rrhh_vacaciones_sync_estado");
    const r = await registro(); expect(r.ok).toBe(false); expect(bd.instantanea()).toEqual(antes); expect(bd.sync).toEqual({});
  });
  it("cambiar fecha de alta mediante rebase invalida sin alterar hechos consumidos", async () => {
    await registro(); const consumo = bd.t.detalle.reduce((s, d) => s + d.dias_tomados, 0);
    const conn = bd.conexion(); await conn.beginTransaction();
    await rebasearVacacionesEnConexion(conn as never, EMPRESA, 1, "2019-10-13", { usuario: "rrhh" }); await conn.commit();
    expect(bd.sync[key].generacion).toBe(2); expect(bd.t.detalle.reduce((s, d) => s + d.dias_tomados, 0)).toBe(consumo);
  });
  it("histórico usa el mismo flujo y deja dirty sin inventar consumo", async () => {
    await sincronizarPeriodosVacaciones(EMPRESA, 1);
    const input = { empresaId: EMPRESA, idEmpleado: 1, fechaInicio: "2020-10-01", fechaFin: "2020-10-01", diasATomar: 1 };
    const preview = await previsualizarRegistro(EMPRESA, 1, input.fechaInicio, input.fechaFin, input.diasATomar);
    const r = await registrarVacaciones({ ...input, decision: { motivo: "Revisado por RRHH con constancia histórica", huella: preview.plan!.huella } });
    expect(r.ok).toBe(true); expect(bd.sync[key]?.dirty).toBe(1);
    expect(bd.t.detalle.reduce((s, d) => s + d.dias_tomados, 0)).toBe(1);
  });
  it("resincronización explícita ejecuta motor aun existiendo un estado limpio", async () => {
    await sincronizarPeriodosVacaciones(EMPRESA, 1); bd.sync[key] = { dirty: 0, generacion: 7 }; bd.ejecutadas = [];
    const r = await resincronizarSaldosEmpresa(EMPRESA);
    expect(r.sincronizados).toBe(1); expect(bd.ejecutadas.some((sql) => sql.startsWith("SELECT fecha_alta"))).toBe(true);
    expect(bd.ejecutadas.some((sql) => sql.includes("rrhh_vacaciones_sync_estado"))).toBe(false);
  });
});

describe("contratos de invalidación y esquema", () => {
  it("aprobación pasa por el único helper FIFO que invalida", () => {
    expect(src("src/lib/rrhh/solicitudes-vacaciones.ts")).toContain("await registrarVacacionesFifoEnConexion(conn");
    expect(src("src/lib/rrhh/vacaciones.ts")).toContain("await marcarVacacionesDirty(conn, input.empresaId, input.idEmpleado)");
  });
  it("limpieza RRHH/vacaciones/incidencias invalida dentro de la transacción antes del commit", () => {
    const s = src("src/lib/admin/limpiar-modulo.ts");
    const hook = s.indexOf('if (["rrhh", "rrhh_vacaciones", "rrhh_incidencias"].includes(opts.modulo))');
    expect(hook).toBeGreaterThan(0); expect(s.indexOf("await invalidarVacacionesEmpresaEnConexion(conn, opts.empresaId)", hook)).toBeLessThan(s.indexOf("await conn.commit()", hook));
  });
  it("preflight es SELECT/SHOW sin information_schema ni DATABASE()", () => {
    const s = src("sql/preflight-2026-10-rrhh-vacaciones-sync-estado.sql").replace(/--[^\n]*/g, "");
    expect(s.split(";").map((x) => x.trim()).filter(Boolean).every((x) => /^(SELECT|SHOW)\b/i.test(x))).toBe(true);
    expect(s).not.toMatch(/information_schema|DATABASE\s*\(/i);
    expect(s).toContain("u611730801_Plataforma");
  });
  it("migración aditiva coincide exactamente con schema y protege tenant por FK compuesta", () => {
    const ddl = src("sql/migrate-2026-10-rrhh-vacaciones-sync-estado.sql").slice(src("sql/migrate-2026-10-rrhh-vacaciones-sync-estado.sql").indexOf("CREATE TABLE IF NOT EXISTS"));
    expect(src("sql/schema.sql").replace(/\r/g, "")).toContain(ddl.trim());
    expect(ddl).toContain("PRIMARY KEY (empresa_id, id_empleado)");
    expect(ddl).toContain("FOREIGN KEY (empresa_id, id_empleado) REFERENCES empleados(empresa_id, id)");
    expect(ddl.split(";").map((x) => x.trim()).filter(Boolean).every((x) => x.startsWith("CREATE TABLE IF NOT EXISTS"))).toBe(true);
  });
});
