import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Se usa el requireTenantCxp REAL (sesión, empresa y permisos simulados) para verificar Admin y no Admin.
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("@/lib/permisos", async (original) => ({ ...(await original<typeof import("@/lib/permisos")>()), permisosEfectivos: vi.fn() }));

const m = vi.hoisted(() => ({ listar: vi.fn(), exportar: vi.fn() }));
vi.mock("./antiguedad", () => ({ listarAntiguedadCxp: m.listar, listarAntiguedadCxpParaExportar: m.exportar }));

import { getSession } from "@/lib/session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import { ErrorCxp } from "./errores";
import { antiguedadCxpHttp, exportarAntiguedadCxpHttp } from "./http-antiguedad";

const empresa = { id: 7, slug: "kt", nombre: "KT", activa: true, modulos: ["contabilidad"] };
const fila = (modulo: string, v: boolean, e = false) => ({ modulo, puedeVer: v, puedeCrear: false, puedeEditar: e, puedeEliminar: false });
const url = (qs = "entidad=5") => new Request(`http://x/api?${qs}`);
const vacia = { filas: [], totalReal: 0, page: 1, pageSize: 25, fechaCorte: "2026-11-30", moneda: "GTQ", totalesPorTramo: [], totalesPorSituacion: [], saldoTotal: "0.00", rotulo: "r" };
const vaciaExp = { ok: true, filas: [], totalesPorTramo: [], totalesPorSituacion: [], saldoTotal: "0.00", fechaCorte: "2026-11-30" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 3, rol: "Contabilidad", username: "conta", empresaId: 7 } as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxp_facturas", true)] as never);
  m.listar.mockResolvedValue(vacia);
  m.exportar.mockResolvedValue(vaciaExp);
});

describe("MIL-CXP-01 · permisos y ámbito", () => {
  it("no Admin con cxp_facturas:ver lista y exporta; empresa de la sesión (nunca de la query); entidad = ?entidad=", async () => {
    expect((await antiguedadCxpHttp(url("entidad=5&empresaId=999&proveedorId=3&tramo=31-60"), "kt")).status).toBe(200);
    expect(m.listar).toHaveBeenCalledWith(7, 5, { proveedorId: 3, tramo: "31-60" });
    expect((await exportarAntiguedadCxpHttp(url("entidad=5&empresa_id=999"), "kt")).status).toBe(200);
    expect(m.exportar).toHaveBeenCalledWith(7, 5, {}, undefined);
  });
  it("Admin de la empresa: permitido", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 1, rol: "Admin", username: "root", empresaId: 7 } as never);
    expect((await antiguedadCxpHttp(url(), "kt")).status).toBe(200);
  });
  it("no Admin SIN cxp_facturas (solo pagos, bitácora o facturación): 403 en lista y exportación, sin consultar", async () => {
    for (const filas of [[fila("cxp_pagos", true)], [fila("cxp_bitacora", true)], [fila("facturacion", true, true)], []]) {
      vi.mocked(permisosEfectivos).mockResolvedValue(filas as never);
      expect((await antiguedadCxpHttp(url(), "kt")).status).toBe(403);
      expect((await exportarAntiguedadCxpHttp(url(), "kt")).status).toBe(403);
    }
    expect(m.listar).not.toHaveBeenCalled();
    expect(m.exportar).not.toHaveBeenCalled();
  });
  it("empresa sin módulo Contabilidad: 403; Admin de otra empresa: 403; sin sesión: se rechaza", async () => {
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, modulos: ["rrhh"] } as never);
    expect((await antiguedadCxpHttp(url(), "kt")).status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
    vi.mocked(getSession).mockResolvedValue({ id: 1, rol: "Admin", username: "root", empresaId: 7 } as never);
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    expect((await antiguedadCxpHttp(url(), "kt")).status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null as never);
    expect((await antiguedadCxpHttp(url(), "kt")).status).toBeGreaterThanOrEqual(401);
    expect(m.listar).not.toHaveBeenCalled();
  });
  it("entidad ausente, repetida o inválida: 400 y no consulta", async () => {
    for (const qs of ["", "entidad=", "entidad=0", "entidad=abc", "entidad=1&entidad=2", "entidad=99999999999"]) {
      expect((await antiguedadCxpHttp(url(qs), "kt")).status, qs).toBe(400);
      expect((await exportarAntiguedadCxpHttp(url(qs), "kt")).status, qs).toBe(400);
    }
    expect(m.listar).not.toHaveBeenCalled();
    expect(m.exportar).not.toHaveBeenCalled();
  });
});

describe("MIL-CXP-01 · filtros inválidos: 400 sin consultar ni exportar", () => {
  const INVALIDOS = ["proveedorId=abc", "proveedorId=0", "proveedorId=", "tramo=x", "situacion=MORA", "page=0", "pageSize=101", "proveedorId=1&proveedorId=2", "tramo=0-15&proveedorId=abc"];
  it("lista: HTTP 400 FILTRO_INVALIDO, sin consulta", async () => {
    for (const qs of INVALIDOS) {
      const r = await antiguedadCxpHttp(url(`entidad=5&${qs}`), "kt");
      expect(r.status, qs).toBe(400);
      expect((await r.json()).codigo).toBe("FILTRO_INVALIDO");
    }
    expect(m.listar).not.toHaveBeenCalled();
  });
  it("exportación: HTTP 400 FILTRO_INVALIDO y NO genera archivo", async () => {
    for (const qs of INVALIDOS) {
      const r = await exportarAntiguedadCxpHttp(url(`entidad=5&${qs}`), "kt");
      expect(r.status, qs).toBe(400);
      expect(r.headers.get("Content-Type")).not.toContain("spreadsheetml");
    }
    expect(m.exportar).not.toHaveBeenCalled();
  });
  it("sin permiso manda el 403 (la autorización va antes que los filtros)", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([] as never);
    expect((await antiguedadCxpHttp(url("entidad=5&proveedorId=abc"), "kt")).status).toBe(403);
  });
});

describe("MIL-CXP-01 · fecha de corte conservada al exportar", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-30T18:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  it("hoy o ayer: se pasa a la exportación con los filtros", async () => {
    expect((await exportarAntiguedadCxpHttp(url("entidad=5&situacion=VENCIDA&corte=2026-11-29"), "kt")).status).toBe(200);
    expect(m.exportar).toHaveBeenLastCalledWith(7, 5, { situacion: "VENCIDA" }, "2026-11-29");
  });
  it("histórico, futuro o mal formado: 400 y no se genera nada", async () => {
    for (const c of ["2026-11-28", "2026-12-01", "2026-02-30", "x", ""]) expect((await exportarAntiguedadCxpHttp(url(`entidad=5&corte=${c}`), "kt")).status, c).toBe(400);
    expect(m.exportar).not.toHaveBeenCalled();
  });
  it("la lista no acepta «corte»", async () => {
    expect((await antiguedadCxpHttp(url("entidad=5&corte=2026-11-30"), "kt")).status).toBe(400);
    expect(m.listar).not.toHaveBeenCalled();
  });
});

describe("MIL-CXP-01 · entidad que no pertenece a la empresa", () => {
  it("el servicio responde 404 ENTIDAD_NO_DISPONIBLE y la ruta lo propaga en lista y exportación", async () => {
    const e = new ErrorCxp("Entidad no disponible.", 404, "ENTIDAD_NO_DISPONIBLE");
    m.listar.mockRejectedValue(e);
    m.exportar.mockRejectedValue(e);
    for (const r of [await antiguedadCxpHttp(url("entidad=99"), "kt"), await exportarAntiguedadCxpHttp(url("entidad=99"), "kt")]) {
      expect(r.status).toBe(404);
      expect((await r.json()).codigo).toBe("ENTIDAD_NO_DISPONIBLE");
    }
  });
  it("política vigente (CONTABILIDAD-ACCESO-UNIFICADO): el permiso central cubre todos los libros de la empresa; cont_entidad_usuarios no concede ni restringe", async () => {
    // Cualquier entidad de la empresa de la sesión se entrega al servicio sin consultar cont_entidad_usuarios (no es un hueco nuevo: es la política de todo CxP/Contabilidad).
    for (const entidad of ["5", "6", "42"]) expect((await antiguedadCxpHttp(url("entidad=" + entidad), "kt")).status).toBe(200);
    expect(m.listar.mock.calls.map((c) => [c[0], c[1]])).toEqual([[7, 5], [7, 6], [7, 42]]);
  });
});

describe("MIL-CXP-01 · errores controlados", () => {
  it("MIGRACION_PENDIENTE (ErrorCxp 503) en lista y exportación", async () => {
    const e = new ErrorCxp("Esquema de Cuentas por pagar pendiente.", 503, "MIGRACION_PENDIENTE");
    m.listar.mockRejectedValue(e);
    m.exportar.mockRejectedValue(e);
    for (const r of [await antiguedadCxpHttp(url(), "kt"), await exportarAntiguedadCxpHttp(url(), "kt")]) {
      expect(r.status).toBe(503);
      expect((await r.json()).codigo).toBe("MIGRACION_PENDIENTE");
    }
  });
  it("ER_NO_SUCH_TABLE sin envolver → 503 MIGRACION_PENDIENTE", async () => {
    m.listar.mockRejectedValue(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }));
    const r = await antiguedadCxpHttp(url(), "kt");
    expect([r.status, (await r.json()).codigo]).toEqual([503, "MIGRACION_PENDIENTE"]);
  });
  it("error inesperado → 500 genérico sin SQL ni detalles", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.listar.mockRejectedValue(Object.assign(new Error("SELECT secreto FROM x"), { code: "ER_X" }));
    const r = await antiguedadCxpHttp(url(), "kt");
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/secreto|SELECT/);
    spy.mockRestore();
  });
  it("exportación que excede el límite → 400; exportación OK → xlsx privado con corte en el nombre", async () => {
    m.exportar.mockResolvedValue({ ok: false, error: "El filtro devuelve más de 20000 facturas." });
    expect((await exportarAntiguedadCxpHttp(url(), "kt")).status).toBe(400);
    m.exportar.mockResolvedValue(vaciaExp);
    const r = await exportarAntiguedadCxpHttp(url(), "kt");
    expect(r.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("Content-Disposition")).toContain("cuentas-por-pagar-antiguedad-2026-11-30.xlsx");
  });
});
