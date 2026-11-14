import { describe, expect, it, vi } from "vitest";
import { idUnidadTrasUpsert } from "./unidad-upsert";

describe("idUnidadTrasUpsert", () => {
  it("usa insertId cuando es válido (sin consulta extra)", async () => {
    const buscar = vi.fn();
    expect(await idUnidadTrasUpsert(12, buscar)).toBe(12);
    expect(await idUnidadTrasUpsert("7", buscar)).toBe(7);
    expect(buscar).not.toHaveBeenCalled();
  });
  it.each([0, "0", null, undefined, NaN])("insertId %s -> busca la unidad por placa", async (v) => {
    expect(await idUnidadTrasUpsert(v, async () => 55)).toBe(55);
  });
  it("si no se puede resolver, falla en vez de devolver 0 (nunca un unidad_id inexistente)", async () => {
    await expect(idUnidadTrasUpsert(0, async () => null)).rejects.toThrow("No se pudo resolver la unidad");
  });
});
