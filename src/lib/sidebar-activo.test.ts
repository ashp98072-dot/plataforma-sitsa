import { describe, it, expect } from "vitest";
import { enlaceSidebarActivo } from "./sidebar-activo";

const flota = ["/e/kt/flota", ...["vehiculos","taller","servicios","historial-servicios","compras","inventario-equipo","lecturas","reportes","piloto","combustible"].map(tab => "/e/kt/flota?tab=" + tab)];
describe("sidebar: único enlace activo", () => {
  it.each(flota)("activa solo %s", href => {
    const url = new URL(href,"https://test.local");
    expect(enlaceSidebarActivo(url.pathname,url.search,flota)).toBe(href);
  });
  it("admite bookmarks de Flota por segmento", () => {
    expect(enlaceSidebarActivo("/e/kt/flota/vehiculos","",flota)).toBe("/e/kt/flota?tab=vehiculos");
  });
  it("elige prefijo anidado específico, no el hermano comercial", () => {
    expect(enlaceSidebarActivo("/e/kt/cotizaciones/ajustes/perfil/2","",["/e/kt/cotizaciones","/e/kt/cotizaciones/ajustes"])).toBe("/e/kt/cotizaciones/ajustes");
  });
  it("diferencia vista de Facturación e ignora filtros ajenos", () => {
    expect(enlaceSidebarActivo("/e/kt/facturacion","vista=empresa&q=x",["/e/kt/facturacion?vista=clientes","/e/kt/facturacion?vista=empresa"])).toBe("/e/kt/facturacion?vista=empresa");
  });
  it("no activa rutas hermanas por prefijo parcial", () => {
    expect(enlaceSidebarActivo("/e/kt/compras/proveedores","",["/e/kt/compras/requerimientos"])).toBeNull();
  });
});
