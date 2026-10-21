import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * CLASIFICACIÓN EXPLÍCITA — qué errores de Fondos/Gastos son de DOMINIO (se muestran, con su estado) y cuáles siguen siendo
 * INESPERADOS (500 genérico). Antes cualquier `Error` normal sin code/errno/sql se mostraba con 400.
 */
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));

import { ErrorGasto, crearGasto, normalizarDestinoPago } from "./gastos";
import { crearSolicitudFondo } from "./fondos";
import { ErrorDominioFormulario, MENSAJE_ERROR_SERVIDOR, respuestaDeExcepcion } from "@/lib/validacion-formulario";

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("las validaciones esperadas lanzan ErrorDominioFormulario (400 con su mensaje)", () => {
  it("cuenta de transferencia móvil", () => {
    expect(() => normalizarDestinoPago("Transferencia móvil", "123")).toThrow(ErrorDominioFormulario);
    expect(() => normalizarDestinoPago("Transferencia móvil", null)).toThrow(ErrorDominioFormulario);
  });
  it("Fondos: precondiciones de la solicitud", async () => {
    await expect(crearSolicitudFondo(7, { fechaRequerimiento: "", lineas: [] } as never)).rejects.toBeInstanceOf(ErrorDominioFormulario);
    await expect(crearSolicitudFondo(7, { fechaRequerimiento: "2026-10-02", lineas: [], requirenteNombre: "x" } as never)).rejects.toMatchObject({ message: "La solicitud necesita al menos una línea de gasto.", status: 400 });
  });
  it("Gastos: precondiciones del gasto", async () => {
    await expect(crearGasto(7, { fechaSolicitud: "", categoria: "Combustible", monto: 1 } as never)).rejects.toBeInstanceOf(ErrorDominioFormulario);
    await expect(crearGasto(7, { fechaSolicitud: "2026-10-02", categoria: "", monto: 1 } as never)).rejects.toMatchObject({ message: "Categoría de gasto requerida." });
  });
  it("ErrorGasto es un error de dominio y conserva su estado", () => {
    const e = new ErrorGasto("Este gasto es histórico y no tiene flujo de autorización.", 409);
    expect(e).toBeInstanceOf(ErrorDominioFormulario);
    expect(respuestaDeExcepcion(e)).toEqual({ status: 409, cuerpo: { error: "Este gasto es histórico y no tiene flujo de autorización." } });
    expect(respuestaDeExcepcion(new ErrorGasto("x")).status).toBe(400);
  });
});

describe("los fallos internos NO se marcaron como dominio (siguen siendo 500)", () => {
  const INTERNOS: [string, string][] = [
    ["src/lib/tms/fondos.ts", "No se pudo crear la solicitud de fondo."],
    ["src/lib/tms/gastos.ts", "No se pudo asignar el código del gasto."],
    ["src/lib/tms/gastos.ts", "No se pudo crear el gasto."],
  ];
  it.each(INTERNOS)("%s: «%s» sigue siendo Error normal", (archivo, mensaje) => {
    const src = leer(archivo);
    expect(src).toContain(`throw new Error("${mensaje}")`);
    expect(respuestaDeExcepcion(new Error(mensaje))).toEqual({ status: 500, cuerpo: { error: MENSAJE_ERROR_SERVIDOR } });
  });
  it("no queda ningún `throw new Error` con mensaje de validación/pertenencia en las libs de Fondos, Gastos e identidad administrativa", () => {
    for (const archivo of ["src/lib/tms/fondos.ts", "src/lib/tms/gastos.ts", "src/lib/tms/identidad-administrativa.ts"]) {
      const restantes = leer(archivo).split("\n").filter((l) => l.includes("throw new Error("));
      for (const linea of restantes) {
        expect(linea, archivo).toMatch(/No se pudo (crear|asignar)/);
      }
    }
  });
});

describe("el helper no depende de heurísticas", () => {
  it("las rutas usan respuestaFalloOperacion (clasificación explícita) y no devuelven error.message directamente", () => {
    for (const ruta of ["fondos/route.ts", "fondos/[id]/route.ts", "gastos/route.ts", "gastos/[id]/route.ts"]) {
      const src = leer(`src/app/api/empresas/[slug]/tms/${ruta}`);
      expect(src, ruta).toContain("respuestaFalloOperacion(");
      expect(src, ruta).not.toMatch(/error instanceof Error \? error\.message/);
    }
  });
});
