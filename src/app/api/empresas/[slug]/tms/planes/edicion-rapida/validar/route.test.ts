import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn() }));
vi.mock("@/lib/tms/edicion-rapida-validar", () => ({ validarEdicionRapida: vi.fn() }));

import { requireTenantProgramacion } from "@/lib/tenant";
import { validarEdicionRapida } from "@/lib/tms/edicion-rapida-validar";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (body: unknown, raw = false) => POST(new Request("http://x/api", { method: "POST", body: raw ? String(body) : JSON.stringify(body) }), ctx);
const cambio = { planId: 101, esperado: { estado: "Programado", fechaPlan: "2026-09-24", horaCarga: "05:00", regresoEstimado: "2026-09-24T08:00", pilotoPersonalId: 10, auxiliarPersonalIds: [20], flotaVehiculoId: 30, tcVehiculoId: null },
  nuevo: { pilotoPersonalId: 11, auxiliarPersonalIds: [20], flotaVehiculoId: 30, tcVehiculoId: null } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7 }, session: { username: "ops" } } as never);
  vi.mocked(validarEdicionRapida).mockResolvedValue({ ok: true, filas: [{ planId: 101, estado: "ok", errores: [], advertencias: [] }] });
});

describe("POST /tms/planes/edicion-rapida/validar", () => {
  it("exige EXACTAMENTE programacion:editar", async () => {
    await post({ motivoCambio: "x", cambios: [cambio] });
    expect(requireTenantProgramacion).toHaveBeenCalledWith("kt-monaco", "editar");
  });

  it("sin permiso: devuelve el error del guard y no valida nada", async () => {
    vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: new Response("{}", { status: 403 }) } as never);
    const res = await post({ cambios: [cambio] });
    expect(res.status).toBe(403);
    expect(validarEdicionRapida).not.toHaveBeenCalled();
  });

  it("33) la empresa sale SIEMPRE de la sesión: el cuerpo no puede traer empresaId (esquema estricto)", async () => {
    expect((await post({ empresaId: 999, cambios: [cambio] })).status).toBe(400);
    expect((await post({ cambios: [{ ...cambio, empresaId: 999 }] })).status).toBe(400);
    expect(validarEdicionRapida).not.toHaveBeenCalled();
    expect((await post({ motivoCambio: "Cambio operativo", cambios: [cambio] })).status).toBe(200);
    expect(vi.mocked(validarEdicionRapida).mock.calls[0][0]).toBe(7);
  });

  it("200 con el resultado por fila y sin caché; el cuerpo validado llega al núcleo", async () => {
    const res = await post({ motivoCambio: " Piloto no se presentó ", cambios: [cambio] });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ ok: true, filas: [{ planId: 101, estado: "ok", errores: [], advertencias: [] }] });
    expect(vi.mocked(validarEdicionRapida).mock.calls[0][1]).toMatchObject({ motivoCambio: "Piloto no se presentó" });
  });

  it("una fila en error sigue siendo 200 con ok=false (la validación es informativa)", async () => {
    vi.mocked(validarEdicionRapida).mockResolvedValue({ ok: false, filas: [{ planId: 101, estado: "error", errores: [{ codigo: "RECURSO_OCUPADO_BD", mensaje: "x" }], advertencias: [] }] });
    const res = await post({ motivoCambio: "x", cambios: [cambio] });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(false);
  });

  it("400: JSON malformado, cuerpo vacío, planId repetido, más de 200 filas", async () => {
    expect((await post("no-es-json", true)).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ cambios: [] })).status).toBe(400);
    expect((await post({ cambios: [cambio, cambio] })).status).toBe(400);
    expect((await post({ cambios: Array.from({ length: 201 }, (_, i) => ({ ...cambio, planId: i + 1 })) })).status).toBe(400);
    expect(validarEdicionRapida).not.toHaveBeenCalled();
  });

  it("no crea el endpoint de guardado ni toca la UI", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    expect(existsSync("src/app/api/empresas/[slug]/tms/planes/edicion-rapida/route.ts")).toBe(false);
    expect(readFileSync("src/app/e/[slug]/programacion/programacion-client.tsx", "utf8")).not.toMatch(/edicion-rapida/i);
  });
});
