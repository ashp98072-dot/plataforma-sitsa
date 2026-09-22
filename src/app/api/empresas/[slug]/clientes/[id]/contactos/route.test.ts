import { beforeEach,describe,expect,it,vi } from "vitest";
vi.mock("@/lib/clientes/acceso",()=>({requireClientesOFacturacion:vi.fn()}));
vi.mock("@/lib/clientes/repository",()=>({resolverTmsClienteId:vi.fn()}));
vi.mock("@/lib/auditoria",()=>({registrarAuditoria:vi.fn()}));
vi.mock("@/lib/tms/cliente-contactos",()=>({listarContactosCliente:vi.fn(),buscarPosiblesDuplicadosContacto:vi.fn(),crearContactoCliente:vi.fn()}));
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";import { resolverTmsClienteId } from "@/lib/clientes/repository";import { listarContactosCliente,buscarPosiblesDuplicadosContacto,crearContactoCliente } from "@/lib/tms/cliente-contactos";import { GET,POST } from "./route";
const ctx={params:Promise.resolve({slug:"acme",id:"12"})};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(requireClientesOFacturacion).mockResolvedValue({empresa:{id:7},session:{username:"admin"}} as never);vi.mocked(resolverTmsClienteId).mockResolvedValue({ok:true,tmsClienteId:55,cliente:{id:12,nombre:"Calsa"}} as never);vi.mocked(buscarPosiblesDuplicadosContacto).mockResolvedValue([]);});
describe("contactos administrados desde Clientes",()=>{
 it("lista todos los contactos del cliente resuelto dentro del tenant",async()=>{vi.mocked(listarContactosCliente).mockResolvedValue([{id:1,nombre:"Ana",activo:true}] as never);const r=await GET(new Request("http://x"),ctx);expect(r?.status).toBe(200);expect(requireClientesOFacturacion).toHaveBeenCalledWith("acme","clientes",false);expect(listarContactosCliente).toHaveBeenCalledWith(7,55,{incluirInactivos:true});});
 it("crea usando permiso clientes:editar y el tms_cliente_id resuelto por servidor",async()=>{vi.mocked(crearContactoCliente).mockResolvedValue({id:9,nombre:"Ana",activo:true} as never);const r=await POST(new Request("http://x",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nombre:"Ana"})}),ctx);expect(r?.status).toBe(201);expect(requireClientesOFacturacion).toHaveBeenCalledWith("acme","clientes",true);expect(crearContactoCliente).toHaveBeenCalledWith(7,55,expect.objectContaining({nombre:"Ana"}));});
 it("un cliente de otro tenant/no resuelto no permite consultar contactos",async()=>{vi.mocked(resolverTmsClienteId).mockResolvedValue({ok:false,mensaje:"Cliente no encontrado."});const r=await GET(new Request("http://x"),ctx);expect(r?.status).toBe(404);expect(listarContactosCliente).not.toHaveBeenCalled();});
});
