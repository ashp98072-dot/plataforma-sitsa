import { readFileSync } from "node:fs";import { join } from "node:path";import { describe,expect,it } from "vitest";import type { ParametroAjustes } from "@/lib/tms/cotizacion-costeo-ajustes";import { decimalAPorcentaje,formularioNuevaVigencia,porcentajeADecimal,ultimaVigencia } from "./cotizacion-ajustes-client";
const src=readFileSync(join(__dirname,"cotizacion-ajustes-client.tsx"),"utf8");
describe("UI ajustes de costeo",()=>{
 it("convierte porcentajes de UI a fracción persistida y viceversa",()=>{expect(porcentajeADecimal("12")).toBe(.12);expect(decimalAPorcentaje(.2)).toBe("20");});
 it("crea vigencias por POST y nunca actualiza ni elimina historial",()=>{expect(src).toContain('/ajustes/parametros`');expect(src).toContain('method:"POST"');expect(src).not.toContain('method:"DELETE"');});
 it("presenta advertencia de impacto futuro",()=>expect(src).toContain("Los cambios aplican a nuevos cálculos"));
});

// "Nueva vigencia" se precarga desde la ÚLTIMA vigencia disponible (incluida una futura ya programada),
// nunca desde la "Vigencia actual" del badge: si no, al programar 2026-11-01 se copiaría 2026-09-21 y se
// perdería 2026-10-01.
const vigencia=(id:number,vigenteDesde:string,combustible:number,over:Partial<ParametroAjustes>={}):ParametroAjustes=>({
 id,vigenteDesde,precioCombustibleGalon:combustible,ivaTasa:.12,costoPilotoDia:207.74,costoAuxiliarDia:148.04,viaticoPilotoDia:200,viaticoAuxiliarDia:200,viaticoGuiaDia:125,hotelDia:null,margenObjetivo:.2,
 creadoPor:"admin",creadoEn:"2026-09-21 10:00:00",esVigenciaActual:false,...over});
// Mismo orden que devuelve el servidor: ORDER BY vigente_desde DESC, id DESC.
const ACTUAL=vigencia(1,"2026-09-21",29.89,{esVigenciaActual:true});
const FUTURA=vigencia(2,"2026-10-01",31.5,{esVigenciaActual:false,ivaTasa:.15,costoPilotoDia:250,hotelDia:300,margenObjetivo:.25});
describe("Nueva vigencia: plantilla = última vigencia disponible",()=>{
 it("con una vigencia actual y una futura, precarga la FUTURA (31.50) y no la actual (29.89)",()=>{
  const parametros=[FUTURA,ACTUAL];
  const form=formularioNuevaVigencia(ultimaVigencia(parametros),"2026-09-25");
  expect(Number(form.precioCombustibleGalon)).toBe(31.5);
  expect(form.precioCombustibleGalon).not.toBe("29.89");
 });
 it("copia TODOS los campos de la última vigencia (no una mezcla con la actual)",()=>{
  const form=formularioNuevaVigencia(ultimaVigencia([FUTURA,ACTUAL]),"2026-11-01");
  expect(form).toEqual({vigenteDesde:"2026-11-01",precioCombustibleGalon:"31.5",ivaTasa:"15",costoPilotoDia:"250",costoAuxiliarDia:"148.04",viaticoPilotoDia:"200",viaticoAuxiliarDia:"200",viaticoGuiaDia:"125",hotelDia:"300",margenObjetivo:"25"});
 });
 it("solo con la vigencia actual, la plantilla es esa misma",()=>{
  expect(Number(formularioNuevaVigencia(ultimaVigencia([ACTUAL]),"2026-11-01").precioCombustibleGalon)).toBe(29.89);
 });
 it("la fecha inicial del formulario es hoy, no la de la plantilla",()=>{
  expect(formularioNuevaVigencia(ultimaVigencia([FUTURA,ACTUAL]),"2026-09-25").vigenteDesde).toBe("2026-09-25");
 });
 it("sin vigencias: no hay plantilla y el formulario queda con valores vacíos/0 (sin error)",()=>{
  expect(ultimaVigencia([])).toBeUndefined();expect(ultimaVigencia(undefined)).toBeUndefined();
  expect(formularioNuevaVigencia(ultimaVigencia([]),"2026-09-25")).toEqual({vigenteDesde:"2026-09-25",precioCombustibleGalon:"",ivaTasa:"",costoPilotoDia:"0",costoAuxiliarDia:"0",viaticoPilotoDia:"0",viaticoAuxiliarDia:"0",viaticoGuiaDia:"0",hotelDia:"",margenObjetivo:""});
 });
 it("el componente precarga desde ultimaVigencia y ya no depende de esVigenciaActual para la plantilla",()=>{
  expect(src).toContain("ultimaVigencia(datos?.parametros)");expect(src).toContain("formularioNuevaVigencia(plantillaVigencia");
  expect(src).not.toMatch(/find\(p=>p\.esVigenciaActual\)/);
 });
 it("el badge 'Vigencia actual' se sigue determinando por la marca del servidor en cada fila (sin cambios)",()=>{
  expect(src).toContain('{p.esVigenciaActual&&<span className="rounded bg-emerald-800 px-1">Vigencia actual</span>}');
 });
});
