import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
import { execute, query } from "@/lib/db";
import { MARCAS_DOCUMENTO } from "./cotizacion-documento";
import { guardarPresentacionComercial, obtenerPresentacionComercial } from "./cotizacion-presentacion";

beforeEach(() => vi.resetAllMocks());

describe("obtenerPresentacionComercial — defaults por marca", () => {
  it("sin filas en configuracion: cae al texto fijo de cada marca (mismo que usa el PDF de una cotización sin snapshot)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const p = await obtenerPresentacionComercial(7);
    expect(p.KUIQTRANS).toEqual({ mensaje: MARCAS_DOCUMENTO.KUIQTRANS.saludo, cierre: MARCAS_DOCUMENTO.KUIQTRANS.cierre });
    expect(p.MONACO).toEqual({ mensaje: MARCAS_DOCUMENTO.MONACO.saludo, cierre: MARCAS_DOCUMENTO.MONACO.cierre });
  });

  it("con filas guardadas: usa el valor de configuracion en vez del fijo", async () => {
    vi.mocked(query).mockResolvedValue([
      { parametro: "cotizaciones_mensaje_monaco", valor: "Saludos personalizados de Mónaco." },
      { parametro: "cotizaciones_cierre_kuiqtrans", valor: "Cierre a la medida de KuiqTrans." },
    ] as never);
    const p = await obtenerPresentacionComercial(7);
    expect(p.MONACO.mensaje).toBe("Saludos personalizados de Mónaco.");
    expect(p.MONACO.cierre).toBe(MARCAS_DOCUMENTO.MONACO.cierre); // sin fila -> sigue el fijo
    expect(p.KUIQTRANS.cierre).toBe("Cierre a la medida de KuiqTrans.");
    expect(p.KUIQTRANS.mensaje).toBe(MARCAS_DOCUMENTO.KUIQTRANS.saludo);
  });

  it("una fila con valor vacío (override borrado) también cae al fijo, no a cadena vacía", async () => {
    vi.mocked(query).mockResolvedValue([{ parametro: "cotizaciones_mensaje_monaco", valor: "" }] as never);
    const p = await obtenerPresentacionComercial(7);
    expect(p.MONACO.mensaje).toBe(MARCAS_DOCUMENTO.MONACO.saludo);
  });

  it("tenant isolation: consulta con la empresa recibida y solo los 4 parametro de presentación", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await obtenerPresentacionComercial(9);
    const [sql, params] = vi.mocked(query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE empresa_id = ?");
    expect(params[0]).toBe(9);
    expect(params.slice(1)).toEqual([
      "cotizaciones_mensaje_kuiqtrans", "cotizaciones_cierre_kuiqtrans",
      "cotizaciones_mensaje_monaco", "cotizaciones_cierre_monaco",
    ]);
  });

  it("si la tabla configuracion no existe todavía en esta instalación, no rompe: sirve los defaults fijos", async () => {
    vi.mocked(query).mockRejectedValue(new Error("Table 'configuracion' doesn't exist"));
    const p = await obtenerPresentacionComercial(7);
    expect(p.KUIQTRANS.mensaje).toBe(MARCAS_DOCUMENTO.KUIQTRANS.saludo);
  });
});

describe("guardarPresentacionComercial — solo defaults, nunca cotizaciones", () => {
  it("guarda mensaje y cierre de una marca con INSERT ... ON DUPLICATE KEY UPDATE (nunca DELETE)", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
    await guardarPresentacionComercial(7, { MONACO: { mensaje: " Hola. ", cierre: " Gracias. " } });
    expect(execute).toHaveBeenCalledTimes(2);
    const llamadas = vi.mocked(execute).mock.calls;
    expect(llamadas.some(([sql, params]) => String(sql).includes("ON DUPLICATE KEY UPDATE") && (params as unknown[])[2] === "Hola.")).toBe(true);
    expect(llamadas.some(([, params]) => (params as unknown[])[1] === "cotizaciones_mensaje_monaco" && (params as unknown[])[0] === 7)).toBe(true);
    expect(llamadas.some(([sql]) => String(sql).match(/\bDELETE\b/i))).toBe(false);
  });

  it("solo escribe las marcas/campos presentes en `cambios`", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
    await guardarPresentacionComercial(7, { KUIQTRANS: { mensaje: "Solo el mensaje." } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execute).mock.calls[0][1]).toEqual([7, "cotizaciones_mensaje_kuiqtrans", "Solo el mensaje."]);
  });

  it("sin cambios (objeto vacío) no escribe nada", async () => {
    await guardarPresentacionComercial(7, {});
    expect(execute).not.toHaveBeenCalled();
  });

  it("rechaza texto de más de 2000 caracteres, para cualquiera de las dos marcas, sin escribir nada", async () => {
    const largo = "x".repeat(2001);
    await expect(guardarPresentacionComercial(7, { MONACO: { mensaje: largo } })).rejects.toThrow(/no puede exceder 2000 caracteres/);
    await expect(guardarPresentacionComercial(7, { KUIQTRANS: { cierre: largo } })).rejects.toThrow(/no puede exceder 2000 caracteres/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("nunca modifica tms_cotizaciones: solo toca la tabla configuracion", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
    await guardarPresentacionComercial(7, { MONACO: { mensaje: "x", cierre: "y" }, KUIQTRANS: { mensaje: "z", cierre: "w" } });
    for (const [sql] of vi.mocked(execute).mock.calls) {
      expect(String(sql)).toContain("configuracion");
      expect(String(sql)).not.toContain("tms_cotizaciones");
    }
  });

  it("aislamiento por empresa: cada escritura lleva la empresa recibida", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
    await guardarPresentacionComercial(11, { MONACO: { mensaje: "x" } });
    expect(vi.mocked(execute).mock.calls[0][1]![0]).toBe(11);
  });
});
