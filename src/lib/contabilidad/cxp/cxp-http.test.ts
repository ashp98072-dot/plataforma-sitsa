import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  guard: vi.fn(), registrar: vi.fn(), listar: vi.fn(), obtener: vi.fn(), anular: vi.fn(), previsualizar: vi.fn(),
  guardarConfig: vi.fn(), obtenerConfig: vi.fn(), proveedores: vi.fn(), cuentas: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantCxp: m.guard }));
vi.mock("./facturas", () => ({ registrarFactura: m.registrar, listarFacturas: m.listar, obtenerFactura: m.obtener, anularFactura: m.anular, previsualizarFactura: m.previsualizar }));
vi.mock("./proveedor-fiscal", () => ({ guardarConfigFiscal: m.guardarConfig, obtenerConfigFiscal: m.obtenerConfig, listarProveedoresCxp: m.proveedores, listarCuentasCxp: m.cuentas }));
import {
  anularFacturaHttp, guardarConfigFiscalHttp, listarCuentasHttp, listarFacturasHttp, listarProveedoresHttp, obtenerConfigFiscalHttp, obtenerFacturaHttp,
  previsualizarFacturaHttp, registrarFacturaHttp,
} from "./http";
import { ErrorCxp } from "./errores";
import { ReglaIsrPendiente } from "./isr-proveedor";
import { CATALOGO_PERMISOS } from "@/lib/permisos-catalogo";
import { PERMISOS_CXP, PLATAFORMA_PERMISIBLES, moduloEmpresaDelPermiso, modulosPropiosDelRol } from "@/lib/permisos-shared";

const OK = { empresa: { id: 1 }, session: { id: 91, username: "op", rol: "Contabilidad" } };
const prohibido = () => ({ error: new Response(JSON.stringify({ error: "x" }), { status: 403 }) });
const req = (url = "http://l/x?entidad=5", body?: unknown) => new Request(url, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  m.guard.mockResolvedValue(OK);
  m.registrar.mockResolvedValue({ factura: { id: 7 }, advertencias: [] });
  m.listar.mockResolvedValue({ facturas: [] }); m.obtener.mockResolvedValue({ id: 7 }); m.anular.mockResolvedValue({ id: 7 });
  m.previsualizar.mockResolvedValue({ totalNetoPagar: "1.00" }); m.guardarConfig.mockResolvedValue({}); m.obtenerConfig.mockResolvedValue(null);
  m.proveedores.mockResolvedValue([]); m.cuentas.mockResolvedValue([]);
});

describe("permisos propios de CxP (fila + acción) y fail-closed", () => {
  it.each([
    ["listar", () => listarFacturasHttp(req(), "e"), ["cxp_facturas", "ver"]],
    ["obtener", () => obtenerFacturaHttp(req(), "e", "7"), ["cxp_facturas", "ver"]],
    ["previsualizar", () => previsualizarFacturaHttp(req(undefined, {}), "e"), ["cxp_facturas", "ver"]],
    ["registrar", () => registrarFacturaHttp(req(undefined, {}), "e"), ["cxp_facturas", "editar"]],
    ["anular", () => anularFacturaHttp(req(undefined, { motivo: "error" }), "e", "7"), ["cxp_anular", "editar"]],
    ["ver config", () => obtenerConfigFiscalHttp(req(), "e", "3"), ["cxp_proveedor_fiscal", "ver"]],
    ["editar config", () => guardarConfigFiscalHttp(req(undefined, {}), "e", "3"), ["cxp_proveedor_fiscal", "editar"]],
    ["cuentas", () => listarCuentasHttp(req(), "e"), ["cxp_proveedor_fiscal", "ver"]],
  ] as const)("%s exige %j y no ejecuta sin permiso", async (_n, llamar, [fila, accion]) => {
    m.guard.mockResolvedValue(prohibido());
    expect((await llamar()).status).toBe(403);
    expect(m.guard.mock.calls[0].slice(1, 3)).toEqual([fila, accion]);
    for (const f of [m.registrar, m.anular, m.guardarConfig, m.listar, m.obtener, m.cuentas, m.obtenerConfig, m.previsualizar]) expect(f).not.toHaveBeenCalled();
  });
  it("el listado de proveedores acepta cualquiera de los dos permisos de lectura", async () => {
    m.guard.mockResolvedValueOnce(prohibido()).mockResolvedValueOnce(OK);
    expect((await listarProveedoresHttp(req(), "e")).status).toBe(200);
    expect(m.guard.mock.calls.map(c => c[1])).toEqual(["cxp_facturas", "cxp_proveedor_fiscal"]);
    m.guard.mockReset(); m.guard.mockResolvedValue(prohibido());
    expect((await listarProveedoresHttp(req(), "e")).status).toBe(403);
  });
  it("registrar NO concede anular ni configurar (filas independientes); catálogo y roles", () => {
    expect(PERMISOS_CXP).toEqual(["cxp_facturas", "cxp_anular", "cxp_proveedor_fiscal"]);
    for (const p of PERMISOS_CXP) {
      expect(PLATAFORMA_PERMISIBLES).toContain(p);
      expect(moduloEmpresaDelPermiso(p)).toBe("contabilidad");
      expect(modulosPropiosDelRol("Contabilidad")).not.toContain(p); // ningún rol los trae por defecto
      expect(modulosPropiosDelRol("Visualizador")).not.toContain(p);
    }
    const cont = CATALOGO_PERMISOS.find(x => x.id === "contabilidad")!;
    const ids = cont.acciones.map(a => a.id);
    expect(ids).toEqual(expect.arrayContaining(["cxp_ver", "cxp_registrar", "cxp_anular", "cxp_ver_fiscal", "cxp_editar_fiscal"]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ámbito, entradas y errores", () => {
  it("la entidad es obligatoria y única (?entidad=)", async () => {
    expect((await listarFacturasHttp(req("http://l/x"), "e")).status).toBe(400);
    expect((await listarFacturasHttp(req("http://l/x?entidad=1&entidad=2"), "e")).status).toBe(400);
    expect(m.listar).not.toHaveBeenCalled();
  });
  it("empresa, usuario, totales e ISR NO se leen del cuerpo", async () => {
    await registrarFacturaHttp(req(undefined, {
      proveedorId: 3, numero: "1", serie: "A", fechaDocumento: "2026-11-02", baseNeto: 10000, ivaMonto: 1200, observaciones: "x",
      empresaId: 99, entidadId: 99, usuario: "otro", creadoPor: 1, isrMonto: "0.00", totalNetoPagar: "1.00", estadoAdmin: "ANULADA", regimenFiscal: "PEQUENO_CONTRIBUYENTE",
    }), "e");
    const [empresaId, entidadId, actor, entrada] = m.registrar.mock.calls[0];
    expect([empresaId, entidadId, actor]).toEqual([1, 5, { id: 91, username: "op" }]);
    expect(Object.keys(entrada).sort()).toEqual(["baseNeto", "fechaDocumento", "fechaVencimiento", "ivaMonto", "numero", "observaciones", "proveedorId", "serie", "tipoDocumento"]);
  });
  it("cuerpo inválido → 400 sin servicio", async () => {
    expect((await registrarFacturaHttp(new Request("http://l/x?entidad=5", { method: "POST", body: "no-json" }), "e")).status).toBe(400);
    expect((await registrarFacturaHttp(req(undefined, [1]), "e")).status).toBe(400);
    expect(m.registrar).not.toHaveBeenCalled();
  });
  it("errores de dominio conservan su estado; regla ISR pendiente = 422; BD sin migrar = 503; inesperado = 500 genérico", async () => {
    m.registrar.mockRejectedValueOnce(new ErrorCxp("La factura A / 1 ya está registrada.", 409, "FACTURA_DUPLICADA"));
    const dup = await registrarFacturaHttp(req(undefined, {}), "e");
    expect(dup.status).toBe(409); expect(await dup.json()).toMatchObject({ codigo: "FACTURA_DUPLICADA" });
    m.registrar.mockRejectedValueOnce(new ReglaIsrPendiente("pendiente"));
    expect((await registrarFacturaHttp(req(undefined, {}), "e")).status).toBe(422);
    m.registrar.mockRejectedValueOnce(Object.assign(new Error("tabla"), { code: "ER_NO_SUCH_TABLE" }));
    const sin = await registrarFacturaHttp(req(undefined, {}), "e");
    expect(sin.status).toBe(503); expect(await sin.json()).toMatchObject({ codigo: "MIGRACION_PENDIENTE" });
    m.registrar.mockRejectedValueOnce(new Error("SELECT secreto FROM x"));
    const e500 = await registrarFacturaHttp(req(undefined, {}), "e");
    expect(e500.status).toBe(500); expect(JSON.stringify(await e500.json())).not.toContain("secreto");
  });
  it("filtros inválidos → 400; factura inexistente → 404", async () => {
    expect((await listarFacturasHttp(req("http://l/x?entidad=5&estado=PAGADA"), "e")).status).toBe(400);
    m.obtener.mockResolvedValueOnce(null);
    expect((await obtenerFacturaHttp(req(), "e", "7")).status).toBe(404);
    expect((await obtenerFacturaHttp(req(), "e", "0")).status).toBe(400);
  });
});

describe("arquitectura (no tocar CxC, clientes ni cont_cxp)", () => {
  const leer = (f: string) => readFileSync(f, "utf8");
  it("los servicios CxP nunca escriben en cont_cxp, fact_*, cont_asientos ni pólizas", () => {
    for (const f of ["facturas.ts", "proveedor-fiscal.ts", "http.ts"]) {
      const src = leer(`src/lib/contabilidad/cxp/${f}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+(cont_cxp|cont_cxc|cont_asiento|fact_|clientes|compras_proveedores)/i);
      expect(src).not.toMatch(/cont_eventos|poliza|fel_/i);
    }
  });
  it("las filas legacy de cont_cxp no se migran: la migración solo crea tablas nuevas", () => {
    const ddl = leer("scripts/cxp-m3a-ddl.sql");
    expect(ddl.replace(/ON (UPDATE|DELETE) \w+/g, "")).not.toMatch(/ALTER TABLE|INSERT INTO|UPDATE |DELETE /i);
    expect(ddl.match(/CREATE TABLE (\w+)/g)).toEqual(["CREATE TABLE cxp_proveedor_fiscal", "CREATE TABLE cxp_facturas"]);
  });
  it("migrate no usa IF NOT EXISTS ni modifica tablas existentes", () => {
    const sql = leer("sql/migrate-2026-11-cxp-m3a-base.sql").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/IF NOT EXISTS/i);
    expect(sql).not.toMatch(/ALTER TABLE|DROP TABLE|TRUNCATE|UPDATE\s+\w+\s+SET|DELETE FROM/i);
  });
  it("el bloque de auditoría es idéntico en preflight, migrate y postcheck", () => {
    const b = (t: string) => t.split("-- BEGIN CXP M3A CONTRACT AUDIT")[1].split("-- END CXP M3A CONTRACT AUDIT")[0];
    const sql = (n: string) => leer(`sql/${n}-2026-11-cxp-m3a-base.sql`).replace(/\r\n/g, "\n");
    expect(b(sql("migrate"))).toBe(b(sql("preflight")));
    expect(b(sql("postcheck"))).toBe(b(sql("preflight")));
  });
});
