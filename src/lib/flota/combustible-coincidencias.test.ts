import { describe, expect, it } from "vitest";
import { buscarCoincidencias, placaComparable } from "./combustible-coincidencias";
describe("coincidencias conservadoras en catálogo suministrado", () => {
    const pilotos = [{ id: 1, nombre: "José Chay" }, { id: 2, nombre: "Héctor Set" }, { id: 3, nombre: "José Carlos Chay" }];
    it.each([" JOSE   CHAY ", "José Chay", "jose chay"])("piloto exacto %s", nombre => expect(buscarCoincidencias(nombre, pilotos, p => p.nombre, "piloto")).toMatchObject({ estado: "EXACTA", candidatos: [pilotos[0]] }));
    it("tildes, homónimos, nombres parciales y apellidos invertidos", () => {
        expect(buscarCoincidencias("HECTOR SET", pilotos, p => p.nombre, "piloto").candidatos).toEqual([pilotos[1]]);
        expect(buscarCoincidencias("Jose Chay", [...pilotos, { id: 4, nombre: "JOSE CHAY" }], p => p.nombre, "piloto").estado).toBe("AMBIGUA");
        expect(buscarCoincidencias("Chay Jose", pilotos, p => p.nombre, "piloto").estado).toBe("APROXIMADA");
        expect(buscarCoincidencias("José", pilotos, p => p.nombre, "piloto").estado).toBe("INEXISTENTE");
        expect(buscarCoincidencias("José Chay", [], p => String(p), "piloto").estado).toBe("INEXISTENTE");
    });
    it("placas con separadores, prefijos preservados y caracteres diferentes", () => {
        const vs = [{ id: 1, placa: "C-570BZT" }];
        for (const s of ["C-570BZT", " C 570 BZT ", "C–570BZT"]) expect(buscarCoincidencias(s, vs, v => v.placa, "placa").estado).toBe("EXACTA");
        expect(buscarCoincidencias("570 BZT", vs, v => v.placa, "placa").estado).toBe("ABREVIADA");
        expect(buscarCoincidencias("C-570BZ7", vs, v => v.placa, "placa").estado).toBe("APROXIMADA");
        expect(buscarCoincidencias("C-570BZT", [...vs, { id: 2, placa: "C 570 BZT" }], v => v.placa, "placa").estado).toBe("AMBIGUA");
        expect(placaComparable("C/570BZT")).toBe(""); expect(placaComparable("570 BZT")).not.toBe(placaComparable("C-570BZT"));
    });
});
