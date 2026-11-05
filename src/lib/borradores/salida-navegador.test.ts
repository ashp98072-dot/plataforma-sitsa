import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BORR-1b — `prepararSalidaDelNavegador`: el `.catch` global ya NO convierte cualquier excepción en «continuar». Se mockean los
 * módulos vecinos para forzar excepciones que, por diseño, `prepararCierreSesionExplicito` ya no deja escapar (defecto
 * hipotético): aun así la salida no continúa en silencio.
 */
const mocks = vi.hoisted(() => ({
  prepararCierre: vi.fn(),
  crearAlmacen: vi.fn(() => ({})),
  crearNucleo: vi.fn(() => ({})),
}));

vi.mock("./cierre-sesion", async (original) => ({ ...(await original<typeof import("./cierre-sesion")>()), prepararCierreSesionExplicito: mocks.prepararCierre }));
vi.mock("./almacen-indexeddb", () => ({ crearAlmacenIndexedDB: mocks.crearAlmacen }));
vi.mock("./nucleo", () => ({ crearNucleoBorradores: mocks.crearNucleo }));

import { prepararSalidaDelNavegador } from "./salida-navegador";
import type { DecisionTrasFallo, InformeLimpieza } from "./cierre-sesion";

beforeEach(() => {
  mocks.prepararCierre.mockReset();
  mocks.crearAlmacen.mockReset().mockReturnValue({});
  mocks.crearNucleo.mockReset().mockReturnValue({});
});

describe("excepciones al preparar la salida", () => {
  it("falla la preparación del almacenamiento ANTES de leer o borrar nada: la salida puede continuar", async () => {
    mocks.crearAlmacen.mockImplementation(() => { throw new Error("IndexedDB bloqueado"); });
    const r = await prepararSalidaDelNavegador("o1_x");
    expect(r).toEqual({ continuar: true, limpieza: "consulta_fallida", detectados: 0, eliminados: 0 });
    expect(mocks.prepararCierre).not.toHaveBeenCalled();
  });

  it("sin ownerKey no hace nada", async () => {
    expect(await prepararSalidaDelNavegador(null)).toMatchObject({ continuar: true, limpieza: "no_requerida" });
    expect(mocks.crearAlmacen).not.toHaveBeenCalled();
  });

  it("una excepción que escapa de la política (posible borrado ya autorizado) NO permite continuar en silencio: se advierte", async () => {
    mocks.prepararCierre.mockRejectedValue(new Error("defecto inesperado"));
    const informes: InformeLimpieza[] = [];
    const r = await prepararSalidaDelNavegador("o1_x", { decidirTrasFallo: async (i) => { informes.push(i); return "cancelar"; } });
    expect(informes).toHaveLength(1);
    expect(informes[0]).toMatchObject({ estado: "error_inesperado", incierto: true });
    expect(r).toMatchObject({ continuar: false, limpieza: "error_inesperado", salidaInformada: false });
  });

  it("sin interfaz de advertencia, o con una que falla, o con «reintentar»: la salida se cancela", async () => {
    mocks.prepararCierre.mockRejectedValue(new Error("defecto inesperado"));
    expect(await prepararSalidaDelNavegador("o1_x")).toMatchObject({ continuar: false });
    expect(await prepararSalidaDelNavegador("o1_x", { decidirTrasFallo: async () => { throw new Error("interfaz caída"); } })).toMatchObject({ continuar: false });
    expect(await prepararSalidaDelNavegador("o1_x", { decidirTrasFallo: async () => "reintentar" as DecisionTrasFallo })).toMatchObject({ continuar: false });
  });

  it("solo un «Salir» explícito del usuario, tras la advertencia, permite continuar (salida informada)", async () => {
    mocks.prepararCierre.mockRejectedValue(new Error("defecto inesperado"));
    const r = await prepararSalidaDelNavegador("o1_x", { decidirTrasFallo: async () => "salir" });
    expect(r).toMatchObject({ continuar: true, salidaInformada: true, limpieza: "error_inesperado" });
  });

  it("un resultado normal de la política se devuelve tal cual", async () => {
    mocks.prepararCierre.mockResolvedValue({ continuar: true, limpieza: "conservados", detectados: 2, eliminados: 0 });
    expect(await prepararSalidaDelNavegador("o1_x")).toEqual({ continuar: true, limpieza: "conservados", detectados: 2, eliminados: 0 });
  });
});
