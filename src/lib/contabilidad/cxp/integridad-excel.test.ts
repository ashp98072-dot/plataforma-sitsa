import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { integridadAExcel, COLUMNAS_INTEGRIDAD_EXCEL, COLUMNAS_PAGO_INTEGRIDAD, textoSeguroIntegridad } from "./integridad-excel";
import { LIMITE_EXPORTACION_INTEGRIDAD } from "./integridad-shared";
import { datosExportacion } from "./__tests__/integridad-export-fixture";

const leer = async (b: Buffer) => { const w = new ExcelJS.Workbook(); await w.xlsx.load(b as never); return w; };
const textos = (w: ExcelJS.Workbook) => { const rows: string[] = []; w.eachSheet(s=>s.eachRow(r=>r.eachCell(c=>rows.push(String(c.value))))); return rows.join("\n"); };
describe("archivo Excel de integridad",()=>{
  it("libro vacío completo conserva encabezados, contadores, fecha UTC y limitaciones",async()=>{
    const d=datosExportacion({filas:[],totalAdvertencias:0,facturasConAnomalias:0,porCodigo:{SOBREAPLICACION:0}});
    const w=await leer(await integridadAExcel(d));expect(w.worksheets.map(s=>s.name)).toEqual(["Integridad CxP","Resumen"]);
    const s=w.getWorksheet("Integridad CxP")!;expect(s.rowCount).toBe(3);
    expect((s.getRow(3).values as string[]).slice(1)).toEqual(COLUMNAS_INTEGRIDAD_EXCEL);
    const txt=textos(w);expect(txt).toContain("2026-11-05T18:30:00.000Z");expect(txt).toContain("no certifica integridad");expect(txt).toContain("no se evalúa");
    expect(w.getWorksheet("Resumen")!.getRow(7).getCell(2).value).toBe(10);
  });
  it("más de una página y varias advertencias de una factura usan los contadores del conjunto",async()=>{
    const d=datosExportacion();d.filas=Array.from({length:30},()=>structuredClone(d.filas[0]));d.totalAdvertencias=30;d.porCodigo={SOBREAPLICACION:30};
    const w=await leer(await integridadAExcel(d));expect(w.getWorksheet("Integridad CxP")!.rowCount).toBe(33);
    expect(w.getWorksheet("Resumen")!.getRow(8).getCell(2).value).toBe(1);expect(w.getWorksheet("Resumen")!.getRow(9).getCell(2).value).toBe(30);
  });
  it("importes normales, DECIMAL(14,2) y sumas gigantes conservan centavos según helper existente",async()=>{
    const d=datosExportacion();d.filas[0].montoPagadero="999999999999.99";d.filas[0].pagado="19999999999999.80";
    const w=await leer(await integridadAExcel(d));const r=w.getWorksheet("Integridad CxP")!.getRow(4);
    expect(r.getCell(7).value).toBe(999999999999.99);expect(r.getCell(7).numFmt).toBe("#,##0.00");
    expect(r.getCell(8).value).toBe("19999999999999.80");expect(r.getCell(9).value).toBe(0.01);
    expect(r.getCell(9).numFmt).toBe("#,##0.00");
  });
  it("sin permiso no hay columnas, hojas, identificadores ni reversos de pagos accidentales",async()=>{
    const d=datosExportacion();d.filas[0].pago={id:98231,estado:"REVERSADO",montoTotal:"555.55",sumaAplicaciones:"444.44",montoAplicado:"333.33"};
    d.filas[0].advertencia.detalle={referencia:"REFERENCIA_PRIVADA"};
    const w=await leer(await integridadAExcel(d));expect(w.getWorksheet("Integridad CxP")!.columnCount).toBe(11);
    for(const secreto of ["98231","REVERSADO","REFERENCIA_PRIVADA","555.55","444.44","333.33","Pago ID"])expect(textos(w)).not.toContain(secreto);
  });
  it("con permiso agrega sólo columnas explícitas, sin inventar importes de factura en pago sin documento",async()=>{
    const d=datosExportacion({pagosVisibles:true,porCodigo:{PAGO_DESCUADRADO:1}});
    d.filas=[{...d.filas[0],facturaId:null,documento:null,estadoAdmin:null,montoPagadero:null,pagado:null,excesoAplicado:null,
      advertencia:{codigo:"PAGO_DESCUADRADO",pagoId:99,mensaje:"Pago descuadrado",detalle:{}},pago:{id:99,estado:"REVERSADO",montoTotal:"10.01",sumaAplicaciones:"0.00",montoAplicado:null}}];
    const w=await leer(await integridadAExcel(d));const s=w.getWorksheet("Integridad CxP")!;
    expect((s.getRow(3).values as string[]).slice(1)).toEqual([...COLUMNAS_INTEGRIDAD_EXCEL,...COLUMNAS_PAGO_INTEGRIDAD]);
    expect(s.getRow(4).getCell(2).value).toBe("");expect(s.getRow(4).getCell(7).value).toBe("");expect(s.getRow(4).getCell(12).value).toBe(99);
    expect(s.getRow(4).getCell(14).value).toBe(10.01);expect(s.getRow(4).getCell(14).numFmt).toBe("#,##0.00");
  });
  it.each(["=HYPERLINK(\"https://evil.test\",\"x\")","+SUM(1,2)","-1+2","@SUM(A1)"," \t=1+1","\r\n@x","\uFEFF=CMD()"])("neutraliza texto editable %j sin fórmulas ni hipervínculos",async payload=>{
    const d=datosExportacion();d.filas[0].documento=payload;d.filas[0].proveedor=payload;d.filas[0].advertencia.mensaje=payload;d.limitaciones=[payload];
    const w=await leer(await integridadAExcel(d));const row=w.getWorksheet("Integridad CxP")!.getRow(4);
    for(const index of [3,5,11])expect(row.getCell(index).value).toBe("'"+payload.replace(/\r\n/g,"\n"));
    w.eachSheet(s=>s.eachRow(r=>r.eachCell(c=>{expect(c.type).not.toBe(ExcelJS.ValueType.Formula);expect(c.type).not.toBe(ExcelJS.ValueType.Hyperlink);})));
  });
  it("texto normal y direcciones web permanecen texto plano",()=>{expect(textoSeguroIntegridad("QA-1")).toBe("QA-1");expect(textoSeguroIntegridad("https://example.test")).toBe("https://example.test");});
  it("rechaza conjunto truncado, excesivo, entidad mezclada o categorías/contadores no autorizados",async()=>{
    await expect(integridadAExcel(datosExportacion({totalAdvertencias:2}))).rejects.toThrow(/incompleto/);
    const grande=datosExportacion();grande.filas=Array(LIMITE_EXPORTACION_INTEGRIDAD+1).fill(grande.filas[0]);grande.totalAdvertencias=grande.filas.length;
    await expect(integridadAExcel(grande)).rejects.toThrow(/excesivo/);
    const ajena=datosExportacion();ajena.filas[0].entidadId=6;await expect(integridadAExcel(ajena)).rejects.toThrow(/no autorizado/);
    const pago=datosExportacion();pago.filas[0].advertencia.codigo="PAGO_DESCUADRADO";await expect(integridadAExcel(pago)).rejects.toThrow(/no autorizado/);
    await expect(integridadAExcel(datosExportacion({porCodigo:{PAGO_DESCUADRADO:1}}))).rejects.toThrow(/no autorizado/);
  });
  it("tablas ausentes se exportan como evaluación incompleta, no certificado",async()=>{
    const d=datosExportacion({filas:[],totalAdvertencias:0,pagosDisponibles:false,facturasRevisadas:0,porCodigo:{},limitaciones:["Tablas de pagos pendientes: evaluación incompleta"]});
    const w=await leer(await integridadAExcel(d));expect(textos(w)).toContain("evaluación incompleta");expect(w.getWorksheet("Resumen")!.getRow(7).getCell(2).value).toBe(0);
  });
});
