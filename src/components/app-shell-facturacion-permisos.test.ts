import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { adaptarPermisosLegacy, tienePermisoBase } from "@/lib/permisos-catalogo";
import { alcanceFacturacion } from "@/lib/facturacion/alcance";
import { capacidadesFacturacion } from "@/lib/facturacion/capacidades";
import type { PermisoModulo } from "@/lib/permisos-shared";
const src = readFileSync("src/components/app-shell.tsx","utf8");
const bloque = src.slice(src.indexOf("    const alcanceFact ="),src.indexOf("    for (const m of opsMods)"));
const permiso = (modulo: string, puedeVer: boolean): PermisoModulo => ({modulo,puedeVer,puedeCrear:false,puedeEditar:false,puedeEliminar:false});
function links(rol: string, permisos: PermisoModulo[], modulos = ["facturacion"]) {
  // El AppShell recibe los permisos EFECTIVOS (ya adaptados con el rol): se reproduce aquí.
  return new Function("rol","permisos","modulos","isAdmin","capacidadesFacturacion","tienePermisoBase","base",
    "const opsLinks = []; " + bloque + "; return opsLinks;")(
      rol,adaptarPermisosLegacy(permisos,rol),modulos,rol==="Admin",capacidadesFacturacion,tienePermisoBase,"/e/kt");
}
describe("Facturación clientes: caso estructural independiente del username", () => {
  it.each(["JefeOperaciones","GerenteOperaciones","AuxiliarOperaciones"])("%s con Ver accede a Facturas aunque no administra cuestionarios", rol => {
    expect(alcanceFacturacion(rol).verClientes).toBe(false);
    expect(links(rol,[permiso("facturacion",true)])).toEqual([{href:"/e/kt/facturacion?vista=facturas",label:"Facturación clientes",key:"fact-cli"}]);
  });
  it("sin base Ver ni siquiera emitir hace aparecer el menú", () => {
    expect(links("JefeOperaciones",[permiso("facturacion",false),permiso("facturacion_emitir",true)])).toEqual([]);
  });
  it("solo Ver entra al módulo sin necesitar emitir", () => {
    expect(links("JefeOperaciones",[permiso("facturacion",true),permiso("facturacion_emitir",false)])).toHaveLength(1);
  });
  it("preserva acceso previo de Operaciones y no habilita capacidad ausente", () => {
    expect(links("Operaciones",[permiso("facturacion",true)])[0].href).toBe("/e/kt/facturacion?vista=clientes");
    expect(links("JefeOperaciones",[permiso("facturacion",true)],["rrhh"])).toEqual([]);
  });
});
