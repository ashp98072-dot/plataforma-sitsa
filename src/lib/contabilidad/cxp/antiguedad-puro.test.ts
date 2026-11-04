import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { antiguedadCxpAExcel } from "./antiguedad-excel";
import {
  ETIQUETA_SITUACION,
  ETIQUETA_TRAMO,
  estadoCargaInicial,
  filaExportacionCxp,
  filtrosAntiguedadCxpDesdeParams,
  paginacionCxp,
  puedeExportarAntiguedad,
  reducirCargaAntiguedad,
  saldoCxp,
  situacionVencimiento,
  tramoDe,
  type AccionCargaAntiguedad,
  type EstadoCargaAntiguedad,
  type FilaAntiguedadCxp,
  type RespuestaAntiguedadCxp,
} from "./antiguedad-shared";

const AHORA = new Date("2026-11-30T18:00:00Z"); // 2026-11-30 en Guatemala
const parse = (qs: string, permitirCorte = false) => filtrosAntiguedadCxpDesdeParams(new URLSearchParams(qs), { permitirCorte, ahora: AHORA });

describe("MIL-CXP-01 · situación de vencimiento (nunca se inventa)", () => {
  it("sin fecha de vencimiento → SIN_VENCIMIENTO (ni vigente ni vencida)", () => {
    expect(situacionVencimiento(null, "2026-11-30")).toBe("SIN_VENCIMIENTO");
  });
  it("vencida solo si el vencimiento es ANTERIOR al corte; el propio día aún no está vencida", () => {
    expect(situacionVencimiento("2026-11-29", "2026-11-30")).toBe("VENCIDA");
    expect(situacionVencimiento("2026-11-30", "2026-11-30")).toBe("VIGENTE");
    expect(situacionVencimiento("2026-12-01", "2026-11-30")).toBe("VIGENTE");
  });
  it("las etiquetas no hablan de «mora» ni de «cartera legal»", () => {
    expect(Object.values(ETIQUETA_SITUACION).join(" ")).not.toMatch(/mora|legal/i);
  });
});

describe("MIL-CXP-01 · filtros estrictos", () => {
  it("acepta proveedor, tramo, situación y paginación válidos; ignora `entidad` (lo valida el ámbito contable)", () => {
    expect(parse("entidad=5&proveedorId=3&tramo=31-60&situacion=VENCIDA&page=2&pageSize=100")).toEqual({
      ok: true, filtros: { proveedorId: 3, tramo: "31-60", situacion: "VENCIDA", page: 2, pageSize: 100 },
    });
    expect(parse("entidad=5")).toEqual({ ok: true, filtros: {} });
  });
  it("RECHAZA valores explícitos inválidos, vacíos o repetidos: nunca los convierte en «todos»", () => {
    const malos = [
      "proveedorId=0", "proveedorId=-1", "proveedorId=abc", "proveedorId=1.5", "proveedorId=99999999999", "proveedorId=", "proveedorId=1&proveedorId=2",
      "tramo=x", "tramo=0-15x", "tramo=", "tramo=0-15&tramo=90%2B",
      "situacion=vencida", "situacion=MORA", "situacion=",
      "page=0", "page=x", "page=1000001", "page=", "pageSize=0", "pageSize=101", "pageSize=x", "pageSize=",
    ];
    for (const qs of malos) {
      const r = parse(qs);
      expect(r.ok, qs).toBe(false);
      if (!r.ok) expect(r.error).toBeTruthy();
    }
  });
  it("un filtro inválido junto a uno válido tampoco pasa a medias; la empresa nunca se lee de la query", () => {
    expect(parse("tramo=0-15&proveedorId=abc").ok).toBe(false);
    expect(parse("empresaId=9&empresa_id=9")).toEqual({ ok: true, filtros: {} });
  });
  it("«corte»: solo al exportar, solo hoy o ayer (Guatemala), formato estricto", () => {
    expect(parse("corte=2026-11-30").ok).toBe(false);
    expect(parse("corte=2026-11-30", true)).toEqual({ ok: true, filtros: {}, corte: "2026-11-30" });
    expect(parse("corte=2026-11-29", true)).toEqual({ ok: true, filtros: {}, corte: "2026-11-29" });
    for (const c of ["2026-11-28", "2026-12-01", "2026-02-30", "30-11-2026", "", "x"]) expect(parse(`corte=${c}`, true).ok, c).toBe(false);
  });
  it("paginación acotada", () => {
    expect(paginacionCxp({})).toEqual({ page: 1, pageSize: 25, offset: 0 });
    expect(paginacionCxp({ page: 3, pageSize: 1000 })).toEqual({ page: 3, pageSize: 100, offset: 200 });
  });
});

describe("MIL-CXP-01 · saldo exacto y tramos", () => {
  it("saldo = monto pagadero − pagado, con Decimal (sin deriva de coma flotante)", () => {
    expect(saldoCxp("33412.50", "10000.00")).toBe("23412.50");
    expect(saldoCxp("0.30", "0.10")).toBe("0.20");
    expect(saldoCxp("999999999999.99", "0.01")).toBe("999999999999.98");
    expect(saldoCxp("100.00", null)).toBe("100.00");
  });
  it("tramos desde el documento (mismas fronteras que CxC): 15/16, 30/31, 60/61, 90/91", () => {
    expect([15, 16, 30, 31, 60, 61, 90, 91].map(tramoDe)).toEqual(["0-15", "16-30", "16-30", "31-60", "31-60", "61-90", "61-90", "90+"]);
  });
});

const fila = (o: Partial<FilaAntiguedadCxp> = {}): FilaAntiguedadCxp => ({
  facturaId: 1, proveedorId: 3, proveedor: "Repuestos Uno", serie: "A", numero: "100", fechaDocumento: "2026-11-02", fechaVencimiento: "2026-12-02",
  diasDesdeDocumento: 28, diasVencidos: 0, situacion: "VIGENTE", totalDocumento: "35000.00", retencionIsr: "1587.50", montoPagadero: "33412.50",
  pagado: "10000.00", saldo: "23412.50", tramo: "16-30", ...o,
});

describe("MIL-CXP-01 · exportación", () => {
  it("fila: columnas y orden; sin vencimiento deja vacíos el vencimiento y los días vencidos", () => {
    expect(filaExportacionCxp(fila(), (t) => ETIQUETA_TRAMO[t])).toEqual([
      "Repuestos Uno", "A-100", "2026-11-02", "28", "16–30 días", "2026-12-02", "0", "Vigente (no vencida)", "35000.00", "1587.50", "33412.50", "10000.00", "23412.50",
    ]);
    const sin = filaExportacionCxp(fila({ fechaVencimiento: null, diasVencidos: null, situacion: "SIN_VENCIMIENTO" }), (t) => ETIQUETA_TRAMO[t]);
    expect([sin[5], sin[6], sin[7]]).toEqual(["", "", "Sin vencimiento"]);
  });

  async function leer(buf: Buffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as never); return wb; }

  it("Excel: importes en el máximo de DECIMAL(14,2) y centavos = número EXACTO con formato; días como número; vacío si no hay vencimiento", async () => {
    const casos = ["999999999999.99", "0.01", "0.30", "123456789012.34"];
    const filas = casos.map((v, i) => fila({ facturaId: i + 1, numero: String(i), montoPagadero: v, saldo: v }));
    filas.push(fila({ facturaId: 99, numero: "sv", fechaVencimiento: null, diasVencidos: null, situacion: "SIN_VENCIMIENTO" }));
    const wb = await leer(await antiguedadCxpAExcel(filas, [], [], "0.00", "2026-11-30"));
    const ws = wb.getWorksheet("Antigüedad CxP")!;
    casos.forEach((v, i) => {
      const c = ws.getRow(5 + i).getCell(13);
      expect(typeof c.value).toBe("number");
      expect((c.value as number).toFixed(2)).toBe(v);
      expect(c.numFmt).toBe("#,##0.00");
      expect(ws.getRow(5 + i).getCell(4).value).toBe(28);
    });
    const sv = ws.getRow(5 + casos.length);
    expect([sv.getCell(6).value, sv.getCell(7).value, sv.getCell(8).value]).toEqual(["", "", "Sin vencimiento"]);
  });
  it("Excel: sumas de 16+ dígitos van como TEXTO exacto (nunca redondeadas); nota de saldo actual y corte no histórico", async () => {
    const g = "19999999999999.80";
    const wb = await leer(await antiguedadCxpAExcel([fila({ saldo: g, montoPagadero: g })], [{ tramo: "16-30", facturas: 20, saldo: g }], [{ situacion: "VIGENTE", facturas: 20, saldo: g }], g, "2026-11-29"));
    expect(wb.getWorksheet("Antigüedad CxP")!.getRow(5).getCell(13).value).toBe(g);
    const t = wb.getWorksheet("Totales")!;
    expect([t.getRow(2).getCell(3).value, t.getRow(5).getCell(3).value]).toEqual([g, g]);
    const ws = wb.getWorksheet("Antigüedad CxP")!;
    expect(String(ws.getRow(2).getCell(1).value)).toMatch(/ACTUALES/);
    expect(String(ws.getRow(2).getCell(1).value)).toMatch(/no representa un saldo histórico/);
    expect(ws.getRow(3).getCell(1).value).toBe("Fecha de corte: 2026-11-29");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
const listaDe = (marca: string): RespuestaAntiguedadCxp => ({
  filas: [], totalReal: 0, page: 1, pageSize: 25, fechaCorte: marca, moneda: "GTQ", totalesPorTramo: [], totalesPorSituacion: [], saldoTotal: "0.00", rotulo: "r",
});
const aplicar = (acciones: AccionCargaAntiguedad[], desde: EstadoCargaAntiguedad = estadoCargaInicial) => acciones.reduce(reducirCargaAntiguedad, desde);
const K1 = '["5",{"proveedorId":"","tramo":"","situacion":""},1]';
const K2 = '["5",{"proveedorId":"3","tramo":"","situacion":""},1]'; // cambio de filtros
const K3 = '["5",{"proveedorId":"3","tramo":"","situacion":""},2]'; // cambio de página
const K4 = '["6",{"proveedorId":"","tramo":"","situacion":""},1]'; // cambio de entidad

describe("MIL-CXP-01 · transición de recarga: no se exporta con una lista anterior", () => {
  it("sin lista cargada no se puede exportar; durante la primera carga tampoco", () => {
    expect(puedeExportarAntiguedad(estadoCargaInicial)).toBe(false);
    expect(puedeExportarAntiguedad(aplicar([{ tipo: "SOLICITAR", clave: K1 }]))).toBe(false);
  });
  it("lista cargada de la solicitud vigente → se puede exportar", () => {
    expect(puedeExportarAntiguedad(aplicar([{ tipo: "SOLICITAR", clave: K1 }, { tipo: "RESPUESTA", clave: K1, lista: listaDe("A") }]))).toBe(true);
  });
  it.each([["filtros", K2], ["página", K3], ["entidad", K4]])("al recargar por cambio de %s la lista anterior sigue visible pero la exportación se BLOQUEA hasta que llegue la nueva", (_n, k) => {
    const cargada = aplicar([{ tipo: "SOLICITAR", clave: K1 }, { tipo: "RESPUESTA", clave: K1, lista: listaDe("A") }]);
    expect(puedeExportarAntiguedad(cargada)).toBe(true);
    const recargando = aplicar([{ tipo: "SOLICITAR", clave: k }], cargada);
    expect(recargando.lista).not.toBeNull(); // no parpadea
    expect(recargando.cargando).toBe(true);
    expect(puedeExportarAntiguedad(recargando)).toBe(false); // la lista anterior NO es exportable
    const nueva = aplicar([{ tipo: "RESPUESTA", clave: k, lista: listaDe("B") }], recargando);
    expect(puedeExportarAntiguedad(nueva)).toBe(true);
    expect(nueva.lista?.fechaCorte).toBe("B");
  });
  it("respuestas fuera de orden: una respuesta tardía de una solicitud superada se descarta y no habilita la exportación", () => {
    const e = aplicar([{ tipo: "SOLICITAR", clave: K1 }, { tipo: "SOLICITAR", clave: K2 }, { tipo: "SOLICITAR", clave: K3 }]);
    const tarde = aplicar([{ tipo: "RESPUESTA", clave: K2, lista: listaDe("vieja") }], e);
    expect(tarde).toBe(e); // ignorada: mismo estado
    expect(puedeExportarAntiguedad(tarde)).toBe(false);
    const ok = aplicar([{ tipo: "RESPUESTA", clave: K3, lista: listaDe("vigente") }], tarde);
    expect(puedeExportarAntiguedad(ok)).toBe(true);
    // una respuesta vieja que llega DESPUÉS de la vigente tampoco pisa la lista
    const despues = aplicar([{ tipo: "RESPUESTA", clave: K1, lista: listaDe("muy vieja") }], ok);
    expect(despues).toBe(ok);
    expect(despues.lista?.fechaCorte).toBe("vigente");
  });
  it("fallo de la solicitud vigente: sin lista, con error y sin exportar; un fallo de una solicitud superada se ignora", () => {
    const cargada = aplicar([{ tipo: "SOLICITAR", clave: K1 }, { tipo: "RESPUESTA", clave: K1, lista: listaDe("A") }, { tipo: "SOLICITAR", clave: K2 }]);
    expect(aplicar([{ tipo: "FALLO", clave: K1, error: "viejo" }], cargada)).toBe(cargada);
    const fallo = aplicar([{ tipo: "FALLO", clave: K2, error: "No se pudo cargar el reporte." }], cargada);
    expect(fallo).toMatchObject({ lista: null, claveLista: null, cargando: false, error: "No se pudo cargar el reporte." });
    expect(puedeExportarAntiguedad(fallo)).toBe(false);
    expect(aplicar([{ tipo: "SOLICITAR", clave: K2 }], fallo).error).toBe(""); // reintentar limpia el error
  });
  it("cableado de la pantalla: el botón y descargar() usan puedeExportarAntiguedad; la entidad remonta el componente; la clave incluye entidad, filtros y página", () => {
    const ui = readFileSync("src/components/contabilidad/cxp-antiguedad.tsx", "utf8");
    expect(ui).toContain("useReducer(reducirCargaAntiguedad, estadoCargaInicial)");
    expect(ui).toMatch(/disabled=\{!puedeExportarAntiguedad\(carga\) \|\| exportando\}/);
    expect(ui).toMatch(/if \(!lista \|\| !puedeExportarAntiguedad\(carga\)\) return/);
    expect(ui).toContain("JSON.stringify([entidadId, aplicados, page])");
    expect(ui).toContain('dispatch({ tipo: "SOLICITAR", clave })');
    expect(ui).toContain('dispatch({ tipo: "RESPUESTA", clave, lista:');
    expect(readFileSync("src/components/contabilidad/cxp-client.tsx", "utf8")).toContain("<CxpAntiguedad key={" + String.fromCharCode(96) + "a");
  });
});
