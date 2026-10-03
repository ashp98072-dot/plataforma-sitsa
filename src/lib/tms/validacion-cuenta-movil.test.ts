import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * Pre-validación PURA de la cuenta de «Transferencia móvil» (misma regla que normalizarDestinoPago): permite que ese error salga
 * junto con los demás de la línea. Incluye el ejemplo del ticket (línea 2 con categoría vacía, monto 0, transferencia móvil y
 * cuenta vacía) y una prueba de PARIDAD contra la regla original para que ambas no se desvíen.
 */
vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/tms/fondos", () => ({ ESTADOS_FONDO: ["Pendiente"], crearSolicitudFondo: vi.fn(), listarSolicitudesFondo: vi.fn() }));

import { requireTenantGastos } from "@/lib/tenant";
import { crearSolicitudFondo } from "@/lib/tms/fondos";
import { normalizarDestinoPago } from "@/lib/tms/gastos";
import { conCuentaMovil } from "@/lib/tms/validacion-fondos-gastos";
import { textoError, type ErrorFormulario } from "@/lib/validacion-formulario";
import { POST } from "@/app/api/empresas/[slug]/tms/fondos/route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastos).mockResolvedValue({ empresa: { id: 7 }, session: { id: 8, username: "ops" } } as Awaited<ReturnType<typeof requireTenantGastos>>);
  vi.mocked(crearSolicitudFondo).mockResolvedValue({ id: 1 } as never);
});

describe("ejemplo del ticket (§16): Solicitud de fondo, línea 2", () => {
  it("categoría vacía + monto 0 + transferencia móvil + cuenta vacía: los TRES errores de una sola vez", async () => {
    const body = {
      entidadRequirenteId: 1, requirenteUsuarioId: 4, solicitanteUsuarioId: 5, fechaRequerimiento: "2026-10-02",
      lineas: [{ categoria: "Combustible", monto: 100 }, { categoria: "", monto: 0, metodoPago: "Transferencia móvil", cuentaOverride: "" }],
    };
    const res = await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect((json.errores as ErrorFormulario[]).map(textoError)).toEqual([
      "Línea 2 — Categoría: selecciona una categoría.",
      "Línea 2 — Monto: debe ser mayor que Q0.",
      "Línea 2 — Cuenta: es obligatoria para transferencia móvil.",
    ]);
    expect(json.error).toBe("Hay datos que debes corregir.");
    expect(crearSolicitudFondo).not.toHaveBeenCalled();
  });
  it("cuenta con longitud incorrecta en la línea 4", async () => {
    const linea = { categoria: "Combustible", monto: 10 };
    const body = {
      entidadRequirenteId: 1, requirenteUsuarioId: 4, solicitanteUsuarioId: 5, fechaRequerimiento: "2026-10-02",
      lineas: [linea, linea, linea, { ...linea, metodoPago: "Transferencia móvil", cuentaOverride: "1234" }],
    };
    const json = await (await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx)).json();
    expect((json.errores as ErrorFormulario[]).map(textoError)).toEqual(['Línea 4 — Cuenta: para transferencia móvil debe tener entre 8 y 15 dígitos (puede iniciar con "+").']);
  });
  it("con empleado y sin cuenta en el payload NO se rechaza (el servidor toma el teléfono de RRHH)", async () => {
    const body = {
      entidadRequirenteId: 1, requirenteUsuarioId: 4, solicitanteUsuarioId: 5, fechaRequerimiento: "2026-10-02",
      lineas: [{ categoria: "Combustible", monto: 10, metodoPago: "Transferencia móvil", empleadoId: 9 }],
    };
    expect((await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx)).status).toBe(200);
  });
  it("otros métodos de pago no exigen cuenta", async () => {
    const body = {
      entidadRequirenteId: 1, requirenteUsuarioId: 4, solicitanteUsuarioId: 5, fechaRequerimiento: "2026-10-02",
      lineas: [{ categoria: "Combustible", monto: 10, metodoPago: "Efectivo" }],
    };
    expect((await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx)).status).toBe(200);
  });
});

describe("paridad con normalizarDestinoPago (gastos.ts)", () => {
  /** Resultado del schema para "Transferencia móvil" con esa cuenta y SIN empleado. */
  function valida(cuenta: string | null | undefined, nullEsVacio: boolean): boolean {
    const s = conCuentaMovil(z.object({ metodoPago: z.string(), cuenta: z.string().nullable().optional() }), "cuenta", nullEsVacio);
    return s.safeParse({ metodoPago: "Transferencia móvil", cuenta }).success;
  }
  function reglaOriginal(cuenta: string | null | undefined): boolean {
    try { normalizarDestinoPago("Transferencia móvil", cuenta ?? null); return true; } catch { return false; }
  }
  const casos = ["", "   ", "1234567", "12345678", "123456789012345", "1234567890123456", "+50212345678", "5021+2345678", "2345 6789", "2345-6789", "abcdefgh", "+", " +502 1234 5678 "];
  it.each(casos)("cuenta %j: el schema acepta exactamente lo que acepta la regla original", (c) => {
    expect(valida(c, true)).toBe(reglaOriginal(c));
    expect(valida(c, false)).toBe(reglaOriginal(c));
  });
  it("sin dato y sin empleado: ambas lo rechazan", () => {
    expect(valida(undefined, true)).toBe(false);
    expect(reglaOriginal(undefined)).toBe(false);
    expect(valida(null, true)).toBe(false); // Gastos: null = campo vacío
    expect(valida(null, false)).toBe(false); // Fondos: null = sin dato; sin empleado también falla
  });
});
