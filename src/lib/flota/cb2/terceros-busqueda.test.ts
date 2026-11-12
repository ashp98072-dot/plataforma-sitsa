import { describe, expect, it } from "vitest";
import { normalizarBusquedaUnidad, unidadTerceraCompatible } from "./terceros-busqueda";
import { reconocerTercero, type AsociacionExterna } from "./terceros-model";
const a: AsociacionExterna = { id: 1, piloto_id: 2, unidad_id: 3, nombre: "Luís Escobar", placa: "M-060KHK", tipo: "MOTOCICLETA", descripcion: "Laboratorio ficticio", relacion: "CONTRATISTA", estado: "VERIFICADA", revision: 1, piloto_referencia: "lab-p", unidad_referencia: "lab-u" };
describe("vale 19955: búsquedas sin modificar originales", () => {
  it.each(["060 KHK", "060KHK", "060-KHK"])("encuentra %s y reconoce prefijo único", placa => {
    expect(normalizarBusquedaUnidad(a.placa).includes(normalizarBusquedaUnidad(placa))).toBe(true);
    expect(reconocerTercero("  luis  ESCOBAR ", placa, [a]).asociacion?.id).toBe(1);
    expect(unidadTerceraCompatible(placa, 3, [{ id: 3, placa: a.placa }])).toBe(true);
    expect(a.placa).toBe("M-060KHK");
  });
  it("abreviada ambigua exige selección explícita justificada; nunca reconocimiento", () => {
    const unidades = [{ id: 3, placa: a.placa }, { id: 4, placa: "C060KHK" }];
    expect(reconocerTercero(a.nombre, "060KHK", [a], { pilotos: [{ id: 2, nombre: a.nombre, referencia: "lab-p" }], unidades: unidades.map(u => ({ ...u, referencia: `lab-${u.id}`, tipo: "MOTOCICLETA", descripcion: "Sintética" })) }).asociacion).toBeNull();
    expect(unidadTerceraCompatible("060KHK", 3, unidades)).toBe(false);
    expect(unidadTerceraCompatible("060KHK", 3, unidades, "Revisé la referencia real de la unidad")).toBe(true);
    expect(unidadTerceraCompatible("999XXX", 3, unidades, "No permite inventar coincidencias")).toBe(false);
    expect(unidadTerceraCompatible("C060KHK", 3, unidades, "No permite cambiar un prefijo explícito")).toBe(false);
  });
  it.each(["PENDIENTE", "REVOCADA"])("%s nunca se reconoce", estado => {
    expect(reconocerTercero(a.nombre, "060KHK", [{ ...a, estado }]).asociacion).toBeNull();
  });
});
