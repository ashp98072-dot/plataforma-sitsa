import { expect,it } from "vitest";
import { normalizarNombreReportado } from "./pilotos-reportados";
import { csvPilotos,filtrosPiloto } from "./pilotos-reporte";
import { proponerNombre } from "./pilotos-nombres";
it("empleado exacto único normaliza tildes/espacios; parcial y erratas solo proponen",()=>{
 const empleados=[{id:1,nombre:"José Luis Escobar"}];
 expect(proponerNombre("  Jose  Luis Escobar ",empleados).propuesta).toEqual({tipo:"EMPLEADO",empleadoId:1,confirmado:false});
 for(const nombre of ["José","Luis Escobr"]){const r=proponerNombre(nombre,empleados);expect(r.candidatos.map(p=>p.id)).toContain(1);expect(r.propuesta).toBeNull();}
 for(const nombre of ["Luis Escobar","Jose Luis Escobr"])expect(proponerNombre(nombre,empleados).propuesta).toEqual({tipo:"EMPLEADO",empleadoId:1,confirmado:false});   // dos palabras completas coincidentes
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
 // el alias hacia un empleado NO elude el mínimo de dos palabras: queda como referencia y se confirma manualmente
 const sinMotor=proponerNombre("Escobr",e,{tipo:"EMPLEADO",empleadoId:1,confirmado:false});expect(sinMotor.propuesta).toBeNull();expect(sinMotor.equivalencia).toEqual({tipo:"EMPLEADO",empleadoId:1,confirmado:false});
 expect(proponerNombre("Jose Luis",e,{tipo:"EMPLEADO",empleadoId:1,confirmado:false}).propuesta?.tipo).toBe("EMPLEADO");   // el motor reconoce al mismo empleado
 expect(proponerNombre("Escobr",[],{tipo:"EMPLEADO",empleadoId:1,confirmado:false}).propuesta).toBeNull();
 expect(proponerNombre("Visitante",[],{tipo:"REPORTADO",reportadoId:3,confirmado:false}).propuesta).toEqual({tipo:"REPORTADO",reportadoId:3,confirmado:false});
 expect(proponerNombre("Visitante",[]).propuesta).toBeNull();
});
it("una equivalencia confirmada propone una errata solo si no hay ambigüedad ni homónimos",()=>{
 const empleado={id:8,nombre:"Jayme Calderón",estado:"Activo"}, alias={tipo:"EMPLEADO" as const,empleadoId:8,confirmado:false};
 expect(proponerNombre("Jaime Calderon",[empleado],alias,undefined,undefined,true).propuesta).toEqual({...alias,origen:"EQUIVALENCIA"});
 expect(proponerNombre("Jaime Calderon",[empleado],alias).propuesta).toBeNull();
 expect(proponerNombre("Jaime Calderon",[empleado,{...empleado,id:9}],alias,undefined,undefined,true).propuesta).toBeNull();
 expect(proponerNombre("Jaime Calderon",[empleado,{id:10,nombre:"Jaime Calderon",estado:"Activo"}],alias,undefined,undefined,true).propuesta).toBeNull();
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

it("equivalencia histórica hacia #75 con coincidencia única #110 (Andrés Taracena): NUNCA se propone #75; conflicto con revisión explícita; el servidor no acepta el ID antiguo sin confirmar",()=>{
 const empleados=[{id:110,nombre:"Andrés Norberto Taracena Mayén",estado:"Baja"},{id:75,nombre:"Mario Pérez Ixcoy",estado:"Activo"}];
 const r=proponerNombre("Andrés Taracena",empleados,{tipo:"EMPLEADO",empleadoId:75,confirmado:false});
 expect(r.propuesta).toBeNull();expect(r.conflictoEquivalencia).toEqual({equivalenciaId:75,reconocidoId:110});expect(r.equivalencia).toEqual({tipo:"EMPLEADO",empleadoId:75,confirmado:false});
 expect(r.elegibles).toEqual([110]);expect(r.candidatos.map(p=>p.id)).toContain(110);
 // alias hacia el MISMO empleado que reconoce el motor → autopropuesta; sin reconocimiento (una sola palabra) el alias NO propone
 const alias110={tipo:"EMPLEADO" as const,empleadoId:110,confirmado:false};
 expect(proponerNombre("Andrés Taracena",empleados,alias110).propuesta).toEqual(alias110);
 const sola=proponerNombre("Taracena",empleados,alias110);expect(sola.propuesta).toBeNull();expect(sola.equivalencia).toEqual(alias110);expect(sola.elegibles).toEqual([]);expect(sola.conflictoEquivalencia).toBeUndefined();
 // un alias nunca resuelve una ambigüedad del motor
 const amb=[...empleados,{id:111,nombre:"Andrés Taracena López",estado:"Activo"}];
 const ambiguo=proponerNombre("Andrés Taracena",amb,alias110);expect(ambiguo.propuesta).toBeNull();expect(ambiguo.elegibles).toEqual([110,111]);
 expect(proponerNombre("Andrés Taracena",amb,{tipo:"EMPLEADO",empleadoId:111,confirmado:false}).propuesta).toBeNull();
 // alias «reportado» previamente confirmado: se conserva si no hay empleado identificable
 expect(proponerNombre("Persona Desconocida Nueva",empleados,{tipo:"REPORTADO",reportadoId:9,confirmado:false}).propuesta).toEqual({tipo:"REPORTADO",reportadoId:9,confirmado:false});
});
it("todo elegible del motor aparece entre los candidatos; los aproximados no alteran la propuesta ni crean ambigüedad",()=>{
 const empleados=[{id:1,nombre:"Marta Luisa Pérez Gómez",estado:"Activo"},{id:2,nombre:"Martha Luisa Perez Gomes",estado:"Activo"},{id:3,nombre:"Pedro Xol",estado:"Baja"}];
 const r=proponerNombre("Luisa Gomez",empleados);
 expect(r.elegibles).toEqual([1]);expect(r.candidatos.map(p=>p.id)).toEqual(expect.arrayContaining([1]));expect(r.propuesta).toEqual({tipo:"EMPLEADO",empleadoId:1,confirmado:false});
 const largo=proponerNombre("Marta Luisa Pérez Gómez Jr",empleados);expect(largo.elegibles).toEqual([1,2]);expect(largo.propuesta).toBeNull();   // #2 comparte «Luisa» y «Perez»: ambiguo aunque #2 sea una variante aproximada
 expect(largo.candidatos.map(p=>p.id)).toEqual(expect.arrayContaining([1,2]));
 for(const e of empleados){const q=proponerNombre(e.nombre,empleados);for(const id of q.elegibles??[])expect(q.candidatos.some(p=>p.id===id)).toBe(true);}
});
