import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { actualizarCotizacion, crearCotizacion, duplicarCotizacion, obtenerCotizacion, listarCotizaciones } from "./cotizaciones";
import { calcularCosteoServicio, type InputCosteoServicio } from "./cotizacion-costeo";
import { ErrorCosteoYaRegistrado, type CosteoPreparado } from "./cotizacion-costeo-db";

function filaCotizacion(over: Record<string, unknown> = {}) {
  return {
    id: 1, empresa_id: 7, codigo: "COT-000001", cliente_id: 3, cliente_nombre: "Cliente Acme", ruta_id: null, ruta_codigo_historico: null,
    origen_texto: null, destino_texto: null, tarifa_referencia: null, tarifa_cotizada: "1400.00", incluye_iva: 0, moneda: "GTQ",
    fecha_emision: "2026-09-08", fecha_vencimiento: null, estado: "Borrador", piloto_incluido: 1, gps_incluido: 0, seguro_mercaderia_incluido: 0,
    seguro_terceros_incluido: 0, km_incluidos: null, tarifa_km_adicional: null, condiciones_adicionales: null, observaciones: null,
    creado_por: "admin", creado_en: "2026-09-08 10:00:00", actualizado_en: "2026-09-08 10:00:00", ...over,
  };
}

/** Conexión simulada; `existeCosteo` = ya hay snapshot; `falla` = SQL que debe fallar. */
function conexion(opts: { existeCosteo?: boolean; falla?: string } = {}) {
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM tms_clientes")) return [[{ nombre: "Cliente Acme" }]];
      if (sql.includes("FROM tms_cotizacion_costeos")) return [opts.existeCosteo ? [{ id: 9 }] : []];
      if (sql.includes("cliente_nombre") && sql.includes("FROM tms_cotizaciones")) return [[filaCotizacion()]];
      return [[]];
    }),
    execute: vi.fn(async (sql: string) => {
      if (opts.falla && sql.includes(opts.falla)) throw new Error(`fallo:${opts.falla}`);
      if (sql.includes("INSERT INTO tms_cotizaciones")) return [{ insertId: 1, affectedRows: 1 }];
      if (sql.includes("INSERT INTO tms_cotizacion_costeos")) return [{ insertId: 55, affectedRows: 1 }];
      return [{ insertId: 0, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  return conn;
}
const sqls = (conn: ReturnType<typeof conexion>) => conn.execute.mock.calls.map((c) => String((c as unknown[])[0]));

const perfil = {
  id: 4, codigo: "CABEZAL", nombre: "Cabezal", diasOperacionMes: 30, gpsMensual: 174.1, seguroVehiculoMensual: 1550, costoAceiteServicio: 1860,
  vidaUtilAceiteKm: 5000, costoJuegoLlantas: 38466, vidaUtilLlantasKm: 50000, rendimientoKmGalon: 9.3, depreciacion: null, costoRefrigeracion: null,
};
const { id: _id, ...perfilMotor } = perfil; void _id;
const input: InputCosteoServicio = {
  perfil: perfilMotor,
  parametros: { precioCombustibleGalon: 29.89, ivaTasa: 0.12, costoPilotoDia: 207.74, costoAuxiliarDia: 148.04, viaticoPilotoDia: 200, viaticoAuxiliarDia: 200, viaticoGuiaDia: 125, margenObjetivo: 0.2 },
  distanciaKm: 600, diasServicio: 1, cantidadPilotos: 2, cantidadAuxiliares: 2, incluirGps: true, incluirSeguroVehiculo: true, precioVenta: 1568,
};
const costeo: CosteoPreparado = { perfil, input, resultado: calcularCosteoServicio(input) };
const base = { clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08" };

beforeEach(() => vi.resetAllMocks());

describe("crearCotizacion — el costeo es OPCIONAL", () => {
  it("sin costeo: funciona igual que siempre (sin tocar las tablas de costeo) y hace commit", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    const c = await crearCotizacion(7, base, "admin");
    expect(c.codigo).toBe("COT-000001");
    expect(sqls(conn).some((s) => s.includes("costeo"))).toBe(false);
    expect(conn.query.mock.calls.some((x) => String((x as unknown[])[0]).includes("costeo"))).toBe(false);
    expect(conn.commit).toHaveBeenCalledOnce(); expect(conn.rollback).not.toHaveBeenCalled();
    expect(vi.mocked(registrarAuditoriaTx).mock.calls.map((x) => x[1].accion)).toEqual(["crear"]);
  });
  it("con costeo: cotización, snapshot y componentes en la MISMA conexión/transacción, un solo commit, en ese orden", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    await crearCotizacion(7, base, "admin", costeo);
    const s = sqls(conn);
    const iCot = s.findIndex((x) => x.includes("INSERT INTO tms_cotizaciones"));
    const iSnap = s.findIndex((x) => x.includes("INSERT INTO tms_cotizacion_costeos"));
    const iComp = s.findIndex((x) => x.includes("INSERT INTO tms_cotizacion_costeo_componentes"));
    expect(iCot).toBeGreaterThanOrEqual(0); expect(iSnap).toBeGreaterThan(iCot); expect(iComp).toBeGreaterThan(iSnap);
    expect(getPool).toHaveBeenCalledTimes(1);
    expect(conn.beginTransaction).toHaveBeenCalledOnce(); expect(conn.commit).toHaveBeenCalledOnce(); expect(conn.rollback).not.toHaveBeenCalled();
    // El snapshot queda ligado al id recién creado y a la empresa de la cotización.
    const paramsSnap = (conn.execute.mock.calls[iSnap] as unknown as [string, unknown[]])[1];
    expect(paramsSnap.slice(0, 2)).toEqual([7, 1]);
    expect(vi.mocked(registrarAuditoriaTx).mock.calls.map((x) => x[1].accion)).toEqual(["crear", "crear_costeo"]);
  });
  it("si falla el snapshot, ROLLBACK completo de la cotización (sin commit)", async () => {
    const conn = conexion({ falla: "INSERT INTO tms_cotizacion_costeos" });
    await expect(crearCotizacion(7, base, "admin", costeo)).rejects.toThrow("fallo:INSERT INTO tms_cotizacion_costeos");
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled(); expect(conn.release).toHaveBeenCalledOnce();
  });
  it("si falla un componente, ROLLBACK completo (no queda cotización sin snapshot)", async () => {
    const conn = conexion({ falla: "tms_cotizacion_costeo_componentes" });
    await expect(crearCotizacion(7, base, "admin", costeo)).rejects.toThrow("fallo:tms_cotizacion_costeo_componentes");
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe("actualizarCotizacion — snapshot inmutable", () => {
  it("Borrador SIN snapshot: lo registra por primera vez dentro de la misma transacción", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    await actualizarCotizacion(7, 1, { observaciones: "x" }, costeo, "admin");
    const s = sqls(conn);
    expect(s.some((x) => x.includes("INSERT INTO tms_cotizacion_costeos"))).toBe(true);
    expect(s.some((x) => x.includes("INSERT INTO tms_cotizacion_costeo_componentes"))).toBe(true);
    expect(conn.commit).toHaveBeenCalledOnce();
  });
  it("Borrador CON snapshot: NO se reemplaza (409 lógico), se revierte todo, sin UPDATE/DELETE del snapshot", async () => {
    const conn = conexion({ existeCosteo: true });
    await expect(actualizarCotizacion(7, 1, { observaciones: "x" }, costeo, "admin")).rejects.toBeInstanceOf(ErrorCosteoYaRegistrado);
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled();
    expect(sqls(conn).some((x) => /costeo/.test(x) && /(INSERT|UPDATE|DELETE)/.test(x))).toBe(false);
  });
  it("editar sin costeo no consulta ni toca las tablas de costeo", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    await actualizarCotizacion(7, 1, { observaciones: "x" });
    expect(sqls(conn).concat(conn.query.mock.calls.map((x) => String((x as unknown[])[0]))).some((x) => x.includes("costeo"))).toBe(false);
  });
});

describe("duplicarCotizacion NO copia el costeo", () => {
  it("la duplicada es un Borrador nuevo SIN snapshot (ni siquiera consulta el original)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    const dup = await duplicarCotizacion(7, 1, "admin");
    expect(dup).not.toBeNull();
    expect(sqls(conn).some((x) => x.includes("costeo"))).toBe(false);
    expect(conn.query.mock.calls.some((x) => String((x as unknown[])[0]).includes("costeo"))).toBe(false);
    expect(vi.mocked(query).mock.calls.some((x) => String(x[0]).includes("costeo"))).toBe(false);
    expect(vi.mocked(registrarAuditoriaTx).mock.calls.map((x) => x[1].accion)).toEqual(["crear"]);
    const fuente = readFileSync("src/lib/tms/cotizaciones.ts", "utf8");
    const bloqueDuplicar = fuente.slice(fuente.indexOf("export async function duplicarCotizacion"));
    expect(bloqueDuplicar).not.toMatch(/costeo/i);
  });
});

describe("Cotizaciones históricas y lecturas normales sin costeo", () => {
  it("obtener/listar no consultan las tablas de costeo ni devuelven campos de costeo", async () => {
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    const uno = await obtenerCotizacion(7, 1);
    const lista = await listarCotizaciones(7);
    expect(vi.mocked(query).mock.calls.some((x) => /costeo/i.test(String(x[0])))).toBe(false);
    for (const c of [uno!, lista[0]]) {
      const json = JSON.stringify(c);
      for (const clave of ["costeo", "costoOperativo", "precioSugerido", "utilidad", "margen", "perfil", "combustible", "salario"]) expect(json.toLowerCase()).not.toContain(clave.toLowerCase());
    }
  });
});
