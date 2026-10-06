import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant",()=>({requireTenantFacturacion:vi.fn()}));
vi.mock("@/lib/db",()=>({query:vi.fn()}));
import { requireTenantFacturacion } from "@/lib/tenant";
import { query } from "@/lib/db";
import { GET } from "./route";
const ctx={params:Promise.resolve({slug:"kt"})};
beforeEach(()=>vi.resetAllMocks());
describe("catálogo mínimo de Facturación",()=>{
  it("403 no consulta clientes",async()=>{
    vi.mocked(requireTenantFacturacion).mockResolvedValue({error:new Response(null,{status:403})} as never);
    expect((await GET(new Request("http://test"),ctx)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
  it("solo base Ver, filtro tenant y ningún dato de cuestionarios",async()=>{
    vi.mocked(requireTenantFacturacion).mockResolvedValue({empresa:{id:7},session:{rol:"JefeOperaciones"}} as never);
    vi.mocked(query).mockResolvedValue([{id:8,nombre:"Cliente",nit:"no exponer"}] as never);
    const res=await GET(new Request("http://test"),ctx);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("kt","ver");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("empresa_id = ?"),[7]);
    expect(await res.json()).toEqual({clientes:[{clienteId:8,nombre:"Cliente"}]});
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
