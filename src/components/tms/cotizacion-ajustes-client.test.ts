import { readFileSync } from "node:fs";import { join } from "node:path";import { describe,expect,it } from "vitest";import { decimalAPorcentaje,porcentajeADecimal } from "./cotizacion-ajustes-client";
const src=readFileSync(join(__dirname,"cotizacion-ajustes-client.tsx"),"utf8");
describe("UI ajustes de costeo",()=>{
 it("convierte porcentajes de UI a fracción persistida y viceversa",()=>{expect(porcentajeADecimal("12")).toBe(.12);expect(decimalAPorcentaje(.2)).toBe("20");});
 it("crea vigencias por POST y nunca actualiza ni elimina historial",()=>{expect(src).toContain('/ajustes/parametros`');expect(src).toContain('method:"POST"');expect(src).not.toContain('method:"DELETE"');});
 it("presenta advertencia de impacto futuro",()=>expect(src).toContain("Los cambios aplican a nuevos cálculos"));
});
