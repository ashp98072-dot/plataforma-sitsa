import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViajesCerrar: vi.fn() }));
vi.mock("@/lib/tms/cierre-masivo", () => ({ cerrarViajesMasivoPorPeriodo: vi.fn() }));

import { requireTenantViajesCerrar } from "@/lib/tenant";
import { cerrarViajesMasivoPorPeriodo } from "@/lib/tms/cierre-masivo";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const resultado = { tipo: "NORMAL", solicitados: 10, cerrados: [{ id: 1, codigo: "P-1" }], omitidos: [], errores: [], agrupacion: "MES", valor: "2026-09", etiqueta: "Septiembre 2026" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViajesCerrar).mockResolvedValue({ session: { username: "jefe" }, empresa: { id: 7 } } as never);
  vi.mocked(cerrarViajesMasivoPorPeriodo).mockResolvedValue(resultado as never);
});

describe("POST /tms/planes/cerrar-masivo-periodo — seguridad", () => {
  it("exige viajes_cerrar:editar; sin permiso devuelve el error del guard y no cierra nada", async () => {
    vi.mocked(requireTenantViajesCerrar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09" })).status).toBe(403);
    expect(requireTenantViajesCerrar).toHaveBeenCalledWith("acme", "editar");
    expect(cerrarViajesMasivoPorPeriodo).not.toHaveBeenCalled();
  });

  it("la empresa y el usuario salen de la sesión; empresa_id en el cuerpo se RECHAZA (esquema estricto), nunca se envía ningún id de plan", async () => {
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", empresa_id: 99 })).status).toBe(400);
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", empresaId: 99 })).status).toBe(400);
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", planIds: [1, 2] })).status).toBe(400);
    expect(cerrarViajesMasivoPorPeriodo).not.toHaveBeenCalled();
    await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09" });
    expect(cerrarViajesMasivoPorPeriodo).toHaveBeenCalledWith({
      empresaId: 7, usuario: "jefe", tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", filtros: undefined, motivo: undefined, comentario: null,
    });
  });

  it("devuelve el resumen sin caché", async () => {
    const r = await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ cerrados: [{ id: 1, codigo: "P-1" }], omitidos: [], errores: [] });
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /tms/planes/cerrar-masivo-periodo — validación estricta del cuerpo", () => {
  it("NORMAL no acepta motivo ni comentario", async () => {
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", motivo: "no debería" })).status).toBe(400);
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", comentario: "x" })).status).toBe(400);
    expect(cerrarViajesMasivoPorPeriodo).not.toHaveBeenCalled();
  });

  it("MANUAL exige motivo común de 5 a 500 caracteres", async () => {
    expect((await post({ tipo: "MANUAL", agrupacion: "MES", valor: "2026-09" })).status).toBe(400);
    expect((await post({ tipo: "MANUAL", agrupacion: "MES", valor: "2026-09", motivo: "abcd" })).status).toBe(400);
    expect((await post({ tipo: "MANUAL", agrupacion: "MES", valor: "2026-09", motivo: "    ab   " })).status).toBe(400);
    expect((await post({ tipo: "MANUAL", agrupacion: "MES", valor: "2026-09", motivo: "x".repeat(501) })).status).toBe(400);
    expect(cerrarViajesMasivoPorPeriodo).not.toHaveBeenCalled();
    expect((await post({ tipo: "MANUAL", agrupacion: "MES", valor: "2026-09", motivo: "abcde" })).status).toBe(200);
  });

  it("comentario opcional, máximo 1000; vacío se envía como null", async () => {
    expect((await post({ tipo: "MANUAL", agrupacion: "MES", valor: "2026-09", motivo: "Motivo común", comentario: "y".repeat(1001) })).status).toBe(400);
    await post({ tipo: "MANUAL", agrupacion: "MES", valor: "2026-09", motivo: "  Motivo común  ", comentario: "   " });
    expect(cerrarViajesMasivoPorPeriodo).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "MANUAL", motivo: "Motivo común", comentario: null }));
    await post({ tipo: "MANUAL", agrupacion: "MES", valor: "2026-09", motivo: "Motivo común", comentario: "Detalle" });
    expect(cerrarViajesMasivoPorPeriodo).toHaveBeenLastCalledWith(expect.objectContaining({ comentario: "Detalle" }));
  });

  it("agrupación desconocida, valor vacío, cuerpo no JSON o tipo desconocido -> 400", async () => {
    expect((await post({ tipo: "NORMAL", agrupacion: "ANIO", valor: "2026" })).status).toBe(400);
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "" })).status).toBe(400);
    expect((await post({ tipo: "OTRO", agrupacion: "MES", valor: "2026-09" })).status).toBe(400);
    expect((await POST(new Request("http://x/api", { method: "POST", body: "no json" }), ctx)).status).toBe(400);
    expect(cerrarViajesMasivoPorPeriodo).not.toHaveBeenCalled();
  });

  it("filtros: solo acepta el subconjunto permitido (strict) — fechaDesde/fechaHasta/planIds/empresaId dentro de filtros se RECHAZAN", async () => {
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", filtros: { fechaDesde: "2026-01-01" } })).status).toBe(400);
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", filtros: { fechaHasta: "2026-01-01" } })).status).toBe(400);
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", filtros: { planIds: [1, 2] } })).status).toBe(400);
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", filtros: { empresaId: 99 } })).status).toBe(400);
    expect(cerrarViajesMasivoPorPeriodo).not.toHaveBeenCalled();
    await post({ tipo: "NORMAL", agrupacion: "SEMANA", valor: "2026-W40", filtros: { clienteId: 5, estado: "Descargado" } });
    expect(cerrarViajesMasivoPorPeriodo).toHaveBeenCalledWith(expect.objectContaining({
      agrupacion: "SEMANA", valor: "2026-W40", filtros: { clienteId: 5, estado: "Descargado" },
    }));
  });
});

/**
 * Corrección pre-merge PR #386 (bloqueo 1, ítem 5) — el esquema de filtros SÍ acepta soloPendientesCierre/
 * soloCerrados/soloSinCerrar como booleano (z.boolean(), nunca un string arbitrario) y los reenvía al servicio.
 */
describe("POST /tms/planes/cerrar-masivo-periodo — filtros de vista (bloqueo 1)", () => {
  it.each(["soloPendientesCierre", "soloCerrados", "soloSinCerrar"])("acepta y reenvía %s=true al servicio", async (campo) => {
    const filtros = { [campo]: true };
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", filtros })).status).toBe(200);
    expect(cerrarViajesMasivoPorPeriodo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ filtros }));
  });

  it.each(["soloPendientesCierre", "soloCerrados", "soloSinCerrar"])("rechaza un string en %s (400)", async (campo) => {
    expect((await post({ tipo: "NORMAL", agrupacion: "MES", valor: "2026-09", filtros: { [campo]: "1" } })).status).toBe(400);
    expect(cerrarViajesMasivoPorPeriodo).not.toHaveBeenCalled();
  });

  it("combina con los demás filtros existentes en el mismo objeto", async () => {
    await post({ tipo: "NORMAL", agrupacion: "SEMANA", valor: "2026-W40", filtros: { clienteId: 5, soloPendientesCierre: true } });
    expect(cerrarViajesMasivoPorPeriodo).toHaveBeenCalledWith(expect.objectContaining({
      filtros: { clienteId: 5, soloPendientesCierre: true },
    }));
  });
});

describe("POST /tms/planes/cerrar-masivo-periodo — período inválido resuelto por el servicio", () => {
  it("si el servicio responde { error } (p. ej. semana ISO inexistente, 2025 solo tiene 52), la ruta lo traduce a 400", async () => {
    vi.mocked(cerrarViajesMasivoPorPeriodo).mockResolvedValue({ error: "Valor de período inválido." } as never);
    const res = await post({ tipo: "NORMAL", agrupacion: "SEMANA", valor: "2025-W53" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Valor de período inválido." });
  });
});
