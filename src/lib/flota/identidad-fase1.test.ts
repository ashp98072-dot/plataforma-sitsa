import { describe, expect, it } from "vitest";
import { chasisAcreditable, serialChasis, validarChasisParaRegistro } from "./chasis";
import { anotarIdentidades, colapsoPorIdentidadActivo } from "./vehiculos-identidad";

describe("chasis (C3)", () => {
  it("normaliza a mayúsculas sin espacios", () => { expect(serialChasis(" 3n6 ab12 ")).toBe("3N6AB12"); });
  it.each(["", "ABC", "AAAAAAAA", "desconocido", "PENDIENTE", "sin dato", "AB-123456", "x".repeat(33)])("rechaza «%s»", v => {
    expect(validarChasisParaRegistro(v).ok).toBe(false);
  });
  it("acepta un chasis real y lo guarda normalizado", () => {
    expect(validarChasisParaRegistro("3n6 ab12345 xy")).toEqual({ ok: true, valor: "3N6AB12345XY" });
    expect(chasisAcreditable("3N6AB12345XY")).toBe(true);
  });
});

describe("anotarIdentidades (C4): colapso por identidad aprobada, nunca por placa", () => {
  const vehs = [{ id: 602, empresa_id: 4 }, { id: 1296, empresa_id: 1 }, { id: 50, empresa_id: 1 }];
  const reps = [{ id: 1296, identidadFisicaId: 7, equivalenciasHistoricas: [1296, 602] }, { id: 50, equivalenciasHistoricas: [50] }];
  it("la ficha representante queda visible y la vinculada apunta a ella", async () => {
    const r = await anotarIdentidades(vehs, 1, reps);
    const por = Object.fromEntries(r.map(x => [x.id, x]));
    expect(por[1296]).toMatchObject({ esRepresentante: true, vinculadaA: null, identidadFisicaId: 7, fichasVinculadas: [602] });
    expect(por[602]).toMatchObject({ esRepresentante: false, vinculadaA: 1296, identidadFisicaId: 7, fichasVinculadas: [1296] });
  });
  it("una ficha sin identidad es su propia representante, sin vínculos", async () => {
    const r = await anotarIdentidades(vehs, 1, reps);
    expect(r.find(x => x.id === 50)).toMatchObject({ esRepresentante: true, vinculadaA: null, identidadFisicaId: null, fichasVinculadas: [] });
    expect((await anotarIdentidades([{ id: 9 }], 1, [])).at(0)).toMatchObject({ esRepresentante: true, fichasVinculadas: [] });
  });
  it("no pierde fichas (la API devuelve la lista completa) ni mezcla datos", async () => {
    expect((await anotarIdentidades(vehs, 1, reps)).map(x => x.id)).toEqual([602, 1296, 50]);
  });
  it("interruptor de emergencia FLOTA_IDENTIDAD_COLAPSO_UI=0", () => {
    expect(colapsoPorIdentidadActivo({} as NodeJS.ProcessEnv)).toBe(true);
    expect(colapsoPorIdentidadActivo({ FLOTA_IDENTIDAD_COLAPSO_UI: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
