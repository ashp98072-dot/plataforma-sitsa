import { describe, it, expect } from "vitest";
import { monedaOriginal } from "./model";
const original = (fila = 1, moneda = "GTQ") => ({
 empresa_id: 1, proveedor_id: 2, importacion_id: 3, tipo: "ORIGEN", revision: 1,
 marca_origen: 1, origen_fila_id: null, operacion_tipo: "CONFIRMAR", hoja_indice: 1,
 hoja_nombre: "DEMO", fila_excel: fila, datos_origen: JSON.stringify({hoja:"DEMO",fila}),
 decision: JSON.stringify({version:1,moneda,candidato:null,vehiculoId:null,errores:[]}),
});
describe("CB2 moneda de evidencia original", () => {
 it("coherencia de todos los originales independiente del orden", () => {
  for(const xs of [[original(1),original(2)],[original(2),original(1)]])expect(monedaOriginal(xs,1,2,3)).toBe("GTQ");
  expect(monedaOriginal([original(1,"USD")],1,2,3)).toBe("USD");
 });
 it("no certifica ausencia ni monedas mezcladas aunque la primera sea valida", () => {
  expect(()=>monedaOriginal([],1,2,3)).toThrow();
  expect(()=>monedaOriginal([original(1),original(2,"USD")],1,2,3)).toThrow("inconsistente");
 });
 it.each(["null","[]","{}",'{"moneda":"GTQ"}',"{",JSON.stringify({...JSON.parse(original().decision),version:2}),JSON.stringify({...JSON.parse(original().decision),moneda:"EUR"})])("rechaza estructura JSON no certificable %s", decision => {
  expect(()=>monedaOriginal([{...original(),decision}],1,2,3)).toThrow("JSON");
 });
 it.each([{empresa_id:9},{proveedor_id:9},{importacion_id:9},{tipo:"RESOLUCION"},{revision:2},{marca_origen:null},{origen_fila_id:1},{operacion_tipo:"REANUDAR"}])("exige ambito y evento ORIGEN valido %j", cambio => {
  expect(()=>monedaOriginal([{...original(),...cambio}],1,2,3)).toThrow("ORIGEN");
 });
 it("rechaza originales repetidos o datos_origen sin posicion coincidente",()=>{
  expect(()=>monedaOriginal([original(),original()],1,2,3)).toThrow("repetidas");
  for(const datos_origen of ["null","[]",'{"hoja":"OTRA","fila":1}'])expect(()=>monedaOriginal([{...original(),datos_origen}],1,2,3)).toThrow("JSON");
 });
});
