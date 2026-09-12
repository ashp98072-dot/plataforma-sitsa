import { describe, expect, it, vi } from "vitest";
import { procesarConfirmacionAutorizacion } from "./autorizacion-confirmacion";

describe("confirmación de autorización", () => {
  it("cancelar no ejecuta ninguna petición", async () => {
    const autorizar = vi.fn();
    const bloqueo = { current: null as number | null };
    expect(await procesarConfirmacionAutorizacion({ confirmada: false, id: 1, bloqueo, autorizar })).toBe(false);
    expect(autorizar).not.toHaveBeenCalled();
  });

  it("confirmar ejecuta exactamente una petición", async () => {
    const autorizar = vi.fn();
    const bloqueo = { current: null as number | null };
    expect(await procesarConfirmacionAutorizacion({ confirmada: true, id: 1, bloqueo, autorizar })).toBe(true);
    expect(autorizar).toHaveBeenCalledOnce();
  });

  it("doble clic concurrente no duplica la autorización", async () => {
    let terminar!: () => void;
    const autorizar = vi.fn(() => new Promise<void>((resolve) => { terminar = resolve; }));
    const bloqueo = { current: null as number | null };
    const primera = procesarConfirmacionAutorizacion({ confirmada: true, id: 1, bloqueo, autorizar });
    const segunda = procesarConfirmacionAutorizacion({ confirmada: true, id: 1, bloqueo, autorizar });
    expect(await segunda).toBe(false);
    expect(autorizar).toHaveBeenCalledOnce();
    terminar();
    expect(await primera).toBe(true);
  });
});
