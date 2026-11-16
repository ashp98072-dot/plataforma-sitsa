import { expect,it } from "vitest";
import { normalizarNombreReportado } from "./pilotos-reportados";
import { csvPilotos,filtrosPiloto } from "./pilotos-reporte";
import { proponerNombre } from "./pilotos-nombres";
it("empleado exacto único normaliza tildes/espacios; parcial y erratas solo proponen",()=>{
 const empleados=[{id:1,nombre:"José Luis Escobar"}];
 expect(proponerNombre("  Jose  Luis Escobar ",empleados).propuesta).toEqual({tipo:"EMPLEADO",empleadoId:1,confirmado:false});
 for(const nombre of ["Luis Escobar","José","Jose Luis Escobr","Luis Escobr"]){const r=proponerNombre(nombre,empleados);expect(r.candidatos.map(p=>p.id)).toContain(1);expect(r.propuesta).toBeNull();}
 expect(proponerNombre("Mensajero ajeno",empleados).candidatos).toEqual([]);
});
it("no resuelve homónimos por exactitud, parecido ni equivalencias antiguas",()=>{
 const empleados=[{id:1,nombre:"José Pérez"},{id:2,nombre:"Jose Perez"}];
 expect(proponerNombre("Jose Perez",empleados).propuesta).toBeNull();
 expect(proponerNombre("Jose Perez",empleados,{tipo:"EMPLEADO",empleadoId:1,confirmado:false}).propuesta).toBeNull();
 expect(proponerNombre("Jose Perez",empleados,{tipo:"REPORTADO",reportadoId:3,confirmado:false}).propuesta).toBeNull();
});
it("reutiliza solo equivalencias confirmadas vigentes; no inventa reportados",()=>{
 const e=[{id:1,nombre:"José Luis Escobar"}];
 expect(proponerNombre("Escobr",e,{tipo:"EMPLEADO",empleadoId:1,confirmado:false}).propuesta?.tipo).toBe("EMPLEADO");
 expect(proponerNombre("Escobr",[],{tipo:"EMPLEADO",empleadoId:1,confirmado:false}).propuesta).toBeNull();
 expect(proponerNombre("Visitante",[],{tipo:"REPORTADO",reportadoId:3,confirmado:false}).propuesta).toEqual({tipo:"REPORTADO",reportadoId:3,confirmado:false});
 expect(proponerNombre("Visitante",[]).propuesta).toBeNull();
});
it("normaliza solo etiquetas, conserva acentos/puntuacion y no infiere homonimos",()=>{
 expect(normalizarNombreReportado("  A\u0301lvaro  Pérez ")).toBe("ÁLVARO PÉREZ");
 expect(normalizarNombreReportado("José Pérez")).not.toBe(normalizarNombreReportado("Jose Pérez"));
 expect(normalizarNombreReportado("Ana-María")).not.toBe(normalizarNombreReportado("Ana María"));
});
it("CSV escapa formulas y comillas sin sustituir datos originales; filtros empresariales no admiten empresa del cliente",()=>{
 const row={piloto_informado:' =HYPERLINK("sintetico")',numero_vale:"001",galones:"1.234567",monto:"12.345678"};
 const csv=csvPilotos([row]);expect(csv).toContain('"\' =HYPERLINK(""sintetico"")"');expect(csv).toContain('"001"');expect(csv).toContain('"1.234567"');expect(row.piloto_informado).toBe(' =HYPERLINK("sintetico")');
 expect(filtrosPiloto.safeParse({empresaId:99}).success).toBe(false);expect(filtrosPiloto.safeParse({pilotoReportadoId:0}).success).toBe(false);
});
