import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { diagnosticarVehiculos } from "./vehiculos-catalogo";
import { opcionesVehiculo } from "./combustible-estaciones-ui";
import { catalogosCombustible } from "./combustible-staff";
import { query } from "@/lib/db";

it("una fila repetida por ID produce una sola opción; no se confunde con dos registros", () => {
  const v = { id: 7, placa: "C-035BXR" };
  expect(diagnosticarVehiculos([v, { ...v, id: "7" as never }])).toMatchObject({ idsRepetidos: [7], posiblesDuplicados: [], vehiculos: [v] });
  expect(opcionesVehiculo([v, v], { id: 7, placa: v.placa })).toHaveLength(1);
});
it("dos IDs de igual placa se conservan identificados; no hay fusión por matrícula", () => {
  const filas = [{ id: 7, placa: "C-035BXR" }, { id: 9, placa: " c – 035bxr " }];
  expect(diagnosticarVehiculos(filas).posiblesDuplicados).toEqual([{ placa: "C035BXR", ids: [7, 9] }]);
  expect(opcionesVehiculo(filas).map(o => [o.value, o.detail])).toEqual([
    ["7", "Registro #7 · placa repetida, verificar unidad"], ["9", "Registro #9 · placa repetida, verificar unidad"],
  ]);
});
it("vale 15094: histórico con misma placa y otro ID no se reemplaza por el activo", () => {
  const opciones = opcionesVehiculo([{ id: 9, placa: "C-035BXR" }], { id: 7, placa: "C-035BXR" });
  expect(opciones.map(o => o.value)).toEqual(["7", "9"]);
  expect(opciones[0].label).toContain("histórico"); expect(opciones.every(o => o.detail?.includes("Registro #"))).toBe(true);
});
it("placas similares no son duplicados y placas vacías no forman grupos", () => {
  const d = diagnosticarVehiculos([{ id: 1, placa: "C-035BXR" }, { id: 2, placa: "P-035BXR" }, { id: 3, placa: "" }, { id: 4, placa: "" }]);
  expect(d.posiblesDuplicados).toEqual([]); expect(d.vehiculos).toHaveLength(4);
});
it("catálogo diagnostica exclusivamente filas accesibles, parametriza tenant y no consulta otros vehículos", async () => {
  vi.mocked(query).mockReset();
  vi.mocked(query).mockImplementation((async (sql: string, params: number[]) => {
    if (sql.includes("FROM flota_vehiculos")) {
      expect(sql).toContain("EXISTS"); expect(sql).not.toContain("JOIN"); expect(params).toEqual([3, 3]);
      return [{ id: 7, placa: "C-035BXR" }, { id: 7, placa: "C-035BXR" }, { id: 9, placa: "C-035BXR" }];
    }
    return [];
  }) as never);
  const result = await catalogosCombustible(3);
  expect(result.vehiculos.map(v => v.id)).toEqual([7, 9]);
  expect(result.diagnosticoVehiculos).toEqual({ idsRepetidos: [7], posiblesDuplicados: [{ placa: "C035BXR", ids: [7, 9] }] });
  expect(query).toHaveBeenCalledTimes(3);
});
