import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("@/lib/permisos", async original => ({ ...(await original<typeof import("@/lib/permisos")>()), permisosEfectivos: vi.fn() }));
const m=vi.hoisted(()=>({obtener:vi.fn()}));
vi.mock("./integridad",()=>({obtenerIntegridadCxp:m.obtener}));
import { getSession } from "@/lib/session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import { ErrorCxp } from "./errores";
import { GET } from "@/app/api/empresas/[slug]/contabilidad/cxp/integridad/route";

const empresa={id:7,slug:"qa",nombre:"QA",activa:true,modulos:["contabilidad"]};
const permiso=(modulo:string)=>({modulo,puedeVer:true,puedeCrear:false,puedeEditar:false,puedeEliminar:false});
const ctx={params:Promise.resolve({slug:"qa"})};
const request=(qs="entidad=5")=>new Request(`http://qa/integridad?${qs}`);
beforeEach(()=>{
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({id:3,rol:"Contabilidad",username:"qa",empresaId:7} as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue([permiso("cxp_facturas")] as never);
  m.obtener.mockResolvedValue({entidadId:5,filas:[],totalAdvertencias:0,pagosVisibles:false});
});

describe("GET Integridad con guard real, empresa y permisos simulados",()=>{
  it("sólo facturas entrega verPagos=false decidido por servidor y respuesta privada",async()=>{
    const r=await GET(request(),ctx);expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(m.obtener).toHaveBeenCalledWith(7,5,{}, {verPagos:false});
  });
  it("permiso de pagos y Admin habilitan sólo su opción en el servidor",async()=>{
    vi.mocked(permisosEfectivos).mockResolvedValue([permiso("cxp_facturas"),permiso("cxp_pagos")] as never);
    expect((await GET(request(),ctx)).status).toBe(200);expect(m.obtener).toHaveBeenLastCalledWith(7,5,{}, {verPagos:true});
    vi.mocked(getSession).mockResolvedValue({id:1,rol:"Admin",username:"qa",empresaId:7} as never);
    await GET(request(),ctx);expect(m.obtener).toHaveBeenLastCalledWith(7,5,{}, {verPagos:true});
  });
  it("sin permiso de facturas, aunque tenga pagos, deniega antes de validar filtros",async()=>{
    for(const permisos of [[],[permiso("cxp_pagos")],[permiso("cxp_bitacora")]]){
      vi.mocked(permisosEfectivos).mockResolvedValue(permisos as never);
      expect((await GET(request("entidad=abc&codigo=NO"),ctx)).status).toBe(403);
    }
    expect(m.obtener).not.toHaveBeenCalled();
  });
  it("sin sesión, empresa ajena o módulo no autorizado nunca llama al servicio",async()=>{
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({...empresa,modulos:["rrhh"]} as never);
    expect((await GET(request(),ctx)).status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
    vi.mocked(getSession).mockResolvedValue({id:1,rol:"Admin",username:"qa",empresaId:7} as never);
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);expect((await GET(request(),ctx)).status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null);expect((await GET(request(),ctx)).status).toBeGreaterThanOrEqual(401);
    expect(m.obtener).not.toHaveBeenCalled();
  });
  it.each(["", "entidad=", "entidad=0", "entidad=x", "entidad=1&entidad=2", "entidad=2147483648", "entidad=5&proveedorId=", "entidad=5&proveedorId=1&proveedorId=2", "entidad=5&codigo=NO", "entidad=5&estado=PAGADA", "entidad=5&page=0", "entidad=5&pageSize=101", "entidad=5&empresaId=999", "entidad=5&verPagos=true"])("entrada inválida %s -> 400 antes de DB",async qs=>{
    expect((await GET(request(qs),ctx)).status).toBe(400);expect(m.obtener).not.toHaveBeenCalled();
  });
  it("filtros y paginación válidos se pasan sin aceptar empresa/usuario del cliente",async()=>{
    await GET(request("entidad=6&proveedorId=3&codigo=SOBREAPLICACION&estado=ANULADA&page=2&pageSize=1"),ctx);
    expect(m.obtener).toHaveBeenCalledWith(7,6,{proveedorId:3,codigo:"SOBREAPLICACION",estado:"ANULADA",page:2,pageSize:1},{verPagos:false});
  });
  it("dominio conserva 403/404/422; migración pendiente es 503; SQL inesperado es genérico",async()=>{
    for(const status of [403,404,422]){
      m.obtener.mockRejectedValueOnce(new ErrorCxp("Revisión requerida",status,"CONTROLADO"));
      expect((await GET(request(),ctx)).status).toBe(status);
    }
    for(const code of ["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"]){
      m.obtener.mockRejectedValueOnce({code,sqlMessage:"SQL PRIVADO"});const r=await GET(request(),ctx);
      expect(r.status).toBe(503);expect(await r.json()).toMatchObject({codigo:"MIGRACION_PENDIENTE"});
    }
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    try {
      m.obtener.mockRejectedValueOnce({code:"ER_PARSE_ERROR",sqlMessage:"SELECT dato_secreto"});const r=await GET(request(),ctx);
      expect(r.status).toBe(500);expect(JSON.stringify(await r.json())).not.toContain("dato_secreto");
      expect(log).toHaveBeenCalledWith("[cxp-integridad]",{code:"ER_PARSE_ERROR"});
    } finally {log.mockRestore();}
  });
});
