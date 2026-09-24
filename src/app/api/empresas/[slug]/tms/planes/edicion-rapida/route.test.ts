import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn() }));
vi.mock("@/lib/tms/edicion-rapida-guardar", () => ({ guardarEdicionRapida: vi.fn() }));

import { requireTenantProgramacion } from "@/lib/tenant";
import { guardarEdicionRapida } from "@/lib/tms/edicion-rapida-guardar";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (body: unknown, raw = false) => POST(new Request("http://x/api", { method: "POST", body: raw ? String(body) : JSON.stringify(body) }), ctx);
const cambio = { planId: 101, esperado: { estado: "Programado", fechaPlan: "2026-09-24", horaCarga: "05:00", regresoEstimado: "2026-09-24T08:00", pilotoPersonalId: 10, auxiliarPersonalIds: [20], flotaVehiculoId: 30, tcVehiculoId: null },
  nuevo: { pilotoPersonalId: 11, auxiliarPersonalIds: [20], flotaVehiculoId: 30, tcVehiculoId: null } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7 }, session: { username: "jefe.ops" } } as never);
  vi.mocked(guardarEdicionRapida).mockResolvedValue({ ok: true, guardados: 1, filas: [{ planId: 101, estado: "guardado" }] });
});

describe("POST /tms/planes/edicion-rapida (guardar)", () => {
  it("exige EXACTAMENTE programacion:editar; sin permiso no guarda nada", async () => {
    await post({ motivoCambio: "x", cambios: [cambio] });
    expect(requireTenantProgramacion).toHaveBeenCalledWith("kt-monaco", "editar");
    vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: new Response("{}", { status: 403 }) } as never);
    vi.mocked(guardarEdicionRapida).mockClear();
    expect((await post({ cambios: [cambio] })).status).toBe(403);
    expect(guardarEdicionRapida).not.toHaveBeenCalled();
  });

  it("41/42) empresa Y usuario salen de la sesión; el cuerpo no acepta empresaId", async () => {
    expect((await post({ empresaId: 9, cambios: [cambio] })).status).toBe(400);
    expect(guardarEdicionRapida).not.toHaveBeenCalled();
    expect((await post({ motivoCambio: "Cambio operativo", cambios: [cambio] })).status).toBe(200);
    const [empresaId, usuario, datos] = vi.mocked(guardarEdicionRapida).mock.calls[0];
    expect([empresaId, usuario]).toEqual([7, "jefe.ops"]);
    expect(datos.cambios).toHaveLength(1);
  });

  it("200 con el resultado del guardado (mismo contrato de cuerpo que /validar) y sin caché", async () => {
    const res = await post({ motivoCambio: "x", cambios: [cambio] });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ ok: true, guardados: 1, filas: [{ planId: 101, estado: "guardado" }] });
  });

  it("409 cuando los cambios ya no son válidos (con las filas y sin el campo interno status)", async () => {
    vi.mocked(guardarEdicionRapida).mockResolvedValue({ ok: false, status: 409, error: "Los cambios ya no son válidos.", filas: [{ planId: 101, estado: "error", errores: [{ codigo: "PLAN_DESACTUALIZADO", mensaje: "x" }], advertencias: [] }] });
    const res = await post({ motivoCambio: "x", cambios: [cambio] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: "Los cambios ya no son válidos.", filas: [{ planId: 101, estado: "error" }] });
    expect(Object.keys(await (await post({ motivoCambio: "x", cambios: [cambio] })).json())).not.toContain("status");
  });

  it("409 sin lock y 500 inesperado", async () => {
    vi.mocked(guardarEdicionRapida).mockResolvedValue({ ok: false, status: 409, error: "No se pudo validar la disponibilidad de recursos porque hay otra operación en curso. Intenta de nuevo." });
    expect((await post({ motivoCambio: "x", cambios: [cambio] })).status).toBe(409);
    vi.mocked(guardarEdicionRapida).mockResolvedValue({ ok: false, status: 500, error: "No se pudo guardar la edición rápida. No se modificó ningún viaje." });
    expect((await post({ motivoCambio: "x", cambios: [cambio] })).status).toBe(500);
  });

  it("400: JSON malformado, cuerpo vacío, ids duplicados y más de 200 filas (no llega al guardado)", async () => {
    expect((await post("no-es-json", true)).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ cambios: [cambio, cambio] })).status).toBe(400);
    expect((await post({ cambios: Array.from({ length: 201 }, (_, i) => ({ ...cambio, planId: i + 1 })) })).status).toBe(400);
    expect(guardarEdicionRapida).not.toHaveBeenCalled();
  });

  it("usa el MISMO esquema que /validar y no toca la UI", async () => {
    const { readFileSync } = await import("node:fs");
    const guardar = readFileSync("src/app/api/empresas/[slug]/tms/planes/edicion-rapida/route.ts", "utf8");
    const validar = readFileSync("src/app/api/empresas/[slug]/tms/planes/edicion-rapida/validar/route.ts", "utf8");
    expect(guardar).toContain("validarEdicionRapidaSchema");
    expect(validar).toContain("validarEdicionRapidaSchema");
    expect(readFileSync("src/app/e/[slug]/programacion/programacion-client.tsx", "utf8")).not.toMatch(/edicion-rapida/i);
  });
});
