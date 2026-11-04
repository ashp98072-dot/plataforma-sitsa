import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { estadoCuentaAExcel } from "./estado-cuenta-excel";
import {
  NOTA_MONEDA_ESTADO_CUENTA,
  ROTULO_ESTADO_CUENTA,
  claseDocumento,
  filtrosEstadoCuentaDesdeParams,
  saldoCrudo,
  type FilaEstadoCuenta,
  type RespuestaEstadoCuenta,
} from "./estado-cuenta-shared";
import { estadoCargaVacio, puedeExportarAntiguedad, reducirCargaAntiguedad } from "./antiguedad-shared";

const AHORA = new Date("2026-11-30T18:00:00Z"); // 2026-11-30 en Guatemala
const parse = (qs: string, permitirCorte = false) => filtrosEstadoCuentaDesdeParams(new URLSearchParams(qs), { permitirCorte, ahora: AHORA });
const BASE = { incluirPagadas: false, incluirAnuladas: false };

describe("MIL-CXP-02 · rótulo obligatorio y moneda", () => {
  it("el rótulo es EXACTAMENTE el aprobado", () => {
    expect(ROTULO_ESTADO_CUENTA).toBe("Estado de cuenta de documentos registrados en Novalvion. Saldos actuales, no históricos. No incluye necesariamente documentos pendientes de migración desde Milenium.");
  });
  it("la moneda se documenta como GTQ sin afirmar un dato por factura", () => {
    expect(NOTA_MONEDA_ESTADO_CUENTA).toMatch(/GTQ/);
    expect(NOTA_MONEDA_ESTADO_CUENTA).toMatch(/no guarda moneda por factura/);
  });
});

describe("MIL-CXP-02 · filtros estrictos", () => {
  it("acepta un filtro válido; por defecto solo abiertas (pagadas y anuladas desactivadas)", () => {
    expect(parse("entidad=5&proveedorId=3")).toEqual({ ok: true, filtros: { proveedorId: 3, ...BASE } });
    expect(parse("proveedorId=3&incluirPagadas=1&incluirAnuladas=1&desde=2026-01-01&hasta=2026-11-30&page=2&pageSize=100")).toEqual({
      ok: true, filtros: { proveedorId: 3, incluirPagadas: true, incluirAnuladas: true, desde: "2026-01-01", hasta: "2026-11-30", page: 2, pageSize: 100 },
    });
    expect(parse("proveedorId=3&incluirPagadas=0")).toEqual({ ok: true, filtros: { proveedorId: 3, ...BASE } });
  });
  it("el proveedor es OBLIGATORIO", () => {
    expect(parse("").ok).toBe(false);
    expect(parse("entidad=5").ok).toBe(false);
  });
  it("RECHAZA valores inválidos, vacíos, repetidos o fuera de rango (nunca se convierten en «todos»)", () => {
    const malos = [
      "proveedorId=0", "proveedorId=-1", "proveedorId=abc", "proveedorId=1.5", "proveedorId=99999999999", "proveedorId=", "proveedorId=1&proveedorId=2",
      "proveedorId=3&incluirPagadas=true", "proveedorId=3&incluirPagadas=2", "proveedorId=3&incluirPagadas=", "proveedorId=3&incluirAnuladas=si", "proveedorId=3&incluirAnuladas=1&incluirAnuladas=0",
      "proveedorId=3&desde=2026-02-30", "proveedorId=3&desde=30/11/2026", "proveedorId=3&hasta=x", "proveedorId=3&desde=", "proveedorId=3&desde=2026-11-30&hasta=2026-11-29",
      "proveedorId=3&page=0", "proveedorId=3&page=x", "proveedorId=3&page=1000001", "proveedorId=3&pageSize=0", "proveedorId=3&pageSize=101", "proveedorId=3&pageSize=",
    ];
    for (const qs of malos) {
      const r = parse(qs);
      expect(r.ok, qs).toBe(false);
      if (!r.ok) expect(r.error).toBeTruthy();
    }
  });
  it("un filtro inválido junto a uno válido tampoco pasa a medias; la empresa nunca se lee de la query", () => {
    expect(parse("proveedorId=3&incluirPagadas=1&hasta=zzz").ok).toBe(false);
    expect(parse("proveedorId=3&empresaId=9&empresa_id=9")).toEqual({ ok: true, filtros: { proveedorId: 3, ...BASE } });
  });
  it("«desde» = «hasta» es válido (rango de un día)", () => {
    expect(parse("proveedorId=3&desde=2026-11-30&hasta=2026-11-30").ok).toBe(true);
  });
  it("«corte»: solo al exportar, solo hoy o ayer (Guatemala), formato estricto", () => {
    expect(parse("proveedorId=3&corte=2026-11-30").ok).toBe(false);
    expect(parse("proveedorId=3&corte=2026-11-30", true)).toEqual({ ok: true, filtros: { proveedorId: 3, ...BASE }, corte: "2026-11-30" });
    expect(parse("proveedorId=3&corte=2026-11-29", true).ok).toBe(true);
    for (const c of ["2026-11-28", "2026-12-01", "2026-02-30", "30-11-2026", "", "x"]) expect(parse(`proveedorId=3&corte=${c}`, true).ok, c).toBe(false);
  });
});

describe("MIL-CXP-02 · saldos y clasificación (precisión decimal)", () => {
  it("saldoCrudo = monto pagadero − pagado, exacto; el negativo se conserva (sobreaplicación) para poder advertirlo", () => {
    expect(saldoCrudo("33412.50", "10000.00")).toBe("23412.50");
    expect(saldoCrudo("0.30", "0.10")).toBe("0.20");
    expect(saldoCrudo("999999999999.99", "0.01")).toBe("999999999999.98");
    expect(saldoCrudo("10.00", "12.50")).toBe("-2.50");
    expect(saldoCrudo("100.00", null)).toBe("100.00");
  });
  it("claseDocumento: abierta si pagadero > pagado; pagada si pagado ≥ pagadero (incluye exceso); anulada siempre anulada", () => {
    expect(claseDocumento("REGISTRADA", "100.00", "0.00")).toBe("ABIERTA");
    expect(claseDocumento("REGISTRADA", "100.00", "99.99")).toBe("ABIERTA");
    expect(claseDocumento("REGISTRADA", "100.00", "100.00")).toBe("PAGADA");
    expect(claseDocumento("REGISTRADA", "100.00", "100.01")).toBe("PAGADA");
    expect(claseDocumento("ANULADA", "100.00", "0.00")).toBe("ANULADA");
  });
});

const fila = (o: Partial<FilaEstadoCuenta> = {}): FilaEstadoCuenta => ({
  facturaId: 1, serie: "A", numero: "100", documento: "A-100", fechaDocumento: "2026-11-02", fechaVencimiento: "2026-12-02", diasDesdeDocumento: 28, diasVencidos: 0,
  situacion: "VIGENTE", estado: "ABIERTA", estadoFinanciero: "PARCIAL", totalDocumento: "35000.00", retencionIsr: "1587.50", montoPagadero: "33412.50", pagado: "10000.00",
  saldo: "23412.50", motivoAnulacion: null, ...o,
});
const respuesta = (filas: FilaEstadoCuenta[], over: Partial<RespuestaEstadoCuenta> = {}): RespuestaEstadoCuenta => ({
  proveedor: { id: 3, nombre: "Repuestos Uno", nit: "111-1", diasCredito: 30, regimenFiscal: "GENERAL", sujetoIsr: true },
  filtros: { incluirPagadas: true, incluirAnuladas: true, desde: null, hasta: null }, filas, totalReal: filas.length, page: 1, pageSize: 25, fechaCorte: "2026-11-30", moneda: "GTQ",
  totales: {
    registradas: { facturas: 1, totalDocumento: "35000.00", retencionIsr: "1587.50", montoPagadero: "33412.50", pagado: "10000.00", saldoExigible: "23412.50" },
    abiertas: { facturas: 1, saldo: "23412.50" }, pagadas: { facturas: 0 }, porSituacion: [{ situacion: "VIGENTE", facturas: 1, saldo: "23412.50" }],
    anuladas: { facturas: 1, totalDocumento: "300.00", retencionIsr: "0.00", montoPagadero: "300.00" },
  },
  advertencias: [], advertenciasOmitidas: 0, pagosVisibles: false, rotulo: ROTULO_ESTADO_CUENTA, notaMoneda: NOTA_MONEDA_ESTADO_CUENTA, ...over,
});

async function leer(buf: Buffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as never); return wb; }
const todoElTexto = (wb: ExcelJS.Workbook) => { const out: string[] = []; wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => out.push(String(c.value ?? ""))))); return out.join("\n"); };

describe("MIL-CXP-02 · Excel propio de Novalvion", () => {
  const pagos = [
    { pagoId: 7, fechaPago: "2026-11-10", medioPago: "MEDIO-SECRETO", referencia: "REF-SECRETA", monto: "10000.00", estado: "REGISTRADO" as const, vigente: true, reversadoEn: null, motivoReversion: null },
    { pagoId: 8, fechaPago: "2026-11-11", medioPago: "MEDIO-SECRETO", referencia: "REF-REVERSADA", monto: "500.00", estado: "REVERSADO" as const, vigente: false, reversadoEn: "2026-11-12 10:00:00", motivoReversion: "MOTIVO-SECRETO" },
  ];
  const anulada = fila({ facturaId: 2, numero: "101", documento: "A-101", estado: "ANULADA", estadoFinanciero: "ANULADA", situacion: null, diasVencidos: null, totalDocumento: "300.00", retencionIsr: "0.00", montoPagadero: "300.00", pagado: "0.00", saldo: "0.00", motivoAnulacion: "Duplicada" });

  it("con permiso de Pagos: hoja «Pagos» con vigentes y REVERSADOS (marcados como solo información)", async () => {
    const wb = await leer(await estadoCuentaAExcel(respuesta([fila({ pagos })], { pagosVisibles: true })));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Estado de cuenta", "Pagos", "Resumen"]);
    const wp = wb.getWorksheet("Pagos")!;
    expect([wp.getRow(2).getCell(6).value, wp.getRow(2).getCell(7).value]).toEqual(["Registrado", "Sí"]);
    expect([wp.getRow(3).getCell(6).value, wp.getRow(3).getCell(7).value, wp.getRow(3).getCell(9).value]).toEqual(["Reversado", "No (solo información)", "MOTIVO-SECRETO"]);
  });
  it("SIN permiso de Pagos: no hay hoja «Pagos» y NINGÚN dato de pagos se escribe, aunque el objeto los traiga (defensa en profundidad)", async () => {
    const wb = await leer(await estadoCuentaAExcel(respuesta([fila({ pagos })], { pagosVisibles: false })));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Estado de cuenta", "Resumen"]);
    const txt = todoElTexto(wb);
    for (const secreto of ["MEDIO-SECRETO", "REF-SECRETA", "REF-REVERSADA", "MOTIVO-SECRETO"]) expect(txt).not.toContain(secreto);
    expect(txt).toMatch(/requiere además el permiso de Pagos/);
  });
  it("anulada: estado «Anulada (importes informativos…)», saldo exigible 0.00 y sus importes NO entran a los totales registrados", async () => {
    const wb = await leer(await estadoCuentaAExcel(respuesta([fila(), anulada])));
    const ws = wb.getWorksheet("Estado de cuenta")!;
    const hdr = 8; // rótulo, nota, moneda, proveedor, corte, filtros, (vacía), encabezados
    expect(ws.getRow(hdr).getCell(1).value).toBe("Documento");
    const r = ws.getRow(hdr + 2);
    expect(r.getCell(1).value).toBe("A-101");
    expect(String(r.getCell(6).value)).toMatch(/^Anulada \(importes informativos/);
    expect([r.getCell(9).value, r.getCell(11).value, r.getCell(5).value]).toEqual([300, 0, "—"]);
    const res = wb.getWorksheet("Resumen")!;
    const filas: unknown[][] = []; res.eachRow((row) => filas.push(row.values as unknown[]));
    expect(filas.find((f) => f[1] === "Saldo exigible")![3]).toBe(23412.5);
    expect(filas.find((f) => f[1] === "Total del documento anulado")![3]).toBe(300);
  });
  it("incluye rótulo exacto, nota de saldo actual/no histórico, proveedor (solo datos registrados) y nunca datos bancarios", async () => {
    const wb = await leer(await estadoCuentaAExcel(respuesta([fila()], { proveedor: { id: 3, nombre: "Repuestos Uno", nit: null, diasCredito: null, regimenFiscal: null, sujetoIsr: null } })));
    const ws = wb.getWorksheet("Estado de cuenta")!;
    expect(ws.getRow(1).getCell(1).value).toBe(ROTULO_ESTADO_CUENTA);
    expect(String(ws.getRow(2).getCell(1).value)).toMatch(/ACTUALES/);
    expect(String(ws.getRow(2).getCell(1).value)).toMatch(/no representa un saldo histórico/);
    expect(ws.getRow(3).getCell(1).value).toBe(NOTA_MONEDA_ESTADO_CUENTA);
    expect(ws.getRow(4).getCell(1).value).toBe("Proveedor: Repuestos Uno"); // sin NIT/crédito/régimen si no hay datos registrados
    expect(todoElTexto(wb)).not.toMatch(/banco|cuenta bancaria|titular/i);
  });
  it("importes en el máximo de DECIMAL(14,2) y centavos: número EXACTO con formato; sumas de 16+ dígitos como TEXTO exacto", async () => {
    const casos = ["999999999999.99", "0.01", "0.30", "123456789012.34"];
    const filas = casos.map((v, i) => fila({ facturaId: i + 1, documento: `A-${i}`, montoPagadero: v, saldo: v }));
    const g = "19999999999999.80";
    const wb = await leer(await estadoCuentaAExcel(respuesta(filas, { totales: { ...respuesta([]).totales, registradas: { ...respuesta([]).totales.registradas, saldoExigible: g } } })));
    const ws = wb.getWorksheet("Estado de cuenta")!;
    casos.forEach((v, i) => {
      const c = ws.getRow(9 + i).getCell(11);
      expect(typeof c.value).toBe("number");
      expect((c.value as number).toFixed(2)).toBe(v);
      expect(c.numFmt).toBe("#,##0.00");
    });
    const res = wb.getWorksheet("Resumen")!;
    const f: unknown[][] = []; res.eachRow((row) => f.push(row.values as unknown[]));
    expect(f.find((x) => x[1] === "Saldo exigible")![3]).toBe(g);
  });
  it("advertencias de integridad visibles en «Resumen» (los importes originales no se tocan)", async () => {
    const wb = await leer(await estadoCuentaAExcel(respuesta([fila()], { advertencias: [{ codigo: "SOBREAPLICACION", facturaId: 1, mensaje: "exceso 10.00", detalle: {} }], advertenciasOmitidas: 3 })));
    const txt = todoElTexto(wb);
    expect(txt).toMatch(/ADVERTENCIAS DE INTEGRIDAD/);
    expect(txt).toMatch(/SOBREAPLICACION: exceso 10.00/);
    expect(txt).toMatch(/3 advertencia\(s\) más/);
  });
});

describe("MIL-CXP-02 · transición de recarga y arquitectura", () => {
  const lista = (m: string) => respuesta([fila()], { fechaCorte: m });
  const ini = estadoCargaVacio<RespuestaEstadoCuenta>();
  const red = reducirCargaAntiguedad<RespuestaEstadoCuenta>;
  it("no se exporta con una lista anterior (mismo reductor probado de MIL-CXP-01)", () => {
    const cargada = red(red(ini, { tipo: "SOLICITAR", clave: "k1" }), { tipo: "RESPUESTA", clave: "k1", lista: lista("A") });
    expect(puedeExportarAntiguedad(cargada)).toBe(true);
    const recargando = red(cargada, { tipo: "SOLICITAR", clave: "k2" });
    expect(recargando.lista).not.toBeNull();
    expect(puedeExportarAntiguedad(recargando)).toBe(false);
    expect(red(recargando, { tipo: "RESPUESTA", clave: "k1", lista: lista("vieja") })).toBe(recargando);
    expect(puedeExportarAntiguedad(red(recargando, { tipo: "RESPUESTA", clave: "k2", lista: lista("B") }))).toBe(true);
  });
  const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  it("el servicio nunca consulta datos bancarios ni de contacto del proveedor", () => {
    const src = sinComentarios(readFileSync("src/lib/contabilidad/cxp/estado-cuenta.ts", "utf8"));
    expect(src).not.toMatch(/\bbanco\b|numero_cuenta|tipo_cuenta|titular_cuenta|\bcorreo\b|telefono|contacto_/i);
    expect(src).toMatch(/SELECT id, nombre_comercial, nit, dias_credito FROM compras_proveedores/);
  });
  it("solo lectura: sin INSERT/UPDATE/DELETE/DDL y sin consultar cont_entidad_usuarios (política vigente, ticket #555)", () => {
    for (const f of ["estado-cuenta.ts", "estado-cuenta-shared.ts", "http-estado-cuenta.ts", "estado-cuenta-excel.ts"]) {
      const src = sinComentarios(readFileSync(`src/lib/contabilidad/cxp/${f}`, "utf8"));
      expect(src, f).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bALTER\b|\bCREATE\b/);
      expect(src, f).not.toMatch(/cont_entidad_usuarios/);
    }
  });
  it("las líneas de pago solo se consultan con verPagos; la instantánea es de solo lectura; los importes no pasan por Number", () => {
    const src = sinComentarios(readFileSync("src/lib/contabilidad/cxp/estado-cuenta.ts", "utf8"));
    expect(src).toMatch(/op\.verPagos \? \(conPagos \? await lineasDePagos/);
    expect(src).toMatch(/if \(conPagos && verPagos\)/);
    expect(readFileSync("src/lib/contabilidad/cxp/lectura-cxp.ts", "utf8")).toContain("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    for (const f of ["src/lib/contabilidad/cxp/estado-cuenta.ts", "src/components/contabilidad/cxp-estado-cuenta.tsx", "src/lib/contabilidad/cxp/estado-cuenta-excel.ts"]) {
      expect(sinComentarios(readFileSync(f, "utf8")), f).not.toMatch(/\bNumber\([^)]*(monto|total_documento|total_neto|isr_monto|saldo|pagado|pagadero|suma|exceso|importe)/i);
    }
  });
  it("cableado de la pantalla: exportar solo con lista vigente del proveedor aplicado; entidad remonta el componente; pestaña solo con permiso de facturas", () => {
    const ui = readFileSync("src/components/contabilidad/cxp-estado-cuenta.tsx", "utf8");
    expect(ui).toMatch(/const exportable = hayProveedor && puedeExportarAntiguedad\(carga\)/);
    expect(ui).toMatch(/disabled=\{!exportable \|\| exportando\}/);
    expect(ui).toMatch(/if \(!lista \|\| !exportable\) return/);
    const cli = readFileSync("src/components/contabilidad/cxp-client.tsx", "utf8");
    expect(cli).toMatch(/puedeVer && <button .*>Estado de cuenta<\/button>/);
    expect(cli).toContain("<CxpEstadoCuenta key={`e${entidadId}`}");
  });
});
