import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Se usa el requireTenantCxp REAL (sesión, empresa y permisos simulados) para verificar Admin y no Admin y la separación facturas / pagos / fiscal.
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("@/lib/permisos", async (original) => ({ ...(await original<typeof import("@/lib/permisos")>()), permisosEfectivos: vi.fn() }));

const m = vi.hoisted(() => ({ obtener: vi.fn(), exportar: vi.fn() }));
vi.mock("./estado-cuenta", () => ({ obtenerEstadoCuentaCxp: m.obtener, exportarEstadoCuentaCxp: m.exportar }));

import { getSession } from "@/lib/session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import { ErrorCxp } from "./errores";
import { estadoCuentaCxpHttp, exportarEstadoCuentaCxpHttp } from "./http-estado-cuenta";
import { NOTA_MONEDA_ESTADO_CUENTA, ROTULO_ESTADO_CUENTA } from "./estado-cuenta-shared";

const empresa = { id: 7, slug: "kt", nombre: "KT", activa: true, modulos: ["contabilidad"] };
const fila = (modulo: string, v = true, e = false) => ({ modulo, puedeVer: v, puedeCrear: false, puedeEditar: e, puedeEliminar: false });
const url = (qs = "entidad=5&proveedorId=3") => new Request(`http://x/api?${qs}`);
const datos = {
  proveedor: { id: 3, nombre: "P", nit: null, diasCredito: null, regimenFiscal: null, sujetoIsr: null }, filtros: { incluirPagadas: false, incluirAnuladas: false, desde: null, hasta: null },
  filas: [], totalReal: 0, page: 1, pageSize: 25, fechaCorte: "2026-11-30", moneda: "GTQ",
  totales: { registradas: { facturas: 0, totalDocumento: "0.00", retencionIsr: "0.00", montoPagadero: "0.00", pagado: "0.00", saldoExigible: "0.00" }, abiertas: { facturas: 0, saldo: "0.00" }, pagadas: { facturas: 0 }, porSituacion: [], anuladas: { facturas: 0, totalDocumento: "0.00", retencionIsr: "0.00", montoPagadero: "0.00" } },
  advertencias: [], advertenciasOmitidas: 0, pagosVisibles: false, rotulo: ROTULO_ESTADO_CUENTA, notaMoneda: NOTA_MONEDA_ESTADO_CUENTA,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 3, rol: "Contabilidad", username: "conta", empresaId: 7 } as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxp_facturas")] as never);
  m.obtener.mockResolvedValue(datos);
  m.exportar.mockResolvedValue({ ok: true, datos });
});

describe("MIL-CXP-02 · D2: separación de permisos decidida en el servidor", () => {
  it("solo cxp_facturas: consulta SIN pagos ni régimen (verPagos=false, verFiscal=false) — lista y exportación", async () => {
    expect((await estadoCuentaCxpHttp(url(), "kt")).status).toBe(200);
    expect(m.obtener).toHaveBeenCalledWith(7, 5, { proveedorId: 3, incluirPagadas: false, incluirAnuladas: false }, { verPagos: false, verFiscal: false });
    expect((await exportarEstadoCuentaCxpHttp(url(), "kt")).status).toBe(200);
    expect(m.exportar).toHaveBeenCalledWith(7, 5, { proveedorId: 3, incluirPagadas: false, incluirAnuladas: false }, { verPagos: false, verFiscal: false }, undefined);
  });
  it("cxp_facturas + cxp_pagos: verPagos=true; la configuración fiscal sigue oculta", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxp_facturas"), fila("cxp_pagos")] as never);
    await estadoCuentaCxpHttp(url(), "kt");
    expect(m.obtener).toHaveBeenLastCalledWith(7, 5, expect.anything(), { verPagos: true, verFiscal: false });
  });
  it("cxp_facturas + cxp_proveedor_fiscal: verFiscal=true; los pagos siguen ocultos", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxp_facturas"), fila("cxp_proveedor_fiscal")] as never);
    await exportarEstadoCuentaCxpHttp(url(), "kt");
    expect(m.exportar).toHaveBeenLastCalledWith(7, 5, expect.anything(), { verPagos: false, verFiscal: true }, undefined);
  });
  it("Admin: ambos", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 1, rol: "Admin", username: "root", empresaId: 7 } as never);
    await estadoCuentaCxpHttp(url(), "kt");
    expect(m.obtener).toHaveBeenLastCalledWith(7, 5, expect.anything(), { verPagos: true, verFiscal: true });
  });
  it("SIN cxp_facturas (aunque tenga pagos, fiscal, bitácora o facturación): 403 en lista y exportación y no consulta nada", async () => {
    for (const filas of [[fila("cxp_pagos")], [fila("cxp_proveedor_fiscal")], [fila("cxp_bitacora")], [fila("facturacion", true, true)], [fila("cxp_pagos"), fila("cxp_proveedor_fiscal")], []]) {
      vi.mocked(permisosEfectivos).mockResolvedValue(filas as never);
      expect((await estadoCuentaCxpHttp(url(), "kt")).status).toBe(403);
      expect((await exportarEstadoCuentaCxpHttp(url(), "kt")).status).toBe(403);
    }
    expect(m.obtener).not.toHaveBeenCalled();
    expect(m.exportar).not.toHaveBeenCalled();
  });
  it("la empresa sale de la sesión (nunca de la query); empresa sin módulo Contabilidad o Admin ajeno: 403; sin sesión: se rechaza", async () => {
    await estadoCuentaCxpHttp(url("entidad=5&proveedorId=3&empresaId=999"), "kt");
    expect(m.obtener.mock.calls[0][0]).toBe(7);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, modulos: ["rrhh"] } as never);
    expect((await estadoCuentaCxpHttp(url(), "kt")).status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
    vi.mocked(getSession).mockResolvedValue({ id: 1, rol: "Admin", username: "root", empresaId: 7 } as never);
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    expect((await estadoCuentaCxpHttp(url(), "kt")).status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null as never);
    expect((await estadoCuentaCxpHttp(url(), "kt")).status).toBeGreaterThanOrEqual(401);
    expect(m.obtener).toHaveBeenCalledTimes(1);
  });
});

describe("MIL-CXP-02 · ámbito y filtros inválidos: 400 sin consultar ni exportar", () => {
  it("entidad ausente, repetida, no numérica o fuera de rango: 400", async () => {
    for (const qs of ["proveedorId=3", "entidad=&proveedorId=3", "entidad=0&proveedorId=3", "entidad=abc&proveedorId=3", "entidad=1&entidad=2&proveedorId=3", "entidad=99999999999&proveedorId=3"]) {
      expect((await estadoCuentaCxpHttp(url(qs), "kt")).status, qs).toBe(400);
      expect((await exportarEstadoCuentaCxpHttp(url(qs), "kt")).status, qs).toBe(400);
    }
    expect(m.obtener).not.toHaveBeenCalled();
    expect(m.exportar).not.toHaveBeenCalled();
  });
  const INVALIDOS = [
    "", "proveedorId=abc", "proveedorId=0", "proveedorId=", "proveedorId=1&proveedorId=2", "proveedorId=3&incluirPagadas=2", "proveedorId=3&incluirPagadas=true", "proveedorId=3&incluirAnuladas=",
    "proveedorId=3&desde=2026-02-30", "proveedorId=3&desde=2026-11-30&hasta=2026-11-01", "proveedorId=3&page=0", "proveedorId=3&pageSize=101",
  ];
  it("lista: HTTP 400 FILTRO_INVALIDO (incluye proveedor faltante), sin consulta", async () => {
    for (const qs of INVALIDOS) {
      const r = await estadoCuentaCxpHttp(url(`entidad=5&${qs}`), "kt");
      expect(r.status, qs).toBe(400);
      expect((await r.json()).codigo).toBe("FILTRO_INVALIDO");
    }
    expect(m.obtener).not.toHaveBeenCalled();
  });
  it("exportación: HTTP 400 y NO genera archivo", async () => {
    for (const qs of INVALIDOS) {
      const r = await exportarEstadoCuentaCxpHttp(url(`entidad=5&${qs}`), "kt");
      expect(r.status, qs).toBe(400);
      expect(r.headers.get("Content-Type")).not.toContain("spreadsheetml");
    }
    expect(m.exportar).not.toHaveBeenCalled();
  });
  it("la autorización va antes que la validación de filtros (sin permiso → 403, no 400)", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([] as never);
    expect((await estadoCuentaCxpHttp(url("entidad=5&proveedorId=abc"), "kt")).status).toBe(403);
  });
});

describe("MIL-CXP-02 · fecha de corte conservada al exportar", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-30T18:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  it("hoy o ayer: se pasa a la exportación con los filtros", async () => {
    expect((await exportarEstadoCuentaCxpHttp(url("entidad=5&proveedorId=3&incluirPagadas=1&corte=2026-11-29"), "kt")).status).toBe(200);
    expect(m.exportar).toHaveBeenLastCalledWith(7, 5, { proveedorId: 3, incluirPagadas: true, incluirAnuladas: false }, expect.anything(), "2026-11-29");
  });
  it("histórico, futuro o mal formado: 400 y no se genera nada; la LISTA no acepta «corte»", async () => {
    for (const c of ["2026-11-28", "2026-12-01", "2026-02-30", "x", ""]) expect((await exportarEstadoCuentaCxpHttp(url(`entidad=5&proveedorId=3&corte=${c}`), "kt")).status, c).toBe(400);
    expect(m.exportar).not.toHaveBeenCalled();
    expect((await estadoCuentaCxpHttp(url("entidad=5&proveedorId=3&corte=2026-11-30"), "kt")).status).toBe(400);
    expect(m.obtener).not.toHaveBeenCalled();
  });
});

describe("MIL-CXP-02 · errores controlados y respuesta", () => {
  it("la respuesta lleva el rótulo exacto, la nota de moneda y no se altera", async () => {
    const r = await estadoCuentaCxpHttp(url(), "kt");
    const j = await r.json();
    expect(j.rotulo).toBe(ROTULO_ESTADO_CUENTA);
    expect(j.notaMoneda).toBe(NOTA_MONEDA_ESTADO_CUENTA);
    expect(j).toEqual(datos);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("404 de entidad ajena y de proveedor ajeno; 503 MIGRACION_PENDIENTE; ER_NO_SUCH_TABLE sin envolver → 503", async () => {
    m.obtener.mockRejectedValueOnce(new ErrorCxp("Entidad no disponible.", 404, "ENTIDAD_NO_DISPONIBLE"));
    expect([(await estadoCuentaCxpHttp(url(), "kt")).status]).toEqual([404]);
    m.obtener.mockRejectedValueOnce(new ErrorCxp("Proveedor no disponible.", 404, "PROVEEDOR_NO_DISPONIBLE"));
    const r2 = await estadoCuentaCxpHttp(url(), "kt");
    expect([r2.status, (await r2.json()).codigo]).toEqual([404, "PROVEEDOR_NO_DISPONIBLE"]);
    m.obtener.mockRejectedValueOnce(new ErrorCxp("Esquema pendiente.", 503, "MIGRACION_PENDIENTE"));
    expect((await estadoCuentaCxpHttp(url(), "kt")).status).toBe(503);
    m.exportar.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }));
    const r3 = await exportarEstadoCuentaCxpHttp(url(), "kt");
    expect([r3.status, (await r3.json()).codigo]).toEqual([503, "MIGRACION_PENDIENTE"]);
  });
  it("error inesperado → 500 genérico sin SQL ni detalles", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.obtener.mockRejectedValue(Object.assign(new Error("SELECT secreto FROM x"), { code: "ER_X" }));
    const r = await estadoCuentaCxpHttp(url(), "kt");
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/secreto|SELECT/);
    spy.mockRestore();
  });
  it("exportación: límite excedido → 400; OK → xlsx privado con proveedor y corte en el nombre", async () => {
    m.exportar.mockResolvedValueOnce({ ok: false, error: "El filtro devuelve más de 20000 facturas." });
    expect((await exportarEstadoCuentaCxpHttp(url(), "kt")).status).toBe(400);
    const r = await exportarEstadoCuentaCxpHttp(url(), "kt");
    expect(r.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("Content-Disposition")).toContain("cuentas-por-pagar-estado-cuenta-proveedor-3-2026-11-30.xlsx");
  });
  it("política de entidad vigente (ticket #555): cualquier entidad de la empresa de la sesión llega al servicio; no se consulta cont_entidad_usuarios", async () => {
    for (const e of ["5", "6", "42"]) expect((await estadoCuentaCxpHttp(url(`entidad=${e}&proveedorId=3`), "kt")).status).toBe(200);
    expect(m.obtener.mock.calls.map((c) => [c[0], c[1]])).toEqual([[7, 5], [7, 6], [7, 42]]);
  });
});
