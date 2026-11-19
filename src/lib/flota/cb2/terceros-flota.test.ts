import { beforeEach, describe, expect, it, vi } from "vitest";
import { exigirPlacaNoEsFlota, relacionPlaca } from "./terceros-flota";

/**
 * Guarda de unidad EXTERNA contra Flota. La base se simula en memoria:
 *  1 M-001MON (activa) · 2 «558 BSJ» (activa, CANÓNICA) · 3 «558BSJ» (inactiva, ABSORBIDA por la fusión 3 -> 2)
 *  4 C-777ENT (en taller) · 5 C-130BQA (activa) · 6 P-130BQA (activa; 5 y 6 hacen ambigua la forma abreviada «130 BQA»)
 */
const EMPRESA = 7;
const FLOTA = [
  { id: 1, placa: "M-001MON", activo: 1, estado: "Activo" },
  { id: 2, placa: "558 BSJ", activo: 1, estado: "Activo" },
  { id: 3, placa: "558BSJ", activo: 0, estado: "Inactivo" },
  { id: 4, placa: "C-777ENT", activo: 1, estado: "En taller" },
  { id: 5, placa: "C-130BQA", activo: 1, estado: "Activo" },
  { id: 6, placa: "P-130BQA", activo: 1, estado: "Activo" },
];
const ALIAS = [{ origen_id: 3, destino_id: 2, empresa_id: EMPRESA }];

function conexion(conTablaFusiones = true) {
  return {
    query: vi.fn(async (sql: string, args: unknown[] = []) => {
      if (sql.includes("FROM flota_vehiculos v")) return [FLOTA];
      if (sql.includes("information_schema.TABLES")) return [conTablaFusiones ? [{ TABLE_NAME: "flota_vehiculos_fusiones" }] : []];
      if (sql.includes("FROM flota_vehiculos_fusiones WHERE origen_id")) {
        const [id, empresa] = args as number[];
        const a = ALIAS.find((x) => x.origen_id === id && x.empresa_id === empresa);
        return [a ? [{ destino_id: a.destino_id }] : []];
      }
      throw new Error(`consulta no prevista: ${sql}`);
    }),
  };
}
const guarda = (placa: string, confirmar = false, c = conexion()) => exigirPlacaNoEsFlota(c as never, EMPRESA, placa, confirmar);

beforeEach(() => vi.clearAllMocks());

describe("exigirPlacaNoEsFlota — una placa de Flota no se registra como unidad externa", () => {
  it("placa de un vehículo activo, con cualquier formato (espacios, guiones, minúsculas): bloquea con 409 y lo identifica", async () => {
    for (const p of ["M-001MON", "m 001-mon", "M001MON"]) {
      await expect(guarda(p), p).rejects.toMatchObject({ status: 409, message: expect.stringContaining("ya existe en Flota: #1 (M-001MON)") });
    }
  });

  it("placa de un vehículo ABSORBIDO por una fusión: bloquea e indica el vehículo CANÓNICO", async () => {
    await expect(guarda("558 BSJ")).rejects.toThrow(/#3 \(558BSJ\) — no operable: inactiva o en taller; fusionada, vehículo canónico #2 \(558 BSJ\)/);
    await expect(guarda("558BSJ")).rejects.toThrow(/#2 \(558 BSJ\)/);
  });

  it("placa de un vehículo en taller (no operable) también bloquea: no se esquiva registrándola como externa", async () => {
    await expect(guarda("C-777ENT")).rejects.toThrow(/#4 \(C-777ENT\) — no operable: inactiva o en taller/);
  });

  it("forma abreviada (sin prefijo): bloquea; si es ambigua, lista los candidatos", async () => {
    await expect(guarda("130 BQA")).rejects.toThrow(/#5 \(C-130BQA\) \/ #6 \(P-130BQA\)/);
  });

  it("placa casi igual (un carácter) a una de Flota: pide confirmación; con confirmación expresa se permite", async () => {
    await expect(guarda("C-130BQB")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("casi igual a unidades de Flota") });
    await expect(guarda("C-130BQB", true)).resolves.toBeUndefined();
  });

  it("placa nueva que no se parece a ninguna: permitida", async () => {
    await expect(guarda("P-999ZZZ")).resolves.toBeUndefined();
    await expect(guarda("M-424KHK")).resolves.toBeUndefined();
  });

  it("la coincidencia EXACTA no se puede confirmar: `confirmarCoincidencias` no la salta", async () => {
    await expect(guarda("M-001MON", true)).rejects.toThrow(/ya existe en Flota/);
  });

  it("consulta el alcance de la empresa (propios + compartidos), NO filtra por activo/estado ni excluye absorbidos, y usa parámetros", async () => {
    const c = conexion();
    await guarda("P-999ZZZ", false, c);
    const [sql, args] = c.query.mock.calls[0] as unknown as [string, number[]];
    expect(sql).toContain("v.empresa_id = ?");
    expect(sql).toContain("flota_vehiculo_acceso");
    expect(sql).not.toMatch(/v\.activo\s*=\s*1|estado\s*=\s*'Activo'|NOT EXISTS/i);
    expect(args).toEqual([EMPRESA, EMPRESA]);
  });

  it("sin tabla de fusiones (migración no instalada) la guarda funciona igual, sin canónico", async () => {
    await expect(guarda("558BSJ", false, conexion(false))).rejects.toThrow(/#2 \(558 BSJ\) \/ #3 \(558BSJ\)/);
    await expect(guarda("558BSJ", false, conexion(false))).rejects.not.toThrow(/canónico/);
  });

  describe("caso INVERSO: placa nueva COMPLETA frente a una placa de Flota ABREVIADA (comprobación bidireccional local)", () => {
    it("«C-558BSJ» (completa) frente a «558 BSJ» y «558BSJ» de Flota: bloquea e indica el canónico; `confirmarCoincidencias` NO lo salta", async () => {
      for (const confirmar of [false, true]) {
        await expect(guarda("C-558BSJ", confirmar), String(confirmar)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/ya existe en Flota: #2 \(558 BSJ\) \/ #3 \(558BSJ\) — no operable: inactiva o en taller; fusionada, vehículo canónico #2 \(558 BSJ\)/) });
      }
    });
    it("cualquier letra de prefijo coincide con la abreviada (M-558BSJ, c558bsj, C 558 BSJ)", async () => {
      for (const p of ["M-558BSJ", "c558bsj", "C 558 BSJ"]) await expect(guarda(p, true), p).rejects.toThrow(/ya existe en Flota: #2/);
    });
    it("el sentido directo se conserva (abreviada nueva frente a Flota completa) y sigue sin poder confirmarse", async () => {
      await expect(guarda("001 MON", true)).rejects.toThrow(/ya existe en Flota: #1 \(M-001MON\)/);
    });
    it("una placa distinta a un carácter sigue siendo solo «casi igual» (confirmable), no coincidencia exacta/abreviada", async () => {
      await expect(guarda("558 BSK")).rejects.toThrow(/casi igual/);
      await expect(guarda("558 BSK", true)).resolves.toBeUndefined();
    });
  });

  describe("relacionPlaca (local, simétrica)", () => {
    it.each([
      ["M-001MON", "m 001 mon", "EXACTA"],
      ["C-558BSJ", "558 BSJ", "ABREVIADA"],
      ["558 BSJ", "C558BSJ", "ABREVIADA"],
      ["130 BQA", "C-130BQA", "ABREVIADA"],
      ["C-130BQA", "130 BQA", "ABREVIADA"],
      ["C-130BQA", "P-130BQA", null], // dos placas completas con prefijos distintos NO son la misma
      ["558BSJ", "558BSK", null],
      ["558BSJ", "M-001MON", null],
      ["", "558BSJ", null],
      ["CANECA", "558BSJ", null],
    ] as const)("%s vs %s -> %s (y al revés)", (a, b, esperado) => {
      expect(relacionPlaca(a, b)).toBe(esperado);
      expect(relacionPlaca(b, a)).toBe(esperado);
    });
  });

  describe("reutilización de una unidad externa ya registrada (devolución anticipada de registrarUnidad)", () => {
    it("si su placa ya es de Flota: bloquea (no se reutiliza) e identifica la unidad externa; confirmar no lo salta", async () => {
      await expect(exigirPlacaNoEsFlota(conexion() as never, EMPRESA, "M-001MON", true, { reutilizando: { id: 21 } }))
        .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/La unidad externa #21 \(«M-001MON»\) coincide con una unidad de Flota: #1 \(M-001MON\)\. No se reutiliza como externa.*no se modifican/) });
      await expect(exigirPlacaNoEsFlota(conexion() as never, EMPRESA, "C-558BSJ", false, { reutilizando: { id: 21 } })).rejects.toThrow(/La unidad externa #21/);
    });
    it("conserva la idempotencia: una externa legítima (sin choque, o solo «casi igual» ya confirmada al crearla) se reutiliza sin error", async () => {
      await expect(exigirPlacaNoEsFlota(conexion() as never, EMPRESA, "P-999ZZZ", false, { reutilizando: { id: 21 } })).resolves.toBeUndefined();
      await expect(exigirPlacaNoEsFlota(conexion() as never, EMPRESA, "C-130BQB", false, { reutilizando: { id: 21 } })).resolves.toBeUndefined();
    });
  });
});
