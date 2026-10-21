import { describe,it,expect } from "vitest";
import { readFileSync } from "fs";
import { confirmacionBancariaSchema,motivoBloqueoBancario,BLOQUEO_RETENCION,BLOQUEO_MONEDA } from "./confirmacion-bancaria-schema";
import { validarEvidenciaBancaria,MAX_EVIDENCIA_BANCARIA } from "./confirmacion-bancaria-evidencia";
import { huellaConfirmacion } from "./confirmaciones-bancarias";
const input={pagoId:null,cuentaBancariaId:1,monto:"4000",fechaAcreditacion:"2026-10-13",referencia:"REF",observaciones:null,idempotencyKey:"idempotencia-123456"};
describe("PR B contratos bancarios",()=>{
  it("normaliza monto/referencia sin orden JSON y conserva pago NULL",()=>{
    const a=confirmacionBancariaSchema.parse({...input,referencia:" REF "});
    expect(a.pagoId).toBeNull();
    expect(huellaConfirmacion(1,2,3,a,null)).toBe(huellaConfirmacion(1,2,3,{...input,monto:"4000.00"},null));
    expect(huellaConfirmacion(1,2,3,a,null)).not.toBe(huellaConfirmacion(1,2,3,{...a,pagoId:4},null));
  });
  it.each(["0","-1","1.234","NaN","1e4","1000000000000"])("rechaza monto %s",monto=>expect(confirmacionBancariaSchema.safeParse({...input,monto}).success).toBe(false));
  it("rechaza fecha inexistente, referencia vacía y payload con nombre/cuenta arbitraria",()=>{
    for(const delta of [{fechaAcreditacion:"2026-02-30"},{referencia:"  "},{cuenta:"123456"}]) expect(confirmacionBancariaSchema.safeParse({...input,...delta}).success).toBe(false);
  });
  const f={moneda:"GTQ",retencionPct:"0",retencionMonto:"0.00",estado:"Emitida",entidadId:2};
  it("GTQ sin retención habilitada; retención y moneda ajena bloqueadas",()=>{
    expect(motivoBloqueoBancario(f)).toBeNull();
    expect(motivoBloqueoBancario({...f,retencionPct:"15"})).toBe(BLOQUEO_RETENCION);
    expect(motivoBloqueoBancario({...f,retencionMonto:"1"})).toBe(BLOQUEO_RETENCION);
    expect(motivoBloqueoBancario({...f,moneda:"USD"})).toBe(BLOQUEO_MONEDA);
  });
  it.each([
    [Buffer.from("%PDF-1.7 fixture"),"e.pdf","application/pdf"],
    [Buffer.from([137,80,78,71,13,10,26,10,1]),"e.png","image/png"],
    [Buffer.from([255,216,255,224]),"e.jpeg","image/jpeg"],
  ])("evidencia válida %s", (b,n,m)=>expect(validarEvidenciaBancaria(b as Buffer,n as string,m as string).sha256).toHaveLength(64));
  it("rechaza MIME/extensión falsa, ejecutable, vacío y exceso",()=>{
    for(const [b,n,m] of [[Buffer.from("%PDF-1.7"),"e.png","image/png"],[Buffer.from("MZ"),"e.pdf","application/pdf"],[Buffer.alloc(0),"e.pdf","application/pdf"],[Buffer.alloc(MAX_EVIDENCIA_BANCARIA+1),"e.pdf","application/pdf"]]) expect(()=>validarEvidenciaBancaria(b as Buffer,n as string,m as string)).toThrow();
  });
  it("sin automatización ni modificación de pagos; permisos independientes sin legacy",()=>{
    const s=readFileSync("src/lib/facturacion/confirmaciones-bancarias.ts","utf8");
    expect(s).not.toMatch(/registrarAsientoTx|registrarEventoContableTx|COBRO_CONFIRMADO|INSERT INTO cont_|(?:INSERT INTO|UPDATE|DELETE FROM) fact_pagos/);
    const p=readFileSync("src/lib/permisos-catalogo.ts","utf8");
    for(const a of ["ver_confirmaciones_bancarias","confirmar_banco","anular_confirmacion"]) expect(p).toContain('accion("facturacion_'+a+'"');
    const ui=readFileSync("src/components/facturacion/confirmaciones-bancarias-panel.tsx","utf8");
    expect(ui).toContain("Pago informado no equivale");
    expect(ui).toContain("crypto.randomUUID()");
    expect(ui).not.toMatch(/localStorage|sessionStorage/);
  });
  it("DDL schema=migrate; preflight solo lectura; sin seeds ni ALTER",()=>{
    const m=readFileSync("sql/migrate-2026-10-confirmaciones-bancarias.sql","utf8").replaceAll("\r\n","\n");
    const ddl=m.slice(m.indexOf("CREATE TABLE"));
    expect(readFileSync("sql/schema.sql","utf8").replaceAll("\r\n","\n")).toContain(ddl.trim());
    const p=readFileSync("sql/preflight-2026-10-confirmaciones-bancarias.sql","utf8").replace(/--[^\n]*/g,"");
    for (const sentencia of p.split(";").map(s=>s.trim()).filter(Boolean)) expect(sentencia).toMatch(/^(SELECT|SHOW)\b/i);
    expect(m.replace(/--[^\n]*/g,"")).not.toMatch(/^\s*(?:ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
  });
});
