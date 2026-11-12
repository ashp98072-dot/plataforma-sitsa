import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));

import { query } from "@/lib/db";
import { colaboradorParticipaEnViaje } from "./viajes-piloto";

// TMS-ENTREGA-PILOTO-2 — la opción nueva NO cambia el comportamiento de los callers existentes.
beforeEach(() => { vi.clearAllMocks(); });
describe("colaboradorParticipaEnViaje: errores de base de datos", () => {
  it("por defecto (callers existentes) el error se traga y equivale a «no participa» (null), como siempre", async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error("Too many connections"));
    expect(await colaboradorParticipaEnViaje(7, 31, 900)).toBeNull();
  });
  it("con propagarErrores el error se relanza para que el llamador distinga «no participa» de «servicio no disponible»", async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error("Too many connections"));
    await expect(colaboradorParticipaEnViaje(7, 31, 900, { propagarErrores: true })).rejects.toThrow("Too many connections");
  });
  it("sin error el resultado es el mismo con y sin la opción; la consulta lleva empresa, viaje y colaborador", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 900, plan_id: 55, estado: "abierto" }] as never);
    const a = await colaboradorParticipaEnViaje(7, 31, 900); const b = await colaboradorParticipaEnViaje(7, 31, 900, { propagarErrores: true });
    expect(a).toEqual({ viajeId: 900, planId: 55, estado: "abierto" }); expect(b).toEqual(a);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([900, 7, 31, 31, 31, 31, 31]);
    vi.mocked(query).mockResolvedValue([] as never); expect(await colaboradorParticipaEnViaje(7, 31, 900, { propagarErrores: true })).toBeNull();
  });
});
