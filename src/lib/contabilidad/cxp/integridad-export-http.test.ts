import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session",()=>({getSession:vi.fn(),createSessionToken:vi.fn(),setSessionCookie:vi.fn()}));
vi.mock("@/lib/empresas",()=>({obtenerEmpresaPorSlug:vi.fn(),empresasParaUsuario:vi.fn()}));
vi.mock("@/lib/permisos",async original=>({...await original<typeof import("@/lib/permisos")>(),permisosEfectivos:vi.fn()}));
const m=vi.hoisted(()=>({exportar:vi.fn()}));
vi.mock("./integridad",()=>({exportarIntegridadCxp:m.exportar,obtenerIntegridadCxp:vi.fn()}));
import { getSession } from "@/lib/session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import { ErrorCxp } from "./errores";
import * as route from "@/app/api/empresas/[slug]/contabilidad/cxp/integridad/export/route";
import { datosExportacion } from "./__tests__/integridad-export-fixture";

const empresa={id:7,slug:"qa",nombre:"QA",activa:true,modulos:["contabilidad"]};
const permiso=(modulo:string)=>({modulo,puedeVer:true,puedeCrear:false,puedeEditar:false,puedeEliminar:false});
const ctx={params:Promise.resolve({slug:"qa"})};
const request=(qs="entidad=5")=>new Request(`http://qa/integridad/export?${qs}`);
const leer=async(r:Response)=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Buffer.from(await r.arrayBuffer()) as never);return w;};
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(getSession).mockResolvedValue({id:3,rol:"Contabilidad",username:"qa",empresaId:7} as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue([permiso("cxp_facturas")] as never);
  m.exportar.mockImplementation(async(_empresa:number,entidadId:number,filtros:object,op:{verPagos:boolean})=>{
    const d=datosExportacion({entidadId,filtros,pagosVisibles:op.verPagos});d.filas[0].entidadId=entidadId;return d;
  });
});

describe("GET Excel Integridad: guard real y archivo real con servicio simulado",()=>{
  it("sólo GET; cabeceras privadas, nombre seguro, dos hojas y sin columnas de pagos",async()=>{
    expect(Object.keys(route)).toEqual(["GET"]);
    const r=await route.GET(request(),ctx);expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="cxp-integridad-entidad-5-2026-11-05.xlsx"');
    const w=await leer(r);expect(w.worksheets.map(s=>s.name)).toEqual(["Integridad CxP","Resumen"]);expect(w.worksheets[0].columnCount).toBe(11);
    expect(m.exportar).toHaveBeenCalledWith(7,5,{}, {verPagos:false});
  });
  it("permiso de pagos y Admin habilitan columnas; se reevalúan al exportar",async()=>{
    vi.mocked(permisosEfectivos).mockResolvedValue([permiso("cxp_facturas"),permiso("cxp_pagos")] as never);
    expect((await leer(await route.GET(request(),ctx))).worksheets[0].columnCount).toBe(16);
    expect(m.exportar).toHaveBeenLastCalledWith(7,5,{}, {verPagos:true});
    vi.mocked(permisosEfectivos).mockResolvedValue([permiso("cxp_facturas")] as never);
    expect((await leer(await route.GET(request(),ctx))).worksheets[0].columnCount).toBe(11);
    vi.mocked(getSession).mockResolvedValue({id:1,rol:"Admin",username:"qa",empresaId:7} as never);
    expect((await route.GET(request(),ctx)).status).toBe(200);expect(m.exportar).toHaveBeenLastCalledWith(7,5,{}, {verPagos:true});
  });
  it("sin permiso de facturas, con sólo pagos o sin sesión no genera libro",async()=>{
    for(const permisos of [[],[permiso("cxp_pagos")]]){
      vi.mocked(permisosEfectivos).mockResolvedValue(permisos as never);const r=await route.GET(request("entidad=abc"),ctx);expect(r.status).toBe(403);expect(r.headers.get("cache-control")).toBe("private, no-store");
    }
    vi.mocked(getSession).mockResolvedValue(null);expect((await route.GET(request(),ctx)).status).toBeGreaterThanOrEqual(401);expect(m.exportar).not.toHaveBeenCalled();
  });
  it("empresa ajena o módulo no autorizado no llegan al servicio",async()=>{
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({...empresa,modulos:["rrhh"]} as never);expect((await route.GET(request(),ctx)).status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);vi.mocked(getSession).mockResolvedValue({id:1,rol:"Admin",username:"qa",empresaId:7} as never);
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);expect((await route.GET(request(),ctx)).status).toBe(403);expect(m.exportar).not.toHaveBeenCalled();
  });
  it.each(["", "entidad=", "entidad=1&entidad=2", "entidad=2147483648", "entidad=5&empresaId=999", "entidad=5&usuario=1", "entidad=5&verPagos=true", "entidad=5&page=1", "entidad=5&pageSize=25", "entidad=5&codigo=NO", "entidad=5&estado=PAGADA", "entidad=5&proveedorId=", "entidad=5&proveedorId=1&proveedorId=2"])("%s: 400 JSON sin archivo",async qs=>{
    const r=await route.GET(request(qs),ctx);expect(r.status).toBe(400);expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("content-type")).not.toContain("spreadsheet");expect(m.exportar).not.toHaveBeenCalled();
  });
  it("filtros autorizados se pasan sin paginación y se reflejan en el resumen del archivo",async()=>{
    const r=await route.GET(request("entidad=6&proveedorId=3&codigo=SOBREAPLICACION&estado=ANULADA"),ctx);expect(r.status).toBe(200);
    expect(m.exportar).toHaveBeenCalledWith(7,6,{proveedorId:3,codigo:"SOBREAPLICACION",estado:"ANULADA"},{verPagos:false});
    const w=await leer(r);const s=w.getWorksheet("Resumen")!;expect(s.getRow(2).getCell(2).value).toBe(6);expect(s.getRow(3).getCell(2).value).toBe(3);expect(s.getRow(5).getCell(2).value).toBe("ANULADA");
  });
  it.each([[403,"SIN_PERMISO_PAGOS"],[404,"ENTIDAD_NO_DISPONIBLE"],[404,"PROVEEDOR_NO_DISPONIBLE"],[422,"ANOMALIA_NO_EVALUABLE"],[422,"LIMITE_EXPORTACION"],[409,"EXPORTACION_INCONSISTENTE"]])("error %s/%s devuelve JSON controlado, nunca archivo parcial",async(status,codigo)=>{
    m.exportar.mockRejectedValueOnce(new ErrorCxp("Reduce los filtros o revisa el ámbito.",status,codigo));const r=await route.GET(request(),ctx);
    expect(r.status).toBe(status);expect(await r.json()).toMatchObject({codigo});expect(r.headers.get("content-disposition")).toBeNull();expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("migraciones pendientes y SQL inesperado no revelan detalles ni generan archivo",async()=>{
    m.exportar.mockRejectedValueOnce({code:"ER_NO_SUCH_TABLE",sqlMessage:"SELECT secreto"});const m1=await route.GET(request(),ctx);expect(m1.status).toBe(503);expect(await m1.json()).toMatchObject({codigo:"MIGRACION_PENDIENTE"});
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    try {m.exportar.mockRejectedValueOnce({code:"ER_PARSE_ERROR",sqlMessage:"SQL secreto"});const r=await route.GET(request(),ctx);expect(r.status).toBe(500);expect(JSON.stringify(await r.json())).not.toContain("secreto");expect(r.headers.get("content-disposition")).toBeNull();}
    finally {log.mockRestore();}
  });
});
