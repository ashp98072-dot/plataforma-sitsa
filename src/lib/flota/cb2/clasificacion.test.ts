import { describe, expect, it } from "vitest";
import { clasificarProducto, identificarEmpleado } from "./clasificacion";
describe("clasificación y búsqueda conservadoras PR514", () => {
    it.each([["Diesel","DIESEL"],["Diésel","DIESEL"],["Regular","GASOLINA_REGULAR"],["Gasolina regular","GASOLINA_REGULAR"],["Super","GASOLINA_SUPERIOR"],["Súper","GASOLINA_SUPERIOR"],["Gasolina superior","GASOLINA_SUPERIOR"],["V-POWER DIESEL","VPOWER_DIESEL"],["V-POWER GASOLINA","VPOWER_GASOLINA"],["V-POWER",null],["",null],["Diesel / Regular",null]])("producto %s → %s", (original, esperado) => expect(clasificarProducto(original)).toBe(esperado));
    const empleados = [{id:1,nombre:"José Antonio Chay"},{id:2,nombre:"Héctor René Set"},{id:3,nombre:"Jorge Luis Sarceño"},{id:4,nombre:"José Carlos Ordoñez"}];
    it.each(["JOSE CHAY","HECTOR SET","JORGE SARCEÑO","JOSE ORDOÑEZ","CHAY JOSE"])("tokens completos %s sugieren sin asignación débil", nombre => { const m=identificarEmpleado(nombre,empleados);expect(m.estado).toBe("PARCIAL_UNICA");expect(m.candidatos).toHaveLength(1);expect(m.propuesta).toBeNull(); });
    it("exacta única normaliza tildes, caso y espacios; homónimos y un apellido no identifican", () => {
        expect(identificarEmpleado("  JOSE   ANTONIO CHAY ",empleados).propuesta?.id).toBe(1);
        expect(identificarEmpleado("JOSE CHAY",[...empleados,{id:5,nombre:"José Manuel Chay"}]).estado).toBe("AMBIGUA");
        expect(identificarEmpleado("José Antonio Chay",[...empleados,{id:6,nombre:"JOSE ANTONIO CHAY"}]).propuesta).toBeNull();
        for(const s of ["CHAY","JO CHAY","JOSE CHA","JOSE CHAY"]) expect(identificarEmpleado(s,s === "JOSE CHAY" ? [] : empleados).propuesta).toBeNull();
    });
});
