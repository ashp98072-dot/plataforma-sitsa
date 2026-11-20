import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tenant: vi.fn(), permisos: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenant: mocks.tenant }));
vi.mock("@/lib/permisos", () => ({ permisosEfectivos: mocks.permisos }));
import { accesoCanecas } from "./acceso";

describe("acceso de Canecas", () => {
  beforeEach(() => {
    mocks.tenant.mockReset(); mocks.permisos.mockReset();
    mocks.tenant.mockResolvedValue({ empresa:{id:1}, session:{id:3,rol:"RRHH"} });
  });
  it("deniega sin grant propio aunque tenga acceso a otra área", async () => {
    mocks.permisos.mockResolvedValue([{modulo:"inventario",puedeVer:true,puedeCrear:true,puedeEditar:true}]);
    expect((await accesoCanecas("uno","ver")).error?.status).toBe(403);
  });
  it("separa lectura, registro y confirmación", async () => {
    mocks.permisos.mockResolvedValue([{modulo:"canecas",puedeVer:true},{modulo:"canecas_compras",puedeVer:true}]);
    expect((await accesoCanecas("uno","compras")).error).toBeUndefined();
    expect((await accesoCanecas("uno","confirmar")).error?.status).toBe(403);
  });
  it("respeta el rechazo de empresa antes de comprobar permisos", async () => {
    mocks.tenant.mockResolvedValue({error:new Response(null,{status:403})});
    expect((await accesoCanecas("otra","ver")).error?.status).toBe(403);
    expect(mocks.permisos).not.toHaveBeenCalled();
  });
  it("propaga la opción de solo lectura al guard de empresa", async () => {
    mocks.permisos.mockResolvedValue([{modulo:"canecas",puedeVer:true}]);
    await accesoCanecas("uno", "ver", {soloLectura:true});
    expect(mocks.tenant).toHaveBeenCalledWith("uno", {soloLectura:true});
  });
});
