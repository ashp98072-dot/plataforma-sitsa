import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";

const q = vi.fn(), release = vi.fn();
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => ({ query: q, release }) }), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
const { revisarNombresTx, registrarPilotoReportadoTx } = await import("./pilotos-reportados");
const { nombresImportacion } = await import("./service");
const { proponerNombre } = await import("./pilotos-nombres");
const { acumularFecha, esColumnaInexistente, ventanaLaboral } = await import("./empleados-baja");
const { decisionesMasivas } = await import("@/components/flota/cb2/nombres-masivos");

const andres = { id: 50, nombre: "Andres Norberto Taracena Mayen", estado: "Baja", fecha_egreso: "2026-06-30", fecha_alta: "2024-01-10" };
const NOMBRE = "Andres Norberto Taracena Mayen";
const conn = () => ({ query: q }) as unknown as PoolConnection;
function sqlMock(opts: { alias?: Record<string, unknown> | null; origen?: unknown[]; errorFechas?: unknown } = {}) {
  q.mockReset(); release.mockReset();
  q.mockImplementation(async (sql: string) => {
    if (sql.includes("fecha_egreso") && opts.errorFechas) throw opts.errorFechas;
    if (sql.includes("information_schema")) return [[], []];
    if (sql.includes("FROM empleados")) return [[sql.includes("fecha_egreso") ? andres : { id: 50, nombre: andres.nombre, estado: "Baja" }], []];
    if (sql.includes("flota_cb2_pilotos_equivalencias")) return [opts.alias ? [opts.alias] : [], []];
    if (sql.includes("FROM flota_cb2_importaciones")) return [[{ id: 1 }], []];
    if (sql.includes("flota_cb2_filas")) return [(opts.origen ?? []).map(d => ({ datos_origen: JSON.stringify(d) })), []];
    return [[], []];
  });
}
beforeEach(() => sqlMock());

describe("rango de fechas: una fila sin fecha invalida la acción masiva de bajas", () => {
  it("acumularFecha conserva que falta alguna fecha aunque existan mínima y máxima (tres consumos, uno sin fecha, en cualquier orden)", () => {
    for (const orden of [[0, 1, 2], [1, 0, 2], [2, 1, 0]]) {
      const fechas = ["2026-05-01", null, "2026-05-03"]; let r;
      for (const i of orden) r = acumularFecha(r, fechas[i]);
      expect(r).toEqual({ min: "2026-05-01", max: "2026-05-03", sinFecha: true });
      expect(ventanaLaboral({ id: 1, nombre: "x", estado: "Baja", fechaBaja: "2026-06-30" }, r)).toBe("SIN_FECHA_CONSUMO");
    }
    expect(acumularFecha(undefined, "fecha inválida").sinFecha).toBe(true);
  });
  it("PREVIEW: revisarNombresTx conserva sinFecha como ADVERTENCIA, pero reconoce y propone al empleado de baja", async () => {
    const [g] = await revisarNombresTx(conn(), 7, [NOMBRE, NOMBRE, NOMBRE], true, ["2026-05-01", null, "2026-05-03"]);
    expect(g.filas).toBe(3); expect(g.rango).toMatchObject({ min: "2026-05-01", max: "2026-05-03", sinFecha: true });
    expect(g.propuesta).toEqual({ tipo: "EMPLEADO", empleadoId: 50, confirmado: false });
    expect(ventanaLaboral({ id: 50, nombre: NOMBRE, estado: "Baja", fechaBaja: "2026-06-30" }, g.rango)).toBe("SIN_FECHA_CONSUMO");
  });
  it("PREVIEW: consumos posteriores a la baja → advertencia, no bloqueo", async () => {
    const [g] = await revisarNombresTx(conn(), 7, ["Andres Taracena", "Andres Taracena"], true, ["2026-05-01", "2026-07-15"]);
    expect(g.propuesta).toEqual({ tipo: "EMPLEADO", empleadoId: 50, confirmado: false });
    expect(ventanaLaboral({ id: 50, nombre: NOMBRE, estado: "Baja", fechaBaja: "2026-06-30" }, g.rango)).toBe("POSTERIOR_A_BAJA");
    expect(decisionesMasivas([g], {}).reportado).toHaveLength(0);   // jamás termina como piloto reportado
  });
  it("REANUDACIÓN: nombresImportacion aplica la misma política (propuesta única) y conserva el rango con filas sin fecha", async () => {
    const t = (fechaConsumo?: unknown) => ({ textos: { piloto: "Andres Taracena" }, ...(fechaConsumo === undefined ? {} : { fechaConsumo }) });
    sqlMock({ origen: [t("2026-05-01"), t(), t("2026-07-03")] });
    const [g] = await nombresImportacion(7, 1);
    expect(g.rango).toMatchObject({ min: "2026-05-01", max: "2026-07-03", sinFecha: true });
    expect(g.propuesta).toEqual({ tipo: "EMPLEADO", empleadoId: 50, confirmado: false });
  });
});

describe("equivalencias históricas hacia empleados de baja", () => {
  const alias = { nombre_normalizado: NOMBRE.toUpperCase(), empleado_id: 50, piloto_reportado_id: null, requiere_revision: 0 };
  it("el alias hacia un empleado de baja se propone igual que hacia uno activo (preview y reanudación)", async () => {
    sqlMock({ alias });
    const [g] = await revisarNombresTx(conn(), 7, [NOMBRE], true, ["2026-05-01"]);
    expect(g.equivalencia).toEqual({ tipo: "EMPLEADO", empleadoId: 50, confirmado: false }); expect(g.propuesta).toEqual({ tipo: "EMPLEADO", empleadoId: 50, confirmado: false });
    sqlMock({ alias, origen: [{ textos: { piloto: NOMBRE }, fechaConsumo: "2026-05-01" }] });
    expect((await nombresImportacion(7, 1))[0].propuesta).toEqual({ tipo: "EMPLEADO", empleadoId: 50, confirmado: false });
  });
  it("un alias antiguo a «piloto reportado» no oculta a un empleado identificable: se propone el empleado", async () => {
    sqlMock({ alias: { nombre_normalizado: "ANDRES TARACENA", empleado_id: null, piloto_reportado_id: 9, requiere_revision: 0 } });
    const [g] = await revisarNombresTx(conn(), 7, ["Andres Taracena"], true, ["2026-05-01"]);
    expect(g.equivalencia).toMatchObject({ tipo: "REPORTADO" }); expect(g.propuesta).toEqual({ tipo: "EMPLEADO", empleadoId: 50, confirmado: false });
  });
  it("alias hacia #50 con un nombre de UNA palabra («Taracena»): sin autopropuesta (preview, reanudación) y el servidor rechaza la decisión sin confirmar; confirmada se acepta", async () => {
    sqlMock({ alias });
    const [g] = await revisarNombresTx(conn(), 7, ["Taracena"], true, ["2026-05-01"]);
    expect(g.propuesta).toBeNull(); expect(g.equivalencia).toEqual({ tipo: "EMPLEADO", empleadoId: 50, confirmado: false });
    sqlMock({ alias, origen: [{ textos: { piloto: "Taracena" }, fechaConsumo: "2026-05-01" }] });
    expect((await nombresImportacion(7, 1))[0].propuesta).toBeNull();
    sqlMock({ alias });
    const ctx = { empresaId: 7, proveedorId: 3, actor: { id: 9, username: "demo" }, autorizar: async () => {} };
    const c = { query: q, execute: vi.fn() } as unknown as PoolConnection;
    await expect(registrarPilotoReportadoTx(c, ctx, 1, "Taracena", { tipo: "EMPLEADO", empleadoId: 50, confirmado: false })).rejects.toThrow("requiere confirmación");
  });
  it("el alias hacia un empleado ACTIVO conserva su comportamiento (propuesta sin confirmar)", () => {
    const activo = { id: 33, nombre: "Edgar Palala", estado: "Activo" };
    expect(proponerNombre("Edgar Palala", [activo], { tipo: "EMPLEADO", empleadoId: 33, confirmado: false }).propuesta).toEqual({ tipo: "EMPLEADO", empleadoId: 33, confirmado: false });
  });
  it("el servidor acepta la decisión sin confirmar hacia el empleado de baja SOLO si coincide con la propuesta vigente; otra distinta se rechaza", async () => {
    sqlMock({});
    const ctx = { empresaId: 7, proveedorId: 3, actor: { id: 9, username: "demo" }, autorizar: async () => {} };
    const c = { query: q, execute: vi.fn() } as unknown as PoolConnection;
    await expect(registrarPilotoReportadoTx(c, ctx, 1, "Andres Taracena", { tipo: "EMPLEADO", empleadoId: 50, confirmado: false })).resolves.toBeNull();
    await expect(registrarPilotoReportadoTx(c, ctx, 1, "Andres Taracena", { tipo: "EMPLEADO", empleadoId: 51, confirmado: false })).rejects.toThrow("requiere confirmación");
  });
});

describe("reintento SQL solo por columna inexistente", () => {
  it("ER_BAD_FIELD_ERROR/1054 reintenta sin fechas; conexión o permisos se propagan", async () => {
    expect(esColumnaInexistente({ code: "ER_BAD_FIELD_ERROR" })).toBe(true); expect(esColumnaInexistente({ errno: 1054 })).toBe(true);
    for (const e of [{ code: "ECONNREFUSED" }, { code: "ER_TABLEACCESS_DENIED_ERROR", errno: 1142 }, { code: "ER_ACCESS_DENIED_ERROR", errno: 1045 }, new Error("x"), null]) expect(esColumnaInexistente(e)).toBe(false);
    sqlMock({ errorFechas: { code: "ER_BAD_FIELD_ERROR", errno: 1054 } });
    const [g] = await revisarNombresTx(conn(), 7, [NOMBRE], true, ["2026-05-01"]);
    expect(g.candidatos[0].fechaBaja).toBeNull(); expect(q.mock.calls.filter(([s]) => String(s).includes("FROM empleados"))).toHaveLength(2);
    for (const err of [{ code: "ECONNREFUSED", errno: -111 }, { code: "ER_TABLEACCESS_DENIED_ERROR", errno: 1142 }]) {
      sqlMock({ errorFechas: err });
      await expect(revisarNombresTx(conn(), 7, [NOMBRE], true, ["2026-05-01"])).rejects.toBe(err);
      expect(q.mock.calls.filter(([s]) => String(s).includes("FROM empleados"))).toHaveLength(1);
    }
  });
});
