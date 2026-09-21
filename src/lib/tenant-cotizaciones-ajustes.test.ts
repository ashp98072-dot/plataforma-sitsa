import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session",()=>({getSession:vi.fn(),createSessionToken:vi.fn(),setSessionCookie:vi.fn()}));
vi.mock("@/lib/empresas",()=>({obtenerEmpresaPorSlug:vi.fn(),empresasParaUsuario:vi.fn()}));
vi.mock("@/lib/permisos",async(importOriginal)=>{const actual=await importOriginal<typeof import("@/lib/permisos")>();return {...actual,permisosEfectivos:vi.fn()};});
import { getSession } from "@/lib/session";import { empresasParaUsuario,obtenerEmpresaPorSlug } from "@/lib/empresas";import { permisosEfectivos } from "@/lib/permisos";import { requireTenantCotizacionesAjustes } from "@/lib/tenant";
const emp=(modulos=["tms"])=>({id:1,slug:"kt",nombre:"KT",activa:true,modulos}) as never;
const perm=(modulo:string)=>({modulo,puedeVer:true,puedeCrear:true,puedeEditar:true,puedeEliminar:true});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(emp());vi.mocked(empresasParaUsuario).mockResolvedValue([emp()]);vi.mocked(getSession).mockResolvedValue({id:2,username:"u",nombre:"U",rol:"Operaciones"} as never);});
describe("requireTenantCotizacionesAjustes",()=>{
 it.each(["ver","crear","editar"] as const)("admite solo el permiso explícito para %s",async accion=>{vi.mocked(permisosEfectivos).mockResolvedValue([perm("cotizaciones_ajustes")]);expect((await requireTenantCotizacionesAjustes("kt",accion)).error).toBeUndefined();});
 it("no acepta fallbacks de cotizaciones, costeo ni tms",async()=>{vi.mocked(permisosEfectivos).mockResolvedValue([perm("cotizaciones"),perm("cotizaciones_costeo"),perm("tms")]);expect((await requireTenantCotizacionesAjustes("kt","ver")).error?.status).toBe(403);});
 it("exige TMS habilitado",async()=>{vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(emp(["rrhh"]));vi.mocked(empresasParaUsuario).mockResolvedValue([emp(["rrhh"])]);vi.mocked(permisosEfectivos).mockResolvedValue([perm("cotizaciones_ajustes")]);expect((await requireTenantCotizacionesAjustes("kt","ver")).error?.status).toBe(403);});
 it("Admin pasa sin permiso",async()=>{vi.mocked(getSession).mockResolvedValue({id:1,username:"a",rol:"Admin"} as never);expect((await requireTenantCotizacionesAjustes("kt","editar")).error).toBeUndefined();});
 it("Admin también requiere que la empresa tenga TMS",async()=>{vi.mocked(getSession).mockResolvedValue({id:1,username:"a",rol:"Admin"} as never);vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(emp(["rrhh"]));vi.mocked(empresasParaUsuario).mockResolvedValue([emp(["rrhh"])]);expect((await requireTenantCotizacionesAjustes("kt","ver")).error?.status).toBe(403);});
});
