import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ guard: vi.fn(), diario: vi.fn(), mayor: vi.fn(), balance: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantContReporte: m.guard }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: vi.fn() }));
vi.mock("./reportes", () => ({ libroDiario: m.diario, libroMayor: m.mayor, balanceComprobacion: m.balance }));
import { aCentavos, conSaldoAcumulado, deCentavos, fechaValida, saldosDeCuenta, totalesBalance, totalizar } from "./calculo";
import { opcionesHttp, reporteHttp } from "./http";
import { exportarXlsx } from "./exportar";
import { CATALOGO_PERMISOS } from "@/lib/permisos-catalogo";
import { PERMISOS_CONT_REPORTES, PLATAFORMA_PERMISIBLES, moduloEmpresaDelPermiso, modulosPropiosDelRol } from "@/lib/permisos-shared";

describe("aritmética en centavos (sin punto flotante)", () => {
  it("convierte y formatea importes DECIMAL(14,2) sin perder centavos", () => {
    expect(aCentavos("0.10") + aCentavos("0.20")).toBe(BigInt(30)); // 0.1 + 0.2 en flotante da 0.30000000000000004
    expect(deCentavos(aCentavos("1234567890123.45"))).toBe("1234567890123.45");
    expect(deCentavos(aCentavos(null))).toBe("0.00");
    expect(deCentavos(aCentavos("-12.3"))).toBe("-12.30");
    expect(() => aCentavos("abc")).toThrow();
  });
  it("totales de un asiento y cuadre", () => {
    expect(totalizar([{ debe: "100.10", haber: "0" }, { debe: "0", haber: "100.10" }])).toMatchObject({ debe: "100.10", haber: "100.10", diferencia: "0.00", cuadra: true });
    expect(totalizar([{ debe: "10.00", haber: "0" }, { debe: "0", haber: "9.99" }])).toMatchObject({ diferencia: "0.01", cuadra: false });
  });
  it("saldo acumulado, saldos deudor/acreedor y totales del balance", () => {
    expect(conSaldoAcumulado([{ debe: "100.00", haber: "0.00" }, { debe: "0.00", haber: "130.50" }]).map((l) => l.saldo)).toEqual(["100.00", "-30.50"]);
    expect(saldosDeCuenta("100.00", "30.00")).toEqual({ saldoDeudor: "70.00", saldoAcreedor: "0.00" });
    expect(saldosDeCuenta("30.00", "100.00")).toEqual({ saldoDeudor: "0.00", saldoAcreedor: "70.00" });
    const t = totalesBalance([{ debito: "100.00", credito: "30.00", saldoDeudor: "70.00", saldoAcreedor: "0.00" }, { debito: "30.00", credito: "100.00", saldoDeudor: "0.00", saldoAcreedor: "70.00" }]);
    expect(t).toMatchObject({ totalDebe: "130.00", totalHaber: "130.00", diferencia: "0.00", cuadra: true });
  });
  it("fechas estrictas", () => {
    expect(fechaValida("2026-02-28")).toBe("2026-02-28");
    for (const f of ["2026-02-30", "26-01-01", "", null, undefined, "2026-13-01"]) expect(fechaValida(f as never)).toBeUndefined();
  });
});

describe("HTTP de reportes: permiso propio por reporte y ámbito", () => {
  const OK = { empresa: { id: 7 }, session: { id: 91, username: "conta", rol: "Contabilidad" } };
  const req = (qs: string) => new Request(`http://l/x?${qs}`);
  beforeEach(() => {
    vi.resetAllMocks();
    m.guard.mockResolvedValue(OK);
    m.diario.mockResolvedValue({ asientos: [] }); m.mayor.mockResolvedValue({ movimientos: [] }); m.balance.mockResolvedValue({ filas: [] });
  });
  it.each([["diario", "contabilidad_diario"], ["mayor", "contabilidad_mayor"], ["balance", "contabilidad_balance"]] as const)("%s exige la fila %s y no consulta sin permiso", async (tipo, fila) => {
    m.guard.mockResolvedValue({ error: new Response("{}", { status: 403 }) });
    expect((await reporteHttp(req("entidad=5&cuentaId=3"), "e", tipo)).status).toBe(403);
    expect(m.guard.mock.calls[0][1]).toBe(fila);
    for (const f of [m.diario, m.mayor, m.balance]) expect(f).not.toHaveBeenCalled();
  });
  it("la empresa sale de la sesión (nunca del cuerpo/URL) y la entidad del parámetro validado", async () => {
    const r = await reporteHttp(req("entidad=5&empresaId=99&desde=2026-01-01&hasta=2026-01-31&numero=A-1&page=2"), "e", "diario");
    expect(r.status).toBe(200);
    expect(m.diario).toHaveBeenCalledWith(7, 5, { desde: "2026-01-01", hasta: "2026-01-31", numero: "A-1", page: 2 });
    await reporteHttp(req("entidad=6&cuentaId=12&sinMovimiento=1"), "e", "mayor");
    expect(m.mayor).toHaveBeenCalledWith(7, 6, 12, { desde: undefined, hasta: undefined });
    await reporteHttp(req("entidad=6&sinMovimiento=1"), "e", "balance");
    expect(m.balance).toHaveBeenCalledWith(7, 6, { desde: undefined, hasta: undefined, incluirSinMovimiento: true });
  });
  it("entidad ausente/repetida/ inválida, fechas inválidas o invertidas y mayor sin cuenta → 400 sin consultar", async () => {
    for (const qs of ["", "entidad=5&entidad=6", "entidad=abc", "entidad=0", "entidad=5&desde=2026-02-30", "entidad=5&desde=2026-03-01&hasta=2026-02-01"]) {
      expect((await reporteHttp(req(qs), "e", "diario")).status, qs).toBe(400);
    }
    expect((await reporteHttp(req("entidad=5"), "e", "mayor")).status).toBe(400);
    expect(m.diario).not.toHaveBeenCalled(); expect(m.mayor).not.toHaveBeenCalled();
  });
  it("opciones: basta cualquiera de los tres permisos; sin ninguno, 403", async () => {
    m.guard.mockResolvedValueOnce({ error: new Response("{}", { status: 403 }) }).mockResolvedValueOnce({ error: new Response("{}", { status: 403 }) }).mockResolvedValueOnce(OK);
    m.query.mockResolvedValue([]);
    expect((await opcionesHttp(req(""), "e")).status).toBe(200);
    expect(m.guard.mock.calls.map((c) => c[1])).toEqual(["contabilidad_diario", "contabilidad_mayor", "contabilidad_balance"]);
    expect(String(m.query.mock.calls[0][0])).toContain("empresa_id = ?");
    expect(m.query.mock.calls[0][1]).toEqual([7]);
    m.guard.mockReset().mockResolvedValue({ error: new Response("{}", { status: 403 }) });
    expect((await opcionesHttp(req(""), "e")).status).toBe(403);
  });
  it("exporta Excel solo bajo demanda (formato=xlsx)", async () => {
    m.balance.mockResolvedValue({ entidad: { codigo: "MON", nombre: "Mónaco" }, desde: null, hasta: null, filas: [], totales: { totalDebe: "0.00", totalHaber: "0.00", diferencia: "0.00", totalSaldoDeudor: "0.00", totalSaldoAcreedor: "0.00" } });
    const r = await reporteHttp(req("entidad=5&formato=xlsx"), "e", "balance");
    expect(r.headers.get("content-type")).toContain("spreadsheetml");
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 2).toString()).toBe("PK");
  });
});

describe("Excel", () => {
  it("genera libros válidos para los tres reportes", async () => {
    const entidad = { codigo: "MON", nombre: "Mónaco" };
    const diario = { entidad, desde: null, hasta: null, page: 1, totalAsientos: 1, asientos: [{ numero: "A-1", fecha: "2026-01-10", glosa: "g", usuario: "u", totalDebe: "1.00", totalHaber: "1.00", cuadra: true, lineas: [{ codigo: "1101", cuenta: "Caja", debe: "1.00", haber: "0.00" }] }], totalesRango: { debe: "1.00", haber: "1.00", diferencia: "0.00" } };
    const mayor = { entidad, desde: null, hasta: null, nota: "n", cuenta: { codigo: "1101", nombre: "Caja" }, movimientos: [{ fecha: "2026-01-10", numero: "A-1", glosa: "g", debe: "1.00", haber: "0.00", saldo: "1.00" }], totales: { debe: "1.00", haber: "0.00", saldoFinal: "1.00" } };
    const balance = { entidad, desde: null, hasta: null, filas: [{ codigo: "1101", nombre: "Caja", debito: "1.00", credito: "0.00", saldoDeudor: "1.00", saldoAcreedor: "0.00" }], totales: { totalDebe: "1.00", totalHaber: "1.00", diferencia: "0.00", totalSaldoDeudor: "1.00", totalSaldoAcreedor: "1.00" } };
    for (const [t, d] of [["diario", diario], ["mayor", mayor], ["balance", balance]] as const) expect((await exportarXlsx(t, d)).subarray(0, 2).toString()).toBe("PK");
  });
});

describe("permisos del catálogo", () => {
  it("tres filas propias de Contabilidad, ningún rol las trae por defecto, ver Diario no concede Mayor ni Balance", () => {
    expect(PERMISOS_CONT_REPORTES).toEqual(["contabilidad_diario", "contabilidad_mayor", "contabilidad_balance"]);
    for (const p of PERMISOS_CONT_REPORTES) {
      expect(PLATAFORMA_PERMISIBLES).toContain(p);
      expect(moduloEmpresaDelPermiso(p)).toBe("contabilidad");
      for (const rol of ["Contabilidad", "Visualizador", "Facturacion"]) expect(modulosPropiosDelRol(rol as never)).not.toContain(p);
    }
    const ids = CATALOGO_PERMISOS.find((x) => x.id === "contabilidad")!.acciones.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["contabilidad_ver_diario", "contabilidad_ver_mayor", "contabilidad_ver_balance"]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("arquitectura: fuente única, solo lectura, Excel bajo demanda", () => {
  const dir = "src/lib/contabilidad/reportes";
  const fuentes = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.includes(".test."));
  it("fuente económica única, con metadatos de períodos; ninguna consulta escribe", () => {
    const src = readFileSync(`${dir}/reportes.ts`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).not.toMatch(/INSERT|UPDATE |DELETE|DROP|ALTER|TRUNCATE|FOR UPDATE/);
    expect(src).not.toMatch(/cxc|cxp|fact_|bancari|cont_eventos/i);
    expect(src).toContain("READ ONLY");
    expect(src.match(/FROM (cont_\w+)|JOIN (cont_\w+)/g)?.map((x) => x.split(" ")[1]).filter((v, i, a) => a.indexOf(v) === i).sort()).toEqual(["cont_asiento_detalle", "cont_asientos", "cont_cuentas", "cont_entidades", "cont_periodos"]);
    expect(src).toContain("estado = '${ESTADO}'");
  });
  it("todo SQL está acotado por empresa y entidad", () => {
    const src = readFileSync(`${dir}/reportes.ts`, "utf8");
    expect(src).toContain("${alias}.empresa_id = ?");
    expect(src).toContain("${alias}.entidad_id = ?");
    expect(src).toContain("FROM cont_entidades WHERE empresa_id = ? AND id = ?");
  });
  it("ExcelJS solo se importa en exportar.ts y se carga con import() dinámico", () => {
    for (const f of fuentes) if (f !== "exportar.ts") expect(readFileSync(`${dir}/${f}`, "utf8"), f).not.toMatch(/from "exceljs"/);
    expect(readFileSync(`${dir}/http.ts`, "utf8")).toContain('await import("./exportar")');
    expect(readFileSync("src/components/contabilidad/reportes-client.tsx", "utf8")).not.toMatch(/exceljs/i);
  });
  it("la página y el menú de Contabilidad", () => {
    expect(readFileSync("src/app/e/[slug]/contabilidad/layout.tsx", "utf8")).toContain("/contabilidad/reportes");
    const pagina = readFileSync("src/app/e/[slug]/contabilidad/reportes/page.tsx", "utf8");
    for (const fila of PERMISOS_CONT_REPORTES) expect(pagina).toContain(`p("${fila}")`);
  });
});
