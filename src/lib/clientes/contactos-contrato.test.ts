import { readFileSync } from "node:fs";import { join } from "node:path";import { describe,expect,it } from "vitest";
const read=(p:string)=>readFileSync(join(process.cwd(),p),"utf8");
describe("contrato de administración de contactos desde Clientes",()=>{
 const lista=read("src/app/api/empresas/[slug]/clientes/[id]/contactos/route.ts"),detalle=read("src/app/api/empresas/[slug]/clientes/[id]/contactos/[contactoId]/route.ts"),repo=read("src/lib/clientes/repository.ts"),modelo=read("src/lib/tms/cliente-contactos.ts");
 it("resuelve clientes.id a tms_clientes.id en servidor y usa permiso clientes",()=>{expect(lista).toContain('requireClientesOFacturacion(slug, "clientes"');expect(lista).toContain("resolverTmsClienteId");expect(detalle).toContain("resolverTmsClienteId");});
 it("no recibe empresa ni cliente TMS arbitrarios del navegador",()=>{expect(lista).not.toMatch(/empresaId.*z\./);expect(lista).not.toMatch(/tmsClienteId.*z\./);});
 it("lista contadores activos e inactivos desde la fuente real",()=>{expect(repo).toContain("FROM tms_cliente_contactos cc");expect(repo).toContain("contactos_activos");expect(repo).toContain("contactos_inactivos");});
 it("audita crear, editar, desactivar, reactivar y eliminar",()=>{for(const a of ["crear_contacto_cliente","editar_contacto_cliente","desactivar_contacto_cliente","reactivar_contacto_cliente","eliminar_contacto_cliente"])expect(lista+detalle).toContain(a);});
 it("solo elimina sin uso y recomienda desactivar cuando hay histórico",()=>{expect(modelo).toContain("tms_cliente_rutas WHERE empresa_id=? AND contacto_cliente_id=?");expect(detalle).toContain("Puedes desactivarlo");});
});
