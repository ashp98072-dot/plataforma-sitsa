import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), simularReconstruccion: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-reconstruccion-aplicador", () => ({ simularReconstruccion: m.simularReconstruccion }));

import { NextResponse } from "next/server";
import * as ruta from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (cuerpo?: string) => new Request("http://local", { method: "POST", body: cuerpo });

beforeEach(() => {
  vi.resetAllMocks();
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { id: 3 } });
  m.simularReconstruccion.mockResolvedValue({ modo: "DRY_RUN", escribio: false, puedeAplicarse: false });
});

describe("POST reconstruccion/dry-run", () => {
  it("solo expone POST de dry-run: no hay ninguna ruta que APLIQUE la reconstrucción", () => {
    expect(Object.keys(ruta).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(["POST"]);
    const src = readFileSync("src/app/api/empresas/[slug]/rrhh/vacaciones/reconstruccion/dry-run/route.ts", "utf8");
    expect(src).not.toMatch(/aplicarReconstruccion/);
  });

  it("exige RRHH · Vacaciones · editar; sin permiso no procesa nada", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    const r = await ruta.POST(post("{}"), ctx);
    expect(r.status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "vacaciones", "editar");
    expect(m.simularReconstruccion).not.toHaveBeenCalled();
  });

  it("usa la empresa de la SESIÓN y pasa las decisiones del cuerpo; responde sin cache y como DRY_RUN", async () => {
    const decisiones = [{ clave: "x" }];
    const r = await ruta.POST(post(JSON.stringify({ decisiones, empresa_id: 999 })), ctx);
    expect(r.status).toBe(200);
    expect(m.simularReconstruccion).toHaveBeenCalledWith(7, decisiones);
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect(await r.json()).toMatchObject({ modo: "DRY_RUN", escribio: false });
  });

  it("sin cuerpo también funciona (sin decisiones)", async () => {
    const r = await ruta.POST(post(), ctx);
    expect(r.status).toBe(200);
    expect(m.simularReconstruccion).toHaveBeenCalledWith(7, undefined);
  });

  it("cuerpo no JSON → 400; cuerpo gigante → 413; fallo interno → 500 sin filtrar detalles", async () => {
    expect((await ruta.POST(post("{no es json"), ctx)).status).toBe(400);
    expect((await ruta.POST(post("x".repeat(200_001)), ctx)).status).toBe(413);
    m.simularReconstruccion.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await ruta.POST(post("{}"), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom");
  });
});
