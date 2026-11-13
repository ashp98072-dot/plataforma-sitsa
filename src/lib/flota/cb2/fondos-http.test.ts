import { beforeEach,it,expect,vi } from "vitest";
const m=vi.hoisted(()=>({guard:vi.fn(),consultar:vi.fn(),vincular:vi.fn()}));
vi.mock("@/lib/tenant",()=>({requireTenantFlotaCombustible:m.guard}));
vi.mock("./fondos",async original=>({...await original<typeof import("./fondos")>(),consultarFondoCB2:m.consultar,vincularFondoCB2:m.vincular}));
import { cb2Http } from "./http";
const body={proveedorId:3,consumoId:5,lineaId:7,revision:0,motivo:"Revision manual de diferencias",confirmado:true};
const req=(origin="http://localhost",extra={})=>new Request("http://localhost/fondos",{method:"POST",headers:{Origin:origin},body:JSON.stringify({...body,...extra})});
beforeEach(()=>{m.guard.mockResolvedValue({empresa:{id:11},session:{id:22,username:"Operador",rol:"JefeOperaciones"}});m.vincular.mockResolvedValue({estado:"VINCULADO_MANUAL"});m.consultar.mockResolvedValue({estado:"SIN_CONCILIAR",items:[],vinculo:null});});
it("permiso conciliar sin exigir administrador, tenant del servidor y confirmacion explicita",async()=>{
 const r=await cb2Http(req(),"demo","vincular-fondo");expect(r.status).toBe(200);expect(m.guard).toHaveBeenCalledWith("demo","conciliar",{soloLectura:false});
 expect(m.vincular).toHaveBeenCalledWith(expect.objectContaining({empresaId:11,proveedorId:3,actor:{id:22,username:"Operador"}}),body);
 for(const extra of [{confirmado:false},{empresaId:99},{lineaId:0}])expect((await cb2Http(req("http://localhost",extra),"demo","vincular-fondo")).status).toBe(400);
 expect(m.vincular).toHaveBeenCalledTimes(1);
});
it("consulta paginada por consumo y origen/permisos bloquean escritura",async()=>{
 const r=await cb2Http(new Request("http://localhost/fondos?proveedorId=3&consumoId=5&buscar=ABC"),"demo","fondos");expect(r.status).toBe(200);expect(m.consultar).toHaveBeenCalledWith(11,3,5,"ABC");expect(r.headers.get("cache-control")).toContain("no-store");
 expect((await cb2Http(req("https://otro.test"),"demo","vincular-fondo")).status).toBe(403);m.guard.mockResolvedValue({error:new Response(null,{status:403})});expect((await cb2Http(req(),"demo","vincular-fondo")).status).toBe(403);expect(m.vincular).not.toHaveBeenCalled();
});
