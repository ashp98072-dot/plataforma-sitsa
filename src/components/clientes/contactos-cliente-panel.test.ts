import { readFileSync } from "node:fs";import { join } from "node:path";import { describe,expect,it } from "vitest";
const read=(p:string)=>readFileSync(join(process.cwd(),p),"utf8");
describe("contactos dentro del catálogo de Clientes",()=>{
 const panel=read("src/components/clientes/contactos-cliente-panel.tsx"),clientes=read("src/components/clientes/clientes-client.tsx"),programacion=read("src/app/e/[slug]/programacion/plan-form.tsx"),rutas=read("src/app/e/[slug]/rutas/page.tsx");
 it("muestra contador, búsqueda, filtros y acciones de estado",()=>{for(const texto of ["activos ·","inactivos","Buscar contacto...","Todos","Activos","Inactivos","Desactivar","Reactivar"])expect(panel).toContain(texto);});
 it("Clientes lista contadores e integra el panel en edición y consulta",()=>{expect(clientes).toContain("contactosActivos");expect(clientes.match(/<ContactosClientePanel/g)).toHaveLength(2);});
 it("Clientes y Rutas escriben sobre el mismo endpoint/modelo operativo",()=>{expect(panel).toContain("/clientes/${clienteId}/contactos");expect(rutas).toContain("/tms/clientes/${formClienteId}/contactos");expect(rutas).toContain('method: "POST"');});
 it("Programación consume activos y preserva el snapshot histórico",()=>{expect(programacion).toContain("/tms/clientes/${form.clienteId}/contactos");expect(programacion).toContain("contactoNombreHistorico");});
});
