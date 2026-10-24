import { describe, expect, it } from "vitest";
import { crearBuscadorEmpleados, identificarEmpleado, seleccionarEmpleado } from "./empleados-coincidencias";
describe("pilotos CB2: tokens completos únicos", () => {
    const alvaro = {id:1,nombre:"Álvaro Antonio León Pinto",estado:"Activo"};
    it.each(["Alvaro Pinto","Antonio Pinto","Alvaro Leon","Antonio Leon","Pinto Alvaro","León Antonio","  ÁLVARO,   PINTO. ","Pinto—Antonio","Álvaro Antonio León Pinto"])("autopropone %s sin exigir posición ni orden", original=>{
        const m=identificarEmpleado(original,[alvaro]);expect(m.propuesta).toBe(alvaro);expect(m.candidatos).toEqual([alvaro]);expect(m.metodo).toBe(original === alvaro.nombre ? "EXACTA_NORMALIZADA":"TOKENS_COMPLETOS_UNICOS");
    });
    it("distingue exacta y coincidencia por tokens",()=>{expect(identificarEmpleado("álvaro antonio león pinto",[alvaro]).metodo).toBe("EXACTA_NORMALIZADA");expect(identificarEmpleado("PINTO ALVARO",[alvaro]).estado).toBe("PARCIAL_UNICA");});
    it.each(["Alvaro Pin","Alvar Pinto","A Pinto","Pinto","Alvaro Alvaro","Alvaro 123","","NO TIENE NOMBRE"])("no inventa identidad para %s",nombre=>expect(identificarEmpleado(nombre,[alvaro,{id:99,nombre:"NO TIENE NOMBRE"}]).propuesta).toBeNull());
    it("una exacta no oculta otro empleado que también contiene los tokens",()=>{
        for(const catalogo of [[alvaro,{id:2,nombre:"Alvaro Pinto"}],[alvaro,{id:2,nombre:"Alvaro Manuel Pinto"}],[alvaro,{id:2,nombre:alvaro.nombre}]]){const m=identificarEmpleado("Alvaro Pinto",catalogo);expect(m.estado).toBe("AMBIGUA");expect(m.propuesta).toBeNull();expect(m.candidatos).toHaveLength(2);}
    });
    it("ignora registros inactivos cuando se suministra estado y rehace índice al recargar catálogo",()=>{
        const inactivo={id:2,nombre:"Alvaro Manuel Pinto",estado:"Inactivo"};expect(identificarEmpleado("Alvaro Pinto",[alvaro,inactivo]).propuesta?.id).toBe(1);
        expect(identificarEmpleado("Alvaro Pinto",[{...alvaro,estado:"Inactivo"}]).estado).toBe("INEXISTENTE");expect(identificarEmpleado("Alvaro Pinto",[alvaro,{...inactivo,estado:"Activo"}]).estado).toBe("AMBIGUA");
    });
    it("corrección y borrado manual tienen prioridad sobre la autopropuesta",()=>{
        expect(seleccionarEmpleado("Alvaro Pinto",[alvaro],undefined)).toEqual({empleadoId:1,metodoEmpleado:"TOKENS_COMPLETOS_UNICOS"});
        expect(seleccionarEmpleado("Alvaro Pinto",[alvaro],2)).toEqual({empleadoId:2,metodoEmpleado:"MANUAL"});expect(seleccionarEmpleado("Alvaro Pinto",[alvaro],null)).toEqual({empleadoId:null,metodoEmpleado:"SIN_ASIGNACION"});
    });
    it("normaliza el catálogo una vez para 10.000 consultas; reutiliza resultados repetidos",()=>{
        let lecturas=0;
        const catalogo=Array.from({length:2000},(_,i)=>({id:i+1,get nombre(){lecturas++;return i===0?alvaro.nombre:`Empleado Persona${i}`;}}));
        const buscar=crearBuscadorEmpleados(catalogo);expect(lecturas).toBe(2000);const inicial=buscar("Alvaro Pinto");for(let i=0;i<10000;i++)expect(buscar(i%2?"Pinto, Alvaro":"Alvaro Pinto").propuesta?.id).toBe(1);expect(buscar("Alvaro Pinto")).toBe(inicial);expect(lecturas).toBe(2000);
        const publico=identificarEmpleado("Alvaro Pinto",catalogo);expect(lecturas).toBe(4000);for(let i=0;i<10000;i++)expect(identificarEmpleado("Alvaro Pinto",catalogo)).toBe(publico);expect(lecturas).toBe(4000);
    });
});
