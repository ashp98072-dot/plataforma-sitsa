import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({load:vi.fn(),read:vi.fn(),guard:vi.fn()}));
vi.mock("@/lib/load-env",()=>({loadRuntimeEnv:m.load}));
vi.mock("node:fs",()=>({readFileSync:m.read}));
vi.mock("@/lib/tenant",()=>({requireTenantFlotaCombustible:m.guard}));
import { GET } from "@/app/api/empresas/[slug]/flota/combustible/cb2/diagnostico/route";
const get=()=>GET(new Request("http://localhost/lab"),{params:Promise.resolve({slug:"empresa-lab"})});
beforeEach(()=>{vi.resetAllMocks();m.guard.mockResolvedValue({empresa:{id:1}});m.read.mockReturnValue("build-lab-608");vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","");vi.stubEnv("CB2_TERCEROS_D2_APROBADA","1");vi.stubEnv("FLOTA_FUSIONES_APROBADAS","");vi.stubEnv("NOVALVION_DEPLOY_SHA","");vi.stubEnv("DB_PASSWORD","SECRET_NEVER_RETURNED");});
afterEach(()=>vi.unstubAllEnvs());
it("diagnostico autenticado de solo lectura devuelve booleanos y build sin secretos",async()=>{
 const response=await get(),data=await response.json();expect(data).toMatchObject({tercerosDirectos:false,tercerosHabilitados:true,fusionesHabilitadas:false,buildId:"build-lab-608",shaDeclarado:null});expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(JSON.stringify(data)).not.toContain("SECRET_NEVER_RETURNED");expect(m.read.mock.calls[0][0]).toMatch(/[\\/]\.next[\\/]BUILD_ID$/);
});
it("valores efectivos se leen despues de cargar configuracion persistente",async()=>{
 m.load.mockImplementation(()=>{vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","1");vi.stubEnv("NOVALVION_DEPLOY_SHA","a".repeat(40));});expect(await (await get()).json()).toMatchObject({tercerosDirectos:true,shaDeclarado:"a".repeat(40)});
});
it("no inventa version si BUILD_ID no existe ni expone valores no validados",async()=>{
 m.read.mockImplementation(()=>{throw Error("private/path");});vi.stubEnv("NOVALVION_DEPLOY_SHA","secret/path");const data=await (await get()).json();expect(data.buildId).toBeNull();expect(data.shaDeclarado).toBeNull();expect(JSON.stringify(data)).not.toContain("private/path");
});
it("sin permisos no lee build ni configuracion",async()=>{
 m.guard.mockResolvedValue({error:Response.json({error:"denied"},{status:403})});expect((await get()).status).toBe(403);expect(m.load).not.toHaveBeenCalled();expect(m.read).not.toHaveBeenCalled();
});
