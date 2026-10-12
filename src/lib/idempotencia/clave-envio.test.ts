import { describe, expect, it, vi } from "vitest";
import { CLAVE_ENVIO_REGEX, crearGuardEnvio, nuevaClaveEnvio } from "./clave-envio";

describe("nuevaClaveEnvio", () => {
  it("genera claves válidas y distintas en cada llamada", () => {
    const claves = new Set(Array.from({ length: 50 }, () => nuevaClaveEnvio()));
    expect(claves.size).toBe(50);
    for (const c of claves) expect(c).toMatch(CLAVE_ENVIO_REGEX);
  });

  it("sin crypto.randomUUID (contexto no seguro) usa getRandomValues y sigue siendo válida", () => {
    const original = globalThis.crypto;
    const getRandomValues = vi.fn((arr: Uint8Array) => { arr.fill(171); return arr; });
    Object.defineProperty(globalThis, "crypto", { value: { getRandomValues }, configurable: true });
    try {
      const clave = nuevaClaveEnvio();
      expect(getRandomValues).toHaveBeenCalledOnce();
      expect(clave).toMatch(CLAVE_ENVIO_REGEX);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });

  it("el formato rechaza claves cortas, con espacios o símbolos", () => {
    for (const mala of ["", "corta", "con espacios en la clave 123", "a'; DROP TABLE x;--", "x".repeat(65)]) {
      expect(CLAVE_ENVIO_REGEX.test(mala)).toBe(false);
    }
  });
});

describe("crearGuardEnvio — un solo envío en vuelo", () => {
  it("dos clics en el mismo tick: solo el primero ejecuta la tarea (la bandera es síncrona)", async () => {
    const guard = crearGuardEnvio();
    const tarea = vi.fn(async () => { await Promise.resolve(); return "creado"; });
    const [a, b] = await Promise.all([guard.ejecutar(tarea), guard.ejecutar(tarea)]);
    expect(tarea).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ omitido: false, valor: "creado" });
    expect(b).toEqual({ omitido: true });
  });

  it("mientras está en vuelo reporta enVuelo=true y al terminar se libera (botón bloqueado → habilitado)", async () => {
    const guard = crearGuardEnvio();
    let liberar!: () => void;
    const pendiente = guard.ejecutar(() => new Promise<void>((r) => { liberar = r; }));
    expect(guard.enVuelo).toBe(true);
    liberar();
    await pendiente;
    expect(guard.enVuelo).toBe(false);
  });

  it("si la tarea falla, el guard se libera y permite reintentar (botón habilitado tras error)", async () => {
    const guard = crearGuardEnvio();
    await expect(guard.ejecutar(async () => { throw new Error("red caída"); })).rejects.toThrow("red caída");
    expect(guard.enVuelo).toBe(false);
    const reintento = vi.fn(async () => "ok");
    expect(await guard.ejecutar(reintento)).toEqual({ omitido: false, valor: "ok" });
    expect(reintento).toHaveBeenCalledOnce();
  });

  it("Enter + clic encadenados mientras la primera tarea sigue pendiente no disparan una segunda", async () => {
    const guard = crearGuardEnvio();
    let liberar!: () => void;
    const tarea = vi.fn(() => new Promise<void>((r) => { liberar = r; }));
    const primera = guard.ejecutar(tarea);
    const segunda = await guard.ejecutar(tarea);
    const tercera = await guard.ejecutar(tarea);
    expect(segunda).toEqual({ omitido: true });
    expect(tercera).toEqual({ omitido: true });
    liberar();
    await primera;
    expect(tarea).toHaveBeenCalledTimes(1);
  });
});
